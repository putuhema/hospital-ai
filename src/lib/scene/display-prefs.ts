/** Viewer display preferences, remembered in this browser. */
export type DisplayPrefs = {
  /** Building name labels. */
  buildings: boolean;
  /** Room name labels (shown when looking inside). */
  rooms: boolean;
  /** The building/room tooltip on hover. */
  info: boolean;
};

const KEY = "forma-display";

export const defaultPrefs = (): DisplayPrefs => ({ buildings: true, rooms: true, info: true });

export function loadPrefs(): DisplayPrefs {
  const prefs = defaultPrefs();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    // Older versions stored one `names` flag for both kinds of label.
    prefs.buildings = saved.buildings ?? saved.names ?? true;
    prefs.rooms = saved.rooms ?? saved.names ?? true;
    prefs.info = saved.info ?? true;
  } catch {}
  return prefs;
}

export function savePrefs(prefs: DisplayPrefs) {
  localStorage.setItem(KEY, JSON.stringify(prefs));
}
