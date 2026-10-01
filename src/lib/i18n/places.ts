import type { Lang } from "./lang.ts";

/**
 * Indonesian names for the kinds of place, keyed by the English name the
 * layout uses (a place's `detail`). Matching and search keep the English;
 * this is only what visitors read.
 */
const ID: Record<string, string> = {
  Building: "Gedung",
  "Listed room": "Ruangan",
  "Patient room": "Kamar pasien",
  "Examination room": "Ruang periksa",
  Office: "Kantor",
  "Waiting area": "Ruang tunggu",
  "Reception desk": "Resepsionis",
  "Nurse station": "Ruang perawat",
  Toilets: "Toilet",
  Pharmacy: "Apotek",
  Laboratory: "Laboratorium",
  "Operating theatre": "Kamar operasi",
  "Stairs & lift": "Tangga & lift",
  Storage: "Gudang",
  Radiology: "Radiologi",
  Emergency: "IGD",
  Perinatology: "Perinatologi",
  "Entrance & exit": "Pintu masuk & keluar",
  "Information desk": "Pusat informasi",
  Parking: "Parkir",
  "Drop-off": "Tempat turun penumpang",
  "Café": "Kafe",
  "Cash machine": "ATM",
  "Prayer room": "Musala",
  Lift: "Lift",
  Landmark: "Penanda",
};

/** What a kind of place is called in `lang`, e.g. "Pharmacy" → "Apotek". */
export const typeName = (detail: string, lang: Lang) => (lang === "id" ? (ID[detail] ?? detail) : detail);

/**
 * Indonesian for the names the editor and its templates give new rooms
 * ("Examination room 2", "Room 1"), which the editor writes in English.
 */
const ROOM_NAMES: Record<string, string> = {
  ...ID,
  "Exam room": "Ruang periksa",
  "Treatment bay": "Ruang tindakan",
  Room: "Kamar",
  Reception: "Resepsionis",
  "Triage desk": "Meja triase",
  Resuscitation: "Ruang resusitasi",
};
const ROOM_NAME = new RegExp(
  `^(${Object.keys(ROOM_NAMES)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})( \\d+)?$`,
  "i",
);
const ROOM_KEYS = new Map(Object.keys(ROOM_NAMES).map((n) => [n.toLowerCase(), n]));

/** A room's name as visitors read it: an editor default in Indonesian ("Toilets 2" → "Toilet 2"); a name the hospital wrote as written. */
export function roomName(name: string, lang: Lang) {
  const m = lang === "id" ? ROOM_NAME.exec(name.trim()) : null;
  return m ? ROOM_NAMES[ROOM_KEYS.get(m[1].toLowerCase())!] + (m[2] ?? "") : name;
}

/** The map's pieces with their rooms named for visitors in `lang`; the same pieces when nothing changes. */
export function localizeRooms<P extends { roomAssets?: { name: string }[]; rooms?: string[] }>(pieces: P[], lang: Lang): P[] {
  if (lang !== "id") return pieces;
  return pieces.map((p) =>
    p.roomAssets?.length || p.rooms?.length
      ? {
          ...p,
          ...(p.roomAssets && { roomAssets: p.roomAssets.map((r) => ({ ...r, name: roomName(r.name, lang) })) }),
          ...(p.rooms && { rooms: p.rooms.map((n) => roomName(n, lang)) }),
        }
      : p,
  );
}

/** The same inside a sentence: "toilets", "apotek", but "IGD" and "ATM" keep their capitals. */
export function typeInline(detail: string, lang: Lang) {
  const name = typeName(detail, lang);
  return name === name.toUpperCase() ? name : name.toLowerCase();
}
