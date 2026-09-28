<script lang="ts">
    import { onMount, untrack } from "svelte";
    import { replaceState } from "$app/navigation";
    import HospitalScene from "$lib/components/shared/HospitalScene.svelte";
    import Logo from "$lib/components/shared/Logo.svelte";
    import FloorPlan from "$lib/components/shared/FloorPlan.svelte";
    import RouteFinder from "$lib/components/shared/RouteFinder.svelte";
    import MobileMap from "./MobileMap.svelte";
    import type { Piece } from "$lib/model/layout";
    import { walkwayAt } from "$lib/model/interiors";
    import type { Point, WalkingNetwork } from "$lib/wayfinding/navigation";
    import {
        buildGrid,
        places,
        planRoute,
        type Place,
    } from "$lib/wayfinding/routing";
    let {
        title,
        pieces,
        network,
        canvasWidth,
        canvasHeight,
        shareUrl = null,
        editable = false,
        notice = "",
    }: {
        title: string;
        pieces: Piece[];
        network: WalkingNetwork;
        canvasWidth: number;
        canvasHeight: number;
        /** The public address of this map; routes are shared from it. Null when unpublished. */
        shareUrl?: string | null;
        /** Show the link back to the editor (not on the public map). */
        editable?: boolean;
        /** A problem with the layout itself, e.g. it could not be loaded. */
        notice?: string;
    } = $props();
    let view = $state<"3D" | "Plan">("3D"),
        error = $state(""),
        toast = $state(""),
        ready = $state(false),
        panelOpen = $state(true),
        wide = $state(true),
        layersOpen = $state(false),
        sheetInset = $state(0);
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
        const desktop = window.matchMedia("(min-width: 701px)");
        wide = desktop.matches;
        desktop.onchange = () => (wide = desktop.matches);
        // Deep links, e.g. a QR code at an entrance: /?from=b:9&to=r:2:25
        const params = new URLSearchParams(location.search);
        from = decode(params.get("from"));
        const target = decode(params.get("to"));
        to = target && "id" in target ? target : null;
        if (params.get("view") === "plan") view = "Plan";
        ready = true;
    });
    // When the layout changes (a new version is published or saved), keep the
    // chosen places but pick up where they are now.
    $effect(() => {
        const list = placeList;
        untrack(() => {
            if (from && "id" in from) from = list.find((p) => p.id === (from as Place).id) ?? null;
            if (to) to = list.find((p) => p.id === to!.id) ?? null;
        });
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
        const link = shareUrl ? shareUrl + location.search : location.href;
        try {
            await navigator.clipboard.writeText(link);
            notify(
                shareUrl
                    ? "Link copied — it opens this route on any phone"
                    : "Link copied — publish the map in the editor so it opens on other devices",
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
<div
    class="map-viewer"
    class:picking
    class:mobile={ready && !wide}
    class:layers-open={layersOpen}
    style:--sheet-inset={`${wide ? 0 : sheetInset}px`}
>
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
                    insetBottom={wide ? 0 : sheetInset}
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
    {#if ready && !wide}<MobileMap
            {title}
            places={placeList}
            {grid}
            {route}
            {editable}
            bind:from
            bind:to
            bind:picking
            bind:view
            bind:layersOpen
            bind:inset={sheetInset}
            onshare={share}
            ondownload={download}
        />{:else}
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
                {#if editable}<a href="/editor">Open editor</a>{/if}
                <button onclick={download}>Export 3D model (.glb)</button>
            </div>
        </details>
    </div>{/if}
    {#if picking}<div class="pick-banner" role="status">
            {wide ? "Click" : "Tap"} your room or building, or where you are on a corridor or path · <button
                onclick={() => (picking = false)}>Cancel</button
            >
        </div>{/if}
    {#if error || notice}<p class="viewer-error" role="alert">{error || notice}</p>{/if}
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
    /* Phones get the mobile layout once the page knows the screen size; the
       desktop panel never shows there. */
    @media (max-width: 700px) {
        .panel,
        .top-actions {
            visibility: hidden;
        }
        .map-viewer :global(.orbit-help) {
            display: none;
        }
    }
    .mobile .plan {
        padding: calc(env(safe-area-inset-top) + 124px) 8px calc(var(--sheet-inset) + 8px);
    }
    .mobile .pick-banner {
        top: calc(env(safe-area-inset-top) + 12px);
        width: calc(100% - 24px);
        padding: 12px 16px;
        border-radius: 16px;
        font-size: 14px;
        line-height: 1.4;
        text-align: center;
        animation: banner-in 280ms cubic-bezier(0.23, 1, 0.32, 1);
    }
    .mobile .pick-banner button {
        font-size: 14px;
        font-weight: 600;
    }
    @keyframes banner-in {
        from {
            opacity: 0;
            transform: translate(-50%, -8px);
        }
    }
    .mobile :global(.toast) {
        top: calc(env(safe-area-inset-top) + 76px);
        bottom: auto;
        max-width: calc(100% - 32px);
        border-radius: 14px;
        font-size: 14px;
    }
    .mobile .viewer-error {
        top: calc(env(safe-area-inset-top) + 76px);
        bottom: auto;
        left: 12px;
        right: 12px;
        max-width: none;
    }
    /* The 3D display options open under the map type card, as one menu. */
    .mobile :global(.scene-options) {
        display: none;
    }
    .mobile.layers-open :global(.scene-options) {
        display: flex;
        flex-wrap: wrap;
        top: calc(env(safe-area-inset-top) + 318px);
        right: 12px;
        z-index: 20;
        width: 240px;
        padding: 8px;
        gap: 4px;
        border-radius: 16px;
        background: white;
        box-shadow:
            0 2px 6px #1f352614,
            0 16px 40px #1f352629;
        transform-origin: top right;
        transition:
            opacity 200ms cubic-bezier(0.23, 1, 0.32, 1),
            transform 200ms cubic-bezier(0.23, 1, 0.32, 1);
        @starting-style {
            opacity: 0;
            transform: scale(0.96);
        }
    }
    .mobile.layers-open :global(.scene-options button) {
        padding: 9px 12px;
        font-size: 13px;
    }
    .mobile.layers-open :global(.scene-options .greenery) {
        padding: 6px 8px;
        font-size: 13px;
    }
</style>
