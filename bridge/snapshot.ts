/**
 * Turns the rows read from SIMRS Khanza into what the visitor app shows:
 * today's registrations and queue per clinic, and the beds per ward. The
 * queries are here too, so what is read is in one place: totals and queue
 * numbers only, never a patient's name or record number.
 */
import type { ClinicLive, CounterLive, DoctorQueue, Snapshot, WardLive } from "../src/lib/model/live.ts";

/** `?` is the day (YYYY-MM-DD). Visits are found by their number (no_rawat starts with the day), which is indexed. */
export const QUERIES = {
  /** Clinics in use. */
  clinics: `select kd_poli, nm_poli from poliklinik where status = '1' and kd_poli <> '-'`,
  /** Today's registrations per clinic and doctor; cancelled ones don't count. */
  registrations: `
    select r.kd_poli, p.nm_poli, r.kd_dokter, d.nm_dokter,
           count(*) as registered,
           sum(r.stts in ('Belum', 'Berkas Diterima')) as waiting
      from reg_periksa r
      join poliklinik p on p.kd_poli = r.kd_poli
      join dokter d on d.kd_dokter = r.kd_dokter
     where r.no_rawat like concat(date_format(?, '%Y/%m/%d'), '/%')
       and r.tgl_registrasi = ?
       and r.stts <> 'Batal'
     group by r.kd_poli, p.nm_poli, r.kd_dokter, d.nm_dokter`,
  /** Who practises today and their quota (jadwal). */
  quotas: `
    select j.kd_poli, j.kd_dokter, d.nm_dokter, sum(j.kuota) as kuota
      from jadwal j
      join dokter d on d.kd_dokter = j.kd_dokter
     where j.hari_kerja = elt(dayofweek(?), 'AKHAD', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU')
     group by j.kd_poli, j.kd_dokter, d.nm_dokter`,
  /** The queue number called last per clinic and doctor (antripoli holds one visit each). */
  serving: `
    select a.kd_poli, a.kd_dokter, r.no_reg
      from antripoli a
      join reg_periksa r on r.no_rawat = a.no_rawat
     where r.tgl_registrasi = ? and r.stts <> 'Batal'`,
  /** Beds in use per ward and class. */
  beds: `
    select b.kd_bangsal, b.nm_bangsal, k.kelas,
           count(*) as beds,
           sum(k.status = 'KOSONG') as empty
      from kamar k
      join bangsal b on b.kd_bangsal = k.kd_bangsal
     where k.statusdata = '1' and b.status = '1'
     group by b.kd_bangsal, b.nm_bangsal, k.kelas`,
  /** Queue tickets printed at the registration counters today (antrean loket). */
  tickets: `select count(*) as tickets from antriloketcetak where tanggal = ?`,
  /** The number each counter is serving. */
  counters: `select loket, antrian from antriloket order by loket`,
  /** The number called last, where this Khanza keeps one (optional: not every installation has the table). */
  called: `select last_number from antriloket_counter where id = 1`,
};

type Value = string | number | null;
export type Rows = {
  clinics: { kd_poli: string; nm_poli: Value }[];
  registrations: { kd_poli: string; nm_poli: Value; kd_dokter: string; nm_dokter: Value; registered: Value; waiting: Value }[];
  quotas: { kd_poli: string | null; kd_dokter: string; nm_dokter: Value; kuota: Value }[];
  serving: { kd_poli: string | null; kd_dokter: string | null; no_reg: Value }[];
  beds: { kd_bangsal: string; nm_bangsal: Value; kelas: Value; beds: Value; empty: Value }[];
  /** The registration counters; left out where SIMRS has no such queue. */
  tickets?: { tickets: Value }[];
  counters?: { loket: Value; antrian: Value }[];
  called?: { last_number: Value }[];
};

