/**
 * The bridge between SIMRS Khanza and the visitor app. It runs on a machine
 * at the hospital that can reach Khanza's database, reads today's queue per
 * clinic and the beds per ward every few seconds (read-only), and sends the
 * totals to the app, where open maps update at once.
 *
 *   node --env-file=.env khanza-bridge.ts             keep running
 *   node --env-file=.env khanza-bridge.ts --once      read and send once
 *   node --env-file=.env khanza-bridge.ts --dry-run   print what would be sent, send nothing
 */
import mysql from "mysql2/promise";
import { buildSnapshot, QUERIES, type Rows } from "./snapshot.ts";

const env = process.env,
  once = process.argv.includes("--once"),
  dryRun = process.argv.includes("--dry-run");
const interval = Math.max(5, Number(env.BRIDGE_INTERVAL_SECONDS) || 15) * 1000;
/** Sent this often even when nothing changed, so the app knows the bridge is alive. */
const HEARTBEAT = 60_000;
const day = env.BRIDGE_DATE?.trim() || null;

function need(key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    console.error(`${key} is not set (see .env.example).`);
    process.exit(1);
  }
  return value;
}
if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
  console.error("BRIDGE_DATE must be YYYY-MM-DD.");
  process.exit(1);
}
const pushUrl = dryRun ? "" : `${need("CONVEX_SITE_URL").replace(/\/+$/, "")}/simrs/push`,
  secret = dryRun ? "" : need("SIMRS_BRIDGE_SECRET");

const pool = mysql.createPool({
  host: need("KHANZA_DB_HOST"),
  port: Number(env.KHANZA_DB_PORT) || 3306,
  database: need("KHANZA_DB_NAME"),
  user: need("KHANZA_DB_READ_USER"),
  password: env.KHANZA_DB_READ_PASS ?? "",
  connectionLimit: 2,
  connectTimeout: 10_000,
  dateStrings: true,
});

const log = (text: string) => console.log(`${new Date().toLocaleTimeString("en-GB")}  ${text}`);

/** The bridge only reads, so it runs as a user that can only read. */
async function checkReadOnly() {
  const [grants] = await pool.query({ sql: "show grants", rowsAsArray: true });
  const writes = (grants as string[][])
    .map(([line]) => /^GRANT (.+?) ON /i.exec(line)?.[1] ?? "")
    .flatMap((list) => list.split(/,\s*/))
    .map((p) => p.replace(/\s*\(.*$/, "").trim().toUpperCase())
    .filter((p) => p && !["USAGE", "SELECT", "SHOW VIEW", "SHOW DATABASES"].includes(p));
  if (writes.length) {
    console.error(
      `The database user can do more than read (${[...new Set(writes)].slice(0, 5).join(", ")}). ` +
        "Create a SELECT-only user for the bridge (see README.md).",
    );
    process.exit(1);
  }
}

async function read() {
  const [[{ today }]] = (await pool.query("select date_format(curdate(), '%Y-%m-%d') as today")) as unknown as [{ today: string }[]];
  const date = day ?? today;
  const run = async (sql: string, params: unknown[] = []) => (await pool.query({ sql, timeout: 20_000 }, params))[0];
  // The counters' queue is optional: a Khanza without those tables (or a user without access to them) just has none.
  const optional = (sql: string, params: unknown[] = []) => run(sql, params).catch(() => undefined);
  const [clinics, registrations, quotas, serving, waiting, beds, schedules, tickets, counters, called] = await Promise.all([
    run(QUERIES.clinics),
    run(QUERIES.registrations, [date, date]),
    run(QUERIES.quotas, [date]),
    run(QUERIES.serving, [date]),
    run(QUERIES.waiting, [date, date]),
    run(QUERIES.beds),
    run(QUERIES.schedules),
    optional(QUERIES.tickets, [date]),
    optional(QUERIES.counters),
    optional(QUERIES.called),
  ]);
  return buildSnapshot({ clinics, registrations, quotas, serving, waiting, beds, schedules, tickets, counters, called } as unknown as Rows);
}

async function push(snapshot: object) {
  const response = await fetch(pushUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify({ ...(env.HOSPITAL_SLUG?.trim() && { slug: env.HOSPITAL_SLUG.trim() }), snapshot }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string; changed?: number };
  if (!response.ok) throw Error(`The app answered ${response.status}${body.error ? `: ${body.error}` : ""}`);
  return body.changed ?? 0;
}

let lastSent = "",
  lastAt = 0,
  failing = false;

async function tick() {
  const snapshot = await read();
  if (dryRun) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }
  const json = JSON.stringify(snapshot);
  if (json === lastSent && Date.now() - lastAt < HEARTBEAT) return;
  const changed = await push(snapshot);
  if (json !== lastSent || failing) {
    const registered = snapshot.clinics.reduce((sum, c) => sum + c.registered, 0),
      waiting = snapshot.clinics.reduce((sum, c) => sum + c.waiting, 0),
      empty = snapshot.wards.reduce((sum, w) => sum + w.empty, 0),
      beds = snapshot.wards.reduce((sum, w) => sum + w.beds, 0);
    log(`sent: ${registered} registered, ${waiting} waiting, ${empty} of ${beds} beds empty (${changed} changed)`);
  }
  lastSent = json;
  lastAt = Date.now();
  failing = false;
}

await checkReadOnly();
if (once || dryRun) {
  await tick();
  await pool.end();
} else {
  log(`Bridge started: reading ${env.KHANZA_DB_NAME} on ${env.KHANZA_DB_HOST} every ${interval / 1000} s${day ? ` (day ${day})` : ""}.`);
  for (;;) {
    try {
      await tick();
    } catch (err) {
      // SIMRS or the internet being away is ordinary: say so once, keep trying.
      if (!failing) log(`not sent: ${err instanceof Error ? err.message : err}. Trying again every ${interval / 1000} s.`);
      failing = true;
    }
    await new Promise((done) => setTimeout(done, interval));
  }
}
