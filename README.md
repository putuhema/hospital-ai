# Forma hospital layout builder

SvelteKit hospital layout editor with grid placement and real Blender-authored GLB models rendered with Three.js.

## Run

```sh
pnpm install
pnpm dev
```

Changes save automatically in this browser. The quick guide (`?` or the header button) walks through the four steps: place buildings, connect them with corridors, add rooms, check wayfinding.

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
- **Open wayfinding map** opens `/map`: search *from* and *to*, use shortcuts like *Nearest toilets*, or click a room in 3D or on the plan. Routes are drawn on both views.
- The 3D map sits in a calm landscape — gradient sky, drifting clouds, woodland and a pond, with the campus set straight into the meadow — sized to the canvas and fading into haze a short way past the campus (`src/lib/scene/scenery.ts`). The display bar has *Top view* (a north-up bird's-eye view, also in the editor's 3D view), toggles *Buildings* and *Rooms* name labels separately, plus *Hover info*, and has a *Trees* slider (none → lush); these preferences are remembered. The editor keeps a plain background.
- Links are shareable: `/map?from=b:9&to=r:2:25&view=plan`. Use this for QR codes at entrances or kiosks. The map reads the layout saved in *this browser* — it isn't a hosted public link.

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

- `src/routes/+page.svelte` — the editor: project state, autosave, undo and keyboard shortcuts. Its panels live in `src/lib/components/editor/` (asset library, toolbar, plan view, properties panel and its sub-editors, guide).
- `src/routes/map/+page.svelte` — the wayfinding map, with deep links (`/map?from=b:9&to=r:2:25`).
- `src/lib/editor/` — editing rules (`operations.ts`), JSON/OBJ export (`export.ts`) and undo history.
- `src/lib/model/` — the layout data, assets and templates, and room/door geometry.
- `src/lib/wayfinding/` — walls and doors (`navigation.ts`) and grid routing with turn-by-turn steps (`routing.ts`).
- `src/lib/scene/` — the Three.js scene in parts: camera rig, stage (lights, ground, grid), model loading, generated interiors, labels, route overlay, pointer handling and the map's scenery. `src/lib/components/shared/HospitalScene.svelte` puts them together.
- `src/styles/` — global styles, imported in cascade order by `src/routes/layout.css`.

## Validation

```sh
pnpm check
pnpm test
pnpm build
```
