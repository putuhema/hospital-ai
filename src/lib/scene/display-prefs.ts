/** Viewer display preferences, remembered in this browser. */
export type DisplayPrefs = {
  /** Building name labels. */
  buildings: boolean;
  /** Room name labels (shown when looking inside). */
  rooms: boolean;
  /** The building/room tooltip on hover. */
  info: boolean;
  /** People strolling between the buildings while the map isn't being used. */
  people: boolean;
  /** Lighter 3D mode (no shadow maps, 1x pixel ratio, fewer trees & people) for budget phones. */
  lite: boolean;
};

const KEY = "forma-display";

/** Detect modest / budget devices so 3D maps stay smooth automatically. */
export function detectLowEndDevice(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const cores = navigator.hardwareConcurrency ?? 8;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const mobile = /Android|Mobile|iPhone|iPad/i.test(navigator.userAgent);
  return reduced || (mem !== undefined && mem <= 3) || (mobile && cores <= 4);
}

export const defaultPrefs = (): DisplayPrefs => ({
  buildings: true,
  rooms: true,
  info: true,
  people: true,
  lite: detectLowEndDevice(),
});

export function loadPrefs(): DisplayPrefs {
  const prefs = defaultPrefs();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    // Older versions stored one `names` flag for both kinds of label.
    prefs.buildings = saved.buildings ?? saved.names ?? true;
    prefs.rooms = saved.rooms ?? saved.names ?? true;
    prefs.info = saved.info ?? true;
    prefs.people = saved.people ?? true;
    prefs.lite = typeof saved.lite === "boolean" ? saved.lite : detectLowEndDevice();
  } catch {}
  return prefs;
}

export function savePrefs(prefs: DisplayPrefs) {
  localStorage.setItem(KEY, JSON.stringify(prefs));
}
