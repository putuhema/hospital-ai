/**
 * Kinds of landmark visitors look for: spots that aren't rooms. Each has an
 * icon (the inside of a 24 × 24 SVG, drawn with a 2px round stroke), a colour
 * for its badge, and words people use for it, which search understands.
 */
export type LandmarkCategory =
  | "entrance"
  | "info"
  | "parking"
  | "dropoff"
  | "cafe"
  | "atm"
  | "prayer"
  | "lift"
  | "other";

export type Category = {
  id: LandmarkCategory;
  name: string;
  color: string;
  icon: string;
  /** Other ways to say it, in English and Indonesian. */
  words: string[];
};

export const categories: Category[] = [
  {
    id: "entrance",
    name: "Entrance & exit",
    color: "#2f7d44",
    icon: '<path d="M14 4H6v16h8M11 12h9m-3-3 3 3-3 3"/>',
    words: ["entrance", "exit", "way out", "way in", "main door", "gate", "pintu masuk", "pintu keluar", "keluar", "masuk", "gerbang"],
  },
  {
    id: "info",
    name: "Information desk",
    color: "#2f6fb0",
    icon: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
    words: ["information", "info", "help desk", "enquiries", "customer service", "informasi", "pusat informasi"],
  },
  {
    id: "parking",
    name: "Parking",
    color: "#3a5ba8",
    icon: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M10 17V8h3a2.5 2.5 0 0 1 0 5h-3"/>',
    words: ["parking", "car park", "park", "garage", "motorcycle", "motorbike", "scooter", "parkir", "tempat parkir", "parkir motor", "parkir mobil", "sepeda motor"],
  },
  {
    id: "dropoff",
    name: "Drop-off",
    color: "#4f6f8f",
    icon: '<path d="M5 16v-4l2-5h10l2 5v4zM5 12h14M7.5 16v2m9-2v2"/>',
    words: ["drop off", "dropoff", "pick up", "pickup", "taxi", "ambulance bay", "lobby", "penjemputan", "antar jemput", "taksi"],
  },
  {
    id: "cafe",
    name: "Café",
    color: "#b0683a",
    icon: '<path d="M5 9h11v4a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3v3m3-3v3"/>',
    words: ["cafe", "café", "coffee", "canteen", "cafeteria", "food", "restaurant", "snack", "kantin", "kafe", "kopi", "makan"],
  },
  {
    id: "atm",
    name: "Cash machine",
    color: "#3f8a74",
    icon: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6.5 9.5v5m11-5v5"/>',
    words: ["atm", "cash", "cash machine", "cashpoint", "money", "bank", "uang", "tunai", "anjungan tunai"],
  },
  {
    id: "prayer",
    name: "Prayer room",
    color: "#6a5aa0",
    icon: '<path d="M4 20h16M6 20v-7a6 6 0 0 1 12 0v7M12 3v4M10 20v-3a2 2 0 0 1 4 0v3"/>',
    words: ["prayer", "prayer room", "chapel", "mosque", "multi faith", "quiet room", "musholla", "mushola", "musala", "masjid", "kapel", "ibadah", "sholat"],
  },
  {
    id: "lift",
    name: "Lift",
    color: "#5d6b73",
    icon: '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="m9 10 3-3 3 3m-6 4 3 3 3-3"/>',
    words: ["lift", "elevator", "lifts", "elevators", "stairs", "tangga", "eskalator", "escalator"],
  },
  {
    id: "other",
    name: "Landmark",
    color: "#c98a1e",
    icon: '<path d="m12 3 9 9-9 9-9-9z"/>',
    words: [],
  },
];

export const category = (id: string | undefined) =>
  categories.find((c) => c.id === id) ?? categories[categories.length - 1];

export const isCategory = (id: unknown): id is LandmarkCategory =>
  typeof id === "string" && categories.some((c) => c.id === id);
