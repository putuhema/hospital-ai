<script lang="ts">
    import type { Piece } from "$lib/model/layout";
    import {
        doorSegment,
        footprint,
        inPolygon,
        isBuilding,
        roomColor,
        roomDoor,
    } from "$lib/model/interiors";
    import { buildingDoors, type Point, type Waypoint } from "$lib/wayfinding/navigation";
    import type { Place } from "$lib/wayfinding/routing";
    let {
        pieces,
        places,
        width,
        height,
        route = null,
        landmarks = [],
        destination = null,
        selectedLandmark = "",
        picking = false,
        here = null,
        controls = true,
        onpick,
    }: {
        pieces: Piece[];
        places: Place[];
        width: number;
        height: number;
        route?: Point[] | null;
        landmarks?: Waypoint[];
        destination?: Place | null;
        selectedLandmark?: string;
        /** Crosshair cursor while the parent waits for a point. */
        picking?: boolean;
        /** A "You are here" marker, e.g. on a printed sign. */
        here?: Point | null;
        /** Show the zoom buttons. */
        controls?: boolean;
        /** A click on the plan: the tile point and the place under it, if any. */
        onpick?: (point: Point, place: Place | null) => void;
    } = $props();
    const S = 40;
    let view = $state({ x: -1, y: -1, w: 0, h: 0 });
    let svg: SVGSVGElement;
    $effect(() => {
        view = { x: -1, y: -1, w: width + 2, h: height + 2 };
    });
    const pts = (list: Point[]) =>
        list.map((p) => `${p.x * S},${p.y * S}`).join(" ");
    function toTile(e: { clientX: number; clientY: number }): Point {
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
        return { x: p.x / S, y: p.y / S };
    }
    function placeAt(p: Point): Place | null {
        const mark = landmarks.find(
            (n) => Math.hypot(n.x - p.x, n.y - p.y) < 0.5,
        );
        if (mark) return places.find((pl) => pl.id === `n:${mark.id}`) ?? null;
        for (const b of pieces.filter(isBuilding)) {
            if (p.x < b.x || p.x > b.x + b.w || p.y < b.y || p.y > b.y + b.h)
                continue;
            if (b.shape && !inPolygon(p, footprint(b))) continue;
            const r = b.roomAssets?.find(
                (r) =>
                    p.x > b.x + r.x &&
                    p.x < b.x + r.x + r.w &&
                    p.y > b.y + r.y &&
                    p.y < b.y + r.y + r.h,
            );
            return (
                places.find(
                    (pl) => pl.id === (r ? `r:${b.id}:${r.id}` : `b:${b.id}`),
                ) ?? null
            );
        }
        return null;
    }
    let drag: { x: number; y: number; moved: boolean; view: typeof view } | null =
        null;
    function down(e: PointerEvent) {
        svg.setPointerCapture(e.pointerId);
        drag = { x: e.clientX, y: e.clientY, moved: false, view: { ...view } };
    }
    function move(e: PointerEvent) {
        if (!drag) return;
        const dx = e.clientX - drag.x,
            dy = e.clientY - drag.y;
        if (Math.hypot(dx, dy) > 4) drag.moved = true;
        if (!drag.moved) return;
        const scale = drag.view.w / svg.clientWidth;
        view = { ...drag.view, x: drag.view.x - dx * scale, y: drag.view.y - dy * scale };
    }
    function up(e: PointerEvent) {
        if (drag && !drag.moved) {
            const p = toTile(e);
            if (p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height)
                onpick?.(p, placeAt(p));
        }
        drag = null;
    }
    function zoom(factor: number, around?: Point) {
        const c = around ?? { x: view.x + view.w / 2, y: view.y + view.h / 2 };
        const w = Math.min(width + 10, Math.max(3, view.w * factor)),
            k = w / view.w;
        view = { x: c.x - (c.x - view.x) * k, y: c.y - (c.y - view.y) * k, w, h: view.h * k };
    }
    function wheel(e: WheelEvent) {
        e.preventDefault();
        zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, toTile(e));
    }
    let highlight = $derived.by(() => {
        const b = pieces.find((p) => p.id === destination?.pieceId);
        if (!b || !destination) return null;
        const r = b.roomAssets?.find((r) => r.id === destination.roomId);
        return r
            ? { x: b.x + r.x, y: b.y + r.y, w: r.w, h: r.h }
            : { x: b.x, y: b.y, w: b.w, h: b.h };
    });
