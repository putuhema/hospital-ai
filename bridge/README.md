# Khanza bridge

Sends live figures from **SIMRS Khanza** to the visitor app: today's registrations and queue per clinic (poli), and the beds per ward (bangsal). Visitors see them on a place's card and can ask the assistant ("antrean poli anak nomor berapa?", "masih ada kamar kelas 1?").

It runs on a machine at the hospital that can reach Khanza's database and the internet. Every 15 seconds it reads Khanza (read-only) and, when something changed, sends the totals to the app; open maps update at once. Nothing reaches into the hospital from outside: the bridge only makes outgoing HTTPS requests.

## What leaves the hospital

Totals and queue numbers only:

- per clinic and doctor: patients registered today, how many still wait, the queue number called last (`no_reg`), and the doctor's quota for today;
- per ward and class: beds and how many are empty;
- the registration counters (loket): queue tickets taken today, the number called last and the number each counter is serving.

No patient name, record number, visit number or diagnosis is read into the snapshot. The queries are in [snapshot.ts](snapshot.ts): `poliklinik`, `reg_periksa`, `dokter`, `jadwal`, `antripoli`, `kamar`, `bangsal`, and for the counters `antriloketcetak`, `antriloket` and `antriloket_counter`.

## Set up

Needs Node 22.18 or newer.

1. A database user that can only read those tables (run as a Khanza database admin; use the bridge machine's address instead of `%` if you can):

   ```sql
   CREATE USER 'pmap_bridge'@'%' IDENTIFIED BY 'a-long-password';
   GRANT SELECT ON sik.poliklinik  TO 'pmap_bridge'@'%';
   GRANT SELECT ON sik.reg_periksa TO 'pmap_bridge'@'%';
   GRANT SELECT ON sik.dokter      TO 'pmap_bridge'@'%';
   GRANT SELECT ON sik.jadwal      TO 'pmap_bridge'@'%';
   GRANT SELECT ON sik.antripoli   TO 'pmap_bridge'@'%';
   GRANT SELECT ON sik.kamar       TO 'pmap_bridge'@'%';
   GRANT SELECT ON sik.bangsal     TO 'pmap_bridge'@'%';
   -- The registration counters' queue (optional; without these it is simply not shown):
   GRANT SELECT ON sik.antriloketcetak    TO 'pmap_bridge'@'%';
   GRANT SELECT ON sik.antriloket         TO 'pmap_bridge'@'%';
   GRANT SELECT ON sik.antriloket_counter TO 'pmap_bridge'@'%';
   ```

   The bridge refuses to start with a user that can change data.

2. A secret both sides hold, set on the app's Convex deployment:

   ```sh
   npx convex env set SIMRS_BRIDGE_SECRET "$(openssl rand -base64 32)"
   ```

3. On the bridge machine, in this folder:

   ```sh
   npm install
   cp .env.example .env   # fill in the database, CONVEX_SITE_URL and the same secret
   npm run check          # prints what would be sent, sends nothing
   npm start              # keeps running
   ```

   Keep it running with the machine's service manager (systemd, pm2, NSSM on Windows). When SIMRS or the internet is away it says so once and keeps trying.

4. In the editor, select a clinic room, a ward or the registration desk and, under **Visitor info → Live from SIMRS**, choose the clinic, ward or *Registration counters* it shows. A building can show several wards.

## How it shows

- A linked place's card shows _Antrean hari ini_ (registered, waiting, the number being served and quota left per doctor) or _Tempat tidur_ (empty beds, per class), with the time the figures arrived.
- A place linked to the registration counters shows _Antrean loket pendaftaran_: numbers taken, how many wait, the number called last and each counter's.
- The assistant answers from the same figures (`get_clinic_queue`, `get_registration_queue`, `get_bed_availability`), for every clinic and ward, linked or not.
- When the bridge has been silent for 5 minutes the figures are no longer shown, and the assistant says they aren't available.

## Notes

- "Waiting" counts registrations with status _Belum_ or _Berkas Diterima_; cancelled ones (_Batal_) don't count at all.
- The number being served is the visit Khanza's own queue display holds for that clinic and doctor (`antripoli`), so it follows the nurse pressing _Panggil_ in Khanza.
- Beds are those in use in Khanza (`kamar.statusdata = '1'`) in active wards; "empty" is status _KOSONG_.
- The counters' queue comes from the ticket printer (`antriloketcetak`) and the numbers the registration form calls (`antriloket`; `antriloket_counter` is this hospital's own addition, and a Khanza without it uses the highest number a counter serves). Khanza keeps called numbers without a day, so until staff reset the queue in the morning, numbers above today's tickets are treated as yesterday's and not shown.
- `BRIDGE_DATE=2026-10-22` reads another day, for trying it on a copy of the database.
