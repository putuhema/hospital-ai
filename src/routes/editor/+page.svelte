<script lang="ts">
    import { onMount } from "svelte";
    import { goto } from "$app/navigation";
    import { assets, starterPieces, parseLayout, pieceFrom, STORAGE_KEY, type Piece } from "$lib/model/layout";
    import { emptyNetwork, type WalkingNetwork } from "$lib/wayfinding/navigation";
    import {
        anchoredLayout,
        checkCanvasSize,
        checkMove,
        checkPlacement,
        checkReshape,
        checkRotation,
        duplicated,
        placedFrom,
        rotated,
        type Anchor,
    } from "$lib/editor/operations";
    import { downloadFile, fileName, layoutJson, layoutObj, layoutSnapshot } from "$lib/editor/export";
    import { History } from "$lib/editor/history.svelte";
    import HospitalScene from "$lib/components/shared/HospitalScene.svelte";
    import WayfindingPanel from "$lib/components/editor/WayfindingPanel.svelte";
    import EditorRail from "$lib/components/editor/EditorRail.svelte";
    import ProjectBar from "$lib/components/editor/ProjectBar.svelte";
    import CanvasSettings from "$lib/components/editor/CanvasSettings.svelte";
    import AssetLibrary from "$lib/components/editor/AssetLibrary.svelte";
    import CanvasToolbar, { type EditorView } from "$lib/components/editor/CanvasToolbar.svelte";
    import PlanView from "$lib/components/editor/PlanView.svelte";
    import CanvasControls from "$lib/components/editor/CanvasControls.svelte";
    import PropertiesPanel from "$lib/components/editor/PropertiesPanel.svelte";
    import GuideDialog from "$lib/components/editor/GuideDialog.svelte";

    const GUIDE_SEEN = "forma-guide-seen";

    // The project.
    let pieces: Piece[] = $state(structuredClone(starterPieces));
    let network: WalkingNetwork = $state(emptyNetwork());
    let title = $state("Greenfield Hospital"),
        canvasWidth = $state(24),
        canvasHeight = $state(20);
    let canvas = $derived({ width: canvasWidth, height: canvasHeight });

    // Editor state.
    let selected = $state<number | null>(1),
        /** Index into `assets` of the asset being placed. */
        active = $state<number | null>(null),
        view = $state<EditorView>("3D"),
        zoom = $state(100),
        grid = $state(true),
        pan = $state(false),
        panX = $state(0),
        panY = $state(0);
    /**
     * The asset being placed, as a piece that can be turned and edited before
     * it goes on the canvas. Each click places a copy of it.
     */
    let draft = $state<Piece | null>(null);
    $effect(() => {
        draft = active === null ? null : pieceFrom(assets[active], { id: 0, x: 0, y: 0 });
    });
    let assetsOpen = $state(true),
        propertiesOpen = $state(true),
        canvasSettings = $state(false),
        exportOpen = $state(false),
        guideOpen = $state(false),
        toast = $state(""),
        saved = $state(true);
    let current = $derived(pieces.find((p) => p.id === selected));
    let exportScene: (() => Promise<void>) | null = null;

    function notify(message: string) {
        toast = message;
        setTimeout(() => (toast = ""), 2800);
    }

    // Undo/redo covers the pieces and the walking network.
    const history = new History();
    const serialised = () => JSON.stringify({ pieces, network });
    function restore(json: string | null) {
        if (json === null) return;
        ({ pieces, network } = JSON.parse(json));
        saved = false;
    }
    /** Call before every change, so it can be undone. */
    function checkpoint() {
        history.record(serialised());
        saved = false;
    }
    const undo = () => restore(history.undo(serialised()));
    const redo = () => restore(history.redo(serialised()));

    // Persistence: autosave shortly after every change, so work is never lost.
    let loaded = false,
        saveTimer: ReturnType<typeof setTimeout> | undefined;
    const snapshot = () => layoutSnapshot({ title, pieces, network, width: canvasWidth, height: canvasHeight });
    function save(announce = true) {
        clearTimeout(saveTimer);
        localStorage.setItem(STORAGE_KEY, snapshot());
        saved = true;
        if (announce) notify("Saved on this device");
    }
    $effect(() => {
        snapshot();
        if (!loaded) return;
        saved = false;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => save(false), 600);
    });
    $effect(() => {
        if (!guideOpen && loaded) localStorage.setItem(GUIDE_SEEN, "1");
    });
    function load(json: string) {
        const d = parseLayout(json);
        pieces = d.pieces;
        network = d.network;
        title = d.title;
        canvasWidth = d.grid.width;
        canvasHeight = d.grid.height;
    }
    onMount(() => {
        if (!localStorage.getItem(GUIDE_SEEN)) guideOpen = true;
        if (window.matchMedia("(max-width: 900px)").matches) assetsOpen = propertiesOpen = false;
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            if (data) load(data);
        } catch {
            notify("Could not restore the saved project");
        }
        loaded = true;
    });

    // Editing the selected piece, or the draft while placing.
    function edit(changes: Partial<Piece>) {
        if (draft) {
            draft = { ...draft, ...changes };
            return;
        }
        checkpoint();
        pieces = pieces.map((p) => (p.id === selected ? { ...p, ...changes } : p));
    }
    function update(key: keyof Piece, value: string | number | undefined) {
        const piece = draft ?? current;
        if (!piece) return;
        if (typeof value === "number") value = Math.round(value);
        if (key === "w" || key === "h" || key === "shape") {
            // A draft isn't on the canvas yet, so only its own rooms and doors matter.
            const problem = checkReshape(draft ? [] : pieces, { ...piece, [key]: value });
            if (problem) return notify(problem);
        }
        edit({ [key]: value });
    }
    function rotate() {
        if (draft) {
            const turned = rotated(draft, canvas);
            if (turned.w > canvasWidth || turned.h > canvasHeight)
                return notify("Too large for the canvas when turned");
            draft = turned;
            return;
        }
        if (!current) return;
        const turned = rotated(current, canvas);
        const problem = checkRotation(pieces, turned, canvas);
        if (problem) return notify(problem);
        edit(turned);
    }
    function duplicate() {
        if (!current || draft) return;
        const copy = duplicated(current, Date.now(), canvas);
        checkpoint();
        selected = copy.id;
        pieces = [...pieces, copy];
    }
    function remove() {
        if (!current || draft) return;
        checkpoint();
        pieces = pieces.filter((p) => p.id !== selected);
        selected = null;
    }
    function moveBuilding(id: number, x: number, y: number) {
        const p = pieces.find((p) => p.id === id);
        if (!p || (p.x === x && p.y === y)) return;
        const problem = checkMove(pieces, p, x, y, canvas);
        if (problem) return notify(problem);
        checkpoint();
        pieces = pieces.map((o) => (o.id === id ? { ...o, x, y } : o));
    }
    /** Place the active asset at a tile; without one, a click deselects. */
    function placeAt(tile: { x: number; y: number }) {
        if (active === null) {
            selected = null;
            return;
        }
        if (!draft) return;
        const piece = placedFrom($state.snapshot(draft), Date.now(), tile);
        const problem = checkPlacement(pieces, piece, canvas);
        if (problem) return notify(problem);
        checkpoint();
        selected = piece.id;
        pieces = [...pieces, piece];
        propertiesOpen = true;
        notify(piece.name + " placed — press Esc to stop placing");
    }
    function resizeCanvas(w: number, h: number, anchor: Anchor) {
        const next = anchoredLayout($state.snapshot(pieces), $state.snapshot(network), canvas, w, h, anchor);
        const problem = checkCanvasSize(next.pieces, next.network, w, h);
        if (problem) return notify(problem);
        pieces = next.pieces;
        network = next.network;
        canvasWidth = w;
        canvasHeight = h;
        saved = false;
        canvasSettings = false;
        history.clear();
        notify("Canvas resized");
    }

    // Import and export.
    function download(format: "json" | "obj") {
        const project = { title, pieces, network, width: canvasWidth, height: canvasHeight };
        if (format === "json") {
            downloadFile(layoutJson(project), "application/json", fileName(title, "json"));
            notify("Layout exported");
        } else {
            downloadFile(layoutObj(pieces), "text/plain", fileName(title, "obj"));
            notify("Blender-compatible OBJ exported");
        }
    }
    async function exportModel() {
        exportOpen = false;
        if (!exportScene || view !== "3D") return notify("Switch to 3D before exporting the detailed model");
        try {
            await exportScene();
            notify("Detailed Blender model exported");
        } catch {
            notify("Models are still loading. Try again shortly.");
        }
    }
    function importFile(e: Event) {
        const file = (e.target as HTMLInputElement).files?.[0];
        file?.text().then((text) => {
            try {
                parseLayout(text);
                checkpoint();
                load(text);
                selected = null;
                notify("Layout imported");
            } catch {
                notify("Invalid layout file");
            }
        });
    }

    function key(e: KeyboardEvent) {
        if ((e.target as HTMLElement).matches("input,select,textarea")) return;
        const command = e.metaKey || e.ctrlKey;
        if (e.key === "Escape") {
            if (guideOpen) guideOpen = false;
            else if (active !== null) active = null;
            else if (view !== "Paths") selected = null;
        }
        // The wayfinding view has its own tools; only save and undo apply.
        if (view === "Paths" && !command) return;
        if (e.key === "?") guideOpen = true;
        if (e.key.toLowerCase() === "d" && !command) duplicate();
        if (e.key === "Delete" || e.key === "Backspace") remove();
        if (e.key.toLowerCase() === "r") rotate();
        if (command && e.key === "s") {
            e.preventDefault();
            save();
        }
        if (command && e.key === "z") {
            e.preventDefault();
            e.shiftKey ? redo() : undo();
        }
    }
