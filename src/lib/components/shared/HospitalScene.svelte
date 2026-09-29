<script lang="ts">
    import { onMount } from "svelte";
    import * as THREE from "three";
    import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
    import { center, isArea, isBuilding, isOpenAir } from "$lib/model/interiors";
    import type { Piece } from "$lib/model/layout";
    import type { Point } from "$lib/wayfinding/navigation";
    import { createScenery, SKY } from "$lib/scene/scenery";
    import { createCameraRig } from "$lib/scene/camera-rig";
    import { createStage } from "$lib/scene/stage";
    import { createRouteOverlay } from "$lib/scene/route-overlay";
    import { createLabel, createDeclutter } from "$lib/scene/labels";
    import { loadTemplates, MODEL_KINDS, pieceModel } from "$lib/scene/models";
    import { attachPointer, type Hover } from "$lib/scene/pointer";
    import { clearGroup } from "$lib/scene/dispose";
    import { defaultPrefs, loadPrefs } from "$lib/scene/display-prefs";
    import SceneOptions from "./SceneOptions.svelte";
    import SceneTooltip from "./SceneTooltip.svelte";
    let {
        presentation = false,
        pan = false,
        onmove,
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
        labels = true,
        insetLeft = 0,
        insetBottom = 0,
    }: {
        presentation?: boolean;
        pan?: boolean;
        onmove?: (id: number, x: number, y: number) => void;
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
        labels?: boolean;
        /** Pixels on the left covered by an overlay panel; the view centres in the rest. */
        insetLeft?: number;
        /** Pixels at the bottom covered by a sheet; the campus rises clear of it. */
        insetBottom?: number;
    } = $props();
    let cutaway = $state(false),
        overhead = $state(false);
    let prefs = $state(defaultPrefs());
    onMount(() => {
        prefs = loadPrefs();
    });
    let buildingNames = $derived(labels && prefs.buildings),
        roomNames = $derived(labels && prefs.rooms);
    // A route runs indoors, so roofs come off while one is shown.
    let inside = $derived(cutaway || !!route?.length);
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
        buildingNames;
        roomNames;
        insetLeft;
        insetBottom;
        prefs.greenery;
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
            onerror("WebGL unavailable. Use the 2D view on this device.");
            return;
        }
        renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.setClearColor(presentation ? SKY.horizon : "#edf0e7");
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
            overlay = createRouteOverlay();
        scene.add(buildings, labelGroup, overlay.group);
        const declutter = createDeclutter();

        let templates = new Map<string, THREE.Group>(),
            materials = new Set<THREE.Material>();
        let destroyed = false;
        // Signatures of what was last built, so each sync only redoes what changed.
        let built = "",
            canvasSize = "",
            routeShown = "",
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
                labelGroup.add(tag);
            }
            // Rooms are only visible with the roofs off.
            if (roomNames && inside)
                for (const r of p.roomAssets ?? []) {
                    const tag = createLabel(r.name, "room");
                    tag.position.set((p.x + r.x + r.w / 2) * 2, 1.6, (p.y + r.y + r.h / 2) * 2);
                    labelGroup.add(tag);
                }
        }

        sync = () => {
            if (destroyed) return;
            controls.mouseButtons.LEFT = pan ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
            const size = `${canvasWidth}:${canvasHeight}`;
            if (size !== canvasSize) {
                canvasSize = size;
                stage.resize(canvasWidth, canvasHeight);
                rig.centre(canvasWidth, canvasHeight, zoom);
            }
            stage.grid.visible = grid;
            rig.setOverhead(overhead);
            rig.frame(host.clientWidth, host.clientHeight, insetLeft, insetBottom);
            scenery?.update(pieces, canvasWidth * 2, canvasHeight * 2, prefs.greenery, camera);
            if (lastZoom !== zoom) {
                rig.zoomBy(lastZoom / zoom);
                lastZoom = zoom;
            }
            const nextRoute = JSON.stringify(route ?? null);
            if (nextRoute !== routeShown) {
                routeShown = nextRoute;
                rig.frameRoute(overlay.show(route));
            }
            const next = JSON.stringify([pieces, inside, buildingNames, roomNames]);
            if (next !== built && ready()) {
                built = next;
                buildPieces();
                // The map opens on the canvas, filling the view, and stays
                // within it; framed again when the canvas is resized.
                if (presentation && canvasSize !== sited) {
                    sited = canvasSize;
                    rig.frameSite(
                        new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(canvasWidth * 2, 0, canvasHeight * 2)),
                        zoom,
                    );
                }
            }
            const object = buildings.children.find((o) => o.userData.pieceId === selected);
            stage.selectedBox.visible = !!object && !presentation;
            if (object) stage.selectedBox.box.setFromObject(object);
            if (!active) stage.ghost.visible = false;
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
                onerror("Could not load the Blender models. Please reload.");
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

        let frame = 0;
        function animate(time = 0) {
            frame = requestAnimationFrame(animate);
            overlay.animate(time);
            scenery?.animate(time, camera, rig.focusDistance());
            declutter(labelGroup, camera, dom.clientWidth, dom.clientHeight, time);
            rig.tick();
            controls.update();
            rig.bound();
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

<div class="real-scene" bind:this={host} aria-label="Interactive 3D hospital scene">
    {#if loading}<div class="scene-message">Loading Blender models…</div>{/if}
    {#if failed}<div class="scene-message">3D could not load. Switch to 2D or reload.</div>{/if}
    {#if prefs.info && hover && hoveredPiece && isBuilding(hoveredPiece)}<SceneTooltip
            piece={hoveredPiece}
            room={hoveredRoom}
            x={hover.x}
            y={hover.y}
        />{/if}
    <SceneOptions bind:prefs bind:cutaway bind:overhead routeShown={!!route?.length} {presentation} />
    <div class="orbit-help">
        {pan
            ? "Drag to pan"
            : onmove
              ? "Drag buildings to move · Drag background to orbit"
              : "Drag to explore"} · Scroll to zoom · Right-drag to pan
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
