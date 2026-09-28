<script lang="ts">
    import Icon from "./Icon.svelte";
    let {
        grid = $bindable(),
        zoom = $bindable(),
        onfit,
    }: { grid: boolean; zoom: number; onfit: () => void } = $props();
</script>

<div class="compass">
    <span>N</span><svg width="28" height="35" viewBox="0 0 28 35"
        ><path d="m14 2 9 27-9-7-9 7z" fill="#586b59" /><path
            d="m14 2 0 20-9 7z"
            fill="#b4c1af"
        /></svg
    >
</div>
<div class="canvas-bottom">
    <button class="grid-button" class:enabled={grid} onclick={() => (grid = !grid)}
        ><Icon name="grid" size={15} /> Grid
        <span>{grid ? "On" : "Off"}</span></button
    >
    <div class="zoom">
        <button aria-label="Zoom out" onclick={() => (zoom = Math.max(50, zoom - 10))}>−</button
        ><span>{zoom}%</span><button
            aria-label="Zoom in"
            onclick={() => (zoom = Math.min(150, zoom + 10))}>+</button
        ><span class="divider"></span><button
            title="Fit canvas"
            onclick={() => {
                zoom = 100;
                onfit();
            }}>⛶</button
        >
    </div>
</div>
