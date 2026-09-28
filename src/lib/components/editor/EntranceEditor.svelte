<script lang="ts">
    import type { Piece } from "$lib/model/layout";
    import { corridorDoors, type Side } from "$lib/model/interiors";
    import { newEntrance } from "$lib/editor/operations";
    let {
        building,
        pieces,
        onchange,
        onnotify,
    }: {
        building: Piece;
        pieces: Piece[];
        onchange: (entrances: NonNullable<Piece["entrances"]>) => void;
        onnotify: (message: string) => void;
    } = $props();
    let side = $state<Side>("north"),
        offset = $state(1);
    let entrances = $derived(building.entrances ?? []);
    function add() {
        const result = newEntrance(building, pieces, side, offset);
        if ("error" in result) onnotify(result.error);
        else onchange([...entrances, result.entry]);
    }
</script>

<div class="entrance-editor">
    <p>{corridorDoors(building, pieces).length} automatic corridor doors</p>
    <label
        >Wall<select bind:value={side}
            ><option value="north">North</option><option value="east">East</option><option
                value="south">South</option
            ><option value="west">West</option></select
        ></label
    ><label
        >Position along wall (tiles)<input
            type="number"
            min="0.4"
            step="0.1"
            bind:value={offset}
        /></label
    ><button class="btn" onclick={add}>Add entrance</button
    >{#each entrances as door, i}<div>
            {door.side} · {door.offset} tiles<button
                aria-label="Remove entrance"
                onclick={() => onchange(entrances.filter((_, j) => j !== i))}>×</button
            >
        </div>{/each}
</div>
