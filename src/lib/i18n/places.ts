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

/** The same inside a sentence: "toilets", "apotek", but "IGD" and "ATM" keep their capitals. */
export function typeInline(detail: string, lang: Lang) {
  const name = typeName(detail, lang);
  return name === name.toUpperCase() ? name : name.toLowerCase();
}
