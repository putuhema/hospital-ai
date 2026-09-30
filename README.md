# P-Map Editor

Build a hospital campus map, then give visitors walking directions on it. A SvelteKit editor with grid placement and Blender-authored models rendered with Three.js, plus a shareable wayfinding map. The map is the home page (`/`); the editor is at `/editor`.

## Run

```sh
pnpm install
npx convex dev   # in a second terminal: creates/uses the Convex dev deployment and writes .env.local
pnpm dev
```

Open `/editor` to build the campus and `/` for the wayfinding map. Changes save automatically in this browser; **Publish** puts the map online for visitors. The quick guide (`?` or the header button) walks through the four steps: place buildings, connect them with corridors, add rooms, check wayfinding.

## Building the map

- **Library.** Pick a building, corridor, path or ready-made **template** (outpatient clinic, L-shaped day clinic, inpatient ward, emergency department — each arrives with rooms inside) and click the ground. While placing, the Properties panel shows the piece *before placing*: turn it (`R`), resize it, rename it or change its roof, shape, colours and rooms first — each click places a copy with those settings. `Esc` stops placing.
- **Moving.** Drag buildings in 3D or on the plan; moves snap to tiles, reject overlaps and support undo/redo. `R` rotates a piece about its centre, `D` duplicates, `Delete` removes. Overlaps are checked against real outlines, so the empty corner of an L or a corner corridor can hold another piece.
- **Appearance.** Per building: pitched or flat roof, box or **L-shape**, 1–4 storeys (exterior only), wall and roof colour. Per corridor: floor and canopy colour. Per path: paving colour.
- **L-shaped buildings.** One quarter (half the width by half the depth) is cut away and turns with the building. Walls, doors, rooms, routing and the plan follow the L; pitched roofs become a cross-gable, flat roofs one slab.
- **Corridors and paths.** Corridors are built from their outline, so they turn with the piece and keep 10 cm support posts about every 3 m however long they are. A **Garden path** (*Paths* tab) is an open-air paved walkway with kerbs and no roof; it gets doors like a corridor, and routes prefer it to crossing the grass.
- **Rooms.** Select a building, choose one of 12 room types (patient, exam, office, waiting, reception, nurse station, toilets, pharmacy, laboratory, operating theatre, stairs & lift, storage) and click its floor plan. Each type has its own furniture and colour; the door can face any wall and each room's colour can be overridden. *Other destinations* holds searchable names without a drawn room (e.g. "MRI suite").
- **Doors.** Corridors and paths touching a building wall create doors automatically. Extra entrances can be added under *Doors & entrances*.

## Wayfinding

Directions are generated from the layout — there are no paths to draw. Every building and room is a destination, and routes go through real doors, prefer corridors over walking outside, and come with turn-by-turn steps (`src/lib/wayfinding/routing.ts`).

- The editor's **Wayfinding** tab tests routes, lists anything that can't be reached (usually a room door facing a wall — click it to jump to the building), and adds **landmarks** such as entrances, cafés or lifts.
- **Open wayfinding map** opens the map at `/`: search *from* and *to*, use shortcuts like *Nearest toilets*, or click a room in 3D or on the plan. *Pick start on map* takes a room, a building, or any spot on a corridor or path. Routes are drawn on both views.
- The 3D map sits in a calm landscape — gradient sky, drifting clouds, woodland and a pond, with the campus set straight into the meadow — sized to the canvas and fading into haze a short way past the campus (`src/lib/scene/scenery.ts`). The display bar has *Top view* (a north-up bird's-eye view, also in the editor's 3D view), toggles *Buildings* and *Rooms* name labels separately, plus *Hover info*, and has a *Trees* slider (none → lush); these preferences are remembered. The editor keeps a plain background.
- Links are shareable: `/?from=b:9&to=r:2:25&view=plan` (old `/map` links redirect). `/` reads the layout saved in *this browser*, so it's a preview for the editor.

## Publishing

The editor's **Publish** menu stores the layout in [Convex](https://convex.dev) and gives the map a public address, `/m/<slug>`, that opens on any phone. Publishing is deliberate: editing only autosaves locally, the menu shows *Unpublished changes* until you press **Publish changes**, and open public maps update live when you do. **Share route** on either map copies the public link with the route (`/m/<slug>?from=…&to=…`), which is what QR codes should point to.

The device that first publishes keeps the slug and a secret key in `localStorage`; the server stores only the key's hash, so only that browser can update or take the map offline (*Take the map offline*). The backend is `src/convex/` (a `maps` table; `maps.get`, `maps.publish`, `maps.unpublish`), and it validates layouts with the same `parseLayout` the app uses.

### Hospital information

**Hospital info** in the editor (or the Properties panel with nothing selected) holds general questions the map can't answer: visiting rules, BPJS and payment, registration, the emergency number. They are saved and published with the layout (`faq` in the layout file, `src/lib/model/faq.ts`). Visitors find them under *Hospital information*: in the side panel on desktop, and in the ••• menu on phones. Questions without an answer stay hidden, and phone numbers in answers can be tapped to call.

### "You are here" QR signs

