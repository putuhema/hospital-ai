<script lang="ts">
    import type { Piece } from "$lib/model/layout";
    import Icon from "./Icon.svelte";
    let {
        piece,
        placing = false,
        canvasWidth,
        canvasHeight,
        update,
        onrotate,
    }: {
        piece: Piece;
        /** Not on the canvas yet: no position, and any size that fits the canvas. */
        placing?: boolean;
        canvasWidth: number;
        canvasHeight: number;
        update: (key: "x" | "y" | "w" | "h", value: number) => void;
        onrotate: () => void;
    } = $props();
    // Each field is clamped so the piece stays on the canvas.
    let size = $derived([
        { key: "w", label: "Width", unit: "tiles", min: 1, max: canvasWidth - (placing ? 0 : piece.x) },
        { key: "h", label: "Depth", unit: "tiles", min: 1, max: canvasHeight - (placing ? 0 : piece.y) },
    ] as const);
    let fields = $derived(
        placing
            ? [size]
            : [
                  [
                      { key: "x", label: "Position X", unit: "tile", min: 0, max: canvasWidth - piece.w },
                      { key: "y", label: "Position Y", unit: "tile", min: 0, max: canvasHeight - piece.h },
                  ] as const,
                  size,
              ],
    );
</script>

{#each fields as row}<div class="field-row">
        {#each row as f}<label class="field"
                >{f.label}
                <div class="unit-input">
                    <input
                        type="number"
                        min={f.min}
                        max={f.max}
                        value={piece[f.key]}
                        onchange={(e) =>
                            update(f.key, Math.max(f.min, Math.min(f.max, +e.currentTarget.value)))}
                    /><span>{f.unit}</span>
                </div></label
            >{/each}
    </div>{/each}
<div class="rotation">
    <span>Rotation</span><button onclick={onrotate}
        ><Icon name="rotate" size={15} />
        {piece.rotation}° <kbd>R</kbd></button
    >
</div>