</script>

<svelte:head
    ><title>{title} — P-Map Editor</title><meta
        name="description"
        content="Design hospital layouts with modular buildings and corridors on a grid."
    /></svelte:head
>
<svelte:window onkeydown={key} />
<div class="app-shell">
    <EditorRail onimport={() => document.getElementById("import")?.click()} onnotify={notify} />
    <div class="workspace">
        <ProjectBar
            bind:title
            bind:exportOpen
            {saved}
            layout={snapshot()}
            onnotify={notify}
            onedit={() => (saved = false)}
            onguide={() => (guideOpen = true)}
            oncanvassize={() => (canvasSettings = !canvasSettings)}
            onopenmap={() => {
                save(false);
                goto("/");
            }}
            ondownload={download}
            onexportmodel={exportModel}
        />
        {#if canvasSettings}<CanvasSettings
                width={canvasWidth}
                height={canvasHeight}
                onapply={resizeCanvas}
                oncancel={() => (canvasSettings = false)}
            />{/if}
        <main>
            <AssetLibrary bind:active hidden={!assetsOpen} onnotify={notify} />
            <section class="canvas-section">
                <CanvasToolbar
                    bind:active
                    bind:pan
                    bind:view
                    bind:assetsOpen
                    bind:propertiesOpen
                    canUndo={history.past.length > 0}
                    canRedo={history.future.length > 0}
                    onundo={undo}
                    onredo={redo}
                />
                <div class="canvas" class:placing={active !== null}>
                    <div class="canvas-title">
                        <span class="live-dot"></span>
                        {active === null ? "Layout editor" : "Place " + assets[active].name}<small
                            >{canvasWidth} × {canvasHeight} grid</small
                        >
                    </div>
                    {#if view === "Paths"}<WayfindingPanel
                            {pieces}
                            {network}
                            width={canvasWidth}
                            height={canvasHeight}
                            onchange={(n) => {
                                checkpoint();
                                network = n;
                            }}
                            onselectpiece={(id) => {
                                view = "3D";
                                selected = id;
                                propertiesOpen = true;
                            }}
                        />{:else if view === "3D"}<HospitalScene
                            {canvasWidth}
                            {canvasHeight}
                            {pieces}
                            {selected}
                            active={draft}
                            {grid}
                            {zoom}
                            onselect={(id) => (selected = id)}
                            {pan}
                            onmove={moveBuilding}
                            onplace={placeAt}
                            onerror={notify}
                            registerExport={(fn) => (exportScene = fn)}
                        />{:else}<PlanView
                            {pieces}
                            bind:selected
                            asset={draft}
                            width={canvasWidth}
                            height={canvasHeight}
                            {grid}
                            {zoom}
                            {pan}
                            bind:panX
                            bind:panY
                            onplace={placeAt}
                            onmove={moveBuilding}
                            oncancel={() => (active = null)}
                        />{/if}
                    <CanvasControls
                        bind:grid
                        bind:zoom
                        onfit={() => {
                            panX = 0;
                            panY = 0;
                        }}
                    />
                </div>
                <div class="canvas-status">
                    <span><i></i> Snap to grid <b>ON</b></span><span>1 tile = 2 × 2 m</span><span
                        class="right-status"
                        >{pieces.length} objects <span>•</span> Ground floor</span
                    >
                </div>
            </section>
            <PropertiesPanel
                piece={draft ?? current}
                placing={!!draft}
                {pieces}
                {canvasWidth}
                {canvasHeight}
                hidden={!propertiesOpen}
                {update}
                {edit}
                onrotate={rotate}
                onduplicate={duplicate}
                onremove={remove}
                onguide={() => (guideOpen = true)}
                onexportmodel={exportModel}
                onnotify={notify}
            />
        </main>
    </div>
</div>
<input id="import" type="file" accept=".json" hidden onchange={importFile} />
{#if guideOpen}<GuideDialog onclose={() => (guideOpen = false)} />{/if}
{#if toast}<div class="toast" role="status"><span>✓</span>{toast}</div>{/if}
