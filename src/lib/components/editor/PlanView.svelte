<script lang="ts">
    import type { Piece } from "$lib/model/layout";
    import { center, footprint, gatewayParts, isBarrier, isBuilding, isGate, isParking, parkingBays, roomColor } from "$lib/model/interiors";
    type Tile = { x: number; y: number };
    let {
        pieces,
        selected = $bindable(),
        asset,
        width,
        height,
        grid,
        zoom,
        pan,
        panX = $bindable(),
        panY = $bindable(),
        onplace,
        onmove,
        oncancel,
    }: {
        pieces: Piece[];
        selected: number | null;
        /** The piece being placed (as set up before placing), if any. */
        asset: Piece | null;
        width: number;
        height: number;
        grid: boolean;
        zoom: number;
        pan: boolean;
        panX: number;
        panY: number;
        /** A click on the ground: place the asset, or deselect when there is none. */
        onplace: (tile: Tile) => void;
        onmove: (id: number, x: number, y: number) => void;
        /** Escape: stop placing. */
        oncancel: () => void;
    } = $props();
    /** Plan units per tile. */
    const TILE = 40;
    let hover = $state<Tile | null>(null);
    // A drag either moves a building (id) or pans the plan (id null).
    let drag = $state<{
        id: number | null;
        startX: number;
        startY: number;
        x: number;
        y: number;
        originX: number;
        originY: number;
    } | null>(null);
    let offset = $state({ x: 0, y: 0 });
    // Set once a pointer has moved enough to count as a drag rather than a click.
    let suppressClick = false;
    let sorted = $derived([...pieces].sort((a, b) => a.y - b.y));

    const outline = (p: Piece) =>
        footprint(p)
            .map((v) => `${v.x * TILE},${v.y * TILE}`)
            .join(" ");
    function planPoint(svg: SVGSVGElement, e: MouseEvent) {
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        return pt.matrixTransform(svg.getScreenCTM()!.inverse());
    }
    function tileAt(e: MouseEvent): Tile {
        const pos = planPoint(e.currentTarget as SVGSVGElement, e);
        return { x: Math.floor(pos.x / TILE), y: Math.floor(pos.y / TILE) };
    }

    function start(e: PointerEvent, id: number | null = null) {
        if (e.button !== 0 && e.button !== 2) return;
        if (id !== null && !pan && asset) return;
        e.stopPropagation();
        const svg = (
            e.currentTarget instanceof SVGSVGElement
                ? e.currentTarget
                : (e.currentTarget as SVGGElement).ownerSVGElement
        )!;
        svg.setPointerCapture(e.pointerId);
        const pos = planPoint(svg, e);
        const p = pieces.find((p) => p.id === id);
        drag = {
            // Right-drag and the pan tool always pan.
            id: pan || e.button === 2 ? null : id,
            startX: e.clientX,
            startY: e.clientY,
            x: pos.x,
            y: pos.y,
            originX: p?.x ?? panX,
            originY: p?.y ?? panY,
        };
        if (drag.id !== null) selected = drag.id;
    }
    function move(e: PointerEvent) {
        if (!drag) {
            hover = tileAt(e);
            return;
        }
        if (drag.id === null) {
            panX += e.clientX - drag.startX;
            panY += e.clientY - drag.startY;
            drag.startX = e.clientX;
            drag.startY = e.clientY;
            suppressClick = true;
        } else {
            const pos = planPoint(e.currentTarget as SVGSVGElement, e);
            offset = {
                x: Math.round((pos.x - drag.x) / TILE),
                y: Math.round((pos.y - drag.y) / TILE),
            };
            if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 5)
                suppressClick = true;
        }
    }
    function end(commit = true) {
        if (drag && drag.id !== null && commit && suppressClick)
            onmove(drag.id, drag.originX + offset.x, drag.originY + offset.y);
        if (drag?.id != null) suppressClick = true;
        drag = null;
        offset = { x: 0, y: 0 };
        setTimeout(() => (suppressClick = false), 0);
    }
    function key(e: KeyboardEvent) {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Escape") oncancel();
        if (e.key.startsWith("Arrow")) {
            e.preventDefault();
            const p = hover ?? { x: 0, y: 0 };
            const dx = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
            const dy = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
            hover = {
                x: Math.max(0, Math.min(width - 1, p.x + dx)),
                y: Math.max(0, Math.min(height - 1, p.y + dy)),
            };
        }
        if (e.key === "Enter" && asset) {
            e.preventDefault();
            onplace(hover ?? { x: 0, y: 0 });
        }
    }
    const corners = (p: Piece) => [
        [p.x, p.y],
        [p.x + p.w, p.y],
        [p.x, p.y + p.h],
        [p.x + p.w, p.y + p.h],
    ];
</script>

<div
    class="drawing-wrap"
    style={`transform:translate(${panX}px,${panY}px) scale(${zoom / 100})`}
