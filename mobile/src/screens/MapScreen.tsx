import React, { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  Marker,
  UserLocation,
  type ViewStateChangeEvent,
} from "@maplibre/maplibre-react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { cellToBoundary, latLngToCell } from "h3-js";
import { apiJson } from "../api/client";
import { getCached, lastSyncedLabel, setCached } from "../cache/cache";
import Avatar, { AvatarPreset } from "../components/Avatar";
import { colorForUser } from "../map/userColors";
import { useLanguage } from "../i18n/LanguageContext";

type HexItem = {
  h3_index: string;
  owner_user_id: string;
  owner_display_name: string;
  avatar_key: string | null;
  is_mine: boolean;
  hex_score_m: number;
  boundary: number[][];
  expires_at: string;
};

type MeItem = {
  h3_index: string;
  hex_score_m: number;
  expires_at: string;
  locked_until: string;
  seconds_remaining: number;
};

type FriendItem = {
  user_id?: string;
  id?: string;
  friend_id?: string;
};

type OwnerProfile = {
  avatar_key?: string | null;
  city?: string | null;
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

// MapLibre demo tiles (OSM data, no API key needed).
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

// The library's LngLat is a [lng, lat] tuple, but normalise defensively
// so a {lng, lat} shape can never break the bbox fetch.
function toLonLat(c: unknown): [number, number] | null {
  if (
    Array.isArray(c) &&
    c.length >= 2 &&
    typeof c[0] === "number" &&
    typeof c[1] === "number"
  ) {
    return [c[0], c[1]];
  }
  if (c && typeof c === "object") {
    const o = c as Record<string, unknown>;
    const lng = o.lng ?? o.lon;
    const lat = o.lat;
    if (typeof lng === "number" && typeof lat === "number") {
      return [lng, lat];
    }
  }
  return null;
}

// Tap point -> decimal-string h3 cell (same conversion as WalkLiveMap:
// latLngToCell gives a hex string, BigInt keeps it lossless).
function cellDecimal(lat: number, lng: number): string {
  return BigInt("0x" + latLngToCell(lat, lng, 9)).toString();
}

function daysLeft(iso: string): number {
  return Math.max(
    0,
    Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000),
  );
}

function toFeatureCollection(list: HexItem[]) {
  return {
    type: "FeatureCollection" as const,
    features: list.map((h) => ({
      type: "Feature" as const,
      geometry: {
        type: "Polygon" as const,
        coordinates: [h.boundary],
      },
      properties: { h3: String(h.h3_index) },
    })),
  };
}

// H3 boundary ring for a hex string (closed, [lng, lat] pairs).
function cellRing(cell: string): number[][] {
  const ring: number[][] = cellToBoundary(cell, true);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    return [...ring, first];
  }
  return ring;
}

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

