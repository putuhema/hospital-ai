<script lang="ts">
    import type { Piece } from "$lib/model/layout";
    import {
        roomTypes,
        roomType,
        roomColor,
        fitsRoom,
        footprint,
        inPolygon,
        type RoomAsset,
        type Side,
    } from "$lib/model/interiors";
    import ColorField from "$lib/components/shared/ColorField.svelte";
    let {
        building,
        onchange,
    }: { building: Piece; onchange: (rooms: RoomAsset[]) => void } = $props();
    let width = $state(2),
        depth = $state(2),
        door = $state<Side>("south");
    let type = $state(0),
        selected = $state<number | null>(null),
        message = $state("");
    let rooms = $derived(building.roomAssets ?? []);
    let current = $derived(rooms.find((r) => r.id === selected));
    // Tiles in an L's missing corner can't hold rooms.
    let shape = $derived(footprint({ ...building, x: 0, y: 0 }));
    const onFloor = (i: number) =>
        !building.shape ||
        inPolygon(
            { x: (i % building.w) + 0.5, y: Math.floor(i / building.w) + 0.5 },
            shape,
        );
    const sides: { side: Side; label: string }[] = [
        { side: "north", label: "N" },
        { side: "east", label: "E" },
        { side: "south", label: "S" },
        { side: "west", label: "W" },
    ];
    function editRoom(patch: Partial<RoomAsset>) {
        if (!current) return false;
        const next = { ...current, ...patch };
        if (!fitsRoom(building, next, rooms)) {
            message = "That doesn't fit without overlapping another room.";
            return false;
        }
        onchange(rooms.map((r) => (r.id === selected ? next : r)));
        message = "";
        return true;
    }
    function nextName(t: (typeof roomTypes)[number]) {
        const taken = new Set(rooms.map((r) => r.name));
        for (let n = 1; ; n++) {
            const name = `${t.name} ${n}`;
            if (!taken.has(name)) return name;
        }
    }
    function place(x: number, y: number) {
        if (rooms.length >= 100) {
            message = "Maximum 100 rooms per building.";
            return;
        }
        const t = roomTypes[type];
        const r: RoomAsset = {
            id: Date.now(),
            type: t.type,
            name: nextName(t),
            w: width,
            h: depth,
            x,
            y,
            door,
        };
        if (!fitsRoom(building, r, rooms)) {
            message = "Pick an empty spot where the whole room fits.";
            return;
        }
        onchange([...rooms, r]);
        selected = r.id;
        message = "";
    }
    // Door marker position on the mini plan, as percentages of the room.
    const doorStyle = (r: RoomAsset) =>
        ({
            north: "left:50%;top:0;width:34%;height:4px;transform:translateX(-50%)",
            south: "left:50%;bottom:0;width:34%;height:4px;transform:translateX(-50%)",
            west: "top:50%;left:0;height:34%;width:4px;transform:translateY(-50%)",
            east: "top:50%;right:0;height:34%;width:4px;transform:translateY(-50%)",
        })[r.door ?? "south"];
</script>

