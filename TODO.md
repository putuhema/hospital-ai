# TODO — features for hospital visitors

Ideas to make P-Map more useful to the people finding their way, not just the people drawing the map. Ordered by priority within each group; the recommended first steps are marked **(next)**.

## 1. Make it reachable

- [x] **Publish the map.** Done: the editor's *Publish* menu stores the layout in Convex; visitors open `/m/<slug>`.
- [x] **"You are here" QR signs.** Done: *Publish → Print "You are here" QR signs* prints an A4 sign per entrance, landmark or lift lobby with the start preset.
- [ ] **Works offline.** Make the map an installable app that keeps working without a connection; reception inside hospitals is often poor.

## 2. Find the right place

- [ ] **Search by what people say.** Synonyms ("X-ray" → Radiology, "blood test" → Laboratory), doctors' names mapped to their clinics, and tolerance for typos.
- [ ] **Visitor places as categories with icons.** Parking, drop-off, café, cash machine, prayer room, lifts, exits, information desk. Landmarks exist today but have no types.
- [x] **Opening hours and details per destination.** Done: buildings, rooms and landmarks get *Visitor info* (description, phone, opening or visiting hours); the map shows an open/closed badge on the chosen destination and in search results.

## 3. Get there comfortably

- [ ] **Several floors.** Rooms on upper floors, with stairs and lifts connecting them. Routing currently covers the ground floor only.
- [ ] **Step-free routes.** A "wheelchair / pushchair" option that uses lifts and avoids stairs (depends on several floors).
- [ ] **Directions by landmark.** "Pass the café on your left" instead of "head south-east 12 m"; optional photos at confusing turns.
- [ ] **Readability.** Large text, high contrast, reading steps aloud, and more than one language.

## 4. Small wins

- [ ] "Printable directions" button.
- [ ] Always-visible "Emergency department" and "Nearest exit" shortcuts.
- [ ] "Nearest accessible toilet" shortcut.
- [ ] Walking time at a slower pace, for elderly visitors.
