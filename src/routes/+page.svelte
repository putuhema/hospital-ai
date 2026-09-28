<script lang="ts">
    import { onMount } from "svelte";
    import { replaceState } from "$app/navigation";
    import HospitalScene from "$lib/components/shared/HospitalScene.svelte";
    import Logo from "$lib/components/shared/Logo.svelte";
    import FloorPlan from "$lib/components/shared/FloorPlan.svelte";
    import RouteFinder from "$lib/components/shared/RouteFinder.svelte";
    import {
        starterPieces,
        parseLayout,
        STORAGE_KEY,
        type Piece,
    } from "$lib/model/layout";
    import { walkwayAt } from "$lib/model/interiors";
    import {
        emptyNetwork,
        type Point,
        type WalkingNetwork,
    } from "$lib/wayfinding/navigation";
    import {
        buildGrid,
        places,
        planRoute,
        type Place,
    } from "$lib/wayfinding/routing";
    let pieces: Piece[] = $state(structuredClone(starterPieces));
    let network: WalkingNetwork = $state(emptyNetwork());
    let title = $state("Greenfield Hospital"),
        canvasWidth = $state(24),
        canvasHeight = $state(20),
        view = $state<"3D" | "Plan">("3D"),
        error = $state(""),
        toast = $state(""),
        ready = $state(false),
        panelOpen = $state(true),
        wide = $state(true);
    let from = $state.raw<Place | Point | null>(null),
        to = $state.raw<Place | null>(null),
        picking = $state(false);
    let exporter: (() => Promise<void>) | null = null;
    let grid = $derived(buildGrid(pieces, canvasWidth, canvasHeight));
    let placeList = $derived(places(pieces, network));
    let route = $derived(from && to ? planRoute(grid, from, to) : null);
    let landmarks = $derived(network.nodes.filter((n) => n.name.trim()));

    const encode = (p: Place | Point) =>
        "id" in p ? p.id : `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    function decode(value: string | null): Place | Point | null {
        if (!value) return null;
        const place = placeList.find((p) => p.id === value);
        if (place) return place;
        const [x, y] = value.split(",").map(Number);
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    }
    onMount(() => {
        function load() {
            try {
                const saved = localStorage.getItem(STORAGE_KEY);
                if (saved) {
                    const d = parseLayout(saved);
                    pieces = d.pieces;
                    network = d.network;
                    title = d.title;
                    canvasWidth = d.grid.width;
                    canvasHeight = d.grid.height;
                }
                error = "";
            } catch {
                error =
                    "The saved layout could not be loaded. Open the editor to save it again.";
            }
            ready = true;
        }
        load();
        const desktop = window.matchMedia("(min-width: 701px)");
        wide = desktop.matches;
        desktop.onchange = () => (wide = desktop.matches);
        // Deep links, e.g. a QR code at an entrance: /?from=b:9&to=r:2:25
        const params = new URLSearchParams(location.search);
        from = decode(params.get("from"));
        const target = decode(params.get("to"));
        to = target && "id" in target ? target : null;
        if (params.get("view") === "plan") view = "Plan";
        if (window.matchMedia("(max-width: 700px)").matches && to)
            panelOpen = true;
        function changed(e: StorageEvent) {
            if (e.key === STORAGE_KEY) load();
        }
        window.addEventListener("storage", changed);
        return () => window.removeEventListener("storage", changed);
    });
    $effect(() => {
        if (!ready) return;
        const params = new URLSearchParams();
        if (from) params.set("from", encode(from));
        if (to) params.set("to", to.id);
        if (view === "Plan") params.set("view", "plan");
        const query = params.toString();
        try {
            replaceState(query ? `?${query}` : location.pathname, {});
        } catch {
            // Before the router is ready (first render) the URL already matches.
        }
    });
    function notify(s: string) {
        toast = s;
        setTimeout(() => (toast = ""), 2400);
    }
    function choose(place: Place | null, point?: Point) {
        if (picking) {
            // A room or building, or any spot on a corridor or path; not the open grounds.
            if (place) from = place;
            else if (point && walkwayAt(pieces, point)) from = point;
            else return notify("Pick a room, a building, or a spot on a corridor or path");
            picking = false;
        } else if (place) to = place;
    }
    async function share() {
        try {
            await navigator.clipboard.writeText(location.href);
            notify(
                "Link copied — it opens this route on devices that have this layout",
            );
        } catch {
            notify("Copy the address bar to share this route");
        }
    }
    async function download() {
        try {
            await exporter?.();
        } catch {
            error = "The 3D models are still loading. Try again shortly.";
        }
    }
</script>

<svelte:head
    ><title>{title} — P-Map</title><meta
        name="description"
        content="Find rooms and get walking directions around the hospital."
    /></svelte:head
>
<svelte:window
    onkeydown={(e) => {
        if (e.key === "Escape") picking = false;
    }}
/>
<div class="map-viewer" class:picking class:sheet-open={panelOpen}>
    <section class="stage" aria-label="Hospital map">
        {#if ready}{#if view === "3D"}<HospitalScene
                    presentation={true}
                    {pieces}
                    selected={null}
                    active={null}
                    grid={false}
                    zoom={100}
                    {canvasWidth}
                    {canvasHeight}
                    route={route?.points ?? null}
                    insetLeft={panelOpen && wide ? 400 : 0}
                    onselect={(id, roomId, point) => {
                        const key = roomId ? `r:${id}:${roomId}` : `b:${id}`;
                        choose(placeList.find((p) => p.id === key) ?? null, point);
                    }}
                    onplace={() => {}}
                    onerror={(s) => (error = s)}
                    registerExport={(fn) => (exporter = fn)}
                />{:else}<div class="plan">
                    <FloorPlan
                        {pieces}
                        places={placeList}
                        width={canvasWidth}
                        height={canvasHeight}
                        route={route?.points ?? null}
                        {landmarks}
                        destination={to}
                        {picking}
                        onpick={(point, place) => choose(place, point)}
                    />
                </div>{/if}{/if}
    </section>
    <aside class="panel" class:collapsed={!panelOpen}>
        <header>
            <div>
                <small class="product"><Logo size={16} title="" /> P-Map · Wayfinding</small>
                <h1>{title}</h1>
            </div>
            <button
                class="collapse"
                aria-expanded={panelOpen}
                aria-label={panelOpen ? "Hide directions" : "Show directions"}
                onclick={() => (panelOpen = !panelOpen)}
                >{panelOpen ? "−" : "+"}</button
            >
        </header>
        {#if panelOpen}<RouteFinder
                places={placeList}
                {grid}
                {route}
                bind:from
                bind:to
                bind:picking
            />{/if}
    </aside>
    <div class="top-actions">
        <div class="segmented" role="group" aria-label="Map view">
            {#each ["3D", "Plan"] as const as v}<button
                    class:active={view === v}
                    aria-pressed={view === v}
                    onclick={() => (view = v)}>{v}</button
                >{/each}
        </div>
        <button class="btn" disabled={!to} onclick={share}>Share route</button>
        <details class="more">
            <summary class="btn" aria-label="More options">•••</summary>
            <div class="menu">
                <a href="/editor">Open editor</a>
                <button onclick={download}>Export 3D model (.glb)</button>
            </div>
        </details>
    </div>
    {#if picking}<div class="pick-banner" role="status">
            Click your room or building, or where you are on a corridor or path · <button
                onclick={() => (picking = false)}>Cancel</button
            >
        </div>{/if}
    {#if error}<p class="viewer-error" role="alert">{error}</p>{/if}
    {#if toast}<div class="toast" role="status"><span>✓</span>{toast}</div>{/if}
</div>

<style>
    .map-viewer {
        position: relative;
        height: 100dvh;
        overflow: hidden;
        background: #edf0e7;
    }
    .stage {
        position: absolute;
        inset: 0;
    }
    .plan {
        position: absolute;
        inset: 0;
        padding: 16px 16px 16px 400px;
    }
    .panel {
        position: absolute;
        top: 16px;
        left: 16px;
        bottom: 16px;
        width: 368px;
        z-index: 6;
        padding: 20px;
        overflow: auto;
        background: #fffffff5;
        border: 1px solid #fff;
        border-radius: 18px;
        box-shadow: 0 12px 50px #243d241c;
    }
    .panel.collapsed {
        bottom: auto;
    }
    .panel small.product {
        display: flex;
        align-items: center;
        gap: 6px;
        text-transform: uppercase;
    }
    .panel header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 16px;
    }
    .panel small {
        font-size: 9px;
        letter-spacing: 1.4px;
        color: #7b8c70;
    }
    .panel h1 {
        font:
            24px Georgia,
            serif;
        margin: 4px 0 0;
        color: #1f3a2b;
    }
    .collapse {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        background: #eef2e9;
        font-size: 17px;
        color: #3f6b4e;
        flex-shrink: 0;
    }
    .top-actions {
        position: absolute;
        top: 16px;
        right: 16px;
        z-index: 6;
        display: flex;
        gap: 8px;
        align-items: flex-start;
    }
    .segmented {
        display: flex;
        padding: 3px;
        background: white;
        border-radius: 10px;
        box-shadow: 0 3px 16px #243d2414;
    }
    .segmented button {
        padding: 8px 14px;
        border-radius: 7px;
        font-size: 12px;
        color: #52664a;
    }
    .segmented .active {
        background: #2d4a38;
        color: white;
    }
    .top-actions .btn {
        box-shadow: 0 3px 16px #243d2414;
    }
    .more {
        position: relative;
    }
    .more summary {
        list-style: none;
        cursor: pointer;
    }
    .more summary::-webkit-details-marker {
        display: none;
    }
    .menu {
        position: absolute;
        right: 0;
        top: calc(100% + 6px);
        min-width: 200px;
        padding: 6px;
        background: white;
        border-radius: 10px;
        box-shadow: 0 12px 34px #1f35261f;
        display: flex;
        flex-direction: column;
    }
    .menu a,
    .menu button {
        padding: 10px 12px;
        border-radius: 7px;
        font-size: 12px;
        color: #2f4336;
        text-decoration: none;
        text-align: left;
    }
    .menu a:hover,
    .menu button:hover {
        background: #eef3e8;
    }
    .pick-banner {
        position: absolute;
        top: 72px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 7;
        padding: 10px 16px;
        border-radius: 30px;
        background: #2f7fc4;
        color: white;
        font-size: 12px;
        box-shadow: 0 6px 24px #2f7fc440;
    }
    .pick-banner button {
        color: white;
        text-decoration: underline;
        font-size: 12px;
    }
    .map-viewer.picking .stage :global(canvas) {
        cursor: crosshair;
    }
    .map-viewer :global(.scene-options) {
        top: 70px;
        right: 16px;
    }
    .map-viewer :global(.orbit-help) {
        left: 400px;
        bottom: 18px;
    }
    .viewer-error {
        position: absolute;
        bottom: 20px;
        right: 20px;
        max-width: 420px;
        z-index: 8;
        background: #fff2dd;
        color: #785e33;
        padding: 14px 16px;
        border-radius: 10px;
    }
    @media (max-width: 700px) {
        .panel {
            top: auto;
            left: 8px;
            right: 8px;
            bottom: 8px;
            width: auto;
            max-height: 50dvh;
            padding: 16px;
            border-radius: 16px;
        }
        .panel.collapsed {
            bottom: 8px;
        }
        .panel h1 {
            font-size: 19px;
        }
        .plan {
            padding: 64px 8px 8px;
        }
        /* Keep the map (and the route) above the directions sheet. */
        .sheet-open .stage {
            bottom: calc(50dvh - 8px);
        }
        .top-actions {
            top: 10px;
            right: 10px;
            left: 10px;
        }
        .top-actions .segmented {
            margin-right: auto;
        }
        .map-viewer :global(.orbit-help) {
            display: none;
        }
        .map-viewer :global(.scene-options) {
            top: 60px;
            right: 10px;
        }
    }
</style>