<div class="interior-editor">
    <p class="hint">
        Pick a room type, then click an empty spot on the floor plan. Each room
        becomes a searchable destination on the map.
    </p>
    <div class="room-palette" role="listbox" aria-label="Room type">
        {#each roomTypes as t, i}<button
                role="option"
                aria-selected={type === i}
                class:active={type === i}
                onclick={() => {
                    type = i;
                    width = Math.min(t.w, building.w);
                    depth = Math.min(t.h, building.h);
                    selected = null;
                }}
                ><i style={`background:${t.color}`}></i>{t.name}</button
            >{/each}
    </div>
    <div class="new-room">
        <label
            >W<input
                type="number"
                min="1"
                max={building.w}
                step="1"
                bind:value={width}
            /></label
        ><label
            >D<input
                type="number"
                min="1"
                max={building.h}
                step="1"
                bind:value={depth}
            /></label
        >
        <div class="sides" role="group" aria-label="Door wall for new rooms">
            {#each sides as s}<button
                    class:active={door === s.side}
                    aria-pressed={door === s.side}
                    title={`Door on ${s.side} wall`}
                    onclick={() => (door = s.side)}>{s.label}</button
                >{/each}
        </div>
    </div>
    <div
        class="interior-grid"
        style={`grid-template-columns:repeat(${building.w},1fr);aspect-ratio:${building.w}/${building.h}`}
    >
        {#each Array(building.w * building.h) as _, i}<button
                class="cell"
                class:outside={!onFloor(i)}
                disabled={!onFloor(i)}
                aria-label={`Place ${roomTypes[type].name} at ${(i % building.w) + 1}, ${Math.floor(i / building.w) + 1}`}
                onclick={() =>
                    place(i % building.w, Math.floor(i / building.w))}
            ></button>{/each}{#each rooms as r}<button
                class="placed-room"
                class:selected={selected === r.id}
                style={`left:${(r.x / building.w) * 100}%;top:${(r.y / building.h) * 100}%;width:${(r.w / building.w) * 100}%;height:${(r.h / building.h) * 100}%;background:${roomColor(r)}`}
                onclick={() => (selected = selected === r.id ? null : r.id)}
                ><span>{r.name}</span><i
                    class="door"
                    style={doorStyle(r)}
                ></i></button
            >{/each}
    </div>
    {#if message}<p class="message" role="status">{message}</p>{/if}
    {#if current}<div class="room-card">
            <label
                >Room name<input
                    aria-label="Room name"
                    maxlength="100"
                    value={current.name}
                    onchange={(e) => {
                        const name = e.currentTarget.value.trim();
                        if (name) editRoom({ name });
                    }}
                /></label
            >
            <label
                >Type<select
                    value={current.type}
                    onchange={(e) =>
                        editRoom({
                            type: e.currentTarget.value as RoomAsset["type"],
                        })}
                    >{#each roomTypes as t}<option value={t.type}
                            >{t.name}</option
                        >{/each}</select
                ></label
            >
            <div class="row">
                <label
                    >Width<input
                        type="number"
                        min="1"
                        max={building.w - current.x}
                        value={current.w}
                        onchange={(e) => {
                            editRoom({ w: Number(e.currentTarget.value) });
                            e.currentTarget.value = String(current?.w);
                        }}
                    /></label
                ><label
                    >Depth<input
                        type="number"
                        min="1"
                        max={building.h - current.y}
                        value={current.h}
                        onchange={(e) => {
                            editRoom({ h: Number(e.currentTarget.value) });
                            e.currentTarget.value = String(current?.h);
                        }}
                    /></label
                >
                <div class="move" role="group" aria-label="Move room">
                    <span>Move</span>
                    <button aria-label="Move left" onclick={() => editRoom({ x: current!.x - 1 })}>←</button
                    ><button aria-label="Move up" onclick={() => editRoom({ y: current!.y - 1 })}>↑</button
                    ><button aria-label="Move down" onclick={() => editRoom({ y: current!.y + 1 })}>↓</button
                    ><button aria-label="Move right" onclick={() => editRoom({ x: current!.x + 1 })}>→</button>
                </div>
            </div>
            <div class="field-label">Door on wall</div>
            <div class="sides wide" role="group" aria-label="Door wall">
                {#each sides as s}<button
                        class:active={(current.door ?? "south") === s.side}
                        aria-pressed={(current.door ?? "south") === s.side}
                        onclick={() => editRoom({ door: s.side })}
                        >{s.side[0].toUpperCase() + s.side.slice(1)}</button
                    >{/each}
            </div>
            <ColorField
                label="Floor colour"
                value={roomColor(current)}
                fallback={roomType(current.type).color}
                onchange={(color) =>
                    editRoom({
                        color:
                            color === roomType(current!.type).color
                                ? undefined
                                : color,
                    })}
            />
            <p class="size">
                {current.w * 2} × {current.h * 2} m · {current.w *
                    current.h *
                    4} m²
            </p>
            <button
                class="btn remove"
                onclick={() => {
                    onchange(rooms.filter((r) => r.id !== selected));
                    selected = null;
                }}>Remove room</button
            >
        </div>{/if}
</div>

<style>
    .hint,
    .size {
        font-size: 11px;
        color: #738466;
        line-height: 1.5;
        margin: 0 0 10px;
    }
    .room-palette {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 4px;
    }
    .room-palette button {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 7px;
        border: 1px solid #dfe6d8;
        border-radius: 6px;
        font-size: 10.5px;
        text-align: left;
        color: #3d5243;
        background: white;
    }
    .room-palette button:hover {
        border-color: #a9bb9e;
    }
    .room-palette .active {
        background: #e7f0de;
        border-color: #6f8f60;
        font-weight: 600;
    }
    .room-palette i {
        width: 10px;
        height: 10px;
        border-radius: 3px;
        flex-shrink: 0;
        box-shadow: inset 0 0 0 1px #0000001a;
    }
    .new-room,
    .row {
        display: flex;
        align-items: end;
        gap: 6px;
        margin-top: 10px;
    }
    .new-room label {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 10px;
        color: #738466;
    }
    .new-room input {
        width: 42px;
        margin: 0;
    }
    .sides {
        display: flex;
        margin-left: auto;
        border: 1px solid #dce3d4;
        border-radius: 6px;
        overflow: hidden;
    }
    .sides.wide {
        margin: 0 0 10px;
    }
    .sides button {
        flex: 1;
        padding: 6px 8px;
        font-size: 10px;
        color: #52664a;
        background: white;
    }
    .sides button + button {
        border-left: 1px solid #dce3d4;
    }
    .sides .active {
        background: #3f6b4e;
        color: white;
    }
    .interior-grid {
        display: grid;
        position: relative;
        width: 100%;
        background: #f2f5eb;
        margin: 12px 0 8px;
        border: 2px solid #9aab90;
        border-radius: 3px;
    }
    .cell {
        border: 1px dashed #dce3d4;
        min-width: 0;
        padding: 0;
    }
    .cell.outside {
        background: repeating-linear-gradient(
            135deg,
            transparent 0 4px,
            #0000000d 4px 6px
        );
        cursor: default;
    }
    .cell:hover:not(.outside) {
        background: #e2ebd8;
    }
    .placed-room {
        position: absolute;
        border: 2px solid #f8fff2;
        font-size: 9px;
        overflow: hidden;
        padding: 3px;
        color: #2f4336;
        line-height: 1.2;
        box-shadow: inset 0 0 0 1px #00000014;
    }
    .placed-room span {
        display: -webkit-box;
        -webkit-line-clamp: 3;
        line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
    .placed-room .door {
        position: absolute;
        background: #3f6b4e;
        border-radius: 2px;
    }
    .placed-room.selected {
        outline: 2px solid #3f6b4e;
        outline-offset: -2px;
        z-index: 1;
    }
    .message {
        font-size: 11px;
        color: #825936;
        background: #fff0de;
        padding: 7px 9px;
        border-radius: 6px;
    }
    .room-card {
        border: 1px solid #dfe6d8;
        border-radius: 8px;
        padding: 12px;
        background: #fbfcf8;
    }
    label,
    .field-label {
        display: block;
        font-size: 10px;
        color: #738466;
    }
    .row label {
        flex: 1;
        min-width: 0;
    }
    .move {
        font-size: 10px;
        color: #738466;
        display: grid;
        grid-template-columns: repeat(4, 22px);
        gap: 2px;
    }
    .move span {
        grid-column: 1 / -1;
    }
    .move button {
        height: 30px;
        border: 1px solid #dce3d4;
        border-radius: 4px;
        background: white;
        font-size: 11px;
        margin-bottom: 7px;
    }
    input,
    select {
        display: block;
        width: 100%;
        padding: 7px;
        border: 1px solid #dce3d4;
        border-radius: 5px;
        margin: 5px 0 9px;
        background: white;
        font-size: 12px;
    }
    .remove {
        width: 100%;
        justify-content: center;
        font-size: 11px;
        color: #9a4d3c;
    }
</style>
