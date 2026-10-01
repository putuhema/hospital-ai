<script lang="ts">
    import type { Piece } from "$lib/model/layout";
    import { isBuilding, isCorridor, isGate, isBarrier, isParking, isPath } from "$lib/model/interiors";
    import Icon from "./Icon.svelte";
    let {
        pieces,
        canvasWidth,
        canvasHeight,
        greenery = $bindable(),
        onexportmodel,
    }: {
        pieces: Piece[];
        canvasWidth: number;
        canvasHeight: number;
        /** Trees and foliage around the campus on the visitor map: 0 none, 1 normal, 2 lush. */
        greenery: number;
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
<div class="blender-note">
    <span class="blender-logo">◉</span>
    <div>
        <b>Take it into Blender</b>
        <p>Download the campus as a detailed 3D model (.glb).</p>
    </div>
    <button aria-label="Export Blender model" onclick={onexportmodel}>↗</button>
</div>