// Centre of a hex from its boundary ring (the ring's last point
// duplicates the first, so it is excluded from the average).
function hexCenter(boundary: number[][]): [number, number] {
  const pts = boundary.length > 1 ? boundary.slice(0, -1) : boundary;
  let lon = 0;
  let lat = 0;
  for (const [lo, la] of pts) {
    lon += lo;
    lat += la;
  }
  return [lon / pts.length, lat / pts.length];
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

export default function MapScreen({ navigation }: any) {
  const [initialCenter, setInitialCenter] = useState<[number, number] | null>(
    null,
  );
  const [hexes, setHexes] = useState<HexItem[]>([]);
  const [mineCount, setMineCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cacheLabel, setCacheLabel] = useState("");
  const [liveOffline, setLiveOffline] = useState(false);
  const [friendsOnly, setFriendsOnly] = useState(false);
  const [friendIds, setFriendIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<HexItem | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<OwnerProfile | null>(
    null,
  );
  const [presets, setPresets] = useState<AvatarPreset[]>([]);
  const [liveDots, setLiveDots] = useState<LiveDot[]>([]);
  // Map zoom, for the hex flags (shown only when zoomed in).
  const [zoom, setZoom] = useState(14);
  // Trail: last 15 positions per live user (client-side only).
  const [trails, setTrails] = useState<Record<string, [number, number][]>>({});
  const regionRef = useRef<[number, number] | null>(null);
  const [cameraTarget, setCameraTarget] = useState<[number, number] | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [latInput, setLatInput] = useState("");
  const [lngInput, setLngInput] = useState("");
  const [searchError, setSearchError] = useState("");
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();

  // Live dots in the same bbox as the hexes. Fail-open: a live fetch
  // failure never sets the map error — the hexes keep working.
  const fetchLive = useCallback(async (center: [number, number]) => {
    const [lon, lat] = center;
    // Same +/-0.04 deg as WalkLiveMap: the live count must match the
    // Walk map (the hex fetch below stays at 0.01).
    const d = 0.04;
    const bbox = `${lon - d},${lat - d},${lon + d},${lat + d}`;
    try {
      const data = await apiJson<LiveDot[]>(
        `/live/map?bbox=${encodeURIComponent(bbox)}`,
      );
      setLiveDots(data);
      setLiveOffline(false);
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
      // Live dots are best-effort; show a friendly hint, not an error.
      setLiveOffline(true);
    }
  }, []);

  const fetchMap = useCallback(async (center: [number, number]) => {
    setLoading(true);
    setError(null);
    const [lon, lat] = center;
    const d = 0.01;
    const bbox = `${lon - d},${lat - d},${lon + d},${lat + d}`;
    try {
      const data = await apiJson<HexItem[]>(
        `/territories/map?bbox=${encodeURIComponent(bbox)}`,
      );
      setHexes(data);
      const me = await apiJson<MeItem[]>("/territories/me");
      setMineCount(me.length);
      await setCached("map:hexes", data);
      await setCached("map:mineCount", me.length);
      setCacheLabel("");
      fetchLive(center);
    } catch {
      // Offline: show the cached hexes (if any) with a "Cached" label.
      const cachedHexes = await getCached<HexItem[]>("map:hexes");
      const cachedMine = await getCached<number>("map:mineCount");
      if (cachedHexes) {
        setHexes(cachedHexes.data);
        if (cachedMine) setMineCount(cachedMine.data);
        setCacheLabel(lastSyncedLabel(cachedHexes.updatedAt));
        setError(null);
      } else {
        setError(t("map.loadFailed"));
      }
    } finally {
      setLoading(false);
    }
  }, [fetchLive]);

  const loadFriends = useCallback(async () => {
    try {
      const data = await apiJson<FriendItem[] | { friends?: FriendItem[] }>(
        "/friends",
      );
      const list = Array.isArray(data) ? data : (data.friends ?? []);
      const ids = new Set<string>();
      for (const f of list) {
        const fid = f.user_id ?? f.id ?? f.friend_id;
        if (fid) ids.add(fid);
      }
      setFriendIds(ids);
    } catch {
      // If friends fail to load, the filter falls back to mine only.
      setFriendIds(new Set());
    }
  }, []);

  useEffect(() => {
    loadFriends();
  }, [loadFriends]);

  // Live dots refresh every 5 s while this screen is mounted.
  useEffect(() => {
    const id = setInterval(() => {
      if (regionRef.current) {
        fetchLive(regionRef.current);
      }
    }, 5000);
    return () => clearInterval(id);
  }, [fetchLive]);

  useEffect(() => {
    apiJson<AvatarPreset[]>("/users/avatar-presets")
      .then(setPresets)
      .catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        setError(t("map.locationDenied"));
        return;
      }
      const pos = await Location.getCurrentPositionAsync({});
      const center: [number, number] = [
        pos.coords.longitude,
        pos.coords.latitude,
      ];
      regionRef.current = center;
      setInitialCenter(center);
      await fetchMap(center);
    })();
  }, [fetchMap]);

  // Walk ke baad Map tab pe wapas aane pe hexes taaza karo.
  useFocusEffect(
    useCallback(() => {
      if (regionRef.current) {
        fetchMap(regionRef.current);
      }
    }, [fetchMap]),
  );

  const onRegionDidChange = useCallback(
    (event: NativeSyntheticEvent<ViewStateChangeEvent>) => {
      const center = toLonLat(event.nativeEvent.center);
      if (center) {
        regionRef.current = center;
      }
      if (typeof event.nativeEvent.zoom === "number") {
        setZoom(event.nativeEvent.zoom);
      }
    },
    [],
  );

  const onMapPress = useCallback(
    (event: any) => {
      const ne = event.nativeEvent ?? event ?? {};
      // This MapLibre version sends no features/geometry on press —
      // only lngLat, so convert the tap point to its h3 cell.
      const c = toLonLat(ne.lngLat);
      const cell = c ? cellDecimal(c[1], c[0]) : null;
      if (!cell) return;
      const hit = hexes.find((h) => h.h3_index === cell);
      setSelected(hit ?? null);
      if (hit) {
        apiJson<OwnerProfile>(`/users/${hit.owner_user_id}/profile`)
          .then((p) => setSelectedProfile(p))
          .catch(() => setSelectedProfile(null));
      } else {
        setSelectedProfile(null);
      }
    },
    [hexes],
  );

  const onRefresh = useCallback(async () => {
    await loadFriends();
    if (regionRef.current) {
      await fetchMap(regionRef.current);
    }
  }, [fetchMap, loadFriends]);

  const goTo = useCallback(
    async (center: [number, number]) => {
      regionRef.current = center;
      // Camera props (v11: center/zoom/easing/duration) se move karte hain —
      // setCamera nahi hai (TypeError deta hai). Target ko thodi der
      // baad clear karte hain taake agli dafa prop dobara change ho.
      setCameraTarget(center);
      await fetchMap(center);
      setTimeout(() => setCameraTarget(null), 600);
    },
    [fetchMap],
  );

  const goToCurrentLocation = useCallback(async () => {
    setSearchError("");
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        const req = await Location.requestForegroundPermissionsAsync();
        if (req.status !== "granted") {
          setSearchError(t("map.locationDenied"));
          return;
        }
      }
      const pos = await Location.getCurrentPositionAsync({});
      await goTo([pos.coords.longitude, pos.coords.latitude]);
    } catch {
      // Permission nahi, koi aur masla hai — ghalat message mat dikhao.
      setSearchError(t("map.loadFailed"));
    }
  }, [goTo, t]);

  const goToCoords = useCallback(async () => {
    const lat = parseFloat(latInput);
    const lng = parseFloat(lngInput);
    if (
      Number.isNaN(lat) ||
      Number.isNaN(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      setSearchError(t("map.invalidCoords"));
      return;
    }
    setSearchError("");
    setSearchOpen(false);
    try {
      await goTo([lng, lat]);
    } catch {
      setSearchError(t("map.loadFailed"));
    }
  }, [latInput, lngInput, goTo, t]);

  const visibleHexes = friendsOnly
    ? hexes.filter((h) => h.is_mine || friendIds.has(h.owner_user_id))
    : hexes;
  const mine = toFeatureCollection(visibleHexes.filter((h) => h.is_mine));
  const othersByOwner: Record<string, HexItem[]> = {};
  for (const h of visibleHexes.filter((h) => !h.is_mine)) {
    (othersByOwner[h.owner_display_name] ??= []).push(h);
  }

  return (
    <View style={styles.container}>
      {initialCenter ? (
        <Map
          style={styles.map}
          mapStyle={STYLE_URL}
          compassPosition={{ top: insets.top + 116, right: 12 }}
          onRegionDidChange={onRegionDidChange}
          onPress={onMapPress}
        >
          <Camera
            initialViewState={{ center: initialCenter, zoom: 14 }}
            center={cameraTarget ?? undefined}
            zoom={cameraTarget ? 14 : undefined}
            easing="fly"
            duration={500}
          />
          <UserLocation />
          <GeoJSONSource id="mine" data={mine}>
            <Layer
              id="mine-fill"
              type="fill"
              paint={{
                "fill-color": "rgba(0, 180, 0, 0.35)",
                "fill-outline-color": "#008800",
              }}
            />
            <Layer
              id="mine-line"
              type="line"
              paint={{ "line-color": "#008800", "line-width": 2 }}
            />
          </GeoJSONSource>
{Object.entries(othersByOwner).map(([owner, list]) => (
            <GeoJSONSource key={`others-${owner}`} id={`others-${owner}`} data={toFeatureCollection(list)}>
              <Layer
                id={`others-fill-${owner}`}
                type="fill"
                paint={{
                  "fill-color": colorForUser(owner),
                  "fill-opacity": 0.35,
                  "fill-outline-color": colorForUser(owner),
                }}
              />
              <Layer
                id={`others-line-${owner}`}
                type="line"
                paint={{ "line-color": colorForUser(owner), "line-width": 2 }}
              />
            </GeoJSONSource>
          ))}
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
          {zoom >= 15 &&
            hexes.map((h) => {
              const [flon, flat] = hexCenter(h.boundary);
              return (
                <Marker
                  key={`flag-${h.h3_index}`}
                  id={`flag-${h.h3_index}`}
                  lngLat={[flon, flat]}
                  anchor="center"
                >
                  <View style={styles.flagWrap}>
                    <Ionicons
                      name="flag"
                      size={14}
                      color={colorForUser(h.owner_display_name)}
                    />
                    <Avatar
                      avatarKey={h.avatar_key ?? null}
                      presets={presets}
                      displayName={h.owner_display_name}
                      size={22}
                    />
                  </View>
                </Marker>
              );
            })}
        </Map>
      ) : (
        <Text style={styles.locating}>{t("map.locating")}</Text>
      )}

      {/* Floating top bar: territories count + All/Friends filter. */}
      <View style={[styles.topBar, { top: insets.top + 12 }]}>
        <Text style={styles.count}>{t("map.myTerritories", { count: mineCount })}</Text>
        <View style={styles.tabRow}>
          <Pressable onPress={() => setFriendsOnly(false)}>
            <Text style={!friendsOnly ? styles.tabActive : styles.tabInactive}>
              {t("map.all")}
            </Text>
          </Pressable>
          <Pressable onPress={() => setFriendsOnly(true)}>
            <Text style={friendsOnly ? styles.tabActive : styles.tabInactive}>
              {t("map.friends")}
            </Text>
          </Pressable>
          <Pressable
            style={{ marginLeft: "auto" }}
            onPress={() => setSearchOpen((v) => !v)}
          >
            <Ionicons name="search" size={20} color="#007AFF" />
          </Pressable>
        </View>
        {searchOpen ? (
          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              placeholder="Lat"
              value={latInput}
              onChangeText={setLatInput}
              keyboardType="numbers-and-punctuation"
            />
            <TextInput
              style={styles.searchInput}
              placeholder="Lng"
              value={lngInput}
              onChangeText={setLngInput}
              keyboardType="numbers-and-punctuation"
            />
            <Pressable style={styles.goBtn} onPress={goToCoords}>
              <Text style={styles.goBtnText}>{t("map.go")}</Text>
            </Pressable>
          </View>
        ) : null}
        {searchError ? <Text style={styles.error}>{searchError}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      {cacheLabel ? <Text style={styles.hint}>Cached · {cacheLabel}</Text> : null}
      {liveOffline ? <Text style={styles.hint}>{t("map.liveOffline")}</Text> : null}
        {friendsOnly && friendIds.size === 0 ? (
          <Text style={styles.hint}>{t("map.noFriends")}</Text>
        ) : null}
      </View>


      {!selected ? (
        <>
          <View style={styles.legendPill}>
            <View style={[styles.legendDot, { backgroundColor: "#008800" }]} />
            <Text style={styles.legendText}>{t("map.myHex")}</Text>
            <View style={[styles.legendDot, { backgroundColor: "#888888" }]} />
            <Text style={styles.legendText}>{t("map.others")}</Text>
            <View style={[styles.legendDot, { backgroundColor: "#dc2626" }]} />
            <Text style={styles.legendText}>LIVE {liveDots.length}</Text>
          </View>
          <Pressable
            style={[styles.fab, styles.locateFab]}
            onPress={goToCurrentLocation}
          >
            <Ionicons name="locate" size={24} color="#007AFF" />
          </Pressable>
          <Pressable
            style={[styles.fab, loading ? styles.fabDisabled : null]}
            onPress={onRefresh}
            disabled={loading}
          >
            <Ionicons name="refresh" size={24} color={loading ? "#999999" : "#22c55e"} />
          </Pressable>
        </>
      ) : null}

      {selected ? (
        <View style={styles.card}>
          <View style={styles.cardTop}>
            <Avatar
              avatarKey={selectedProfile?.avatar_key ?? null}
              presets={presets}
              displayName={selected.owner_display_name}
              size={48}
            />
            <View style={styles.cardNameCol}>
              <Text style={styles.cardName}>
                {selected.is_mine ? t("map.myHex") : selected.owner_display_name}
              </Text>
              {selectedProfile?.city ? (
                <Text style={styles.cardCity}>{selectedProfile.city}</Text>
              ) : null}
              <Text style={styles.cardScore}>
                {t("map.hexScore", { score: selected.hex_score_m.toFixed(2) })}
              </Text>
            </View>
            <Pressable
              onPress={() => {
                setSelected(null);
                setSelectedProfile(null);
              }}
            >
              <Text style={styles.cardClose}>✕</Text>
            </Pressable>
          </View>
          <Text style={styles.cardHint}>
            {selected.is_mine
              ? t("map.refreshNeed")
              : `${t("map.daysLeft", { days: daysLeft(selected.expires_at) })} • ${t("map.captureNeed", { m: Math.floor(selected.hex_score_m) + 1 })}`}
          </Text>
          <Pressable
            style={styles.profileBtn}
            onPress={() => {
              if (selected.is_mine) {
                navigation.navigate("Profile");
              } else {
                navigation.navigate("Profile", {
                  userId: selected.owner_user_id,
                  status: friendIds.has(selected.owner_user_id)
                    ? "friends"
                    : "none",
                });
              }
            }}
          >
            <Text style={styles.profileBtnText}>{t("map.viewProfile")}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  locating: { flex: 1, textAlign: "center", textAlignVertical: "center", color: "#555" },
  topBar: {
    position: "absolute",
    top: 12,
    left: 12,
    right: 12,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 6,
    elevation: 4,
    shadowColor: "#000000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  count: { fontSize: 16, fontWeight: "600" },
  error: { color: "red", fontSize: 13 },
  tabRow: { flexDirection: "row", gap: 16 },
  tabActive: { fontSize: 18, fontWeight: "bold", color: "#007AFF" },
  tabInactive: { fontSize: 18, color: "#888" },
  hint: { fontSize: 14, color: "#888" },
  demoLink: {
    position: "absolute",
    top: 108,
    left: 16,
    color: "#2563eb",
    fontSize: 14,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: "hidden",
  },
  legendPill: {
    position: "absolute",
    bottom: 12,
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 10,
    elevation: 3,
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  legendDot: { width: 12, height: 12, borderRadius: 3 },
  flagWrap: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 3,
    borderWidth: 1,
    borderColor: "#cccccc",
    elevation: 3,
    shadowColor: "#000000",
    shadowOpacity: 0.25,
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
  legendText: { fontSize: 13, color: "#555", marginRight: 8 },
  fab: {
    position: "absolute",
    bottom: 12,
    right: 12,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  fabDisabled: { opacity: 0.6 },
  locateFab: { bottom: 72 },
  searchRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontSize: 14,
  },
  goBtn: {
    backgroundColor: "#22c55e",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  goBtnText: { color: "#ffffff", fontWeight: "bold", fontSize: 14 },
  card: {
    position: "absolute",
    bottom: 12,
    left: 12,
    right: 12,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    padding: 12,
    paddingBottom: 20,
    gap: 8,
    elevation: 5,
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardNameCol: { flex: 1 },
  cardName: { fontSize: 17, fontWeight: "bold" },
  cardCity: { fontSize: 13, color: "#777" },
  cardScore: { fontSize: 14, color: "#555" },
  cardClose: { fontSize: 20, color: "#888", paddingHorizontal: 4 },
  cardHint: { fontSize: 14, color: "#333" },
  profileBtn: { backgroundColor: "#22c55e", borderRadius: 8, paddingVertical: 8, alignItems: "center" },
  profileBtnText: { color: "#fff", fontWeight: "bold", fontSize: 15 },
});