</script>

<div class="floor-plan">
    <svg
        bind:this={svg}
        class:picking
        viewBox={`${view.x * S} ${view.y * S} ${view.w * S} ${view.h * S}`}
        role="img"
        aria-label="Floor plan. Click a room to choose it. Scroll to zoom, drag to move."
        onpointerdown={down}
        onpointermove={move}
        onpointerup={up}
        onpointercancel={() => (drag = null)}
        onwheel={wheel}
    >
        <defs
            ><pattern
                id="plan-grid"
                width={S}
                height={S}
                patternUnits="userSpaceOnUse"
                ><path
                    d={`M ${S} 0 L 0 0 0 ${S}`}
                    fill="none"
                    stroke="#dfe5d8"
                    stroke-width="1"
                /></pattern
            ></defs
        >
        <rect width={width * S} height={height * S} fill="#f6f8f1" />
        <rect
            width={width * S}
            height={height * S}
            fill="url(#plan-grid)"
            stroke="#c8d3be"
        />
        {#each pieces.filter((p) => !isBuilding(p)) as p}<polygon
                points={pts(footprint(p))}
                fill="#ece6d8"
                stroke="#c9bfa9"
                stroke-width="1.5"
            />{/each}
        {#each pieces.filter(isBuilding) as p}
            <polygon
                points={pts(footprint(p))}
                fill={p.color}
                stroke="#6f7f6a"
                stroke-width="4"
            />
            {#each p.roomAssets ?? [] as r}{@const d = roomDoor(r)}{@const rx =
                    p.x + r.x}{@const ry = p.y + r.y}<rect
                    x={(rx + 0.04) * S}
                    y={(ry + 0.04) * S}
                    width={(r.w - 0.08) * S}
                    height={(r.h - 0.08) * S}
                    fill={roomColor(r)}
                    stroke="#8e9b86"
                    stroke-width="2"
                /><line
                    x1={(d.side === "north" || d.side === "south" ? rx + d.offset - 0.2 : rx + (d.side === "east" ? r.w - 0.04 : 0.04)) * S}
                    x2={(d.side === "north" || d.side === "south" ? rx + d.offset + 0.2 : rx + (d.side === "east" ? r.w - 0.04 : 0.04)) * S}
                    y1={(d.side === "north" || d.side === "south" ? ry + (d.side === "south" ? r.h - 0.04 : 0.04) : ry + d.offset - 0.2) * S}
                    y2={(d.side === "north" || d.side === "south" ? ry + (d.side === "south" ? r.h - 0.04 : 0.04) : ry + d.offset + 0.2) * S}
                    stroke={roomColor(r)}
                    stroke-width="5"
                /><text
                    class="room-label"
                    x={(rx + r.w / 2) * S}
                    y={(ry + r.h / 2) * S}>{r.name}</text
                >{/each}
            {#each buildingDoors(p, pieces) as d}{@const [a, b] = doorSegment(p, d)}<line
                    x1={a.x * S}
                    x2={b.x * S}
                    y1={a.y * S}
                    y2={b.y * S}
                    stroke={p.color}
                    stroke-width="6"
                />{/each}
        {/each}
        {#if highlight}<rect
                class="highlight"
                x={highlight.x * S}
                y={highlight.y * S}
                width={highlight.w * S}
                height={highlight.h * S}
                fill="#d24b3b18"
                stroke="#d24b3b"
                stroke-width="3"
            />{/if}
        {#each pieces.filter(isBuilding) as p}<text
                class="building-label"
                x={(p.x + p.w / 2) * S}
                y={p.y * S - 12}>{p.name}</text
            >{/each}
        {#if route && route.length > 1}<polyline
                points={pts(route)}
                fill="none"
                stroke="#fff"
                stroke-width="14"
                stroke-linejoin="round"
                stroke-linecap="round"
            /><polyline
                points={pts(route)}
                fill="none"
                stroke="#2f7fc4"
                stroke-width="8"
                stroke-linejoin="round"
                stroke-linecap="round"
            /><polyline
                class="flow"
                points={pts(route)}
                fill="none"
                stroke="#ffffffcc"
                stroke-width="3"
                stroke-dasharray="4 18"
                stroke-linecap="round"
            /><circle
                cx={route[0].x * S}
                cy={route[0].y * S}
                r="11"
                fill="#2f7fc4"
                stroke="white"
                stroke-width="4"
            />{@const end = route[route.length - 1]}<path
                transform={`translate(${end.x * S} ${end.y * S})`}
                d="M0 0 C-4 -9 -13 -14 -13 -24 A13 13 0 1 1 13 -24 C13 -14 4 -9 0 0Z"
                fill="#d24b3b"
                stroke="white"
                stroke-width="3"
            /><circle
                cx={end.x * S}
                cy={end.y * S - 24}
                r="5"
                fill="white"
            />{/if}
        {#each landmarks as n}<g
                transform={`translate(${n.x * S} ${n.y * S})`}
                class:selected={n.id === selectedLandmark}
                class="landmark"
                ><rect
                    x="-8"
                    y="-8"
                    width="16"
                    height="16"
                    rx="3"
                    transform="rotate(45)"
                /><text y="-16" class="landmark-label"
                    >{n.name || "Unnamed landmark"}</text
                ></g
            >{/each}
        {#if here}<g transform={`translate(${here.x * S} ${here.y * S})`} class="here"
                ><circle r="46" class="halo" /><circle r="18" /><text y="-62">You are here</text></g
            >{/if}
        <g transform={`translate(${width * S - 30} 34)`} class="north"
            ><path d="M0 -20 L9 8 L0 2 L-9 8Z" /><text y="24">N</text></g
        >
    </svg>
    {#if controls}<div class="zoom">
        <button aria-label="Zoom in" onclick={() => zoom(1 / 1.3)}>+</button
        ><button aria-label="Zoom out" onclick={() => zoom(1.3)}>−</button
        ><button
            aria-label="Fit plan"
            title="Fit plan"
            onclick={() => (view = { x: -1, y: -1, w: width + 2, h: height + 2 })}
            >⛶</button
        >
    </div>{/if}
</div>

<style>
    .floor-plan {
        position: relative;
        width: 100%;
        height: 100%;
        min-height: 0;
    }
    svg {
        display: block;
        width: 100%;
        height: 100%;
        touch-action: none;
        cursor: grab;
        user-select: none;
    }
    svg.picking {
        cursor: crosshair;
    }
    text {
        text-anchor: middle;
        dominant-baseline: middle;
        pointer-events: none;
        paint-order: stroke;
        stroke-linejoin: round;
    }
    .room-label {
        font-size: 10px;
        fill: #34473a;
        stroke: #ffffffa0;
        stroke-width: 3px;
    }
    .building-label {
        font-size: 13px;
        font-weight: 700;
        fill: #1f3a2b;
        stroke: #fff;
        stroke-width: 4px;
    }
    .landmark rect {
        fill: #e0a93b;
        stroke: white;
        stroke-width: 3;
    }
    .landmark.selected rect {
        fill: #d24b3b;
    }
    .landmark-label {
        font-size: 11px;
        font-weight: 600;
        fill: #5a3f10;
        stroke: #fffaf0;
        stroke-width: 4px;
    }
    .flow {
        animation: flow 1.1s linear infinite;
    }
    @keyframes flow {
        to {
            stroke-dashoffset: -22;
        }
    }
    .highlight {
        animation: pulse 1.6s ease-in-out infinite;
    }
    @keyframes pulse {
        50% {
            stroke-opacity: 0.35;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .flow,
        .highlight {
            animation: none;
        }
    }
    .here circle {
        fill: #2f7fc4;
        stroke: white;
        stroke-width: 6;
    }
    .here .halo {
        fill: #2f7fc42e;
        stroke: none;
    }
    .here text {
        font-size: 26px;
        font-weight: 700;
        fill: #1d5a8f;
        stroke: #fff;
        stroke-width: 7px;
    }
    .north path {
        fill: #586b59;
    }
    .north text {
        font-size: 11px;
        font-weight: 700;
        fill: #586b59;
    }
    .zoom {
        position: absolute;
        right: 12px;
        bottom: 12px;
        display: flex;
        flex-direction: column;
        background: white;
        border: 1px solid #d3ddca;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 3px 14px #253a2214;
    }
    .zoom button {
        width: 34px;
        height: 34px;
        font-size: 16px;
        color: #3d5243;
    }
    .zoom button + button {
        border-top: 1px solid #e3e9dc;
    }
</style>
