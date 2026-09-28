<script lang="ts">
    import { MAX_CANVAS, MIN_CANVAS, type Anchor } from "$lib/editor/operations";
    let {
        width,
        height,
        onapply,
        oncancel,
    }: {
        width: number;
        height: number;
        onapply: (width: number, height: number, anchor: Anchor) => void;
        oncancel: () => void;
    } = $props();
    // Drafts start from the current size each time the form opens.
    // svelte-ignore state_referenced_locally
    let draftWidth = $state(width),
        // svelte-ignore state_referenced_locally
        draftHeight = $state(height),
        anchor: Anchor = $state({ x: 0, y: 0 });
    const steps = [0, 0.5, 1] as const;
    const rowNames = { 0: "top", 0.5: "middle", 1: "bottom" },
        colNames = { 0: "left", 0.5: "centre", 1: "right" };
    // Arrows point the way the canvas grows from the anchor.
    function arrow(x: number, y: number) {
        const dx = Math.sign(x - anchor.x),
            dy = Math.sign(y - anchor.y);
        return "↖↑↗←●→↙↓↘"[(dy + 1) * 3 + dx + 1];
    }
    const near = (x: number, y: number) => Math.abs(x - anchor.x) <= 0.5 && Math.abs(y - anchor.y) <= 0.5;
</script>

<form
    class="canvas-settings"
    onsubmit={(e) => {
        e.preventDefault();
        onapply(Number(draftWidth), Number(draftHeight), $state.snapshot(anchor));
    }}
>
    <b>Canvas dimensions</b><label
        >Width <input type="number" min={MIN_CANVAS} max={MAX_CANVAS} step="1" bind:value={draftWidth} />
        tiles</label
    ><label
        >Depth <input
            type="number"
            min={MIN_CANVAS}
            max={MAX_CANVAS}
            step="1"
            bind:value={draftHeight}
        /> tiles</label
    ><div class="canvas-anchor" role="radiogroup" aria-label="Anchor">
        <small>Anchor</small>
        <div>
            {#each steps as y (y)}{#each steps as x (x)}<button
                        type="button"
                        role="radio"
                        aria-checked={anchor.x === x && anchor.y === y}
                        aria-label="Keep layout {y === 0.5 && x === 0.5 ? 'centred' : `${rowNames[y]} ${colNames[x]}`}"
                        title="Keep layout {y === 0.5 && x === 0.5 ? 'centred' : `${rowNames[y]} ${colNames[x]}`}"
                        onclick={() => (anchor = { x, y })}>{near(x, y) ? arrow(x, y) : ""}</button
                    >{/each}{/each}
        </div>
    </div><span>1 tile = 2 m · {MIN_CANVAS}–{MAX_CANVAS} tiles per side · space is added away from the anchor</span
    ><button class="btn primary" type="submit">Apply size</button><button
        class="btn"
        type="button"
        onclick={oncancel}>Cancel</button
    >
</form>
