<script lang="ts">
    import { onMount } from "svelte";
    import * as THREE from "three";
    import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
    import { center, isArea, isBuilding, isOpenAir } from "$lib/model/interiors";
    import type { Piece } from "$lib/model/layout";
    import type { Point } from "$lib/wayfinding/navigation";
    import { createScenery, LAWN } from "$lib/scene/scenery";
    import { aheadView, createCameraRig, doorView } from "$lib/scene/camera-rig";
    import { createStage } from "$lib/scene/stage";
    import { createRouteOverlay } from "$lib/scene/route-overlay";
    import { createHighlight, highlightShape, type HighlightTarget } from "$lib/scene/highlight";
    import { createLabel, createDeclutter } from "$lib/scene/labels";
    import { loadTemplates, MODEL_KINDS, pieceModel } from "$lib/scene/models";
    import { attachPointer, type Hover } from "$lib/scene/pointer";
    import { clearGroup } from "$lib/scene/dispose";
    import { batchMeshes } from "$lib/scene/batch";
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
        facing = null,
        highlight = null,
        labels = true,
        insetLeft = 0,
        insetBottom = 0,
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
        /**
         * While following: how far (radians, positive left) the visitor has
         * turned since this stretch began, from the phone's gyroscope; null
         * when it can't tell. The map turns with them.
         */
        facing?: (() => number | null) | null;
        /** A place to pick out, e.g. the one the assistant is talking about; hidden while a route shows. */
        highlight?: HighlightTarget | null;
        labels?: boolean;
        /** Pixels on the left covered by an overlay panel; the view centres in the rest. */
        insetLeft?: number;
        /** Pixels at the bottom covered by a sheet; the campus rises clear of it. */
        insetBottom?: number;
    } = $props();
    const { t } = useLocale();
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
        focusShape;
        buildingNames;
        roomNames;
        insetLeft;
        insetBottom;
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
        // The map is drawn at up to 1.5× on sharp screens: crisp enough, and
        // far fewer pixels for a budget phone to fill.
        renderer.setPixelRatio(Math.min(devicePixelRatio, presentation ? 1.5 : 2));
        renderer.shadowMap.enabled = true;
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
        const buildings = new THREE.Group(),
            labelGroup = new THREE.Group(),
            overlay = createRouteOverlay(),
            marker = createHighlight();
        scene.add(buildings, labelGroup, overlay.group, marker.group);
        const declutter = createDeclutter();
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
            /** The heading the current stretch is seen from (`aheadView`), when following one. */
            legTheta: number | null = null,
            sited = "",
            lastZoom = zoom;
        const ready = () => templates.size === MODEL_KINDS.length;

        function clearBuildings() {
            clearGroup(labelGroup);
            // Template geometry is shared by every copy; only generated parts are owned.
            clearGroup(buildings, (o) => !!o.userData.generated);
        }

        function buildPieces() {
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
                // A new stretch faces its own way; turning with the visitor starts afresh.
                legTheta = ahead ? ahead.view.theta : null;
                rig.steerFrom();

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
            onselect,
            onplace,
            onmove,
            onhover: (h) => (hover = h),
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
            if (rig.tick()) dirty = true;
            // The way the visitor faces points up the screen: the stretch's way, turned as they turn.
            if (facing && legTheta !== null) {
                const turned = facing();
                if (turned !== null && rig.steer(legTheta + turned)) dirty = true;
            }
            if (controls.update()) dirty = true;
            rig.bound();
            // The route's arrows and the pin move gently; 30 frames a second is plenty.
            if ((route?.length || focusShape || !presentation) && time - pulsed > (presentation ? 32 : 0)) {
                pulsed = time;
                overlay.animate(time);
                marker.animate(time);
                dirty = true;
            }
            if (declutter(labelGroup, camera, dom.clientWidth, dom.clientHeight, time)) dirty = true;
            if (!dirty) return;
            dirty = false;
            if (presentation) {
                const now = rig.heading();
                if (Math.abs(now - heading) > 0.005) heading = now;
            }
            renderer.render(scene, camera);
        }
        sync();
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
