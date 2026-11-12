/**
 * Live figures from the hospital's information system (SIMRS Khanza): today's
 * registrations and queue per clinic (poli), and the beds per ward (bangsal).
 * The bridge (bridge/khanza-bridge.ts) reads them at the hospital and sends
 * them here every few seconds. Only totals and queue numbers: nothing about
 * a patient ever leaves the hospital's database.
 */
import { parseSchedules, type ClinicSchedule } from "./schedules.ts";

/** One doctor's queue at a clinic today. */
export type DoctorQueue = {
  /** kd_dokter. */
  code: string;
  name: string;
  /** Patients registered today, cancelled ones left out. */
  registered: number;
  /** Of those, not seen yet. */
  waiting: number;
  /** Today's quota (kuota) from the schedule, when one is set. */
  quota?: number;
  /** The queue number (no_reg) called last, e.g. "012". */
  serving?: string;
};

/** A clinic's registrations and queue today. */
export type ClinicLive = {
  /** kd_poli. */
  code: string;
  name: string;
  registered: number;
  waiting: number;
  doctors: DoctorQueue[];
};

/** A ward's beds right now. */
export type WardLive = {
  /** kd_bangsal. */
  code: string;
  name: string;
  beds: number;
  empty: number;
  /** Per class, e.g. "Kelas 1" or "Kelas VIP". */
  classes: { name: string; beds: number; empty: number }[];
};

/** The registration counters' queue (antrean loket pendaftaran) today. */
export type CounterLive = {
  /** Queue tickets taken today. */
  tickets: number;
  /** The number called last; 0 before the first call. */
  called: number;
  /** Tickets not called yet. */
  waiting: number;
  /** What each counter (loket) is serving. */
  counters: { no: number; serving: number }[];
};

/** What the bridge sends. `schedules` are the doctors' hours per clinic (schedules.ts); kept even when the bridge goes quiet. */
export type Snapshot = { clinics: ClinicLive[]; wards: WardLive[]; counter?: CounterLive; schedules?: ClinicSchedule[] };
/** The same as visitors get it, with when it arrived. */
export type Live = Snapshot & { at: number };

export const MAX_CLINICS = 300,
  MAX_WARDS = 400;
/** Without news from the bridge for this long, the figures are no longer shown. */
export const STALE_MS = 5 * 60_000;

const text = (s: unknown, max: number): s is string => typeof s === "string" && s.length > 0 && s.length <= max;
const count = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < 100_000;

/** Validates what the bridge sent; throws on anything else. */
export function parseSnapshot(value: unknown): Snapshot {
  const s = value as Snapshot;
  const fail = () => {
    throw Error("Invalid snapshot");
  };
  if (!s || !Array.isArray(s.clinics) || !Array.isArray(s.wards) || s.clinics.length > MAX_CLINICS || s.wards.length > MAX_WARDS)
    fail();
  const clinics = s.clinics.map((c) => {
    if (!c || !text(c.code, 20) || !text(c.name, 100) || !count(c.registered) || !count(c.waiting) || !Array.isArray(c.doctors) || c.doctors.length > 60)
      fail();
    return {
      code: c.code,
      name: c.name.trim(),
      registered: c.registered,
      waiting: c.waiting,
      doctors: c.doctors.map((d) => {
        if (
          !d ||
          !text(d.code, 30) ||
          !text(d.name, 100) ||
          !count(d.registered) ||
          !count(d.waiting) ||
          (d.quota !== undefined && !count(d.quota)) ||
          (d.serving !== undefined && !text(d.serving, 12))
        )
          fail();
        return {
          code: d.code,
          name: d.name.trim(),
          registered: d.registered,
          waiting: d.waiting,
          ...(d.quota ? { quota: d.quota } : {}),
          ...(d.serving ? { serving: d.serving } : {}),
        };
      }),
    };
  });
  const wards = s.wards.map((w) => {
    if (!w || !text(w.code, 20) || !text(w.name, 100) || !count(w.beds) || !count(w.empty) || !Array.isArray(w.classes) || w.classes.length > 12)
      fail();
    return {
      code: w.code,
      name: w.name.trim(),
      beds: w.beds,
      empty: w.empty,
      classes: w.classes.map((k) => {
        if (!k || !text(k.name, 40) || !count(k.beds) || !count(k.empty)) fail();
        return { name: k.name, beds: k.beds, empty: k.empty };
      }),
    };
  });
  if (new Set(clinics.map((c) => c.code)).size !== clinics.length || new Set(wards.map((w) => w.code)).size !== wards.length) fail();
  const schedules = s.schedules === undefined ? undefined : parseSchedules(s.schedules);
  const k = s.counter;
  if (k === undefined || k === null) return { clinics, wards, ...(schedules && { schedules }) };
  if (!count(k.tickets) || !count(k.called) || !count(k.waiting) || !Array.isArray(k.counters) || k.counters.length > 30) fail();
  const counters = k.counters.map((c) => {
    if (!c || !count(c.no) || !count(c.serving)) fail();
    return { no: c.no, serving: c.serving };
  });
  return { clinics, wards, counter: { tickets: k.tickets, called: k.called, waiting: k.waiting, counters }, ...(schedules && { schedules }) };
}

/** How a place names what it shows from SIMRS: "poli:<kd_poli>", "ward:<kd_bangsal>" or "loket" (the registration counters). */
export const clinicKey = (code: string) => `poli:${code}`,
  wardKey = (code: string) => `ward:${code}`,
  COUNTER_KEY = "loket";
export const MAX_LINKS = 30;
const LINK = /^((poli|ward):.{1,20}|loket)$/;

/** Validates a place's links to SIMRS; undefined when there are none. */
export function parseLinks(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_LINKS || value.some((k) => typeof k !== "string" || !LINK.test(k)))
    throw Error("Invalid SIMRS links");
  const links = [...new Set(value as string[])];
  return links.length ? links : undefined;
}

/** The figures while they are recent; null once the bridge has been silent too long. */
export const fresh = (live: Live | null | undefined, now: number): Live | null =>
  live && now - live.at < STALE_MS ? live : null;

/** The clinics and wards a place is linked to, in the order they were linked; null when it shows none. */
export function liveFor(
  links: string[] | undefined,
  live: Live | null | undefined,
): { clinics: ClinicLive[]; wards: WardLive[]; counter?: CounterLive; at: number } | null {
  if (!links?.length || !live) return null;
  const clinics = links.flatMap((k) => live.clinics.filter((c) => clinicKey(c.code) === k)),
    wards = links.flatMap((k) => live.wards.filter((w) => wardKey(w.code) === k)),
    counter = links.includes(COUNTER_KEY) ? live.counter : undefined;
  return clinics.length || wards.length || counter ? { clinics, wards, ...(counter && { counter }), at: live.at } : null;
}

/** Today's queue of a doctor from SIMRS (by kd_dokter), in any clinic. */
export const doctorToday = (live: Live | null | undefined, code: string | undefined) =>
  code ? live?.clinics.flatMap((c) => c.doctors).find((d) => d.code === code) : undefined;

/** Whether a doctor has started seeing today's patients: one has been called or seen. Undefined when SIMRS can't tell (nobody registered). */
export function started(d: DoctorQueue | undefined): boolean | undefined {
  if (!d) return undefined;
  if (d.serving || d.registered > d.waiting) return true;
  return d.registered ? false : undefined;
}

/** Places left in a doctor's quota today; undefined without a quota. */
export const quotaLeft = (d: DoctorQueue) => (d.quota === undefined ? undefined : Math.max(0, d.quota - d.registered));
