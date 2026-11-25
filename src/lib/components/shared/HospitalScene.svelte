<script lang="ts">
    import { onMount } from "svelte";
    import * as THREE from "three";
    import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
    import { center, isArea, isBuilding, isOpenAir, whereAt } from "$lib/model/interiors";
    import type { Piece } from "$lib/model/layout";
    import type { Point } from "$lib/wayfinding/navigation";
    import { createScenery, LAWN } from "$lib/scene/scenery";
    import { aheadView, createCameraRig, doorView } from "$lib/scene/camera-rig";
    import { createStage } from "$lib/scene/stage";
    import { createRouteOverlay } from "$lib/scene/route-overlay";
    import { createHighlight, highlightShape, type HighlightTarget } from "$lib/scene/highlight";
    import { createLabel, createDeclutter } from "$lib/scene/labels";
    import { loadTemplates, MODEL_KINDS, pieceModel } from "$lib/scene/models";
    import { isServerRoom } from "$lib/scene/interior-geometry";
    import { attachPointer, type Hover } from "$lib/scene/pointer";
    import { clearGroup } from "$lib/scene/dispose";
    import { batchMeshes } from "$lib/scene/batch";
    import { createCrowd, stepEvery } from "$lib/scene/crowd";
    import { chasePose, createAvatar, createBeacon, createLost, keysInput, wayAlong, look, roamer, step, zoom as zoomRoam, type RoamInput, type Roamer } from "$lib/scene/roam";
    import { canStep, planRoute, type NavGrid, type Place } from "$lib/wayfinding/routing";
    import { budgetFor, newGame, PEOPLE, tick as tickGame, type Fare, type Game, type GameEvent } from "$lib/scene/guide-game";
    import { daylightAt, sunFrom } from "$lib/scene/daylight";
    import { CHATTER, CHATTER_BY } from "$lib/i18n/chatter";
    import { defaultPrefs, loadPrefs } from "$lib/scene/display-prefs";
    import SceneOptions from "./SceneOptions.svelte";
    import SceneTooltip from "./SceneTooltip.svelte";
    import { useLocale } from "$lib/i18n/locale.svelte";
    let {
        presentation = false,
        pan = false,
        onmove,
        greenery = 1,
        canvasWidth = 24,
        canvasHeight = 20,
        pieces,
        selected,
        active,
        grid,
        zoom,
        onselect,
        onplace,
        onerror,
        registerExport,
        route = null,
        walked = 0,
        onward = 0,
        leg = null,
        strolls = [],
        crowdSize = null,
        tips = [],
        highlight = null,
        labels = true,
        insetLeft = 0,
        insetBottom = 0,
        roaming = false,
        navGrid = null,
        roamStart = null,
        roamPad = null,
        onroam,
        playing = 0,
        gameTargets = [],
        ongame,
    }: {
        presentation?: boolean;
        pan?: boolean;
        onmove?: (id: number, x: number, y: number) => void;
        /** Trees and foliage around the campus: 0 none, 1 normal, 2 lush. */
        greenery?: number;
        canvasWidth?: number;
        canvasHeight?: number;
        pieces: Piece[];
        selected: number | null;
        active: { kind: string; w: number; h: number } | null;
        grid: boolean;
        zoom: number;
        /** A click: the piece and room under it, and the point it landed on, in tiles. */
        onselect: (id: number | null, roomId?: number, point?: Point) => void;
        onplace: (p: { x: number; y: number }) => void;
        onerror: (s: string) => void;
        registerExport: (fn: () => Promise<void>) => void;
        /** Walking route in tile coordinates, drawn on the ground floor. */
        route?: Point[] | null;
        /** The route point the visitor has walked to; the line behind it greys. */
        walked?: number;
        /** Metres walked past `walked`, as the phone follows the visitor; their dot moves along. */
        onward?: number;
        /**
         * Following the route: the stretch being walked, as route point indices
         * up to the next turn. The map looks along it, the turn marked on the floor.
         */
        leg?: { from: number; to: number } | null;
        /** Walks between the buildings (in tiles), for people strolling while the map isn't used. */
        strolls?: Point[][];
        /** How many people are about (busy hours and long queues bring more); null for the most. */
        crowdSize?: number | null;
        /** Real tips from the hospital, said now and then by the people walking about. */
        tips?: string[];
        /** A place to pick out, e.g. the one the assistant is talking about; hidden while a route shows. */
        highlight?: HighlightTarget | null;
        labels?: boolean;
        /** Pixels on the left covered by an overlay panel; the view centres in the rest. */
        insetLeft?: number;
        /** Pixels at the bottom covered by a sheet; the campus rises clear of it. */
        insetBottom?: number;
        /** Walking about yourself, third person (scene/roam.ts): the camera follows a figure you steer. */
        roaming?: boolean;
        /** Where the walls are, so the figure can't walk through them. */
        navGrid?: NavGrid | null;
        /** Where to start walking (tiles); a gate or a door when not given. */
        roamStart?: Point | null;
        /** Steering from an on-screen stick (phones), read every frame. */
        roamPad?: RoamInput | null;
        /**
         * Where the figure is (tiles) and which way it faces (radians, 0 towards +y), ten times a second,
         * with the route the arrow follows (tiles), for the mini map and "you are in".
         */
        onroam?: (at: Point & { facing: number; route: Point[] }) => void;
        /** The guiding game (scene/guide-game.ts) while walking about: a new number starts a new round; 0 for none. */
        playing?: number;
        /** Where lost visitors may want to go: the pharmacy, wards, clinics and the like. */
        gameTargets?: Place[];
        /** The game as it stands, a few times a second, and what just happened. */
        ongame?: (game: Game, events: GameEvent[]) => void;
    } = $props();
    const locale = useLocale(),
        t = locale.t;
    /** What someone walking by (or the creator in the server room) is saying: who/where, the line, and until when. */
    let speech = $state<{ who?: number; at?: THREE.Vector3; text: string; until: number } | null>(null),
        bubble = $state<HTMLDivElement>();
    let cutaway = $state(false),
        overhead = $state(false),
        /** Which way the map faces, in radians: 0 when north is up. */
        heading = $state(0);
    let faceNorth: () => void = () => {};
    /** The visitor moved the map themselves: a button takes it back to the starting view. */
    let away = $state(false),
        recenter: () => void = () => {};
    let turned = $derived(Math.abs(Math.atan2(Math.sin(heading), Math.cos(heading))) > 0.05);
    let prefs = $state(defaultPrefs());
    onMount(() => {
        prefs = loadPrefs();
    });
    let buildingNames = $derived(labels && prefs.buildings),
        roomNames = $derived(labels && prefs.rooms);
    // Shown only without a route: the route's pin marks the destination then.
    /** The visitor has dragged or zoomed the map, so the hint can go. */
    let explored = $state(false);
    let focus = $derived(route?.length ? null : highlight);
    let focusShape = $derived(focus ? highlightShape(pieces, focus) : null);
    // A route runs indoors, and a highlighted room is inside, so roofs come off.
    let inside = $derived(cutaway || !!route?.length || !!focusShape?.room);
    let hover = $state<Hover | null>(null);
    let hoveredPiece = $derived(pieces.find((p) => p.id === hover?.id));
    let hoveredRoom = $derived(
        hoveredPiece?.roomAssets?.find((r) => r.id === hover?.room),
    );
    let host: HTMLDivElement;
    let loading = $state(true),
        failed = $state(false);
    let sync: () => void = () => {};
    $effect(() => {
        pan;
        overhead;
        inside;
        route;
        walked;
        onward;
        leg;
        strolls;
        crowdSize;
        prefs.people;
        focusShape;
        buildingNames;
        roomNames;
        insetLeft;
        insetBottom;
        roaming;
        greenery;
        canvasWidth;
        canvasHeight;
        pieces;
        selected;
        active;
        grid;
        zoom;
        sync();
    });

    onMount(() => {
        let renderer: THREE.WebGLRenderer;
        try {
            renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        } catch {
            failed = true;
            loading = false;
            onerror(t("webglUnavailable"));
            return;
        }
        const lowEnd = presentation && prefs.lite;
        // Budget phones get 1x pixel ratio & shadow-free lighting for smooth 3D panning.
        renderer.setPixelRatio(lowEnd ? 1 : Math.min(devicePixelRatio, presentation ? 1.5 : 2));
        renderer.shadowMap.enabled = !lowEnd;
        // On the map nothing moves in the sun, so shadows are drawn once per
        // rebuild instead of every frame (see `sync`), with plain filtering.
        renderer.shadowMap.type = presentation ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
        renderer.shadowMap.autoUpdate = !presentation;
        renderer.setClearColor(presentation ? LAWN : "#edf0e7");
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        const dom = renderer.domElement;
        host.appendChild(dom);

        const scene = new THREE.Scene();
        const rig = createCameraRig(dom, presentation);
        const { camera, controls } = rig;
        // The landscape is for the wayfinding map; the editor stays plain.
        const scenery = presentation ? createScenery(scene) : null;
        const stage = createStage(scene, presentation);
        if (lowEnd) stage.sun.castShadow = false;
        const buildings = new THREE.Group(),
            labelGroup = new THREE.Group(),
            overlay = createRouteOverlay(),
            marker = createHighlight();
        scene.add(buildings, labelGroup, overlay.group, marker.group);
        const declutter = createDeclutter();
        // People strolling about while the map rests (not with reduced motion; fewer on a modest phone).
        const crowd =
            presentation && !matchMedia("(prefers-reduced-motion: reduce)").matches
                ? createCrowd(scene, lowEnd ? 12 : (navigator.hardwareConcurrency ?? 8) <= 4 ? 20 : 40)
                : null;
        let crowdFed: Point[][] | null = null,
            crowdAt = 0,
            /** When the visitor last touched the map; the crowd walks once they have let it be a moment. */
            touched = 0;
        const touch = () => (touched = performance.now());

        // Walking about yourself (scene/roam.ts): the figure, the keys held, and the camera's lens before.
        const avatar = presentation ? createAvatar() : null;
        if (avatar) scene.add(avatar.group);
        // The guiding game: a lost visitor, the beam where they want to go, and the round under way.
        const lost = avatar ? createLost() : null,
            beacon = avatar ? createBeacon() : null;
        if (lost && beacon) scene.add(lost.group, beacon.group);
        let game: Game | null = null,
            round = 0,
            fareTo: Place | null = null,
            wayPoints: { x: number; z: number }[] = [],
            plannedAt = 0,
            reportedAt = 0,
            who = Math.floor(Math.random() * PEOPLE.length);
        const fareTargets = new WeakMap<Fare, Place>();
        /** The next lost visitor: somewhere along the walks, 15 m or more from the walker, wanting a place a walk away. */
        function makeFare(): Fare | null {
            const walks = strolls.filter((w) => w.length > 1);
            if (!navGrid || !walks.length || !gameTargets.length) return null;
            for (let tries = 0; tries < 12; tries++) {
                const w = walks[Math.floor(Math.random() * walks.length)],
                    i = Math.floor(Math.random() * (w.length - 1)),
                    k = Math.random();
                const spot = { x: w[i].x + (w[i + 1].x - w[i].x) * k, y: w[i].y + (w[i + 1].y - w[i].y) * k };
                if (me && Math.hypot(spot.x * 2 - me.x, spot.y * 2 - me.z) < 15) continue;
                const place = gameTargets[Math.floor(Math.random() * gameTargets.length)];
                const route = planRoute(navGrid, spot, place);
                if (!route || route.meters < 20) continue;
                const end = route.points.at(-1)!;
                const fare: Fare = {
                    who: PEOPLE[who++ % PEOPLE.length],
                    from: { x: spot.x * 2, z: spot.y * 2 },
                    to: { x: end.x * 2, z: end.y * 2, name: place.name },
                    budget: budgetFor(route.meters),
                };
                fareTargets.set(fare, place);
                return fare;
            }
            return null;
        }
        /** Show the visitor waiting for the walker, or nothing. */
        function waiting(fare: Fare | null) {
            beacon?.hide();
            fareTo = null;
            wayPoints = [];
            plannedAt = 0;
            if (fare) lost?.wait(fare.who.look, fare.from.x, fare.from.z);
            else lost?.hide();
        }
        function endGame() {
            game = null;
            lost?.hide();
            beacon?.hide();
            avatar?.pointTo(null);
        }
        /** A round of the game, stepped with the walker: start a new one when asked, steer the arrow, report. */
        function playGame(time: number, dt: number) {
            if (!me || !avatar) return;
            if (playing && playing !== round) {
                round = playing;
                game = newGame(makeFare());
                waiting(game.fare);
                ongame?.(game, []);
            }
            if (!game || !playing) {
                if (game) endGame();
                return avatar.pointTo(null);
            }
            const out = tickGame(game, dt, { x: me.x, z: me.z }, makeFare);
            game = out.game;
            for (const e of out.events) {
                if (e.type === "picked") {
                    lost?.follow();
                    beacon?.show(e.fare.to.x, e.fare.to.z);
                    fareTo = fareTargets.get(e.fare) ?? null;
                    plannedAt = 0;
                    wayPoints = [];
                } else if (e.type === "delivered") waiting(game.fare);
                else if (e.type === "over") {
                    lost?.hide();
                    beacon?.hide();
                }
            }
            lost?.update(time, { x: me.x, z: me.z });
            beacon?.update(time);
            // The arrow follows the walking route: to the one waiting, then to where they want to go.
            const goal: Place | null =
                game.state === "guiding"
                    ? fareTo
                    : game.state === "seeking" && game.fare
                      ? // Where they stand, as a spot on the map.
                        { id: "lost", name: "", kind: "landmark", detail: "", point: { x: game.fare.from.x / 2, y: game.fare.from.z / 2 } }
                      : null;
            if (goal && navGrid) {
                if (time - plannedAt > 500) {
                    plannedAt = time;
                    const route = planRoute(navGrid, { x: me.x / 2, y: me.z / 2 }, goal);
                    wayPoints = route ? route.points.map((p) => ({ x: p.x * 2, z: p.y * 2 })) : [];
                }
                avatar.pointTo(wayAlong(wayPoints, me.x, me.z));
            } else avatar.pointTo(null);
            if (out.events.length || time - reportedAt > 150) {
                reportedAt = time;
                ongame?.(game, out.events);
            }
        }
        let me: Roamer | null = null,
            /** 0 outdoors, 1 inside a building, eased between. */
            indoors = 0,
            roamedAt = 0,
            toldAt = 0,
            mapFov = camera.fov;
        const held = new Set<string>();
        const typing = (e: KeyboardEvent) => (e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]");
        const ROAM_KEYS = new Set(["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"]);
        function keyDown(e: KeyboardEvent) {
            const k = e.key.toLowerCase();
            if (!me || typing(e) || !ROAM_KEYS.has(k)) return;
            held.add(k);
            // The arrows would scroll the page.
            e.preventDefault();
        }
        const keyUp = (e: KeyboardEvent) => held.delete(e.key.toLowerCase());
        const letGo = () => held.clear();
        addEventListener("keydown", keyDown);
        addEventListener("keyup", keyUp);
        addEventListener("blur", letGo);
        // Dragging turns the camera around the figure; two fingers pinch it nearer or farther.
        const fingers = new Map<number, { x: number; y: number }>();
        let pinch = 0;
        function lookDown(e: PointerEvent) {
            if (!me) return;
            fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (fingers.size === 2) {
                const [a, b] = [...fingers.values()];
                pinch = Math.hypot(a.x - b.x, a.y - b.y);
            }
        }
        function lookMove(e: PointerEvent) {
            const was = fingers.get(e.pointerId);
            if (!me || !was) return;
            fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (fingers.size >= 2) {
                const [a, b] = [...fingers.values()],
                    apart = Math.hypot(a.x - b.x, a.y - b.y);
                if (pinch) me = zoomRoam(me, pinch / Math.max(1, apart));
                pinch = apart;
            } else me = look(me, e.clientX - was.x, e.clientY - was.y);
            dirty = true;
        }
        const lookUp = (e: PointerEvent) => {
            fingers.delete(e.pointerId);
            if (fingers.size < 2) pinch = 0;
        };
        function lookWheel(e: WheelEvent) {
            if (!me) return;
            e.preventDefault();
            me = zoomRoam(me, Math.exp(e.deltaY * 0.0015));
            dirty = true;
        }
        dom.addEventListener("pointerdown", lookDown);
        addEventListener("pointermove", lookMove);
        addEventListener("pointerup", lookUp);
        addEventListener("pointercancel", lookUp);
        dom.addEventListener("wheel", lookWheel, { passive: false });
        /** In metres on the ground: whether a short step is clear of walls (the grid is in tiles). */
        const clear = (a: { x: number; z: number }, b: { x: number; z: number }) =>
            !navGrid || canStep(navGrid, { x: a.x / 2, y: a.z / 2 }, { x: b.x / 2, y: b.z / 2 });

        /** A stroll starts in a doorway, on the wall: start a metre along it instead (tiles). */
        function offDoor(path: Point[] | undefined) {
            if (!path) return null;
            const [a, b] = path,
                d = Math.hypot(b.x - a.x, b.y - a.y) || 1,
                k = Math.min(1, 1 / d);
            return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
        }
        /** Start or stop walking about, as `roaming` says. */
        function roam() {
            if (!avatar || roaming === !!me) return;
            if (roaming) {
                const start = roamStart ?? offDoor(strolls.find((w) => w.length > 1)) ?? { x: canvasWidth / 2, y: canvasHeight / 2 };
                me = roamer(start.x * 2, start.y * 2, rig.heading());
                avatar.group.visible = true;
                round = 0;
                controls.enabled = false;
                // A wider lens, close behind them, as in a game.
                chasing.copy(controls.target);
                mapFov = camera.fov;
                camera.fov = 55;
                camera.updateProjectionMatrix();
            } else {
                const at = me!;
                me = null;
                solidAll();
                held.clear();
                avatar.group.visible = false;
                endGame();
                controls.enabled = true;
                camera.fov = mapFov;
                camera.updateProjectionMatrix();
                // Back to the map, over where they stopped.
                controls.target.set(at.x, 0, at.z);
                camera.lookAt(controls.target);
                rig.frameRoute(new THREE.Box3(new THREE.Vector3(at.x - 14, 0, at.z - 14), new THREE.Vector3(at.x + 14, 1, at.z + 14)), 10);
            }
            dirty = true;
        }
        const chaseTarget = new THREE.Vector3(),
            chasing = new THREE.Vector3();

        // Walking into a building (or under a corridor's roof): it fades to see-through, so you stay in
        // sight, and its rooms show. A building between the camera and you fades too, as in a game.
        // Each turns solid again, easing back, once you leave it or it is no longer in the way.
        // Other buildings keep their roofs.
        // Its roof (everything above head height) goes altogether; the walls below fade.
        const SEE_THROUGH = 0.16,
            IN_THE_WAY = 0.22,
            ABOVE_HEAD = 2.4;
        type Faded = {
            looks: { m: THREE.Material; opacity: number; transparent: boolean; depthWrite: boolean }[];
            /** The roof and what else is above head height, hidden while faded. */
            lifted: THREE.Object3D[];
            rooms: THREE.Object3D | null;
            fade: number;
        };
        const faded = new Map<number, Faded>();
        let inWay = new Set<number>(),
            lookedAt = 0;
        const sightLine = new THREE.Raycaster();
        function solid(id: number) {
            const f = faded.get(id);
            if (!f) return;
            for (const l of f.looks) Object.assign(l.m, { opacity: l.opacity, transparent: l.transparent, depthWrite: l.depthWrite, needsUpdate: true });
            for (const o of f.lifted) o.visible = true;
            if (f.rooms) buildings.remove(f.rooms);
            f.rooms?.traverse((o) => {
                if (o instanceof THREE.Mesh) {
                    o.geometry.dispose();
                    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
                }
            });
            faded.delete(id);
        }
        const solidAll = () => [...faded.keys()].forEach(solid);
        function fadeIn(piece: Piece, rooms: boolean): Faded {
            const looks: Faded["looks"] = [],
                lifted: THREE.Object3D[] = [],
                seen = new Set<THREE.Material>(),
                box = new THREE.Box3();
            for (const o of buildings.children)
                if (o.userData.pieceId === piece.id)
                    o.traverse((m) => {
                        if (!(m instanceof THREE.Mesh)) return;
                        if (box.setFromObject(m).min.y > ABOVE_HEAD) {
                            m.visible = false;
                            lifted.push(m);
                            return;
                        }
                        for (const mat of Array.isArray(m.material) ? m.material : [m.material])
                            if (!seen.has(mat)) {
                                seen.add(mat);
                                looks.push({ m: mat, opacity: mat.opacity, transparent: mat.transparent, depthWrite: mat.depthWrite });
                                Object.assign(mat, { transparent: true, depthWrite: false, needsUpdate: true });
                            }
                    });
            const f: Faded = { looks, lifted, rooms: null, fade: 1 };
            faded.set(piece.id, f);
            if (rooms) showRooms(piece, f);
            return f;
        }
        /** Its rooms and inner walls, as with the roofs off: the walls that stop you, in sight. */
        function showRooms(piece: Piece, f: Faded) {
            if (f.rooms || !isBuilding(piece)) return;
            f.rooms = pieceModel(piece, templates.get(piece.kind), pieces, true).interior;
            if (!f.rooms) return;
            // Made for this visit: freed with the buildings if they are rebuilt meanwhile.
            f.rooms.traverse((o) => (o.userData.generated = true));
            buildings.add(f.rooms);
        }
        /** The pieces between the camera and the walker, looked for a few times a second. */
        function inTheWay(head: THREE.Vector3) {
            const toward = head.clone().sub(camera.position),
                far = toward.length();
            sightLine.set(camera.position, toward.normalize());
            sightLine.far = far - 0.6;
            const ids = new Set<number>();
            for (const hit of sightLine.intersectObjects(buildings.children, true)) {
                let o: THREE.Object3D | null = hit.object;
                while (o && o.parent !== buildings) o = o.parent;
                const id = o?.userData.pieceId;
                if (typeof id === "number") ids.add(id);
            }
            return ids;
        }
        /** Fade what the walker is in and what hides them; ease the rest back to solid. */
        function seeThrough(at: Point, head: THREE.Vector3, time: number, dt: number) {
            const here = whereAt(pieces, at)?.piece,
                roofed = here && !isOpenAir(here) ? here : null;
            if (time - lookedAt > 120) {
                lookedAt = time;
                inWay = inTheWay(head);
            }
            const want = new Map<number, number>();
            for (const id of inWay) want.set(id, IN_THE_WAY);
            if (roofed) want.set(roofed.id, SEE_THROUGH);
            for (const [id, to] of want) {
                const piece = pieces.find((p) => p.id === id);
                if (!piece) continue;
                const f = faded.get(id) ?? fadeIn(piece, id === roofed?.id);
                if (id === roofed?.id) showRooms(piece, f);
                f.fade = Math.max(to, f.fade - dt * 3);
                for (const l of f.looks) l.m.opacity = l.opacity * f.fade;
            }
            for (const [id, f] of faded) {
                if (want.has(id)) continue;
                f.fade = Math.min(1, f.fade + dt * 3);
                for (const l of f.looks) l.m.opacity = l.opacity * f.fade;
                if (f.fade >= 1) solid(id);
            }
        }

        // The light of the hour, from the visitor's clock (?hour=21 shows another
        // hour): the sun crossing east to west, warm evenings, lit windows at night.
        const forced = Number(new URLSearchParams(location.search).get("hour"));
        const hourNow = () => {
            if (Number.isFinite(forced) && new URLSearchParams(location.search).has("hour")) return forced;
            const d = new Date();
            return d.getHours() + d.getMinutes() / 60;
        };
        const GLOW = new THREE.Color("#ffcf7a");
        function daylight() {
            if (!presentation) return;
            const h = hourNow(),
                light = daylightAt(h);
            stage.hemi.color.set(light.sky);
            stage.hemi.groundColor.set(light.ground);
            stage.hemi.intensity = light.hemi;
            stage.sun.color.set(light.sun);
            stage.sun.intensity = light.sunStrength;
            stage.aim(sunFrom(h));
            crowd?.setHour(h);
            scenery?.setLawn(light.lawn);
            renderer.setClearColor(light.lawn);
            // Windows glow warm from dusk on.
            buildings.traverse((o) => {
                if (!(o instanceof THREE.Mesh) || !/window|glass|glazing/i.test(`${o.name} ${(o.material as THREE.Material).name}`)) return;
                const m = o.material as THREE.MeshStandardMaterial;
                if (!m.emissive) return;
                m.emissive.copy(GLOW);
                m.emissiveIntensity = light.windows * 0.9;
            });
            renderer.shadowMap.needsUpdate = true;
            dirty = true;
        }
        const daylightTimer = presentation ? window.setInterval(daylight, 60_000) : 0;

        // People say something when tapped, and now and then on their own while
        // the map rests: one at a time, never while a route is being followed.
        const one = (list: string[]) => list[Math.floor(Math.random() * list.length)];
        /** What walker `who` says: a cat meows, children and older people have their own lines now and then. */
        const lines = (who: number) => {
            const kind = crowd?.kindOf(who) ?? "adult";
            if (kind === "cat") return one(CHATTER_BY.cat[locale.lang]);
            if (kind !== "adult" && Math.random() < 0.6) return one(CHATTER_BY[kind][locale.lang]);
            return tips.length && Math.random() < 0.3 ? one(tips) : one(CHATTER[locale.lang]);
        };
        function say(who: number) {
            if (!crowd) return;
            crowd.hold(who, 4.5);
            speech = { who, text: lines(who), until: performance.now() + 4500 };
            dirty = true;
        }
        let nextChat = performance.now() + 12_000;
        const sight = new THREE.Raycaster(),
            headAt = new THREE.Vector3(),
            onScreen = new THREE.Vector3();
        /** Someone in view whom no roof or wall hides, to say something on their own. */
        function someoneInSight() {
            if (!crowd) return -1;
            const seen = crowd.inView(camera).sort(() => Math.random() - 0.5);
            for (const i of seen.slice(0, 6)) {
                crowd.headOf(i, headAt);
                const toward = headAt.clone().sub(camera.position),
                    far = toward.length();
                sight.set(camera.position, toward.normalize());
                const hit = sight.intersectObjects(buildings.children, true)[0];
                if (!hit || hit.distance > far - 0.3) return i;
            }
            return -1;
        }
        dom.addEventListener("pointerdown", touch);
        dom.addEventListener("wheel", touch, { passive: true });
        // The map is drawn only when something changes: the camera, the
        // scene, a label shown or hidden, or a route or pin animating.
        let dirty = true;
        controls.addEventListener("change", () => (dirty = true));
        controls.addEventListener("start", () => (away = presentation));
        recenter = () => {
            rig.recenter();
            away = false;
            dirty = true;
        };
        faceNorth = () => {
            rig.faceNorth();
            dirty = true;
        };

        let templates = new Map<string, THREE.Group>(),
            materials = new Set<THREE.Material>();
        let destroyed = false;
        // Signatures of what was last built, so each sync only redoes what changed.
        let built = "",
            canvasSize = "",
            routeShown = "",
            focusShown = "",
            legShown = "",
            sited = "",
            lastZoom = zoom;
        const ready = () => templates.size === MODEL_KINDS.length;

        function clearBuildings() {
            clearGroup(labelGroup);
            // Template geometry is shared by every copy; only generated parts are owned.
            clearGroup(buildings, (o) => !!o.userData.generated);
        }

        function buildPieces() {
            // The models are made anew: the building walked into is faded again next frame.
            faded.clear();
            clearBuildings();
            for (const p of pieces) {
                // Open-air pieces are built without a Blender template.
                const template = templates.get(p.kind);
                if (!template && !isOpenAir(p)) continue;
                const { model, interior } = pieceModel(p, template, pieces, inside);
                // On the map nothing is dragged, so each building's look-alike parts
                // are merged: far fewer draw calls for a phone.
                if (presentation) {
                    batchMeshes(model);
                    if (interior) batchMeshes(interior);
                }
                if (interior) buildings.add(interior);
                if (isBuilding(p) || isArea(p)) addLabels(p, model);
                buildings.add(model);
            }
        }

        function addLabels(p: Piece, model: THREE.Object3D) {
            if (buildingNames) {
                const top = inside ? 3 : new THREE.Box3().setFromObject(model).max.y + 1.4;
                const tag = createLabel(p.name, "building");
                const c = center(p);
                tag.position.set(c.x * 2, top, c.y * 2);
                tag.userData.place = { pieceId: p.id, y: top };
                labelGroup.add(tag);
            }
            // Rooms are only visible with the roofs off.
            if (roomNames && inside)
                for (const r of p.roomAssets ?? []) {
                    const tag = createLabel(r.name, "room");
                    tag.position.set((p.x + r.x + r.w / 2) * 2, 1.6, (p.y + r.y + r.h / 2) * 2);
                    tag.userData.place = { pieceId: p.id, roomId: r.id, y: 1.6 };
                    labelGroup.add(tag);
                }
        }

        /**
         * The stretch from route point `from` to the turn at `to`, with a little of
         * the way on after it, seen from behind: the way ahead points up the screen.
         */
        function legView(points: Point[], { from, to }: { from: number; to: number }) {
            const a = points[from],
                b = points[Math.min(to, points.length - 1)];
            if (!a || !b) return null;
            const dx = (b.x - a.x) * 2,
                dz = (b.y - a.y) * 2;
            if (Math.hypot(dx, dz) < 0.5) return null;
            const box = new THREE.Box3();
            for (let i = from; i <= Math.min(to, points.length - 1); i++)
                box.expandByPoint(new THREE.Vector3(points[i].x * 2, 0, points[i].y * 2));
            const after = points[to + 1];
            if (after) {
                const turn = new THREE.Vector3((after.x - b.x) * 2, 0, (after.y - b.y) * 2);
                const reach = Math.min(4, turn.length());
                if (reach > 0) box.expandByPoint(new THREE.Vector3(b.x * 2, 0, b.y * 2).addScaledVector(turn.normalize(), reach));
            }
            box.max.y = 1;
            return { box, view: aheadView(dx, dz) };
        }

        sync = () => {
            if (destroyed) return;
            roam();
            if (!presentation) controls.mouseButtons.LEFT = pan ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
            const size = `${canvasWidth}:${canvasHeight}`;
            if (size !== canvasSize) {
                canvasSize = size;
                stage.resize(canvasWidth, canvasHeight);
                rig.centre(canvasWidth, canvasHeight, zoom);
            }
            stage.grid.visible = grid;
            rig.setOverhead(overhead);
            rig.frame(host.clientWidth, host.clientHeight, insetLeft, insetBottom);
            const planted = !!scenery?.update(pieces, canvasWidth * 2, canvasHeight * 2, greenery);
            if (lastZoom !== zoom) {
                rig.zoomBy(lastZoom / zoom);
                lastZoom = zoom;
            }
            const next = JSON.stringify([pieces, inside, buildingNames, roomNames]);
            const rebuilt = next !== built && ready();
            if (rebuilt || planted) renderer.shadowMap.needsUpdate = true;
            if (rebuilt) {
                built = next;
                buildPieces();
                // New buildings, new windows: light them for the hour.
                if (presentation) daylight();
                // The map opens on the canvas, filling the view, and stays
                // within it; framed again when the canvas is resized.
                if (presentation && canvasSize !== sited) {
                    sited = canvasSize;
                    // Opens on the buildings, with a little of the grounds around them.
                    const campus = new THREE.Box3();
                    for (const p of pieces)
                        campus.expandByPoint(new THREE.Vector3(p.x * 2, 0, p.y * 2)).expandByPoint(
                            new THREE.Vector3((p.x + p.w) * 2, 0, (p.y + p.h) * 2),
                        );
                    if (!campus.isEmpty()) campus.expandByVector(new THREE.Vector3(4, 0, 4));
                    rig.frameSite(
                        new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(canvasWidth * 2, 0, canvasHeight * 2)),
                        zoom,
                        campus,
                    );
                }
            }
            // The camera frames the route, or else the highlighted place.
            const nextRoute = JSON.stringify(route ?? null),
                nextFocus = JSON.stringify(focusShape),
                nextLeg = JSON.stringify(route?.length ? leg : null);
            if (nextRoute !== routeShown || nextFocus !== focusShown || nextLeg !== legShown || (rebuilt && focusShape)) {
                const moved = nextRoute !== routeShown || nextFocus !== focusShown || nextLeg !== legShown;
                routeShown = nextRoute;
                focusShown = nextFocus;
                legShown = nextLeg;
                const routeBox = overlay.show(route),
                    ahead = route?.length && leg ? legView(route, leg) : null;

                // The pin floats over the roof, or with the roofs off, above the building's name.
                // A building is its outside and its interior; the pin goes over the taller.
                const parts = buildings.children.filter((o) => o.userData.pieceId === focus?.pieceId);
                const pieceBox = parts.length ? parts.reduce((box, o) => box.expandByObject(o), new THREE.Box3()) : null;
                // Just over the walls with the roofs off, so the pin stays over its room; else just over the roof.
                // A room seen from its door gets it lower, so from that angle it doesn't seem to mark the room behind.
                const top = !focusShape
                    ? 0
                    : focusShape.room && presentation && !overhead
                      ? 2
                      : focusShape.room || inside
                        ? 3.4
                        : pieceBox
                          ? pieceBox.max.y + 0.3
                          : 1;
                const focusBox = marker.show(focusShape, top);
                // A room is seen from in front of its door, with the corridor or space
                // just outside it; a place with what is around it, to find your bearings.
                const around = focusBox?.clone(),
                    door = focusShape?.room ? focusShape.door : undefined;
                // Framed at wall height (the pin may run above the view), grown both ways
                // across the door wall so the doorway shows and the room stays in the middle.
                if (around && door) {
                    around.max.y = Math.min(around.max.y, 2.5);
                    around.expandByVector(door === "north" || door === "south" ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0));
                }
                // Framed afresh: this is the starting view now.
                if (moved) away = false;
                if (moved)
                    if (ahead) rig.frameRoute(ahead.box, 3, ahead.view);
                    else if (routeBox) rig.frameRoute(routeBox, 8);
                    else rig.frameRoute(around ?? null, door ? 1.5 : 10, door ? doorView(door) : undefined);
                // The next turn's arrow, larger when the stretch to it is long and seen from farther.
                overlay.turnAt(ahead ? leg!.to : null, THREE.MathUtils.clamp(rig.focusDistance() / 45, 1, 1.8));
                // From farther away (a whole building) the pin grows, so it stays easy to spot.
                const above = marker.resize(THREE.MathUtils.clamp(rig.focusDistance() / 40, 1, 3));
                // The place's own name moves up onto the pin, like a map marker, instead of covering it.
                for (const tag of labelGroup.children as THREE.Sprite[]) {
                    const at = tag.userData.place as { pieceId: number; roomId?: number; y: number } | undefined;
                    if (!at) continue;
                    const named = !!focusShape && at.pieceId === focus?.pieceId && at.roomId === focus?.roomId;
                    tag.position.y = named ? above : at.y;
                    tag.center.set(0.5, named ? 0 : 0.5);
                }
            }
            overlay.walk(walked, onward);
            const object = buildings.children.find((o) => o.userData.pieceId === selected);
            stage.selectedBox.visible = !!object && !presentation;
            if (object) stage.selectedBox.box.setFromObject(object);
            if (!active) stage.ghost.visible = false;
            if (crowd) {
                crowd.setActive(crowdSize ?? Infinity);
                if (strolls !== crowdFed) {
                    crowdFed = strolls;
                    crowd.setStrolls(strolls.map((path) => path.map((p) => ({ x: p.x * 2, z: p.y * 2 }))));
                }
                // Not before the buildings are there: no one stands about on bare grass while they load.
                crowd.show(prefs.people && ready());
            }
            dirty = true;
        };

        loadTemplates()
            .then((loaded) => {
                if (destroyed) return loaded.materials.forEach((m) => m.dispose());
                ({ templates, materials } = loaded);
                loading = false;
                sync();
            })
            .catch(() => {
                if (destroyed) return;
                loading = false;
                failed = true;
                onerror(t("modelsFailed"));
            });

        const detachPointer = attachPointer({
            dom,
            camera,
            controls,
            buildings,
            ground: stage.ground,
            ghost: stage.ghost,
            selectedBox: stage.selectedBox,
            state: () => ({ pan, active, pieces, inside }),
            onselect: (pieceId, roomId, point) => {
                if (pieceId !== null && roomId !== undefined) {
                    const piece = pieces.find((p) => p.id === pieceId);
                    const rm = piece?.roomAssets?.find((r) => r.id === roomId);
                    if (piece && rm && isServerRoom(rm.name)) {
                        const wx = (piece.x + rm.x + rm.w / 2) * 2;
                        const wz = (piece.y + rm.y + rm.h / 2) * 2;
                        speech = {
                            at: new THREE.Vector3(wx, 2.0, wz),
                            text:
                                locale.lang === "id"
                                    ? "Halo! Saya Putu Mahendra, pembuat AIRMA — lagi kerja di ruang server biar AIRMA makin keren!"
                                    : "Hi! I'm Putu Mahendra, the creator of AIRMA — working on AIRMA right here in the server room!",
                            until: performance.now() + 6500,
                        };
                        dirty = true;
                    }
                }
                onselect(pieceId, roomId, point);
            },
            onplace,
            onmove,
            onhover: (h) => (hover = h),
            // A tap on someone walking by: they say something, and no place is chosen.
            ontap: (x, y) => {
                if (!crowd || !prefs.people) return false;
                const who = crowd.pickAt(camera, dom.clientWidth, dom.clientHeight, x, y);
                if (who < 0) return false;
                say(who);
                return true;
            },
            ondragend: () => {
                built = "";
                sync();
            },
        });

        const resize = new ResizeObserver(() => {
            const w = host.clientWidth,
                h = host.clientHeight;
            if (!w || !h) return;
            renderer.setSize(w, h);
            rig.frame(w, h, insetLeft, insetBottom);
            rig.fit(canvasWidth, canvasHeight, zoom);
            dirty = true;
        });
        resize.observe(host);

        registerExport(async () => {
            if (!ready()) throw Error("Models are still loading");
            const data = await new GLTFExporter().parseAsync(buildings, { binary: true });
            const url = URL.createObjectURL(
                new Blob([data as ArrayBuffer], { type: "model/gltf-binary" }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = "hospital-layout.glb";
            a.click();
            URL.revokeObjectURL(url);
        });

        let frame = 0,
            pulsed = 0;
        function animate(time = 0) {
            frame = requestAnimationFrame(animate);
            // The editor moves buildings and ghosts under the pointer: it always draws.
            if (!presentation) dirty = true;
            if (me && avatar) {
                // Walking about: steer the figure, and the camera follows behind, easing after it.
                const dt = roamedAt ? (time - roamedAt) / 1000 : 0;
                roamedAt = time;
                const keys = keysInput(held),
                    pad = roamPad && Math.hypot(roamPad.x, roamPad.y) > 0.05 ? roamPad : null;
                me = step(me, pad ?? keys, dt, clear);
                avatar.place(me);
                playGame(time, dt);
                // Indoors the camera looks down more steeply, over the walls, and comes a little nearer.
                const here = whereAt(pieces, { x: me.x / 2, y: me.z / 2 })?.piece;
                indoors += ((here && !isOpenAir(here) ? 1 : 0) - indoors) * (1 - Math.exp(-dt * 4));
                const { position, target } = chasePose({
                        ...me,
                        pitch: THREE.MathUtils.lerp(me.pitch, Math.max(me.pitch, 1.08), indoors),
                        distance: me.distance * (1 - 0.15 * indoors),
                    }),
                    ease = 1 - Math.exp(-dt * 9);
                camera.position.lerp(position, ease);
                chasing.lerp(chaseTarget.copy(target), ease);
                camera.lookAt(chasing);
                seeThrough({ x: me.x / 2, y: me.z / 2 }, target, time, dt);
                if (time - toldAt > 100) {
                    toldAt = time;
                    onroam?.({ x: me.x / 2, y: me.z / 2, facing: me.facing, route: game ? wayPoints.map((p) => ({ x: p.x / 2, y: p.z / 2 })) : [] });
                }
                dirty = true;
            } else {
                roamedAt = 0;
                if (rig.tick()) dirty = true;
                if (controls.update()) dirty = true;
                rig.bound();
            }
            // The route's arrows and the pin move gently; 30 frames a second is plenty.
            if ((route?.length || focusShape || !presentation) && time - pulsed > (presentation ? 32 : 0)) {
                pulsed = time;
                overlay.animate(time);
                marker.animate(time);
                dirty = true;
            }
            if (declutter(labelGroup, camera, dom.clientWidth, dom.clientHeight, time)) dirty = true;
            // The crowd steps along with any frame drawn anyway, and on its own once the map rests: about as
            // often as they move a pixel (a few times a second far out, 20 up close), drawing only when
            // someone is in view. A tapped one's hop plays smoothly straight away.
            if (crowd && prefs.people) {
                const lively = crowd.lively(),
                    pixelsPerMetre = dom.clientHeight / (2 * rig.focusDistance() * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
                const every = lively ? 32 : stepEvery(pixelsPerMetre, time - touched);
                if (dirty || ((lively || time - touched > 2500) && time - crowdAt >= every)) {
                    crowdAt = time;
                    if (crowd.update(time, camera)) dirty = true;
                }
            }
            // Now and then, while the map rests and no route is followed, someone in view speaks.
            if (crowd && prefs.people && !speech && !route?.length && time - touched > 2500 && performance.now() > nextChat) {
                nextChat = performance.now() + 22_000 + Math.random() * 14_000;
                const who = someoneInSight();
                if (who >= 0) say(who);
            }
            // The bubble stays over the speaker's head (or the creator's server room desk), wherever the view goes.
            if (speech) {
                if (performance.now() > speech.until || (!speech.at && !prefs.people)) speech = null;
                else if (bubble) {
                    if (speech.at) {
                        onScreen.copy(speech.at).project(camera);
                    } else if (crowd && speech.who !== undefined) {
                        crowd.headOf(speech.who, onScreen).project(camera);
                    }
                    const x = ((onScreen.x + 1) / 2) * dom.clientWidth,
                        y = ((1 - onScreen.y) / 2) * dom.clientHeight;
                    bubble.style.transform = `translate(${x}px, ${y}px)`;
                    bubble.style.visibility = onScreen.z < 1 ? "visible" : "hidden";
                }
            }
            if (!dirty) return;
            dirty = false;
            if (presentation) {
                const now = rig.heading();
                if (Math.abs(now - heading) > 0.005) heading = now;
            }
            renderer.render(scene, camera);
        }
        sync();
        daylight();
        animate();

        return () => {
            destroyed = true;
            sync = () => {};
            cancelAnimationFrame(frame);
            resize.disconnect();
            detachPointer();
            controls.dispose();
            clearBuildings();
            overlay.dispose();
            marker.dispose();
            scenery?.dispose();
            crowd?.dispose();
            avatar?.dispose();
            lost?.dispose();
            beacon?.dispose();
            removeEventListener("keydown", keyDown);
            removeEventListener("keyup", keyUp);
            removeEventListener("blur", letGo);
            removeEventListener("pointermove", lookMove);
            removeEventListener("pointerup", lookUp);
            removeEventListener("pointercancel", lookUp);
            clearInterval(daylightTimer);
            dom.removeEventListener("pointerdown", touch);
            dom.removeEventListener("wheel", touch);
            // What's left: the stage's meshes and lines, and the templates.
            const geometries = new Set<THREE.BufferGeometry>();
            scene.traverse((o) => {
                if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
                    geometries.add(o.geometry);
                    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
                }
            });
            templates.forEach((t) =>
                t.traverse((o) => {
                    if (o instanceof THREE.Mesh) geometries.add(o.geometry);
                }),
            );
            geometries.forEach((g) => g.dispose());
            materials.forEach((m) => m.dispose());
            renderer.dispose();
            dom.remove();
        };
    });
