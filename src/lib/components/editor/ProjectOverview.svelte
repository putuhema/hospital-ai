<script lang="ts">
    import type { Piece } from "$lib/model/layout";
    import { isBuilding, isCorridor, isPath } from "$lib/model/interiors";
    import Icon from "./Icon.svelte";
    let {
        pieces,
        canvasWidth,
        canvasHeight,
        onexportmodel,
    }: {
        pieces: Piece[];
        canvasWidth: number;
        canvasHeight: number;
        onexportmodel: () => void;
    } = $props();
    const count = (n: number) => n.toString().padStart(2, "0");
    let area = $derived(pieces.reduce((s, p) => s + p.w * p.h * 4, 0));
    let used = $derived((area / (canvasWidth * canvasHeight * 4)) * 100);
    let buildings = $derived(pieces.filter(isBuilding).length);
    let corridors = $derived(pieces.filter(isCorridor).length);
    let paths = $derived(pieces.filter(isPath).length);
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
    <div><span>Rooms</span><b>{count(rooms)}</b></div>
    <div>
        <span>Total floor area</span><b>{area} <small>m²</small></b>
    </div>
    <div class="coverage">
        <span style={`width:${Math.min(100, used)}%`}></span>
    </div>
    <p>{Math.round(used)}% of available grid used</p>
</div>
<div class="blender-note">
    <span class="blender-logo">◉</span>
    <div>
        <b>Take it into Blender</b>
        <p>Download the campus as a detailed 3D model (.glb).</p>
    </div>
    <button aria-label="Export Blender model" onclick={onexportmodel}>↗</button>
</div>
