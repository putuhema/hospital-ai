<script lang="ts">
    import type { Piece } from "$lib/model/layout";
    import type { Point, WalkingNetwork } from "$lib/wayfinding/navigation";
    import {
        buildGrid,
        places,
        planRoute,
        unreachable,
        type Place,
    } from "$lib/wayfinding/routing";
    import FloorPlan from "$lib/components/shared/FloorPlan.svelte";
    import RouteFinder from "$lib/components/shared/RouteFinder.svelte";
    let {
        pieces,
        network,
        width,
        height,
        onchange,
        onselectpiece,
    }: {
        pieces: Piece[];
        network: WalkingNetwork;
        width: number;
        height: number;
        onchange: (n: WalkingNetwork) => void;
        /** Jump to a building in the layout editor to fix it. */
        onselectpiece: (id: number) => void;
    } = $props();
    let grid = $derived(buildGrid(pieces, width, height));
    let placeList = $derived(places(pieces, network));
    let blocked = $derived(unreachable(grid, placeList));
    let landmarks = $derived(network.nodes.filter((n) => n.name.trim()));
    // Raw: places are plain values; proxying them would make the sync below loop.
    let from = $state.raw<Place | Point | null>(null),
        to = $state.raw<Place | null>(null),
        picking = $state(false),
        adding = $state(false),
        selected = $state("");
    let route = $derived(from && to ? planRoute(grid, from, to) : null);
    // Keep the chosen places in step with renames and moves.
    $effect(() => {
        const start = from;
        if (start && "id" in start)
            from = placeList.find((p) => p.id === start.id) ?? null;
        if (to) to = placeList.find((p) => p.id === to!.id) ?? null;
    });
    function addLandmark(p: Point) {
        const id = crypto.randomUUID();
        onchange({
            ...network,
            nodes: [
                ...network.nodes,
                { id, name: "New landmark", x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 },
            ],
        });
        selected = id;
        adding = false;
    }
    function rename(id: string, name: string) {
        if (!name.trim()) return;
        onchange({
            ...network,
            nodes: network.nodes.map((n) => (n.id === id ? { ...n, name: name.trim().slice(0, 100) } : n)),
        });
    }
    function remove(id: string) {
        onchange({
            nodes: network.nodes.filter((n) => n.id !== id),
            edges: network.edges.filter((e) => e.from !== id && e.to !== id),
        });
        if (selected === id) selected = "";
    }
</script>

