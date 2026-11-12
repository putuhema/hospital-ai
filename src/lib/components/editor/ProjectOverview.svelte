<script lang="ts">
    import { parseTileMeters, type Piece } from "$lib/model/layout";
    import { isBuilding, isCorridor, isGate, isBarrier, isParking, isPath } from "$lib/model/interiors";
    import Icon from "./Icon.svelte";
    let {
        pieces,
        canvasWidth,
        canvasHeight,
        greenery = $bindable(),
        tileMeters = $bindable(2),
        onexportmodel,
    }: {
        pieces: Piece[];
        canvasWidth: number;
        canvasHeight: number;
        /** Trees and foliage around the campus on the visitor map: 0 none, 1 normal, 2 lush. */
        greenery: number;
        /** Real metres per tile: walking distances and times use it. */
        tileMeters?: number;
        onexportmodel: () => void;
    } = $props();
    const count = (n: number) => n.toString().padStart(2, "0");
    let area = $derived(pieces.reduce((s, p) => s + p.w * p.h * 4, 0));
    let used = $derived((area / (canvasWidth * canvasHeight * 4)) * 100);
    let buildings = $derived(pieces.filter(isBuilding).length);
    let corridors = $derived(pieces.filter(isCorridor).length);
    let paths = $derived(pieces.filter(isPath).length);
    let parking = $derived(pieces.filter(isParking).length);
    let gates = $derived(pieces.filter((p) => isGate(p) || isBarrier(p)).length);
    let treeAmount = $derived(
        greenery === 0 ? "None" : greenery < 1 ? "Few" : greenery > 1 ? "Lush" : "Normal",
    );
    let rooms = $derived(pieces.reduce((n, p) => n + (p.roomAssets?.length ?? 0), 0));

    // Measuring: one building whose real length is known sets the scale for the whole map.
    let measured = $derived(pieces.filter(isBuilding));
    let measureId = $state<number | null>(null),
        measureLength = $state<number | null>(null);
    let measure = $derived(measured.find((p) => p.id === measureId) ?? measured[0]);
    let measuredScale = $derived(
        measure && measureLength && measureLength > 0 ? measureLength / Math.max(measure.w, measure.h) : null,
    );
    const fixed = (n: number) => (Math.round(n * 10) / 10).toLocaleString("en", { maximumFractionDigits: 1 });
</script>

<div class="overview">
    <div class="section-heading">
        <h3>Project overview</h3>
        <Icon name="grid" size={15} />
    </div>
    <div><span>Buildings</span><b>{count(buildings)}</b></div>
    <div><span>Corridor pieces</span><b>{count(corridors)}</b></div>
    {#if paths}<div><span>Path pieces</span><b>{count(paths)}</b></div>{/if}
    {#if parking}<div><span>Parking areas</span><b>{count(parking)}</b></div>{/if}
    {#if gates}<div><span>Gates</span><b>{count(gates)}</b></div>{/if}
    <div><span>Rooms</span><b>{count(rooms)}</b></div>
    <div>
        <span>Total floor area</span><b>{area} <small>m²</small></b>
    </div>
    <div class="coverage">
        <span style={`width:${Math.min(100, used)}%`}></span>
    </div>
    <p>{Math.round(used)}% of available grid used</p>
</div>
<label class="scenery">
    <span><b>Trees around the campus</b>{treeAmount}</span>
    <input type="range" min="0" max="2" step="0.25" aria-label="Trees around the campus" aria-valuetext={treeAmount} bind:value={greenery} />
    <small>Saved with the map and shown to visitors.</small>
</label>
<div class="scenery real-size">
    <span><b>Real size</b>1 tile = {fixed(tileMeters)} m</span>
    <label class="tile-size"
        >1 tile =
        <input
            type="number"
            min="0.5"
            max="10"
            step="0.1"
            value={tileMeters}
            aria-label="Real metres per tile"
            onchange={(e) => (tileMeters = parseTileMeters(e.currentTarget.valueAsNumber))}
        />
        m</label
    >
    {#if measure}<div class="measure">
            <small>Or measure one building:</small>
            <div>
                <select aria-label="Building to measure" value={measure.id} onchange={(e) => (measureId = Number(e.currentTarget.value))}>
                    {#each measured as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
                </select>
                <span>is really</span>
                <input
                    type="number"
                    min="1"
                    step="1"
                    placeholder={String(Math.round(Math.max(measure.w, measure.h) * tileMeters))}
                    aria-label="Its real length in metres, along its longer side"
                    bind:value={measureLength}
                />
                <span>m long</span>
            </div>
            <button
                disabled={!measuredScale || parseTileMeters(measuredScale) !== Math.round(measuredScale * 100) / 100}
                onclick={() => {
                    if (measuredScale) tileMeters = parseTileMeters(measuredScale);
                    measureLength = null;
                }}>Use {measuredScale ? `1 tile = ${fixed(measuredScale)} m` : "it"}</button
            >
        </div>{/if}
    <small
        >The campus is about {Math.round(canvasWidth * tileMeters)} × {Math.round(canvasHeight * tileMeters)} m. Walking
        distances and times for visitors use this, and their phones follow them at this scale.</small
    >
</div>
<div class="blender-note">
    <span class="blender-logo">◉</span>
    <div>
        <b>Take it into Blender</b>
        <p>Download the campus as a detailed 3D model (.glb).</p>
    </div>
    <button aria-label="Export Blender model" onclick={onexportmodel}>↗</button>
</div>
