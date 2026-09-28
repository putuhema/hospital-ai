<script lang="ts">
    import { roomTypes, walkwayAt } from "$lib/model/interiors";
    import type { Point } from "$lib/wayfinding/navigation";
    import {
        planRoute,
        type NavGrid,
        type Place,
        type Route,
    } from "$lib/wayfinding/routing";
    import PlaceSearch from "$lib/components/shared/PlaceSearch.svelte";
    let {
        places,
        grid,
        route,
        from = $bindable(null),
        to = $bindable(null),
        picking = $bindable(false),
    }: {
        places: Place[];
        grid: NavGrid;
        route: Route | null;
        from?: Place | Point | null;
        to?: Place | null;
        /** True while the user is choosing a start point on the map. */
        picking?: boolean;
    } = $props();
    // A picked spot is named after the corridor or path it is on.
    let fromName = $derived(
        !from
            ? ""
            : "id" in from
              ? from.name
              : `Spot on ${walkwayAt(grid.pieces, from)?.name ?? "the map"}`,
    );
    // Shortcuts for room types that exist in this layout, e.g. "Toilets".
    let shortcuts = $derived(
        roomTypes.filter(
            (t) =>
                ["toilet", "reception", "pharmacy", "stairs"].includes(t.type) &&
                places.some((p) => p.kind === "room" && p.detail === t.name),
        ),
    );
    function nearest(detail: string) {
        const options = places.filter(
            (p) => p.kind === "room" && p.detail === detail,
        );
        if (!from) return (to = options[0]);
        let best: Place | null = null,
            bestMeters = Infinity;
        for (const p of options) {
            const r = planRoute(grid, from, p);
            if (r && r.meters < bestMeters) {
                best = p;
                bestMeters = r.meters;
            }
        }
        to = best ?? options[0];
    }
    const glyph = (text: string) =>
        text.startsWith("From")
            ? "●"
            : text.startsWith("Arrive")
              ? "⚑"
              : /Turn left/.test(text)
                ? "↰"
                : /Turn right/.test(text)
                  ? "↱"
                  : /Bear left/.test(text)
                    ? "↖"
                    : /Bear right/.test(text)
                      ? "↗"
                      : /around/.test(text)
                        ? "↩"
                        : "↑";
</script>

<div class="route-finder">
    <div class="fields">
        <PlaceSearch
            {places}
            marker="start"
            label="Starting point"
            placeholder="Where are you now?"
            value={fromName}
            onselect={(p) => {
                from = p;
                picking = false;
            }}
        />
        <PlaceSearch
            {places}
            marker="end"
            label="Destination"
            placeholder="Search a room or building"
            value={to?.name ?? ""}
            onselect={(p) => (to = p)}
        />
        <button
            class="swap"
            title="Swap start and destination"
            aria-label="Swap start and destination"
            disabled={!from || !to || !("id" in from)}
            onclick={() => {
                if (from && "id" in from && to) [from, to] = [to, from];
            }}>⇅</button
        >
    </div>
    <div class="tools">
        <button
            class="chip pick"
            class:active={picking}
            aria-pressed={picking}
            onclick={() => (picking = !picking)}
            >{picking ? "Click the map…" : "📍 Pick start on map"}</button
        >
        {#each shortcuts as t}<button
                class="chip"
                onclick={() => nearest(t.name)}
                ><i style={`background:${t.color}`}></i>{from ? "Nearest " : ""}{t.name.toLowerCase()}</button
            >{/each}
    </div>
    {#if from && to}
        {#if route}<section class="result" aria-live="polite">
                <div class="summary">
                    <b>{Math.max(1, Math.round(route.meters / 72))} min</b>
                    <span>{route.meters} m walk</span>
                    <button
                        class="clear"
                        onclick={() => {
                            to = null;
                        }}>Clear</button
                    >
                </div>
                <ol>
                    {#each route.steps as step}<li>
                            <span class="glyph">{glyph(step.text)}</span>
                            <span class="step"
                                >{step.text}{#if step.meters}<small
                                        >{step.meters} m</small
                                    >{/if}</span
                            >
                        </li>{/each}
                </ol>
            </section>{:else}<p class="notice" role="status">
                <b>No walking route found.</b> The destination may be closed off —
                check that its room door isn't facing a wall.
            </p>{/if}
    {:else if !places.length}<p class="notice">
            Add buildings and rooms in the editor to start finding your way.
        </p>{:else}<p class="tip">
            {from
                ? "Now choose where you want to go."
                : "Choose your starting point — or pick it on the map."}
        </p>{/if}
</div>

<style>
    .fields {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding-right: 38px;
    }
    .swap {
        position: absolute;
        right: 0;
        top: 50%;
        transform: translateY(-50%);
        width: 30px;
        height: 30px;
        border-radius: 50%;
        border: 1px solid #d3ddca;
        background: white;
        font-size: 15px;
        color: #3f6b4e;
    }
    .swap:disabled {
        opacity: 0.4;
    }
    .tools {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin: 10px 0 4px;
    }
    .chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 6px 10px;
        border: 1px solid #d9e2d0;
        border-radius: 20px;
        background: white;
        font-size: 11px;
        color: #3d5243;
    }
    .chip:hover {
        border-color: #9fb394;
    }
    .chip i {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        box-shadow: inset 0 0 0 1px #0000001f;
    }
    .chip.active {
        background: #2f7fc4;
        border-color: #2f7fc4;
        color: white;
    }
    .result {
        margin-top: 12px;
        border-top: 1px solid #e3e9dc;
        padding-top: 12px;
    }
    .summary {
        display: flex;
        align-items: baseline;
        gap: 10px;
    }
    .summary b {
        font:
            28px Georgia,
            serif;
        color: #243d2c;
    }
    .summary span {
        font-size: 12px;
        color: #6a7c62;
    }
    .clear {
        margin-left: auto;
        font-size: 11px;
        color: #4b6f53;
        text-decoration: underline;
    }
    ol {
        list-style: none;
        margin: 10px 0 0;
        padding: 0;
    }
    li {
        display: flex;
        gap: 10px;
        padding: 8px 0;
        border-bottom: 1px solid #eef2ea;
        font-size: 12.5px;
        color: #2f4336;
        line-height: 1.4;
    }
    li:last-child {
        border-bottom: 0;
        font-weight: 600;
    }
    .glyph {
        flex-shrink: 0;
        width: 24px;
        height: 24px;
        display: grid;
        place-items: center;
        border-radius: 50%;
        background: #e8f1f9;
        color: #2f7fc4;
        font-size: 13px;
    }
    li:last-child .glyph {
        background: #fbe6e3;
        color: #d24b3b;
    }
    .step small {
        display: block;
        color: #7b8c70;
        font-size: 11px;
        font-weight: 400;
    }
    .notice,
    .tip {
        font-size: 12px;
        line-height: 1.5;
        color: #6a7c62;
        margin: 12px 0 0;
    }
    .notice {
        background: #fff3e4;
        color: #7d5732;
        padding: 10px 12px;
        border-radius: 8px;
    }
</style>
