<script lang="ts">
    import { roomType, type RoomAsset } from "$lib/model/interiors";
    import type { Piece } from "$lib/model/layout";
    let {
        piece,
        room,
        x,
        y,
    }: {
        piece: Piece;
        /** The room under the pointer, when looking inside. */
        room?: RoomAsset;
        x: number;
        y: number;
    } = $props();
</script>

<div class="room-tooltip" style={`left:${x}px;top:${y}px`} role="tooltip">
    <strong>{room?.name ?? piece.name}</strong>{#if room}<p>
            {roomType(room.type).name}
        </p>
        <div>{room.w * 2} × {room.h * 2} m · {room.w * room.h * 4} m²</div>
        <small>{piece.name}</small>{:else}<p>
            {(piece.rooms?.length ?? 0) + (piece.roomAssets?.length ?? 0)} rooms
        </p>
        {#each piece.roomAssets ?? [] as r}<div>{r.name}</div>{/each}{#each piece.rooms ?? [] as r}<div>
                {r}
            </div>{/each}{#if !piece.rooms?.length && !piece.roomAssets?.length}<small
                >No rooms added yet</small
            >{/if}{/if}
</div>

<style>
    .room-tooltip {
        position: absolute;
        z-index: 5;
        width: 225px;
        max-height: 190px;
        overflow: auto;
        pointer-events: none;
        background: #fffef7f5;
        border: 1px solid #cbd7c1;
        border-radius: 7px;
        padding: 14px;
        box-shadow: 0 5px 22px #243d2426;
        font-size: 12px;
    }
    .room-tooltip p {
        margin: 6px 0;
        color: #718163;
    }
    .room-tooltip div {
        padding: 3px 0;
    }
    .room-tooltip small {
        color: #8c9683;
    }
</style>
