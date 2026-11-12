import { Pedometer } from "expo-sensors";

/** Default daily steps target (B6 will make this user-configurable). */
export const DEFAULT_DAILY_STEPS_TARGET = 10000;

/** Average stride (m per step) and energy (kcal per step) for estimates. */
export const METERS_PER_STEP = 0.75;
export const KCAL_PER_STEP = 0.04;
/** 1 cookie ≈ 30 kcal (fun equivalent). */
export const KCAL_PER_COOKIE = 30;

/**
 * All-day steps from the phone's own step counter (OS records 24/7,
 * even when the app is killed). Returns null when the sensor is
 * unavailable or permission is missing.
 * Requests ACTIVITY_RECOGNITION permission first (Android 10+).
 * NOTE: app.json must also declare "ACTIVITY_RECOGNITION" in
 * android.permissions, otherwise the runtime request is denied.
 */
export async function getTodaySteps(): Promise<number | null> {
  try {
    const perm = await Pedometer.getPermissionsAsync();
    if (perm.status !== "granted") {
      const req = await Pedometer.requestPermissionsAsync();
      if (req.status !== "granted") return null;
    }
    if (!(await Pedometer.isAvailableAsync())) return null;
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const result = await Pedometer.getStepCountAsync(start, now);
    return typeof result.steps === "number" ? result.steps : null;
  } catch {
    return null;
  }
}

export function stepsToKm(steps: number): number {
  return (steps * METERS_PER_STEP) / 1000;
}

export function stepsToKcal(steps: number): number {
  return steps * KCAL_PER_STEP;
}

export function kcalToCookies(kcal: number): number {
  return kcal / KCAL_PER_COOKIE;
}

/** 1 cola can ≈ 140 kcal. */
export const KCAL_PER_COLA = 140;

export function kcalToCola(kcal: number): number {
  return kcal / KCAL_PER_COLA;
}

/** Landmark heights (m) for fun distance equivalents. */
export const MINAR_HEIGHT_M = 62; // Minar-e-Pakistan
export const PISA_HEIGHT_M = 56; // Leaning Tower of Pisa
export const EIFFEL_HEIGHT_M = 330; // Eiffel Tower

export function metersToLandmark(meters: number, heightM: number): number {
  return meters / heightM;
}