</script>

<div
    class="real-scene"
    bind:this={host}
    aria-label={t("scene3d")}
    onpointerdowncapture={() => (explored = presentation)}
    onwheelcapture={() => (explored = presentation)}
>
    {#if loading}<div class="scene-message">{t("loadingModels")}</div>{/if}
    {#if failed}<div class="scene-message">{t("sceneFailed")}</div>{/if}
    {#if prefs.info && hover && hoveredPiece && isBuilding(hoveredPiece)}<SceneTooltip
            piece={hoveredPiece}
            room={hoveredRoom}
            x={hover.x}
            y={hover.y}
        />{/if}
    <SceneOptions bind:prefs bind:cutaway bind:overhead routeShown={!!route?.length} />
    {#if presentation}
        <!-- Shown once the map is turned: a tap turns it back, north up. -->
        <button
            class="compass"
            class:turned
            tabindex={turned ? 0 : -1}
            aria-hidden={!turned}
            aria-label={t("northUp")}
            title={t("northUp")}
            onclick={() => faceNorth()}
            ><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" style:rotate={`${heading}rad`}
                ><path d="M12 3l3.6 9H8.4z" fill="#d6553a" /><path d="M12 21l-3.6-9h7.2z" fill="#9aa59b" /></svg
            ></button
        >
    {/if}
    {#if speech}<div class="npc-bubble" bind:this={bubble} role="status">{speech.text}</div>{/if}
    {#if presentation && away}<button
            class="recenter"
            style:bottom={`${insetBottom + 12}px`}
            title={t("recenterHint")}
            onclick={() => recenter()}
            ><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"
                ><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /><circle cx="12" cy="12" r="7" /></svg
            >{t("recenter")}</button
        >{/if}
    <div class="orbit-help" class:gone={explored || !!route?.length || !!focusShape}>
        <span
            >{#if presentation}{t("mapHelp")}{:else}{t(pan ? "dragToPan" : onmove ? "dragBuildings" : "dragToExplore")} · {t(
                    "zoomHelp",
                )}{/if}</span
        >
    </div>
    {#if !presentation}<a class="source-link" href="/models/hospital-assets.blend" download
            >↓ Blender source</a
        >{/if}
</div>

<style>
    .real-scene {
        position: absolute;
        inset: 0;
        overflow: hidden;
    }
    .real-scene :global(canvas) {
        display: block;
        width: 100%;
        height: 100%;
        touch-action: none;
    }
    .scene-message {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        background: #edf0e7e8;
        z-index: 2;
        font-size: 13px;
        color: #526746;
    }
    .orbit-help {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 65px;
        text-align: center;
        font-size: 9px;
        color: #6d7b64;
        pointer-events: none;
        transition: opacity 0.4s;
    }
    /* On the map, the hint goes once the visitor has moved it. */
    .orbit-help.gone {
        opacity: 0;
    }
    /* What someone walking by says: a small bubble over their head. */
    .npc-bubble {
        position: absolute;
        left: 0;
        top: 0;
        z-index: 2;
        pointer-events: none;
        will-change: transform;
        max-width: 220px;
        margin: -14px 0 0;
        padding: 8px 12px;
        border-radius: 14px;
        background: #fffdf8;
        color: #1f3a2b;
        font-size: 13px;
        line-height: 1.35;
        box-shadow:
            0 0 0 1px #1b2a2117,
            0 10px 24px -10px #1b2a2166;
        translate: -50% -100%;
        animation: bubble-in 220ms cubic-bezier(0.23, 1, 0.32, 1);
    }
    .npc-bubble::after {
        content: "";
        position: absolute;
        left: 50%;
        bottom: -6px;
        width: 12px;
        height: 12px;
        margin-left: -6px;
        background: #fffdf8;
        transform: rotate(45deg);
        box-shadow: 1px 1px 0 #1b2a2117;
    }
    @keyframes bubble-in {
        from {
            opacity: 0;
            scale: 0.85;
        }
    }
    /* Back to the starting view, once the visitor has moved the map from it. */
    .recenter {
        position: absolute;
        right: 12px;
        z-index: 3;
        display: flex;
        align-items: center;
        gap: 7px;
        height: 44px;
        padding: 0 16px 0 13px;
        border-radius: 22px;
        background: #fffdf8;
        color: #23463a;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        box-shadow:
            0 0 0 1px #1b2a2117,
            0 10px 28px -12px #1b2a2166;
        animation: recenter-in 200ms cubic-bezier(0.23, 1, 0.32, 1);
    }
    .recenter svg {
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
    }
    .recenter:active {
        transform: scale(0.96);
    }
    @keyframes recenter-in {
        from {
            opacity: 0;
            transform: translateY(6px) scale(0.96);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .recenter {
            animation: none;
        }
    }
    .compass {
        position: absolute;
        z-index: 3;
        top: 76px;
        right: 20px;
        width: 44px;
        height: 44px;
        display: grid;
        place-items: center;
        border-radius: 50%;
        background: #fffdf8;
        box-shadow:
            0 0 0 1px #1b2a2117,
            0 8px 24px -12px #1b2a2140;
        opacity: 0;
        scale: 0.8;
        pointer-events: none;
        transition:
            opacity 160ms ease-out,
            scale 160ms ease-out;
    }
    .compass.turned {
        opacity: 1;
        scale: 1;
        pointer-events: auto;
    }
    .compass:active {
        scale: 0.94;
    }
    .compass svg {
        transform-origin: center;
    }
    .source-link {
        position: absolute;
        top: 45px;
        left: 20px;
        color: #6c8060;
        text-decoration: none;
        font-size: 10px;
        background: #ffffffbb;
        padding: 6px 9px;
        border-radius: 4px;
    }
</style>