<div class="wayfinding">
    <div class="side">
        <div class="heading">
            <small>WAYFINDING</small>
            <h2>Directions are automatic</h2>
            <p>
                Every building and room is a destination. Routes follow
                corridors and go through real doors — no paths to draw.
            </p>
        </div>

        <section class="check" class:ok={!blocked.length}>
            {#if !blocked.length}<b>✓ All {placeList.length} destinations reachable</b>
            {:else}<b>⚠ {blocked.length} can't be reached</b>
                <p>A room door probably faces a wall or another room.</p>
                <ul>
                    {#each blocked as p}<li>
                            <button
                                onclick={() => p.pieceId && onselectpiece(p.pieceId)}
                                >{p.name}{p.building ? ` · ${p.building}` : ""}
                                <span>Fix →</span></button
                            >
                        </li>{/each}
                </ul>{/if}
        </section>

        <section>
            <h3>Test a route</h3>
            <RouteFinder places={placeList} {grid} {route} bind:from bind:to bind:picking />
        </section>

        <section>
            <h3>
                Landmarks <span>{landmarks.length}</span>
            </h3>
            <p class="muted">
                Add spots that aren't rooms — main entrance, café, lifts, parking.
            </p>
            <button
                class="btn"
                class:primary={adding}
                aria-pressed={adding}
                onclick={() => {
                    adding = !adding;
                    picking = false;
                }}>{adding ? "Click the plan to place it…" : "+ Add landmark"}</button
            >
            {#each landmarks as n}<div class="landmark" class:selected={n.id === selected}>
                    <input
                        aria-label="Landmark name"
                        maxlength="100"
                        value={n.name}
                        onfocus={() => (selected = n.id)}
                        onchange={(e) => rename(n.id, e.currentTarget.value)}
                    /><button aria-label={`Remove ${n.name}`} onclick={() => remove(n.id)}>×</button>
                </div>{/each}
        </section>
    </div>
    <div class="map">
        {#if adding || picking}<div class="banner" role="status">
                {adding ? "Click to place the landmark" : "Click the starting point"} ·
                <button
                    onclick={() => {
                        adding = false;
                        picking = false;
                    }}>Cancel</button
                >
            </div>{/if}
        <FloorPlan
            {pieces}
            places={placeList}
            {width}
            {height}
            route={route?.points ?? null}
            {landmarks}
            destination={to}
            selectedLandmark={selected}
            picking={adding || picking}
            onpick={(point, place) => {
                if (adding) addLandmark(point);
                else if (picking) {
                    from = place ?? point;
                    picking = false;
                } else if (place?.kind === "landmark") {
                    selected = place.id.slice(2);
                    to = place;
                } else if (place) to = place;
            }}
        />
    </div>
</div>
<svelte:window
    onkeydown={(e) => {
        if (e.key === "Escape") {
            adding = false;
            picking = false;
        }
    }}
/>

<style>
    .wayfinding {
        position: absolute;
        inset: 76px 16px 16px;
        z-index: 4;
        display: grid;
        grid-template-columns: 330px minmax(0, 1fr);
        border: 1px solid #d5dfcc;
        border-radius: 14px;
        background: #f4f6ee;
        overflow: hidden;
        box-shadow: 0 8px 28px #31452b12;
    }
    .side {
        background: #fffffff7;
        padding: 20px;
        overflow: auto;
        border-right: 1px solid #d5dfcc;
    }
    .heading small {
        font-size: 9px;
        letter-spacing: 1.4px;
        color: #7b8c70;
    }
    .heading h2 {
        font:
            22px Georgia,
            serif;
        margin: 6px 0;
    }
    p {
        font-size: 12px;
        line-height: 1.55;
        color: #6a7c62;
        margin: 0 0 10px;
    }
    section {
        margin-top: 18px;
    }
    h3 {
        display: flex;
        justify-content: space-between;
        font-size: 13px;
        margin: 0 0 10px;
        color: #2f4336;
    }
    h3 span {
        font-weight: 400;
        color: #7b8c70;
    }
    .check {
        padding: 12px 14px;
        border-radius: 10px;
        background: #fff3e4;
        color: #7d5732;
        font-size: 12px;
    }
    .check.ok {
        background: #e9f3e3;
        color: #2f5a3b;
    }
    .check p {
        color: inherit;
        margin: 6px 0;
    }
    .check ul {
        list-style: none;
        margin: 0;
        padding: 0;
    }
    .check li button {
        display: flex;
        width: 100%;
        justify-content: space-between;
        padding: 6px 0;
        font-size: 12px;
        color: #7d5732;
        text-align: left;
    }
    .check li span {
        text-decoration: underline;
    }
    .landmark {
        display: flex;
        gap: 6px;
        margin-top: 6px;
    }
    .landmark input {
        flex: 1;
        min-width: 0;
        padding: 8px 10px;
        border: 1px solid #d3ddca;
        border-radius: 7px;
        font-size: 12px;
    }
    .landmark.selected input {
        border-color: #e0a93b;
    }
    .landmark button {
        width: 32px;
        color: #9a4d3c;
        font-size: 16px;
    }
    .map {
        position: relative;
        min-height: 0;
        padding: 12px;
    }
    .banner {
        position: absolute;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2;
        padding: 8px 14px;
        border-radius: 30px;
        background: #2f7fc4;
        color: white;
        font-size: 12px;
    }
    .banner button {
        color: white;
        text-decoration: underline;
        font-size: 12px;
    }
    @media (max-width: 800px) {
        .wayfinding {
            display: flex;
            flex-direction: column;
            inset: 70px 8px 8px;
        }
        .side {
            max-height: 45%;
            border-right: 0;
            border-bottom: 1px solid #d5dfcc;
            padding: 14px;
        }
        .map {
            flex: 1;
        }
    }
</style>
