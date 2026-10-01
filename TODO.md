# TODO — P-Map

What's done, and what can still be improved, for hospital visitors and for the people running the map. Ordered by priority within each group; the recommended next steps are marked **(next)**.

## 1. Before going public

- [ ] **Editor sign-in (next).** Anyone who finds the address can change or wipe the hospital in the database (`hospital.save` takes no credentials). Add sign-in, or at least an editor passcode checked by Convex.
- [ ] **Production deploy.** `npx convex deploy`; set `PUBLIC_CONVEX_URL`, `ZAI_API_KEY` (or `ANTHROPIC_API_KEY`), `CHAT_LIMIT_SECRET` (also on the Convex deployment) and `HOSPITAL_TIME_ZONE` on the host; choose an adapter instead of `adapter-auto`.
- [ ] **Real visitor addresses.** Check the host passes the visitor's IP to `getClientAddress()`; behind some proxies every visitor looks the same and they share one chat limit.
- [ ] **Clean up.** Delete the leftover test document in the old `maps` table (Convex dashboard). Remove the leading space in `ANTHROPIC_API_KEY` in `.env.local`.
- [ ] **Decide whether chats are stored.** Today nothing is kept except anonymous counts and 10-minute answer caches.

## 2. Hospital content (in `/editor/info`)

- [ ] **Fill the empty topics.** Pendaftaran, BPJS & pembayaran, Jam besuk, Layanan and Kontak have no questions yet: what visitors ask most.
- [ ] **Indonesian questions.** "What is the emergency number?" and "Can children visit?" are in English and filed under _Lainnya_ (belong under Kontak and Jam besuk).
- [ ] **Doctors' specialties.** Most doctors have a blank specialty; fill it in, or derive it from the title (Sp.A → Anak, Sp.P → Paru, Sp.PD → Penyakit Dalam, Sp.OG → Kandungan, Sp.B → Bedah, Sp.GK → Gizi Klinik, Sp.Rad → Radiologi, drg → Gigi) so "dokter spesialis paru" finds every one.

## 3. The assistant (chat)

- [ ] **Quality check (next).** 30–50 real visitor questions, mostly Indonesian with some English, including tricky ones (closed clinics, emergencies, medical questions, places that don't exist); rerun after every prompt or model change, and to compare models.
- [ ] **Faster first words.** GLM-5 on Z.ai sends each answer in one burst after 4–8 s (the chat reveals it gradually and shows what it is looking up). Try `glm-4.5-air`, which truly streams, or another provider, against the quality check.
- [ ] **Voice input.** Speak the question in Indonesian (browser speech recognition), for older visitors.
- [ ] **Time zone per hospital.** Store it with the hospital instead of `HOSPITAL_TIME_ZONE`, so each hospital's "practising now" is right.

## 4. Get there comfortably

- [ ] **Several floors.** Rooms on upper floors, with stairs and lifts connecting them. Routing covers the ground floor only.
- [ ] **Step-free routes.** A "wheelchair / pushchair" option that uses lifts and avoids stairs (depends on several floors).
- [ ] **Directions by landmark.** "Pass the café on your left" instead of "head south-east 12 m"; optional photos at confusing turns.
- [ ] **Readability.** Larger text option, high contrast, reading steps aloud.
- [ ] **Small wins.** Printable directions; an always-visible "IGD" / nearest exit shortcut; nearest accessible toilet; walking time at a slower pace.

## 5. Speed and reliability

- [ ] **Low-end phones.** Measure the 3D map on a budget Android phone; a lighter mode (fewer trees, no shadows) chosen automatically on weak devices.
- [ ] **Works offline.** The service worker keeps the app and 3D models on the phone; also keep the last hospital data, and add a web app manifest so it can be installed.
- [ ] **Answer cache for follow-ups.** Only a conversation's first question is cached; common follow-ups ("rute ke sana") could be too.

## 6. Editor

- [ ] **Shorter doctor schedules page.** Every clinic repeats the same help text and every doctor is fully expanded with a 7-day grid; show one line per doctor ("Sen–Jum 08.00–12.00") that opens on click.
- [ ] **Two editors at once.** The last save wins while both have unsaved changes; warn, or merge per row.
- [ ] **Visitor map UI.** Revisit the paper gradient over the map (not liked).

## Done

- [x] **Database as the source of truth.** The editor and _Hospital info_ save every change to Convex (hospitals, buildings, places, doctors, questions & answers as rows), live for visitors at `/` and `/m/<slug>`; no publish step. _Share_ gives the public link.
- [x] **"You are here" QR signs.** _Share → Print "You are here" QR signs_: an A4 sign per spot with the start preset.
- [x] **Search by what people say.** Synonyms in English and Indonesian, other names and doctors per destination, typo tolerance.
- [x] **Visitor places with icons, opening hours and details.** Landmark kinds, open/closed badges, visitor info per destination.
- [x] **Hospital information and doctor schedules.** Questions & answers by topic and doctors' practice hours with leave, on their own editor page (`/editor/info`).
- [x] **Chat-first visitor app.** The chat beside the map on desktop and as a sheet over it on phones, Indonesian first with English; directions on their own tab; everything else is asked in the chat.
- [x] **Assistant on a model.** `/api/chat` answers with GLM-5 on Z.ai (or Claude) using the map's tools, with map cards (a doctor's schedule on theirs), follow-up questions, ground rules in the prompt, and the built-in replies when no key is set.
- [x] **Launch safeguards.** Rate limits (6 a minute and 60 a day per visitor, 1000 a day for the hospital) counted in Convex; over a limit the built-in reply answers.
- [x] **Assistant polish.** No "Saya cari … untuk Anda" preambles (GLM's text before a lookup is dropped) and a doctor's clinic is shown on the map straight away; the conversation is kept for the browser session (only the recent part is sent); unanswered questions get the hospital's phone number and questions it can answer; starting questions rotate daily through places, a clinic's doctors and the hospital's own questions in the visitor's language; `search_hospital_info` reads the answers once the questions & answers are too long to send whole; search ignores words like "tempat" ("tempat sholat" finds the Mushola).
- [x] **Streaming and caching.** Gradual reveal and "Melihat jadwal dokter…" status while it works; repeated first questions answered from a 10-minute cache; the hospital parsed once per version; prompts laid out for the providers' caches; a service worker for the app and models.
- [x] **Visitor polish.** The map stays put on phones when the keyboard opens; *Rute* starts from the place the chat just showed; without a known location the assistant points to *Atur lokasi Anda*; rooms the editor named by default read in Indonesian ("Ruang periksa 2"), on the map and in the chat; pages served as `lang="id"` (the editor `en`); a favicon.

Decided:

- The assistant covers much more than the map: doctor schedules, BPJS and payment, registration, visiting rules and anything else the hospital adds.
- Indonesian and English only, Indonesian first.
- Model: GLM-5 on Z.ai (Claude available by setting its key instead).
