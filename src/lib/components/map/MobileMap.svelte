<script lang="ts">
    import { onMount } from "svelte";
    import Logo from "$lib/components/shared/Logo.svelte";
    import PlaceSearch from "$lib/components/shared/PlaceSearch.svelte";
    import PlaceDetails from "$lib/components/shared/PlaceDetails.svelte";
    import BottomSheet from "./BottomSheet.svelte";
    import SearchScreen from "./SearchScreen.svelte";
    import { walkwayAt } from "$lib/model/interiors";
    import { shortcuts as shortcutsFor } from "$lib/wayfinding/shortcuts";
    import PlaceIcon from "$lib/components/shared/PlaceIcon.svelte";
    import { hoursStatus } from "$lib/model/place-info";
    import type { Point } from "$lib/wayfinding/navigation";
    import {
        nearestOfType,
        stepGlyph,
        walkMinutes,
        type NavGrid,
        type Place,
        type Route,
    } from "$lib/wayfinding/routing";
    import { pop, rise, unblur } from "$lib/motion";
    let {
        title,
        places,
        grid,
        route,
        editable = false,
        from = $bindable(null),
        to = $bindable(null),
        picking = $bindable(false),
        view = $bindable("3D"),
        layersOpen = $bindable(false),
        inset = $bindable(0),
        onshare,
        ondownload,
    }: {
        title: string;
        places: Place[];
        grid: NavGrid;
        route: Route | null;
        editable?: boolean;
        from?: Place | Point | null;
        to?: Place | null;
        picking?: boolean;
        view?: "3D" | "Plan";
        /** The map view options are showing (the 3D display options follow it). */
        layersOpen?: boolean;
        /** Pixels at the bottom of the map covered by the sheet. */
        inset?: number;
        onshare: () => void;
        ondownload: () => void;
    } = $props();

    let routing = $state(false),
        searching = $state(false),
        menuOpen = $state(false),
        snap = $state<"peek" | "full">("peek");
    let sheetOpen = $derived(!!to || routing);
    // Stop picking a start when directions close.
    $effect(() => {
        if (!routing) picking = false;
    });

    // Room types and landmark kinds in this layout, most useful first.
    let shortcuts = $derived(shortcutsFor(places));
    let fromName = $derived(
        !from ? "" : "id" in from ? from.name : `Spot on ${walkwayAt(grid.pieces, from)?.name ?? "the map"}`,
    );
    let status = $derived(to?.info ? hoursStatus(to.info, new Date()) : null);

    onMount(() => {
        // A shared link with both ends opens straight on the directions.
        if (from && to) routing = true;
    });
    function goTo(place: Place | null) {
        if (!place) return;
        to = place;
        snap = "peek";
        searching = false;
    }
    function nearest(detail: string) {
        goTo(nearestOfType(grid, places, detail, from));
    }
    function closeSheet() {
        if (routing) routing = false;
        else to = null;
    }
</script>

<svelte:window
    onkeydown={(e) => {
        if (e.key !== "Escape" || searching) return;
        if (menuOpen || layersOpen) menuOpen = layersOpen = false;
        else if (sheetOpen && !picking) closeSheet();
    }}
/>