// Sums come back as text; names may be empty in old rows.
const n = (v: Value) => Math.max(0, Math.round(Number(v) || 0));
const name = (v: Value, code: string) => String(v ?? "").trim() || code;
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
// "Kelas 1" before "Kelas VIP", as the hospital lists them.
const CLASSES = ["Kelas 3", "Kelas 2", "Kelas 1", "Kelas Utama", "Kelas VIP", "Kelas VVIP"];

/**
 * The registration counters' queue. Khanza keeps the called numbers without a
 * day, so numbers beyond today's tickets are yesterday's and are left out.
 */
export function buildCounter(rows: Pick<Rows, "tickets" | "counters" | "called">): CounterLive | undefined {
  if (!rows.tickets) return undefined;
  const tickets = n(rows.tickets[0]?.tickets ?? 0);
  const counters = (rows.counters ?? [])
    .map((r) => ({ no: n(r.loket), serving: n(r.antrian) }))
    .filter((c) => c.no && c.serving && c.serving <= tickets);
  const last = rows.called?.length ? n(rows.called[0].last_number) : Math.max(0, ...counters.map((c) => c.serving));
  const called = last <= tickets ? last : 0;
  return { tickets, called, waiting: tickets - called, counters: called ? counters : [] };
}

export function buildSnapshot(rows: Rows): Snapshot {
  const clinics = new Map<string, ClinicLive & { byDoctor: Map<string, DoctorQueue> }>();
  const clinic = (code: string, label: Value) => {
    let c = clinics.get(code);
    if (!c) clinics.set(code, (c = { code, name: name(label, code), registered: 0, waiting: 0, doctors: [], byDoctor: new Map() }));
    return c;
  };
  const doctor = (c: ReturnType<typeof clinic>, code: string, label: Value) => {
    let d = c.byDoctor.get(code);
    if (!d) c.byDoctor.set(code, (d = { code, name: name(label, code), registered: 0, waiting: 0 }));
    return d;
  };
  for (const r of rows.clinics) clinic(r.kd_poli, r.nm_poli);
  for (const r of rows.registrations) {
    const c = clinic(r.kd_poli, r.nm_poli),
      d = doctor(c, r.kd_dokter, r.nm_dokter);
    d.registered += n(r.registered);
    d.waiting += n(r.waiting);
    c.registered += n(r.registered);
    c.waiting += n(r.waiting);
  }
  // A doctor practising today is listed before anyone registers; a schedule at a clinic no longer in use is not.
  for (const r of rows.quotas) {
    const c = r.kd_poli && clinics.get(r.kd_poli);
    if (!c) continue;
    const d = doctor(c, r.kd_dokter, r.nm_dokter);
    if (n(r.kuota)) d.quota = n(r.kuota);
  }
  for (const r of rows.serving) {
    const d = r.kd_poli && r.kd_dokter ? clinics.get(r.kd_poli)?.byDoctor.get(r.kd_dokter) : undefined;
    const number = String(r.no_reg ?? "").trim();
    if (d && number) d.serving = number.slice(0, 12);
  }

  const wards = new Map<string, WardLive>();
  for (const r of rows.beds) {
    let w = wards.get(r.kd_bangsal);
    if (!w) wards.set(r.kd_bangsal, (w = { code: r.kd_bangsal, name: name(r.nm_bangsal, r.kd_bangsal), beds: 0, empty: 0, classes: [] }));
    const beds = n(r.beds),
      empty = Math.min(beds, n(r.empty));
    w.beds += beds;
    w.empty += empty;
    w.classes.push({ name: name(r.kelas, "-"), beds, empty });
  }
  const rank = (k: string) => (CLASSES.indexOf(k) + 1 || CLASSES.length + 1);
  const counter = buildCounter(rows);
  return {
    ...(counter && { counter }),
    clinics: [...clinics.values()]
      .map(({ byDoctor, ...c }) => ({ ...c, doctors: [...byDoctor.values()].sort(byName) }))
      .sort(byName),
    wards: [...wards.values()]
      .map((w) => ({ ...w, classes: w.classes.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name)) }))
      .sort(byName),
  };
}
