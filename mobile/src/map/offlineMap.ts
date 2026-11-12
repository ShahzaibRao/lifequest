import { OfflineManager } from "@maplibre/maplibre-react-native";

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const HOME_PACK_NAME = "lifequest-home";
const RADIUS_KM = 100;
const MIN_ZOOM = 10;
const MAX_ZOOM = 16;

export type PackProgress = (percentage: number, state: string) => void;
export type PackError = (message: string) => void;

function boundsForCenter(
  lon: number,
  lat: number,
): [number, number, number, number] {
  const dLat = RADIUS_KM / 111.32;
  const cosLat = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const dLon = RADIUS_KM / (111.32 * cosLat);
  const west = Math.max(-180, lon - dLon);
  const east = Math.min(180, lon + dLon);
  const south = Math.max(-85, lat - dLat);
  const north = Math.min(85, lat + dLat);
  return [west, south, east, north];
}

function attachListeners(
  packId: string,
  onProgress: PackProgress,
  onError: PackError,
) {
  OfflineManager.addListener(
    packId,
    (_pack, status) => {
      onProgress(status.percentage, status.state);
      if (status.state === "complete") {
        OfflineManager.removeListener(packId);
      }
    },
    (_pack, error) => {
      onError(error.message);
      OfflineManager.removeListener(packId);
    },
  );
}

export async function getHomePack() {
  const packs = await OfflineManager.getPacks();
  return (
    packs.find((pack) => pack.metadata["name"] === HOME_PACK_NAME) ?? null
  );
}

export async function getHomePackStatus() {
  const pack = await getHomePack();
  return pack ? pack.status() : null;
}

export async function downloadHomePack(
  lon: number,
  lat: number,
  onProgress: PackProgress,
  onError: PackError,
) {
  const existing = await getHomePack();
  if (existing) return existing;
  const pack = await OfflineManager.createPack(
    {
      mapStyle: STYLE_URL,
      bounds: boundsForCenter(lon, lat),
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      metadata: { name: HOME_PACK_NAME },
    },
    (_pack, status) => {
      onProgress(status.percentage, status.state);
      if (status.state === "complete") {
        OfflineManager.removeListener(_pack.id);
      }
    },
    (_pack, error) => {
      onError(error.message);
      OfflineManager.removeListener(_pack.id);
    },
  );
  return pack;
}

export async function resumeHomePack(
  onProgress: PackProgress,
  onError: PackError,
) {
  const pack = await getHomePack();
  if (!pack) return null;
  attachListeners(pack.id, onProgress, onError);
  await pack.resume();
  return pack;
}

export async function updateHomePack(
  onProgress: PackProgress,
  onError: PackError,
) {
  const pack = await getHomePack();
  if (!pack) return null;
  await OfflineManager.invalidatePack(pack.id);
  attachListeners(pack.id, onProgress, onError);
  return pack;
}

export async function deleteHomePack() {
  const pack = await getHomePack();
  if (pack) await OfflineManager.deletePack(pack.id);
}
