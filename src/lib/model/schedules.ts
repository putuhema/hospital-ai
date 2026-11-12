/**
 * Doctors' practice schedules from SIMRS (Khanza's `jadwal`), per clinic. A
 * place linked to a clinic ("poli:<kd_poli>", see live.ts) shows SIMRS's
 * doctors and hours instead of the ones typed in the editor. What the editor
 * knows that SIMRS doesn't is kept: a doctor's leave (cuti), and how their
 * name and specialty are written, matched by name.
 */
import { tidyHours, validHours, type Hours } from "./hours.ts";
import type { Doctor } from "./doctors.ts";
import type { DoctorRow, Records } from "./records.ts";
import { editDistance, normalize } from "../wayfinding/search.ts";

/** One doctor's hours at a clinic. `code` is kd_dokter. */
export type ScheduledDoctor = { code: string; name: string; hours: Hours[] };
/** A clinic's doctors and hours; `code` is kd_poli. */
export type ClinicSchedule = { code: string; doctors: ScheduledDoctor[] };

export const MAX_SCHEDULES = 300;
const text = (s: unknown, max: number): s is string => typeof s === "string" && s.trim().length > 0 && s.length <= max;

/** Validates schedules the bridge sent; throws on anything else. */
export function parseSchedules(value: unknown): ClinicSchedule[] {
  const fail = () => {
    throw Error("Invalid schedules");
  };
  if (!Array.isArray(value) || value.length > MAX_SCHEDULES) fail();
  const list = (value as ClinicSchedule[]).map((c) => {
    if (!c || !text(c.code, 20) || !Array.isArray(c.doctors) || c.doctors.length > 60) fail();
    const doctors = c.doctors.map((d) => {
      if (!d || !text(d.code, 30) || !text(d.name, 100) || !validHours(d.hours)) fail();
      return { code: d.code, name: d.name.trim(), hours: tidyHours(d.hours) };
    });
    return { code: c.code, doctors };
  });
  if (new Set(list.map((c) => c.code)).size !== list.length) fail();
  return list;
}

/** "dr. KEVIN CHERLIE, Sp.A" → "dr. Kevin Cherlie, Sp.A": names typed in capitals read normally. */
export const tidyName = (name: string) =>
  name.trim().replace(/\s+/g, " ").replace(/\b([A-Z])([A-Z']{2,})\b/g, (_, first: string, rest: string) => first + rest.toLowerCase());

// Titles and degrees, so "drg. Desi Safitria Aziz, M.kes" and "drg. DESI SAFITRIA AZIS,M.Kes" are the same doctor.
const TITLES = new Set("dr drg dokter prof sp spesialis m kes ked mkes mars sked".split(" "));
/** The first two words of a doctor's own name. */
function core(name: string) {
  const words = normalize(name)
    .split(" ")
    .filter((w) => w.length > 1 && !TITLES.has(w) && !/^sp/.test(w));
  return words.slice(0, 2).join(" ");
}
/** Whether two spellings name the same doctor (a letter or two may differ). */
export function sameDoctor(a: string, b: string) {
  const x = core(a),
    y = core(b);
  return !!x && !!y && (x === y || editDistance(x, y, 2) <= 2);
}

/**
 * The doctors for a place linked to SIMRS clinics: SIMRS's doctors and hours,
 * with the editor's name, specialty and leave where the editor has the same
 * doctor. Undefined when SIMRS has no schedule for those clinics.
 */
export function scheduledDoctors(links: string[] | undefined, schedules: ClinicSchedule[], typed: Doctor[] = []): Doctor[] | undefined {
  const codes = (links ?? []).filter((k) => k.startsWith("poli:")).map((k) => k.slice(5));
  const found = codes.flatMap((code) => schedules.filter((s) => s.code === code)).flatMap((s) => s.doctors);
  if (!found.length) return undefined;
  const doctors: Doctor[] = [];
  for (const d of found) {
    // The same doctor at two of the place's clinics: one entry, both hours.
    const same = doctors.find((x) => x.code === d.code);
    if (same) {
      same.hours = tidyHours([...same.hours, ...d.hours]);
      continue;
    }
    const known = typed.find((t) => sameDoctor(t.name, d.name));
    doctors.push({
      code: d.code,
      name: known?.name ?? tidyName(d.name),
      hours: d.hours,
      ...(known?.specialty && { specialty: known.specialty }),
      ...(known?.leave?.length && { leave: known.leave }),
    });
  }
  return doctors;
}

/** The hospital's rows with SIMRS's schedules in place of the typed ones, for every place linked to a clinic SIMRS schedules. */
export function withSchedules(records: Records, schedules: ClinicSchedule[]): Records {
  if (!schedules.length) return records;
  const byPlace = new Map<string, DoctorRow[]>();
  for (const d of records.doctors) byPlace.set(d.place, [...(byPlace.get(d.place) ?? []), d]);
  let doctors = records.doctors;
  for (const p of records.places) {
    const typed = (byPlace.get(p.place) ?? []).sort((a, b) => a.order - b.order).map(({ place: _, order: __, ...d }) => d);
    const scheduled = scheduledDoctors(p.info.simrs, schedules, typed);
    if (!scheduled) continue;
    doctors = [...doctors.filter((d) => d.place !== p.place), ...scheduled.map((d, order) => ({ ...d, place: p.place, order }))];
  }
  return { ...records, doctors };
}
