import React, { useCallback, useEffect, useRef, useState } from "react";
import { PermissionsAndroid, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  Marker,
  UserLocation,
} from "@maplibre/maplibre-react-native";
import { cellToBoundary, latLngToCell } from "h3-js";
import { apiJson } from "../api/client";
import { getLocalPoints } from "./walkStore";
import { Pedometer } from "expo-sensors";
import * as Location from "expo-location";
import { colorForUser } from "../map/userColors";
import Avatar, { AvatarPreset } from "../components/Avatar";
import { useLanguage } from "../i18n/LanguageContext";

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

type ServerHex = {
  h3_index: string;
  owner_display_name: string;
  is_mine: boolean;
  hex_score_m: number;
  boundary: number[][];
  expires_at: string;
};

type LocalPt = {
  seq: number;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  recorded_at: string;
};

type LiveDot = {
  user_id: string;
  display_name: string;
  latitude: number;
  longitude: number;
  h3_index: string;
  updated_at: number;
  avatar_key: string | null;
};

function haversineM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(a));
}

function cellRing(cell: string): number[][] {
  const ring: number[][] = cellToBoundary(cell, true);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    return [...ring, first];
  }
  return ring;
}

// Backend h3_index ab decimal string mein aata hai; h3-js hex string
// use karta hai. BigInt conversion lossless hai (Number se precision
// jaati) — is se server hex seedha cell se match hota hai, ray-casting
// ki zaroorat nahi.
function serverHexByCell(hexes: ServerHex[]): Record<string, ServerHex> {
  const out: Record<string, ServerHex> = {};
  for (const h of hexes) out[BigInt(h.h3_index).toString(16)] = h;
  return out;
}

function polygonFC(cells: string[]) {
  return {
    type: "FeatureCollection" as const,
    features: cells.map((h3) => ({
      type: "Feature" as const,
      geometry: {
        type: "Polygon" as const,
        coordinates: [cellRing(h3)],
      },
      properties: {},
    })),
  };
}

function serverFC(hexes: ServerHex[]) {
  return {
    type: "FeatureCollection" as const,
    features: hexes.map((h) => ({
      type: "Feature" as const,
      geometry: {
        type: "Polygon" as const,
        coordinates: [h.boundary],
      },
      properties: {},
    })),
  };
}

// Live dots: one Point per walking user, colour = that user's colour.
// Provisional hexes: the hex each live friend is in RIGHT NOW (their
// h3_index is already in the live response). Yellow = not confirmed
// yet; the real (solid) hex replaces it after validation.
function toProvisionalFC(list: LiveDot[]) {
  return {
    type: "FeatureCollection" as const,
    features: list.map((d) => ({
      type: "Feature" as const,
      geometry: {
        type: "Polygon" as const,
        coordinates: [cellRing(BigInt(d.h3_index).toString(16))],
      },
      properties: {},
    })),
  };
}

// Trails: one LineString per live user, in that user's colour.
function toTrailFC(trails: Record<string, [number, number][]>, names: Record<string, string>) {
  return {
    type: "FeatureCollection" as const,
    features: Object.entries(trails)
      .filter(([, pts]) => pts.length >= 2)
      .map(([uid, pts]) => ({
        type: "Feature" as const,
        geometry: { type: "LineString" as const, coordinates: pts },
        properties: { color: colorForUser(names[uid] ?? uid) },
      })),
  };
}

