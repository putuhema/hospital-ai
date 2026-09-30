# TODO — features for hospital visitors

Ideas to make P-Map more useful to the people finding their way, not just the people drawing the map. Ordered by priority within each group; the recommended first steps are marked **(next)**.

## 1. Make it reachable

- [x] **Publish the map.** Done: the editor's _Publish_ menu stores the layout in Convex; visitors open `/m/<slug>`.
- [x] **"You are here" QR signs.** Done: _Publish → Print "You are here" QR signs_ prints an A4 sign per entrance, landmark or lift lobby with the start preset.
- [ ] **Works offline.** Make the map an installable app that keeps working without a connection; reception inside hospitals is often poor.

## 2. Find the right place

- [x] **Search by what people say.** Done: built-in synonyms in English and Indonesian ("X-ray"/"rontgen" → Radiology, "blood test" → Laboratory, "apotek" → Pharmacy), _Other names & doctors_ per destination (results show which name matched), and tolerance for typos and half-typed words. New Radiology and Emergency room types.
- [x] **Visitor places as categories with icons.** Done: landmarks get a kind (entrance & exit, information desk, parking, drop-off, café, cash machine, prayer room, lift) with an icon on the plan, in search and on the destination card; the map offers "nearest café / parking" shortcuts. Not yet drawn in the 3D view.
- [x] **Opening hours and details per destination.** Done: buildings, rooms and landmarks get _Visitor info_ (description, phone, opening or visiting hours); the map shows an open/closed badge on the chosen destination and in search results.

## 3. Get there comfortably

- [ ] **Several floors.** Rooms on upper floors, with stairs and lifts connecting them. Routing currently covers the ground floor only.
- [ ] **Step-free routes.** A "wheelchair / pushchair" option that uses lifts and avoids stairs (depends on several floors).
- [ ] **Directions by landmark.** "Pass the café on your left" instead of "head south-east 12 m"; optional photos at confusing turns.
- [ ] **Readability.** Large text, high contrast, reading steps aloud. Languages: see _Indonesian first_ under the assistant.

## 4. Small wins

- [ ] "Printable directions" button.
- [ ] Always-visible "Emergency department" and "Nearest exit" shortcuts.
- [ ] "Nearest accessible toilet" shortcut.
- [ ] Walking time at a slower pace, for elderly visitors.

## 5. Hospital assistant (chat)

A chat assistant in the visitor app that answers questions about the hospital and shows places on the map. Claude never guesses hospital facts: it calls tools built on the existing search, visitor info and routing code, and answers from their results. Ordered from easiest to hardest to implement.

- [x] **Hospital information FAQ.** An editor section for general questions the map can't answer (visiting rules, BPJS and payment, registration, emergency number), published with the map. Same pattern as _Visitor info_.
- [x] **Assistant tools as plain code.** `search_places` (`search.ts`), `get_place_details` with open-now (`place-info.ts`), `find_nearest` (`nearestOfType`), `get_directions` (`planRoute`) and `show_on_map`, which returns a place or route for the app to show. No AI yet; unit-tested like the rest.
- [x] **"Show on map" cards.** A place card in the chat ("Laboratory · Open until 16:00 · Show on map") that selects the place or route on the map through the existing `to`/`from` links.
- [x] **Chat screen.** A sheet over the map on phones, a panel beside it on desktop; suggested questions ("Where is the pharmacy?", "Visiting hours?", "Nearest parking"); replies appear as they are written. Can be built against canned replies first.
- [x] **Indonesian first.** The visitor map and chat open in Indonesian, with a switch to English: buttons and labels, open/closed ("Buka · sampai 16.00"), walking steps ("Belok kiri ke Farmasi"), suggested questions ("Di mana apotek?", "Jam besuk?", "Parkir terdekat") and the canned replies. The editor's starter topics too (Jam besuk, BPJS & pembayaran, Pendaftaran, Nomor darurat). Search already understands Indonesian words.
- [x] **Doctor schedules.** In the editor, per clinic or room: doctors with their specialty (poli) and practice days and hours, and when they are on leave (cuti). Visitors see the schedule in the place details and find a clinic by doctor or specialty; a `get_doctor_schedule` tool answers "Kapan dr. Sari praktik?" with today's status, like open-now.
- [ ] **More hospital information.** Done: the FAQ is grouped into topics (pendaftaran, BPJS & pembayaran, jam besuk, fasilitas, layanan, kontak, lainnya) with common questions per topic, edited on its own page, _Hospital info_ (`/editor/info`), together with the doctors' schedules; visitors read it by topic; up to 120 questions. Still to do: once it is too long to send whole with every chat, a `search_hospital_info` tool finds the relevant answers.
- [ ] **Chat server route.** A SvelteKit server route loads the published map from Convex, calls Claude (`claude-opus-5-5`, low effort) with the tools, and streams text and map cards to the app. The API key stays on the server. Cache the instructions, FAQ and tool list (no current time in them; open-now comes from the tool) and turn on the automatic refusal fallback.
- [ ] **Ground rules.** Only states hospital facts from the tools or the FAQ, otherwise says so and gives the information desk's number; no medical advice; emergencies get the Emergency department, directions and the emergency number straight away; replies in Indonesian, or in English when the visitor writes in English; stays on the hospital.
- [ ] **Launch safeguards.** A message limit per visitor, a daily spending cap, friendly error messages, and a decision on whether chats are stored.
- [ ] **Quality check.** 30–50 real visitor questions, mostly in Indonesian with some in English, including tricky ones (closed departments, emergencies, medical questions, places that don't exist), rerun after every prompt change.

Decided:

- It covers much more than the map: doctor schedules, BPJS and payment, registration, visiting rules and anything else the hospital wants to add (see _Doctor schedules_ and _More hospital information_).
- Indonesian and English only, Indonesian first: the default for the app and the replies (see _Indonesian first_).

Still to decide:

- Budget per chat: Opus 5.5 at low effort, or a cheaper model (Sonnet 5.5, Haiku 4.5)?
- Store conversations to improve answers, or discard them for privacy?
- Installable web app (see _Works offline_) or App Store / Play Store apps later?

## UI

- i don't like the gradient effect
- make it more like a sheet on the mobile, a map like layout but the bottom is a chat button that opened

## database

- it's not publish it save the data in the database as the source of truth for the app
- the publish map is not work properly
- save all the data and information about the hospital in the database
