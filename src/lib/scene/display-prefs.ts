/** Viewer display preferences, remembered in this browser. */
export type DisplayPrefs = {
  /** Building name labels. */
  buildings: boolean;
  /** Room name labels (shown when looking inside). */
  rooms: boolean;
  /** The building/room tooltip on hover. */
  info: boolean;
  /** Tree and foliage amount on the map: 0 = none, 1 = normal, 2 = lush. */
  greenery: number;
};

const KEY = "forma-display";

export const defaultPrefs = (): DisplayPrefs => ({ buildings: true, rooms: true, info: true, greenery: 1 });

export function loadPrefs(): DisplayPrefs {
  const prefs = defaultPrefs();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    // Older versions stored one `names` flag for both kinds of label.
    prefs.buildings = saved.buildings ?? saved.names ?? true;
    prefs.rooms = saved.rooms ?? saved.names ?? true;
    prefs.info = saved.info ?? true;
    prefs.greenery = saved.greenery ?? 1;
  } catch {}
  return prefs;
}

export function savePrefs(prefs: DisplayPrefs) {
  localStorage.setItem(KEY, JSON.stringify(prefs));
}
