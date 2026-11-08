// Safe wrappers around localStorage. Some browsers (private mode, embedded
// webviews) throw on access, so every call is guarded. Calibration must never
// take the app down.

const CALIBRATION_KEY = 'chesslens.calibration.v1';
const SETTINGS_KEY = 'chesslens.settings.v1';

export function loadJSON(key, fallback = null) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function saveJSON(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function loadCalibration() {
  const value = loadJSON(CALIBRATION_KEY, null);
  if (!value || !Array.isArray(value.corners) || value.corners.length !== 4) return null;
  const valid = value.corners.every(
    (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1,
  );
  return valid ? value : null;
}

export function saveCalibration(calibration) {
  return saveJSON(CALIBRATION_KEY, calibration);
}

export function clearCalibration() {
  removeKey(CALIBRATION_KEY);
}

export function loadSettings() {
  const value = loadJSON(SETTINGS_KEY, null);
  return value && typeof value === 'object' ? value : null;
}

export function saveSettings(settings) {
  return saveJSON(SETTINGS_KEY, settings);
}

export const STORAGE_KEYS = {
  calibration: CALIBRATION_KEY,
  settings: SETTINGS_KEY,
};
