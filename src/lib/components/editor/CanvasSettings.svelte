<script lang="ts">
    import { MAX_CANVAS, MIN_CANVAS } from "$lib/editor/operations";
    let {
        width,
        height,
        onapply,
        oncancel,
    }: {
        width: number;
        height: number;
        onapply: (width: number, height: number) => void;
        oncancel: () => void;
    } = $props();
    // Drafts start from the current size each time the form opens.
    // svelte-ignore state_referenced_locally
    let draftWidth = $state(width),
        // svelte-ignore state_referenced_locally
        draftHeight = $state(height);
</script>

<form
    class="canvas-settings"
    onsubmit={(e) => {
        e.preventDefault();
        onapply(Number(draftWidth), Number(draftHeight));
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
    ><span>1 tile = 2 m · {MIN_CANVAS}–{MAX_CANVAS} tiles per side</span><button
        class="btn primary"
        type="submit">Apply size</button
    ><button class="btn" type="button" onclick={oncancel}>Cancel</button>
</form>