<div class="mobile-map">
    {#if !routing && !picking}
        <header class="top" transition:rise={{ y: -10, duration: 280 }}>
            <div class="search-pill">
                <button class="pill-main" onclick={() => (searching = true)}>
                    <Logo size={24} title="" />
                    {#key to?.id}<span class:filled={!!to} in:unblur>{to?.name ?? `Search ${title}`}</span>{/key}
                </button>
                {#if to}<button class="round small" aria-label="Clear destination" onclick={() => (to = null)}
                        >×</button
                    >{/if}
                <button
                    class="round avatar"
                    aria-label="More options"
                    aria-expanded={menuOpen}
                    onclick={() => ((menuOpen = !menuOpen), (layersOpen = false))}
                >
                    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
                        ><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg
                    >
                </button>
            </div>
            {#if !to && shortcuts.length}<div class="chips" transition:rise={{ y: -6, duration: 220 }}>
                    {#each shortcuts as t}<button class="chip" onclick={() => nearest(t.name)}
                            ><PlaceIcon of={{ ...t, detail: t.name }} size={22} />{from ? "Nearest " : ""}{t.name.toLowerCase()}</button
                        >{/each}
                </div>{/if}
        </header>
        <button
            class="fab layers"
            aria-label="Map view"
            aria-expanded={layersOpen}
            onclick={() => ((layersOpen = !layersOpen), (menuOpen = false))}
            transition:pop
        >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"
                ><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /></svg
            >
        </button>
    {/if}

    {#if menuOpen || layersOpen}<button
            class="scrim"
            aria-label="Close"
            onclick={() => (menuOpen = layersOpen = false)}
        ></button>{/if}
    {#if menuOpen}<div class="popover menu" role="menu" transition:pop>
            {#if editable}<a role="menuitem" href="/editor">Open editor</a>{/if}
            <button role="menuitem" onclick={() => ((menuOpen = false), onshare())}>Share this map</button>
            <button role="menuitem" onclick={() => ((menuOpen = false), ondownload())}>Export 3D model (.glb)</button>
        </div>{/if}
    {#if layersOpen}<div class="popover map-type" transition:pop>
            <small>Map type</small>
            <div class="tiles">
                {#each ["3D", "Plan"] as const as v}<button class:active={view === v} aria-pressed={view === v} onclick={() => (view = v)}
                        ><span class={`tile ${v === "3D" ? "three" : "plan"}`}></span>{v === "3D" ? "3D" : "Floor plan"}</button
                    >{/each}
            </div>
        </div>{/if}

    {#if !to && !routing && !picking}<button
            class="fab directions"
            aria-label="Directions"
            onclick={() => (routing = true)}
            transition:pop={{ from: 0.9 }}
        >
            <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"
                ><path d="M12 2.6l9.4 9.4-9.4 9.4L2.6 12z" fill="currentColor" /><path
                    d="M9 14.5v-2.2a1.5 1.5 0 0 1 1.5-1.5h4.2m-1.8-2.1l2.1 2.1-2.1 2.1"
                    fill="none"
                    stroke="#0f6a73"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                /></svg
            >
        </button>{/if}

    {#if routing && !picking}<div class="route-card" transition:rise={{ y: -12, duration: 320 }}>
            <button class="round" aria-label="Close directions" onclick={() => (routing = false)}>
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"
                    ><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg
                >
            </button>
            <div class="fields">
                <PlaceSearch
                    {places}
                    marker="start"
                    label="Starting point"
                    placeholder="Choose starting point"
                    value={fromName}
                    onselect={(p) => (from = p)}
                />
                <PlaceSearch
                    {places}
                    marker="end"
                    label="Destination"
                    placeholder="Choose destination"
                    value={to?.name ?? ""}
                    onselect={(p) => (to = p)}
                />
            </div>
            <button
                class="round"
                aria-label="Swap start and destination"
                disabled={!from || !to || !("id" in from)}
                onclick={() => {
                    if (from && "id" in from && to) [from, to] = [to, from];
                }}>⇅</button
            >
        </div>{/if}

    {#if sheetOpen}<BottomSheet
            label={routing ? "Directions" : "Destination"}
            hidden={picking}
            top={routing ? "150px" : "72px"}
            bind:snap
            bind:inset
            ondismiss={closeSheet}
        >
            {#snippet peek()}
                {#key routing ? `route:${!!from}:${!!to}:${!!route}` : `place:${to?.id}`}<div class="peek" in:unblur>
                        {#if !routing && to}
                            <div class="title">
                                <PlaceIcon of={to} size={40} />
                                <h2>{to.name}</h2>
                            </div>
                            <p class="sub">
                                {to.detail}{to.building ? ` · ${to.building}` : ""}{#if status}<span
                                        class="status"
                                        class:open={status.open}>· {status.text}</span
                                    >{/if}
                            </p>
                            <div class="actions">
                                <button class="action primary" onclick={() => ((routing = true), (snap = "peek"))}>
                                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
                                        ><path d="M5 19V13a3 3 0 0 1 3-3h10m-4-4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg
                                    >Directions
                                </button>
                                <button class="action" onclick={() => ((from = to), (to = null))}>● Start here</button>
                                <button class="action" onclick={onshare}>Share</button>
                                {#if to.info?.phone}<a class="action" href={`tel:${to.info.phone.replace(/[^\d+]/g, "")}`}
                                        >☎ Call</a
                                    >{/if}
                            </div>
                        {:else if !from}
                            <h2>Where are you now?</h2>
                            <p class="sub">Search your room above, or tap where you are on the map.</p>
                            <div class="actions">
                                <button class="action primary" onclick={() => (picking = true)}>📍 Choose on map</button>
                            </div>
                        {:else if !to}
                            <h2>Where to?</h2>
                            <p class="sub">Search a room or building above.</p>
                            {#if shortcuts.length}<div class="actions">
                                    {#each shortcuts as t}<button class="action" onclick={() => nearest(t.name)}
                                            ><PlaceIcon of={{ ...t, detail: t.name }} size={22} />Nearest {t.name.toLowerCase()}</button
                                        >{/each}
                                </div>{/if}
                        {:else if route}
                            <h2 class="time">
                                {walkMinutes(route.meters)} min <span>({route.meters} m)</span>
                            </h2>
                            <p class="sub">Walking · {route.steps.length - 1} steps to {to.name}</p>
                            <div class="actions">
                                <button class="action primary" onclick={() => (snap = snap === "full" ? "peek" : "full")}
                                    >{snap === "full" ? "Hide steps" : "Steps"}</button
                                >
                                <button class="action" onclick={onshare}>Share</button>
                                <button class="action" onclick={() => (picking = true)}>📍 Change start</button>
                            </div>
                        {:else}
                            <h2>No walking route</h2>
                            <p class="sub">The destination may be closed off — check that its room door isn't facing a wall.</p>
                        {/if}
                    </div>{/key}
            {/snippet}
            {#if !routing && to?.info}<PlaceDetails info={to.info} />{/if}
            {#if routing && route && from && to}<ol class="steps">
                    {#each route.steps as step, i (i + step.text)}<li in:rise={{ delay: Math.min(i, 8) * 35 }}>
                            <span class="glyph">{stepGlyph(step.text)}</span>
                            <span class="step">{step.text}{#if step.meters}<small>{step.meters} m</small>{/if}</span>
                        </li>{/each}
                </ol>{/if}
        </BottomSheet>{/if}

    {#if searching}<SearchScreen
            {places}
            {title}
            {shortcuts}
            onselect={goTo}
            onshortcut={nearest}
            onclose={() => (searching = false)}
        />{/if}
</div>

<style>
    .mobile-map {
        --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
        --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
        --safe-top: env(safe-area-inset-top);
        position: absolute;
        inset: 0;
        z-index: 6;
        pointer-events: none;
        -webkit-tap-highlight-color: transparent;
    }
    .mobile-map > :global(*) {
        pointer-events: auto;
    }
    .mobile-map :global(button),
    .mobile-map :global(a) {
        -webkit-touch-callout: none;
    }
    .top {
        position: absolute;
        top: calc(var(--safe-top) + 10px);
        left: 0;
        right: 0;
        pointer-events: none;
    }
    .top > * {
        pointer-events: auto;
    }
    .search-pill {
        display: flex;
        align-items: center;
        gap: 2px;
        height: 56px;
        margin: 0 12px;
        padding: 0 6px 0 4px;
        border-radius: 28px;
        background: white;
        box-shadow:
            0 1px 2px #1f35261a,
            0 4px 16px #1f35261a;
    }
    .pill-main {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
        height: 100%;
        padding: 0 8px 0 12px;
        border-radius: 28px;
        text-align: left;
    }
    .pill-main:hover {
        background: none;
    }
    .pill-main span {
        font-size: 17px;
        color: #6a7a66;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .pill-main span.filled {
        color: #1f3a2b;
        font-weight: 600;
    }
    .round {
        display: grid;
        place-items: center;
        width: 44px;
        height: 44px;
        flex-shrink: 0;
        border-radius: 50%;
        font-size: 22px;
        color: #3d5243;
        transition:
            transform 160ms var(--ease-out),
            background 150ms,
            opacity 150ms;
    }
    .round:active:not(:disabled) {
        transform: scale(0.94);
    }
    .round.small {
        width: 36px;
        height: 36px;
        font-size: 22px;
        color: #6a7a66;
    }
    .avatar {
        width: 40px;
        height: 40px;
        background: #eef3e8;
        color: #2d4a38;
        fill: currentColor;
    }
    .chips {
        display: flex;
        gap: 8px;
        overflow-x: auto;
        padding: 10px 12px 12px;
        scrollbar-width: none;
    }
    .chips::-webkit-scrollbar {
        display: none;
    }
    .mobile-map :global(.chip) {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        flex-shrink: 0;
        height: 36px;
        padding: 0 14px 0 7px;
        border-radius: 18px;
        background: white;
        font-size: 14px;
        font-weight: 500;
        color: #2f4336;
        white-space: nowrap;
        text-transform: capitalize;
        box-shadow:
            0 1px 2px #1f35261a,
            0 2px 8px #1f352614;
        transition:
            transform 160ms var(--ease-out),
            background 150ms;
    }
    .mobile-map :global(.chip:active) {
        transform: scale(0.96);
    }
    .fab {
        position: absolute;
        right: 12px;
        display: grid;
        place-items: center;
        background: white;
        color: #2f4336;
        fill: currentColor;
        box-shadow:
            0 1px 3px #1f352626,
            0 4px 14px #1f35261f;
        transition:
            transform 160ms var(--ease-out),
            background 150ms;
    }
    .fab:active {
        transform: scale(0.94);
    }
    .fab:hover {
        background: white;
    }
    .layers {
        top: calc(var(--safe-top) + 126px);
        width: 44px;
        height: 44px;
        border-radius: 50%;
    }
    .directions {
        bottom: calc(env(safe-area-inset-bottom) + 24px);
        width: 60px;
        height: 60px;
        border-radius: 18px;
        background: #0f6a73;
        color: white;
        box-shadow:
            0 2px 4px #0f6a7333,
            0 8px 22px #0f6a7340;
    }
    .directions:hover {
        background: #0f6a73;
    }
    .scrim {
        position: absolute;
        inset: 0;
        z-index: 18;
        background: transparent;
        cursor: default;
    }
    .scrim:hover {
        background: transparent;
    }
    .popover {
        position: absolute;
        z-index: 20;
        right: 12px;
        background: white;
        border-radius: 16px;
        box-shadow:
            0 2px 6px #1f352614,
            0 16px 40px #1f352629;
        transform-origin: top right;
    }
    .menu {
        top: calc(var(--safe-top) + 70px);
        right: 14px;
        min-width: 220px;
        padding: 6px;
        display: flex;
        flex-direction: column;
    }
    .menu a,
    .menu button {
        padding: 13px 14px;
        border-radius: 10px;
        font-size: 15px;
        color: #2f4336;
        text-decoration: none;
        text-align: left;
    }
    .menu a:active,
    .menu button:active {
        background: #eef3e8;
    }
    .map-type {
        top: calc(var(--safe-top) + 178px);
        width: 240px;
        height: 132px;
        padding: 12px 14px;
    }
    .map-type small {
        font-size: 12px;
        font-weight: 600;
        color: #52664a;
    }
    .tiles {
        display: flex;
        gap: 10px;
        margin-top: 10px;
    }
    .tiles button {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: #52664a;
        transition: transform 160ms var(--ease-out);
    }
    .tiles button:hover {
        background: none;
    }
    .tiles button:active {
        transform: scale(0.96);
    }
    .tiles button.active {
        color: #0f6a73;
        font-weight: 600;
    }
    .tile {
        width: 100%;
        height: 56px;
        border-radius: 12px;
        border: 2px solid transparent;
        transition: border-color 150ms;
    }
    .active .tile {
        border-color: #0f6a73;
    }
    .tile.three {
        background:
            linear-gradient(160deg, #cfe3f2 0 38%, transparent 38%),
            linear-gradient(20deg, #9dbb86 0 45%, #b8cfa2 45%);
    }
    .tile.plan {
        background:
            linear-gradient(90deg, #fff 0 48%, #d8e2cf 48% 52%, #fff 52%),
            linear-gradient(#eef2e9, #eef2e9);
        background-blend-mode: multiply;
    }
    .route-card {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        z-index: 12;
        display: flex;
        align-items: center;
        gap: 4px;
        padding: calc(var(--safe-top) + 10px) 6px 12px;
        background: white;
        border-radius: 0 0 22px 22px;
        box-shadow: 0 6px 24px #1f35261f;
    }
    .fields {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 0;
    }
    .title {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 4px;
    }
    .title h2 {
        margin: 0;
    }
    .peek h2 {
        margin: 2px 0 4px;
        font:
            600 22px/1.2 Georgia,
            serif;
        color: #1f3a2b;
    }
    .peek h2.time {
        color: #1d7a3d;
    }
    .time span {
        font: 400 17px "Avenir Next", Avenir, sans-serif;
        color: #6a7a66;
    }
    .sub {
        margin: 0;
        font-size: 14px;
        line-height: 1.4;
        color: #6a7a66;
    }
    .status {
        margin-left: 4px;
        color: #b2442f;
        font-weight: 600;
    }
    .status.open {
        color: #2f7d44;
    }
    .actions {
        display: flex;
        gap: 8px;
        margin: 14px -18px 0;
        padding: 0 18px 2px;
        overflow-x: auto;
        scrollbar-width: none;
        touch-action: pan-x;
    }
    .actions::-webkit-scrollbar {
        display: none;
    }
    .action {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        flex-shrink: 0;
        height: 40px;
        padding: 0 16px;
        border-radius: 20px;
        border: 1px solid #d5dccf;
        background: white;
        font-size: 14px;
        font-weight: 600;
        color: #0f6a73;
        text-decoration: none;
        white-space: nowrap;
        transition:
            transform 160ms var(--ease-out),
            background 150ms;
    }
    .action:active {
        transform: scale(0.97);
    }
    .action.primary {
        border-color: #0f6a73;
        background: #0f6a73;
        color: white;
    }
    .steps {
        list-style: none;
        margin: 0;
        padding: 4px 0 0;
        border-top: 1px solid #eef2ea;
    }
    .steps li {
        display: flex;
        gap: 14px;
        padding: 12px 0;
        border-bottom: 1px solid #eef2ea;
        font-size: 15px;
        line-height: 1.4;
        color: #2f4336;
    }
    .steps li:last-child {
        border-bottom: 0;
        font-weight: 600;
    }
    .glyph {
        flex-shrink: 0;
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: #e6f2f3;
        color: #0f6a73;
        font-size: 16px;
    }
    .steps li:last-child .glyph {
        background: #fbe6e3;
        color: #d24b3b;
    }
    .step small {
        display: block;
        font-size: 13px;
        font-weight: 400;
        color: #7b8c70;
    }
    .mobile-map :global(.place-details) {
        margin-top: 0;
        font-size: 14px;
    }
    @media (hover: hover) and (pointer: fine) {
        .action:hover {
            background: #f1f7f7;
        }
        .action.primary:hover {
            background: #0d5d65;
        }
    }
</style>