**Publish → Print "You are here" QR signs** opens `/editor/signs`: one A4 sign per spot, with the spot's name, a plan with a *You are here* marker, and a QR code to `/m/<slug>?from=<spot>`, so visitors who scan it only choose where they're going. Landmarks, reception desks, waiting areas and stairs are suggested (every building when there are none); tick any other room or building. Signs are built from the *published* layout, which is what phones open, and the chosen spots are remembered per map (`src/lib/signs.ts`).

To deploy, run `npx convex deploy` and set `PUBLIC_CONVEX_URL` to the production deployment URL in the hosting environment.

Use **Canvas size** to set 8–100 tiles per side (2 m per tile). Layouts export and import as JSON.

## Blender assets

The editable source is `static/models/hospital-assets.blend`. It contains separate collections for pitched-roof and flat-roof buildings, plus straight, corner, T-junction, and cross corridors. Buildings have plain walls, entrance doors and either teal pitched gable roofs or flat roof slabs. Corridors are open-sided covered walkways with floors, roofs, and support posts. These are exterior architectural modules, not detailed interior room models.

Each collection is also exported as an individual `.glb`, with a Blender-rendered `.png` thumbnail. The app loads these meshes directly. Export → Detailed 3D model exports the current arrangement, including geometry and materials, as a GLB importable in Blender. Export → Blender source downloads the original asset collection. The OBJ option is a simplified layout blockout.

Regenerate using a local Blender installation:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/create-hospital-assets.py
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/render-hospital-previews.py
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/render-extra-previews.py
```

The corridor GLBs now only supply materials: corridors, garden paths and L-shaped roofs are generated in `src/lib/scene/models.ts`. `render-extra-previews.py` renders their library thumbnails (`l-shape.png`, `path.png`).

## Code layout

- `src/routes/editor/+page.svelte` — the editor (`/editor`): project state, autosave, undo and keyboard shortcuts. Its panels live in `src/lib/components/editor/` (asset library, toolbar, plan view, properties panel and its sub-editors, guide).
- `src/routes/+page.svelte` — the wayfinding map for the layout in this browser, the home page, with deep links (`/?from=b:9&to=r:2:25`). `src/routes/m/[slug]/` is the published map. Both render `src/lib/components/map/MapViewer.svelte`. `src/routes/map/` redirects old `/map` links.
- `src/convex/` — the Convex backend for published maps; `src/lib/publish.ts` keeps this device's publish key.
- `src/lib/editor/` — editing rules (`operations.ts`), JSON/OBJ export (`export.ts`) and undo history.
- `src/lib/model/` — the layout data, assets and templates, and room/door geometry. Visitor info per place (`place-info.ts`), opening hours and open-now (`hours.ts`), and doctors' practice schedules with leave (`doctors.ts`: whether a doctor is practising now and when they are back); schedules are edited on *Hospital info* (`/editor/info`) and searchable by doctor or specialty.
- `src/lib/wayfinding/` — walls and doors (`navigation.ts`) and grid routing with turn-by-turn steps (`routing.ts`).
- `src/lib/assistant/tools.ts` — the planned chat assistant's tools, as plain code for now: `search_places`, `get_place_details` (with open-now), `find_nearest`, `get_directions` and `show_on_map`, with their Claude tool definitions and `runTool`, which checks the input. They answer from the published layout and return JSON, with problems as `{ error }`. `cards.ts` and `src/lib/components/assistant/MapCard.svelte` turn a `show_on_map` result into a chat card ("Laboratory · Open now · until 16:00 · Show on map") that links to `?to=…` or `?from=…&to=…`; the map follows such links on the page as well as on load.
- `src/lib/assistant/chat.ts`, `chat.svelte.ts` and `src/lib/components/assistant/ChatPanel.svelte` — the chat: **Ask** beside the map on desktop, a sheet over it on phones, with suggested questions from the map and replies written out as they arrive. Replies come from a `Replier` (a stream of text and cards); for now `cannedReplier` answers from the tools and the hospital information without a model, and the chat server route will replace it. While the chat is open, the place its latest answer is about is highlighted on the 3D map (`src/lib/scene/highlight.ts`: a pulsing outline on its footprint or room, with a pin) and the camera moves to it; otherwise the chosen destination is, until a route shows.
- `src/lib/i18n/` — the visitor map's languages: Indonesian first, English one tap away (the switch is remembered per device). `messages.ts` holds every visitor-facing string in both, `places.ts` the Indonesian names of kinds of place (Apotek, Parkir, IGD…), and `locale.svelte.ts` gives the map's components their language; the editor has none and stays English. Opening hours (`place-info.ts`) and walking steps (`stepText` in `routing.ts`) are written in either; the canned chat replies answer in the language of the question.
- `src/lib/scene/` — the Three.js scene in parts: camera rig, stage (lights, ground, grid), model loading, generated interiors, labels, route overlay, pointer handling and the map's scenery. `src/lib/components/shared/HospitalScene.svelte` puts them together.
- `src/styles/` — global styles, imported in cascade order by `src/routes/layout.css`.

## Validation

```sh
pnpm check
pnpm test
pnpm build
```