>
    <svg
        class="map"
        viewBox={`0 0 ${width * TILE} ${height * TILE}`}
        role="grid"
        tabindex="0"
        onkeydown={key}
        aria-label="Hospital layout grid. Click to place selected asset."
        onclick={(e) => {
            if (!suppressClick && !pan) onplace(tileAt(e));
        }}
        onpointerdown={(e) => start(e)}
        onpointermove={move}
        onpointerup={() => end()}
        onpointercancel={() => end(false)}
        oncontextmenu={(e) => e.preventDefault()}
        onmouseleave={() => (hover = null)}
        ><defs
            ><pattern id="grid" width={TILE} height={TILE} patternUnits="userSpaceOnUse"
                ><path d="M 40 0 L 0 0 0 40" fill="none" stroke="#d9ddd5" stroke-width="1" /></pattern
            ></defs
        ><rect
            width={width * TILE}
            height={height * TILE}
            fill={grid ? "url(#grid)" : "transparent"}
        /><rect
            x="80"
            y="80"
            width={Math.max(0, width * TILE - 160)}
            height={Math.max(0, height * TILE - 160)}
            rx="2"
            fill="none"
            stroke="#b4bcb0"
            stroke-dasharray="6 7"
        />{#each sorted as p}<g
                role="button"
                tabindex="0"
                aria-label={"Select " + p.name}
                onpointerdown={(e) => start(e, p.id)}
                transform={drag?.id === p.id
                    ? `translate(${offset.x * TILE} ${offset.y * TILE})`
                    : undefined}
                onclick={(e) => {
                    if (suppressClick) {
                        e.stopPropagation();
                        return;
                    }
                    if (!asset) {
                        e.stopPropagation();
                        selected = p.id;
                    }
                }}
                onkeydown={(e) => {
                    if (e.key === "Enter") selected = p.id;
                }}
                class="map-piece"
                ><title
                    >{p.name} — {p.rooms?.length ?? 0} rooms{p.rooms?.length
                        ? " : " + p.rooms.join(", ")
                        : ""}</title
                ><polygon
                    points={outline(p)}
                    fill={p.color}
                    stroke={selected === p.id ? "#49775b" : "#8c9a8b"}
                    stroke-width={selected === p.id ? 3 : 1}
                />
                {#each p.roomAssets ?? [] as r}<rect
                        x={(p.x + r.x) * TILE + 3}
                        y={(p.y + r.y) * TILE + 3}
                        width={r.w * TILE - 6}
                        height={r.h * TILE - 6}
                        rx="2"
                        fill={roomColor(r)}
                        stroke="#fff"
                        stroke-width="2"
                    />{/each}
                {#if isBuilding(p) && !p.shape && !p.roomAssets?.length}<rect
                        x={p.x * TILE + 12}
                        y={p.y * TILE + 12}
                        width={p.w * TILE - 24}
                        height={p.h * TILE - 24}
                        rx="1"
                        fill="none"
                        stroke="#fff"
                        stroke-opacity=".5"
                    />{/if}{#if isBuilding(p)}<text
                        x={center(p).x * TILE}
                        y={center(p).y * TILE + 30}
                        text-anchor="middle"
                        class="building-label">{p.name}</text
                    ><text
                        x={center(p).x * TILE}
                        y={center(p).y * TILE + 45}
                        text-anchor="middle"
                        class="building-size">{p.w * 2} × {p.h * 2} m</text
                    >{:else if isParking(p)}{#each parkingBays(p).lines as [a, b]}<line
                            x1={a.x * TILE}
                            y1={a.y * TILE}
                            x2={b.x * TILE}
                            y2={b.y * TILE}
                            stroke="#fff"
                            stroke-opacity=".85"
                            stroke-width="2"
                        />{/each}<g
                        transform={`translate(${center(p).x * TILE} ${center(p).y * TILE})`}
                        class="parking-badge"
                        ><rect x="-11" y="-11" width="22" height="22" rx="5" /><text y="5">P</text></g
                    ><text
                        x={center(p).x * TILE}
                        y={center(p).y * TILE + 28}
                        text-anchor="middle"
                        class="building-label parking-label">{p.name}</text
                    >{:else if isGate(p) || isBarrier(p)}{@const g = gatewayParts(p)}<line
                        x1={g.span[0].x * TILE}
                        y1={g.span[0].y * TILE}
                        x2={g.span[1].x * TILE}
                        y2={g.span[1].y * TILE}
                        class={isGate(p) ? "gateway-beam" : "gateway-arm"}
                    />{#each g.blocks as b}<rect
                            x={b.x * TILE}
                            y={b.y * TILE}
                            width={b.w * TILE}
                            height={b.h * TILE}
                            rx="2"
                            class={isGate(p) ? "gateway-pillar" : "gateway-booth"}
                        />{/each}<text
                        x={center(p).x * TILE}
                        y={center(p).y * TILE - 6}
                        text-anchor="middle"
                        class="building-label parking-label">{p.name}</text
                    >{:else}<path
                        d={p.w >= p.h
                            ? `M${p.x * TILE + 10} ${p.y * TILE + p.h * 20}h${p.w * TILE - 20}`
                            : `M${p.x * TILE + p.w * 20} ${p.y * TILE + 10}v${p.h * TILE - 20}`}
                        stroke="#fff"
                        stroke-width="2"
                        stroke-dasharray="6 5"
                    />{/if}
                {#if selected === p.id}{#each corners(p) as [x, y]}<rect
                            x={x * TILE - 4}
                            y={y * TILE - 4}
                            width="8"
                            height="8"
                            fill="white"
                            stroke="#49775b"
                            stroke-width="2"
                        />{/each}{/if}</g
            >{/each}{#if asset && hover}<polygon
                points={footprint({ ...asset, ...hover })
                    .map((v) => `${v.x * TILE},${v.y * TILE}`)
                    .join(" ")}
                fill={asset.color}
                opacity=".5"
                stroke="#49775b"
                stroke-width="3"
                stroke-dasharray="6 4"
                pointer-events="none"
            />{/if}</svg
    >
</div>