export default function WalkLiveMap({
  sessionUuid,
  showOverlay = true,
}: {
  sessionUuid: string | null;
  showOverlay?: boolean;
}) {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const [path, setPath] = useState<[number, number][]>([]);
  const [cellDist, setCellDist] = useState<Record<string, number>>({});
  const [serverHexes, setServerHexes] = useState<ServerHex[]>([]);
  const [liveDots, setLiveDots] = useState<LiveDot[]>([]);
  const [presets, setPresets] = useState<AvatarPreset[]>([]);
  // Trail: last 15 positions per live user (client-side only).
  const [trails, setTrails] = useState<Record<string, [number, number][]>>({});
  // My own avatar + position (the live dots are friends only).
  const [me, setMe] = useState<{ avatar_key: string | null; display_name: string } | null>(null);
  const [myPos, setMyPos] = useState<[number, number] | null>(null);
  // Latest known position for the live-dots bbox (updated by the
  // preview branch and by every tick while walking).
  const liveCenterRef = useRef<[number, number] | null>(null);
  const othersByOwner: Record<string, ServerHex[]> = {};
  for (const h of serverHexes.filter((h) => !h.is_mine)) {
    (othersByOwner[h.owner_display_name] ??= []).push(h);
  }
  const [center, setCenter] = useState<[number, number] | null>(null);
  const [steps, setSteps] = useState<number | null>(null);
  const lastFetchRef = useRef<[number, number] | null>(null);

  // Live dots in the same bbox as the hexes. Fail-open: a live fetch
  // failure never touches the hexes or the status bar.
  const fetchLive = useCallback(async (c: [number, number]) => {
    const [lon, lat] = c;
    const d = 0.04;
    const bbox = `${lon - d},${lat - d},${lon + d},${lat + d}`;
    try {
      const data = await apiJson<LiveDot[]>(
        `/live/map?bbox=${encodeURIComponent(bbox)}`,
      );
      setLiveDots(data);
      // Trail: append each live position (cap 15), drop users who
      // stopped appearing.
      setTrails((prev) => {
        const next: Record<string, [number, number][]> = {};
        for (const d of data) {
          const pt: [number, number] = [d.longitude, d.latitude];
          const old = prev[d.user_id] ?? [];
          const last = old[old.length - 1];
          const moved = !last || last[0] !== pt[0] || last[1] !== pt[1];
          next[d.user_id] = moved ? [...old, pt].slice(-15) : old;
        }
        return next;
      });
    } catch {
      // Live dots are best-effort; ignore the failure.
    }
  }, []);
  useEffect(() => {
    apiJson<AvatarPreset[]>("/users/avatar-presets")
      .then(setPresets)
      .catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const m = await apiJson<{ user_id: string; display_name: string }>("/auth/me");
        const prof = await apiJson<{ avatar_key: string | null }>(`/users/${m.user_id}/profile`);
        setMe({ avatar_key: prof.avatar_key ?? null, display_name: m.display_name });
      } catch {
        // My avatar is best-effort; the dot stays if this fails.
      }
    })();
  }, []);

  useEffect(() => {
    if (!sessionUuid) {
      setSteps(null);
      return;
    }
    let baseline: number | null = null;
    let sub: { remove: () => void } | null = null;
    (async () => {
      try {
        if (await Pedometer.isAvailableAsync()) {
          sub = Pedometer.watchStepCount((result) => {
            if (baseline === null) baseline = result.steps;
            setSteps(result.steps - (baseline ?? 0));
          });
        }
      } catch {
        // Pedometer unavailable — steps stay null, walk continues.
      }
    })();
    return () => {
      sub?.remove();
    };
  }, [sessionUuid]);

  useEffect(() => {
    let stopped = false;
    if (!sessionUuid) {
      // Preview mode (no session): centre on the user's current
      // position and show nearby hexes; no points or steps.
      setPath([]);
      setCellDist({});
      setSteps(null);
      (async () => {
        try {
          const pos = await Location.getCurrentPositionAsync({});
          if (stopped) return;
          const lon = pos.coords.longitude;
          const lat = pos.coords.latitude;
          setCenter([lon, lat]);
          setMyPos([lon, lat]);
          lastFetchRef.current = [lon, lat];
          liveCenterRef.current = [lon, lat];
          const d = 0.04;
          const bbox = `${lon - d},${lat - d},${lon + d},${lat + d}`;
          const rows = await apiJson<ServerHex[]>(
            `/territories/map?bbox=${encodeURIComponent(bbox)}`,
          );
          if (!stopped) setServerHexes(rows);
          fetchLive([lon, lat]);
        } catch {
          // Location unavailable — the fallback home centre stays.
        }
      })();
      return () => {
        stopped = true;
      };
    }
    const tick = async () => {
      try {
        const raw = (await getLocalPoints(
          sessionUuid,
        )) as unknown as LocalPt[];
        const pts = [...raw].sort((a, b) => a.seq - b.seq);
        if (stopped) return;
        const p = pts.map(
          (pt) => [pt.longitude, pt.latitude] as [number, number],
        );
        setPath(p);
        const dist: Record<string, number> = {};
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1];
          const b = pts[i];
          const d = haversineM(
            a.latitude,
            a.longitude,
            b.latitude,
            b.longitude,
          );
          const cell = latLngToCell(b.latitude, b.longitude, 9);
          dist[cell] = (dist[cell] ?? 0) + d;
        }
        setCellDist(dist);
        // Steps now come from the watchStepCount subscription above.
        // getStepCountAsync(date range) is not supported on Android.
        const last = p[p.length - 1];
        if (last) {
          setCenter((prev) => prev ?? last);
          const lf = lastFetchRef.current;
          if (
            !lf ||
            haversineM(lf[1], lf[0], last[1], last[0]) > 400
          ) {
            lastFetchRef.current = last;
            const d = 0.04;
            const bbox = `${last[0] - d},${last[1] - d},${last[0] + d},${last[1] + d}`;
            apiJson<ServerHex[]>(
              `/territories/map?bbox=${encodeURIComponent(bbox)}`,
            )
              .then((rows) => {
                if (!stopped) setServerHexes(rows);
              })
              .catch(() => {});
          }
          // Live dots refresh every tick (5 s).
          liveCenterRef.current = last;
          setMyPos(last);
          fetchLive(last);
        }
      } catch {
        // Local read — retry on the next tick.
      }
    };
    (async () => {
      if (Platform.OS === "android") {
        try {
          await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
          );
        } catch {
          // Denied — steps stay unavailable, walk continues.
        }
      }
    })();
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [sessionUuid, fetchLive]);

  // Live dots keep refreshing every 5 s (also in preview/idle mode,
  // where the tick above does not run).
  useEffect(() => {
    const id = setInterval(() => {
      if (liveCenterRef.current) {
        fetchLive(liveCenterRef.current);
      }
    }, 5000);
    return () => clearInterval(id);
  }, [fetchLive]);

  const hexMap = serverHexByCell(serverHexes);
  const cells = Object.entries(cellDist).map(([h3, dist]) => {
    const match = hexMap[h3];
    let kind: "walk" | "capture" | "challenge" | "own" =
      dist >= 100 ? "capture" : "walk";
    if (match && !match.is_mine) kind = "challenge";
    else if (match && match.is_mine) kind = "own";
    return { h3, dist, kind, match };
  });
  const byKind = (kind: string) => cells.filter((c) => c.kind === kind).map((c) => c.h3);

  let statusText = t("live.startHint");
  let progress = 0;
  let barColor = "#B8860B";
  if (path.length > 0) {
    const last = path[path.length - 1];
    const cell = latLngToCell(last[1], last[0], 9);
    const dist = Math.floor(cellDist[cell] ?? 0);
    const match = hexMap[cell];
    if (match && !match.is_mine) {
      const score = Math.floor(match.hex_score_m);
      statusText =
        dist > score
          ? t("live.winning", { dist, score, owner: match.owner_display_name })
          : t("live.challengeNeed", { owner: match.owner_display_name, score, dist });
      progress = Math.min(1, dist / (score + 1));
      barColor = "#cc3300";
    } else if (match && match.is_mine) {
      statusText =
        dist >= 50
          ? t("live.ownRefresh", { dist })
          : t("live.ownNeed", { dist });
      progress = Math.min(1, dist / 50);
      barColor = "#008800";
    } else if (dist >= 100) {
      statusText = t("live.capturePreview", { dist });
      progress = 1;
      barColor = "#B8860B";
    } else {
      statusText = t("live.neutralNeed", { dist, remain: 100 - dist });
      progress = Math.min(1, dist / 100);
      barColor = "#B8860B";
    }
  }

  const mapCenter: [number, number] = center ?? [70.4693514, 28.5528843];

  const pathFC = {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        geometry: {
          type: "LineString" as const,
          coordinates: path,
        },
        properties: {},
      },
    ],
  };

  return (
    <View style={styles.container}>
      <Map style={styles.map} mapStyle={STYLE_URL} compassPosition={{ top: insets.top + 64, right: 12 }}>
        <Camera
          initialViewState={{ center: mapCenter, zoom: 16 }}
          trackUserLocation="default"
        />
        <UserLocation accuracy={false} heading={false} />
        {path.length >= 2 && (
          <GeoJSONSource id="walk-path" data={pathFC}>
            <Layer
              id="walk-line"
              type="line"
              paint={{ "line-color": "#0066ff", "line-width": 4 }}
            />
          </GeoJSONSource>
        )}
        <GeoJSONSource
          id="srv-mine"
          data={serverFC(serverHexes.filter((h) => h.is_mine))}
        >
          <Layer
            id="srv-mine-fill"
            type="fill"
            paint={{
              "fill-color": "rgba(0, 180, 0, 0.35)",
              "fill-outline-color": "#008800",
            }}
          />
        </GeoJSONSource>
        {Object.entries(othersByOwner).map(([owner, list]) => (
          <GeoJSONSource key={`srv-others-${owner}`} id={`srv-others-${owner}`} data={serverFC(list)}>
            <Layer
              id={`srv-others-fill-${owner}`}
              type="fill"
              paint={{
                "fill-color": colorForUser(owner),
                "fill-opacity": 0.35,
                "fill-outline-color": colorForUser(owner),
              }}
            />
          </GeoJSONSource>
        ))}
        <GeoJSONSource id="pv-walk" data={polygonFC(byKind("walk"))}>
          <Layer
            id="pv-walk-fill"
            type="fill"
            paint={{
              "fill-color": "rgba(255, 215, 0, 0.25)",
              "fill-outline-color": "#B8860B",
            }}
          />
        </GeoJSONSource>
        <GeoJSONSource id="pv-capture" data={polygonFC(byKind("capture"))}>
          <Layer
            id="pv-capture-fill"
            type="fill"
            paint={{
              "fill-color": "rgba(255, 215, 0, 0.45)",
              "fill-outline-color": "#B8860B",
            }}
          />
        </GeoJSONSource>
        <GeoJSONSource id="pv-challenge" data={polygonFC(byKind("challenge"))}>
          <Layer
            id="pv-challenge-fill"
            type="fill"
            paint={{
              "fill-color": "rgba(255, 69, 0, 0.45)",
              "fill-outline-color": "#cc3300",
            }}
          />
        </GeoJSONSource>
        <GeoJSONSource id="pv-own" data={polygonFC(byKind("own"))}>
          <Layer
            id="pv-own-fill"
            type="fill"
            paint={{
              "fill-color": "rgba(0, 180, 0, 0.25)",
              "fill-outline-color": "#008800",
            }}
          />
        </GeoJSONSource>
        <GeoJSONSource id="live-prov" data={toProvisionalFC(liveDots)}>
          <Layer
            id="live-prov-fill"
            type="fill"
            paint={{
              "fill-color": "rgba(255, 215, 0, 0.20)",
              "fill-outline-color": "#B8860B",
            }}
          />
          <Layer
            id="live-prov-line"
            type="line"
            paint={{ "line-color": "#B8860B", "line-width": 2 }}
          />
        </GeoJSONSource>
        <GeoJSONSource
          id="live-trails"
          data={toTrailFC(
            trails,
            Object.fromEntries(liveDots.map((d) => [d.user_id, d.display_name])),
          )}
        >
          <Layer
            id="live-trails-line"
            type="line"
            paint={{
              "line-color": ["get", "color"],
              "line-width": 3,
              "line-opacity": 0.7,
            }}
          />
        </GeoJSONSource>
        {liveDots.map((d) => (
          <Marker
            key={`live-av-${d.user_id}`}
            id={`live-av-${d.user_id}`}
            lngLat={[d.longitude, d.latitude]}
            anchor="center"
          >
            <View style={styles.liveAvatarWrap}>
              <Avatar
                avatarKey={d.avatar_key ?? null}
                presets={presets}
                displayName={d.display_name}
                size={28}
              />
            </View>
          </Marker>
        ))}
        {myPos && me && (
          <Marker
            key="my-avatar"
            id="my-avatar"
            lngLat={myPos}
            anchor="center"
          >
            <View style={styles.myAvatarWrap}>
              <Avatar
                avatarKey={me.avatar_key}
                presets={presets}
                displayName={me.display_name}
                size={30}
              />
            </View>
          </Marker>
        )}
      </Map>
      <View style={[styles.topBar, { top: insets.top }]}>
        <Text style={styles.status}>{statusText}</Text>
        <Text style={styles.status}>
          <Text style={{ color: "#dc2626" }}>●</Text> LIVE {liveDots.length}
        </Text>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${Math.round(progress * 100)}%`, backgroundColor: barColor },
            ]}
          />
        </View>
      </View>
      {showOverlay ? (
        <View style={styles.overlay}>
          <Text style={styles.status}>{t("live.steps", { steps: steps === null ? "—" : steps })}</Text>
          <Text style={styles.legend}>
            <Text style={{ color: "#008800" }}>●</Text> {t("live.legendOwn")}{"  "}
            <Text style={{ color: "#aa0000" }}>●</Text> {t("live.legendOther")}{"  "}
            <Text style={{ color: "#B8860B" }}>●</Text> {t("live.legendCapture")}{"  "}
            <Text style={{ color: "#cc3300" }}>●</Text> {t("live.legendChallenge")}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  myAvatarWrap: {
    borderWidth: 3,
    borderColor: "#FFD700",
    borderRadius: 18,
    elevation: 4,
    shadowColor: "#000000",
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  liveAvatarWrap: {
    borderWidth: 2,
    borderColor: "#ffffff",
    borderRadius: 16,
    elevation: 3,
    shadowColor: "#000000",
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  container: { flex: 1 },
  map: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  overlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(255, 255, 255, 0.88)",
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(255, 255, 255, 0.88)",
    paddingVertical: 6,
    paddingHorizontal: 8,
    gap: 4,
  },
  progressTrack: {
    height: 6,
    backgroundColor: "#dddddd",
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: { height: 6, borderRadius: 3 },
  status: { fontSize: 13 },
  legend: { fontSize: 11, color: "#333333" },
});
