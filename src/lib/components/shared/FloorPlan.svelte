<script lang="ts">
    import { onMount } from "svelte";
    import { category } from "$lib/model/categories";
    import { useLocale } from "$lib/i18n/locale.svelte";
    import type { Piece } from "$lib/model/layout";
    import {
        doorSegment,
        footprint,
        inPolygon,
        isBuilding,
        gatewayParts,
        isArea,
        isBarrier,
        isGate,
        isParking,
        parkingBays,
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
        walked = 0,
        landmarks = [],
        destination = null,
        selectedLandmark = "",
        picking = false,
        here = null,
        controls = true,
        insetTop = 0,
        insetBottom = 0,
        insetLeft = 0,
        onpick,
    }: {
        pieces: Piece[];
        places: Place[];
        width: number;
        height: number;
        route?: Point[] | null;
        /** The route point the visitor has walked to; the line behind it greys. */
        walked?: number;
        landmarks?: Waypoint[];
        destination?: Place | null;
        selectedLandmark?: string;
        /** Crosshair cursor while the parent waits for a point. */
        picking?: boolean;
        /** A "You are here" marker, e.g. on a printed sign. */
        here?: Point | null;
        /** Show the zoom buttons. */
        controls?: boolean;
        /** Pixels covered by overlays at the top, bottom and left: framing keeps clear of them. */
        insetTop?: number;
        insetBottom?: number;
        insetLeft?: number;
        /** A click on the plan: the tile point and the place under it, if any. */
        onpick?: (point: Point, place: Place | null) => void;
    } = $props();
    const locale = useLocale(),
        t = locale.t;
    /** Drawing units per tile. */
    const S = 40;

    // The view: the tile at the middle of the screen, and pixels per tile.
    let host: HTMLDivElement;
    let size = $state({ w: 0, h: 0 }),
        cam = $state({ x: 0, y: 0, k: 20 }),
        /** The visitor moved the view themselves: a button takes it back. */
        away = $state(false);
    /** Drawing units per screen pixel: what keeps lines, labels and pins one size on screen at any zoom. */
    let unit = $derived(S / cam.k);
    let viewBox = $derived(
        `${(cam.x - size.w / 2 / cam.k) * S} ${(cam.y - size.h / 2 / cam.k) * S} ${(size.w / cam.k) * S} ${(size.h / cam.k) * S}`,
    );
    /** Zoomed out no further than the whole canvas on screen, in no further than a room filling it. */
    let kMin = $derived(size.w ? Math.min(size.w / (width + 2), size.h / (height + 2)) * 0.9 : 1);
    const K_MAX = 220;
    const clampK = (k: number) => Math.min(K_MAX, Math.max(kMin, k));
    /** The middle of the view stays over the canvas. */
    const bound = (c: { x: number; y: number; k: number }) => ({
        k: clampK(c.k),
        x: Math.min(width, Math.max(0, c.x)),
        y: Math.min(height, Math.max(0, c.y)),
    });

    // Moves glide: short and decisive, none with reduced motion.
    let glideFrame = 0;
    function glide(to: { x: number; y: number; k: number }, ms = 320) {
        cancelAnimationFrame(glideFrame);
        const from = { ...cam },
            target = bound(to);
        if (!size.w || matchMedia("(prefers-reduced-motion: reduce)").matches) return void (cam = target);
        const start = performance.now();
        const step = (now: number) => {
            const p = Math.min(1, (now - start) / ms),
                e = 1 - Math.pow(1 - p, 3),
                // Zoom eases in proportion, so it feels even zoomed in or out.
                k = from.k * Math.pow(target.k / from.k, e);
            cam = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, k };
            if (p < 1) glideFrame = requestAnimationFrame(step);
        };
        glideFrame = requestAnimationFrame(step);
    }
    /** Fit a box (tiles) in the part of the view the overlays leave clear. */
    function frame(box: { x0: number; y0: number; x1: number; y1: number }, pad = 40, instant = false) {
        if (!size.w) return;
        away = false;
        const clearW = Math.max(80, size.w - insetLeft - pad * 2),
            clearH = Math.max(80, size.h - insetTop - insetBottom - pad * 2),
            k = clampK(Math.min(clearW / Math.max(0.5, box.x1 - box.x0), clearH / Math.max(0.5, box.y1 - box.y0), 90));
        // The box's middle sits in the middle of the clear part, not of the whole view.
        const to = {
            k,
            x: (box.x0 + box.x1) / 2 - insetLeft / 2 / k,
            y: (box.y0 + box.y1) / 2 - (insetTop - insetBottom) / 2 / k,
        };
        if (instant) {
            cancelAnimationFrame(glideFrame);
            cam = bound(to);
        } else glide(to);
    }
    const boxOf = (list: Point[]) => ({
        x0: Math.min(...list.map((p) => p.x)),
        y0: Math.min(...list.map((p) => p.y)),
        x1: Math.max(...list.map((p) => p.x)),
        y1: Math.max(...list.map((p) => p.y)),
    });
    /** The campus: everything drawn, or the canvas when nothing is. */
    let campus = $derived(
        pieces.length
            ? boxOf(pieces.flatMap((p) => [{ x: p.x, y: p.y }, { x: p.x + p.w, y: p.y + p.h }]))
            : { x0: 0, y0: 0, x1: width, y1: height },
    );

    let highlight = $derived.by(() => {
        const b = pieces.find((p) => p.id === destination?.pieceId);
        if (!b || !destination) return null;
        const r = b.roomAssets?.find((r) => r.id === destination.roomId);
        return r ? { x: b.x + r.x, y: b.y + r.y, w: r.w, h: r.h } : { x: b.x, y: b.y, w: b.w, h: b.h };
    });
    // What the view frames, framed again when it changes: the route, else the
    // destination with what is around it, else the campus (with the "you are here" spot).
    let focus = $derived.by(() => {
        if (route && route.length > 1) return { key: `r:${JSON.stringify(route)}`, box: boxOf(route), pad: 48 };
        if (highlight) {
            const m = Math.max(3, Math.max(highlight.w, highlight.h));
            return {
                key: `d:${destination?.id}`,
                box: { x0: highlight.x - m, y0: highlight.y - m, x1: highlight.x + highlight.w + m, y1: highlight.y + highlight.h + m },
                pad: 24,
            };
        }
        return { key: `c:${width}:${height}`, box: campus, pad: 16 };
    });
    let framedKey = "",
        framedInsets = "";
    $effect(() => {
        const f = focus,
            insets = `${insetTop}:${insetBottom}:${insetLeft}`;
        if (!size.w) return;
        // The first framing is at once; later ones glide. Insets changing (a card
        // rising) frame the same thing again, so it stays in the clear part.
        if (f.key === framedKey && insets === framedInsets) return;
        const first = !framedKey;
        framedKey = f.key;
        framedInsets = insets;
        frame(f.box, f.pad, first);
    });

    onMount(() => {
        const observer = new ResizeObserver(() => {
            size = { w: host.clientWidth, h: host.clientHeight };
        });
        observer.observe(host);
        return () => {
            observer.disconnect();
            cancelAnimationFrame(glideFrame);
        };
    });

    const pts = (list: Point[]) => list.map((p) => `${p.x * S},${p.y * S}`).join(" ");
    /** The tile under a screen point. */
    function toTile(clientX: number, clientY: number): Point {
        const r = host.getBoundingClientRect();
        return { x: cam.x + (clientX - r.left - size.w / 2) / cam.k, y: cam.y + (clientY - r.top - size.h / 2) / cam.k };
    }
    function placeAt(p: Point): Place | null {
        const mark = landmarks.find((n) => Math.hypot(n.x - p.x, n.y - p.y) < Math.max(0.5, 14 / cam.k));
        if (mark) return places.find((pl) => pl.id === `n:${mark.id}`) ?? null;
        for (const b of pieces.filter(isBuilding)) {
            if (p.x < b.x || p.x > b.x + b.w || p.y < b.y || p.y > b.y + b.h) continue;
            if (b.shape && !inPolygon(p, footprint(b))) continue;
            const r = b.roomAssets?.find(
                (r) => p.x > b.x + r.x && p.x < b.x + r.x + r.w && p.y > b.y + r.y && p.y < b.y + r.y + r.h,
            );
            return places.find((pl) => pl.id === (r ? `r:${b.id}:${r.id}` : `b:${b.id}`)) ?? null;
        }
        const area = pieces.find((a) => isArea(a) && inPolygon(p, footprint(a)));
        return (area && places.find((pl) => pl.id === `a:${area.id}`)) ?? null;
    }

    // Touch and mouse: one finger pans, two pinch (and pan), a tap picks,
    // a double tap zooms in; the wheel (or a trackpad pinch) zooms at the cursor.
    const pointers = new Map<number, { x: number; y: number }>();
    let gesture: {
        start: { x: number; y: number; k: number };
        from: { x: number; y: number }[];
        moved: boolean;
        at: number;
    } | null = null;
    let lastTap = { time: 0, x: 0, y: 0 };
    let ripples = $state<{ id: number; x: number; y: number }[]>([]);
    function begin() {
        gesture = {
            start: { ...cam },
            from: [...pointers.values()].map((p) => ({ ...p })),
            moved: gesture?.moved ?? false,
            at: gesture?.at ?? performance.now(),
        };
    }
    function down(e: PointerEvent) {
        cancelAnimationFrame(glideFrame);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        try {
            host.setPointerCapture(e.pointerId);
        } catch {
            // Some pointers can't be captured; the gesture works without.
        }
        if (pointers.size === 1) gesture = null;
        begin();
    }
    function move(e: PointerEvent) {
        if (!pointers.has(e.pointerId) || !gesture) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const now = [...pointers.values()],
            g = gesture;
        if (now.length === 1) {
            const dx = now[0].x - g.from[0].x,
                dy = now[0].y - g.from[0].y;
            if (!g.moved && Math.hypot(dx, dy) < 6) return;
            g.moved = true;
            away = true;
            cam = bound({ x: g.start.x - dx / g.start.k, y: g.start.y - dy / g.start.k, k: g.start.k });
        } else if (now.length >= 2 && g.from.length >= 2) {
            g.moved = true;
            away = true;
            const mid = (q: { x: number; y: number }[]) => ({ x: (q[0].x + q[1].x) / 2, y: (q[0].y + q[1].y) / 2 }),
                spread = (q: { x: number; y: number }[]) => Math.hypot(q[0].x - q[1].x, q[0].y - q[1].y) || 1;
            const k = clampK(g.start.k * (spread(now) / spread(g.from))),
                r = host.getBoundingClientRect(),
                a = mid(g.from),
                b = mid(now);
            // The tile under the fingers' midpoint stays under it as they pinch and move.
            const under = {
                x: g.start.x + (a.x - r.left - size.w / 2) / g.start.k,
                y: g.start.y + (a.y - r.top - size.h / 2) / g.start.k,
            };
            cam = bound({ k, x: under.x - (b.x - r.left - size.w / 2) / k, y: under.y - (b.y - r.top - size.h / 2) / k });
        }
    }
    function up(e: PointerEvent) {
        const g = gesture,
            single = pointers.size === 1;
        pointers.delete(e.pointerId);
        if (pointers.size) return begin();
        gesture = null;
        if (!g || g.moved || !single || performance.now() - g.at > 600) return;
        const p = toTile(e.clientX, e.clientY),
            r = host.getBoundingClientRect(),
            id = performance.now();
        ripples = [...ripples, { id, x: e.clientX - r.left, y: e.clientY - r.top }];
        setTimeout(() => (ripples = ripples.filter((q) => q.id !== id)), 500);
        // A second tap close by and soon after zooms in there.
        if (id - lastTap.time < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
            lastTap.time = 0;
            zoomAt(2, e.clientX, e.clientY);
            return;
        }
        lastTap = { time: id, x: e.clientX, y: e.clientY };
        if (p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height) onpick?.(p, placeAt(p));
    }
    function zoomAt(factor: number, clientX: number, clientY: number, smooth = true) {
        away = true;
        const r = host.getBoundingClientRect(),
            under = toTile(clientX, clientY),
            k = clampK(cam.k * factor),
            to = { k, x: under.x - (clientX - r.left - size.w / 2) / k, y: under.y - (clientY - r.top - size.h / 2) / k };
        if (smooth) glide(to, 220);
        else cam = bound(to);
    }
    function wheel(e: WheelEvent) {
        e.preventDefault();
        cancelAnimationFrame(glideFrame);
        // A trackpad pinch arrives as the wheel with ctrl held, in small steps.
        zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX, e.clientY, false);
    }
    function zoomButton(factor: number) {
        const r = host.getBoundingClientRect();
        // Around the middle of the clear part of the view.
        zoomAt(factor, r.left + insetLeft + (size.w - insetLeft) / 2, r.top + insetTop + (size.h - insetTop - insetBottom) / 2);
    }

    // Labels: building names in tags of one size on screen; where two would
    // overlap, the bigger building's wins. Room names once a room is big enough to hold its own.
    const LABEL = 12;
    const textWidth = (s: string, px: number) => s.length * px * 0.56 + 14;
    let buildingTags = $derived.by(() => {
        const placed: [number, number, number, number][] = [];
        return pieces
            .filter(isBuilding)
            .sort((a, b) => b.w * b.h - a.w * a.h)
            .flatMap((p) => {
                // Just inside the building's top edge, clear of the rooms and landmarks in its middle
                // (in the middle when the building is too small on screen for that).
                const h = (LABEL + 10) * unit,
                    x = (p.x + p.w / 2) * S,
                    y = p.h * S > h * 3 ? p.y * S + h / 2 + 6 * unit : (p.y + p.h / 2) * S,
                    w = textWidth(p.name, LABEL) * unit,
                    box: [number, number, number, number] = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
                if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) return [];
                placed.push(box);
                return [{ id: p.id, name: p.name, x, y, w, h }];
            });
    });
    const roomFits = (r: { w: number; name: string }) => r.w * cam.k > textWidth(r.name, 11) + 4 && cam.k > 26;
    /** Building names give way to room names once the rooms show. */
    let roomsShown = $derived(cam.k > 34);
</script>

<div
    class="floor-plan"
    class:picking
    bind:this={host}
    role="application"
    aria-label={t("planLabel")}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={(e) => {
        pointers.delete(e.pointerId);
        gesture = null;
    }}
    onwheel={wheel}
>
    {#if size.w}<svg {viewBox} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            <defs>
                <filter id="plan-lift" x="-10%" y="-10%" width="120%" height="130%"
                    ><feDropShadow dx="0" dy={3 * unit} stdDeviation={4 * unit} flood-color="#1b2a21" flood-opacity="0.22" /></filter
                >
            </defs>
            <!-- The grounds: lawn, running past the canvas's edge. -->
            <rect x={-width * S} y={-height * S} width={width * 3 * S} height={height * 3 * S} fill="#dfe7d2" />
            <!-- Walkways and open areas, paved. -->
            {#each pieces.filter((p) => !isBuilding(p) && !isParking(p) && !isGate(p) && !isBarrier(p)) as p}<polygon
                    class="walkway"
                    points={pts(footprint(p))}
                    stroke-width={1.5 * unit}
                />{/each}
            {#each pieces.filter(isParking) as p}<g class="parking"
                    ><polygon points={pts(footprint(p))} stroke-width={1.5 * unit} />{#each parkingBays(p).lines as [a, b]}<line
                            x1={a.x * S}
                            y1={a.y * S}
                            x2={b.x * S}
                            y2={b.y * S}
                            stroke-width={1.5 * unit}
                        />{/each}<g transform={`translate(${(p.x + p.w / 2) * S} ${(p.y + p.h / 2) * S}) scale(${unit})`} class="badge"
                        ><rect x="-12" y="-12" width="24" height="24" rx="6" /><text y="1">P</text></g
                    ></g
                >{/each}
            {#each pieces.filter((p) => isGate(p) || isBarrier(p)) as p}{@const g = gatewayParts(p)}<g class="gateway" class:gate={isGate(p)}
                    ><polygon points={pts(footprint(p))} stroke-width={1.5 * unit} /><line
                        x1={g.span[0].x * S}
                        y1={g.span[0].y * S}
                        x2={g.span[1].x * S}
                        y2={g.span[1].y * S}
                        stroke-width={4 * unit}
                    />{#each g.blocks as b}<rect x={b.x * S} y={b.y * S} width={b.w * S} height={b.h * S} rx="3" />{/each}</g
                >{/each}
            <!-- Buildings stand off the ground; their rooms and doors inside. -->
            {#each pieces.filter(isBuilding) as p}<g class="building"
                    ><polygon class="shell" points={pts(footprint(p))} fill={p.color} filter="url(#plan-lift)" stroke-width={2.5 * unit} />
                    {#each p.roomAssets ?? [] as r}{@const d = roomDoor(r)}{@const rx = p.x + r.x}{@const ry = p.y + r.y}<rect
                            class="room"
                            x={(rx + 0.04) * S}
                            y={(ry + 0.04) * S}
                            width={(r.w - 0.08) * S}
                            height={(r.h - 0.08) * S}
                            rx={2 * unit}
                            fill={roomColor(r)}
                            stroke-width={1.2 * unit}
                        /><line
                            x1={(d.side === "north" || d.side === "south" ? rx + d.offset - 0.2 : rx + (d.side === "east" ? r.w - 0.04 : 0.04)) * S}
                            x2={(d.side === "north" || d.side === "south" ? rx + d.offset + 0.2 : rx + (d.side === "east" ? r.w - 0.04 : 0.04)) * S}
                            y1={(d.side === "north" || d.side === "south" ? ry + (d.side === "south" ? r.h - 0.04 : 0.04) : ry + d.offset - 0.2) * S}
                            y2={(d.side === "north" || d.side === "south" ? ry + (d.side === "south" ? r.h - 0.04 : 0.04) : ry + d.offset + 0.2) * S}
                            stroke={roomColor(r)}
                            stroke-width={Math.max(4, 3 * unit)}
                        />{/each}
                    {#each buildingDoors(p, pieces) as d}{@const [a, b] = doorSegment(p, d)}<line
                            x1={a.x * S}
                            x2={b.x * S}
                            y1={a.y * S}
                            y2={b.y * S}
                            stroke={p.color}
                            stroke-width={Math.max(5, 4 * unit)}
                        />{/each}</g
                >{/each}
            {#if highlight}<rect
                    class="highlight"
                    x={highlight.x * S}
                    y={highlight.y * S}
                    width={highlight.w * S}
                    height={highlight.h * S}
                    rx={3 * unit}
                    stroke-width={3 * unit}
                />{/if}
            {#if route && route.length > 1}{@const at = Math.max(0, Math.min(walked, route.length - 1))}{@const ahead = route.slice(at)}<polyline
                    points={pts(route)}
                    class="route-casing"
                    stroke-width={11 * unit}
                />{#if at}<polyline points={pts(route.slice(0, at + 1))} class="route-walked" stroke-width={6 * unit} />{/if}{#if ahead.length > 1}<polyline
                        points={pts(ahead)}
                        class="route-line"
                        stroke-width={6 * unit}
                    /><polyline
                        class="flow"
                        points={pts(ahead)}
                        stroke-width={2.4 * unit}
                        stroke-dasharray={`${3 * unit} ${14 * unit}`}
                        style:--flow={`${-17 * unit}`}
                    />{/if}{@const end = route[route.length - 1]}<g
                    class="you"
                    transform={`translate(${route[at].x * S} ${route[at].y * S}) scale(${unit})`}
                    ><circle r="16" class="halo" /><circle r="8" /></g
                ><g class="pin" transform={`translate(${end.x * S} ${end.y * S}) scale(${unit})`}
                    ><path d="M0 0 C-4 -9 -13 -14 -13 -24 A13 13 0 1 1 13 -24 C13 -14 4 -9 0 0Z" /><circle cy="-24" r="5" /></g
                >{/if}
            <!-- Names: room names once zoomed in, building names otherwise. -->
            {#if roomsShown}{#each pieces.filter(isBuilding) as p}{#each p.roomAssets ?? [] as r}{#if roomFits(r)}<text
                                class="room-label"
                                x={(p.x + r.x + r.w / 2) * S}
                                y={(p.y + r.y + r.h / 2) * S}
                                font-size={11 * unit}
                                stroke-width={3 * unit}>{r.name}</text
                            >{/if}{/each}{/each}{/if}
            {#each buildingTags as tag (tag.id)}<g class="name-tag" class:faded={roomsShown}
                    ><rect x={tag.x - tag.w / 2} y={tag.y - tag.h / 2} width={tag.w} height={tag.h} rx={tag.h / 2} stroke-width={1 * unit} /><text
                        x={tag.x}
                        y={tag.y + 0.5 * unit}
                        font-size={LABEL * unit}>{tag.name}</text
                    ></g
                >{/each}
            {#each landmarks as n}<g
                    transform={`translate(${n.x * S} ${n.y * S}) scale(${unit})`}
                    class:selected={n.id === selectedLandmark}
                    class="landmark"
                    style:--color={category(n.category).color}
                    ><circle r="12" /><svg
                        x="-7.5"
                        y="-7.5"
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="white"
                        stroke-width="2.4"
                        stroke-linecap="round"
                        stroke-linejoin="round">{@html category(n.category).icon}</svg
                    >{#if cam.k > 22 || n.id === selectedLandmark}<text y="-21" class="landmark-label">{n.name || t("unnamedLandmark")}</text
                        >{/if}</g
                >{/each}
            {#if here}<g transform={`translate(${here.x * S} ${here.y * S}) scale(${unit * 1.6})`} class="here"
                    ><circle r="26" class="halo" /><circle r="10" /><text y="-36">{t("youAreHere")}</text></g
                >{/if}
        </svg>{/if}
    {#if away}<button
            class="recenter"
            style:bottom={`${insetBottom + 12}px`}
            title={t("recenterHint")}
            onclick={() => frame(focus.box, focus.pad)}
            onpointerdown={(e) => e.stopPropagation()}
            ><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"
                ><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /><circle cx="12" cy="12" r="7" /></svg
            >{t("recenter")}</button
        >{/if}
    {#each ripples as r (r.id)}<span class="ripple" style:left={`${r.x}px`} style:top={`${r.y}px`}></span>{/each}
    <!-- North is always up on the plan. -->
    <div class="north" style:top={`${insetTop + 10}px`} style:left={`${insetLeft + 12}px`} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 3l5 15-5-3.5L7 18z" /></svg><b>{locale.lang === "id" ? "U" : "N"}</b>
    </div>
    {#if controls}<div class="zoom" style:top={`${insetTop + 10}px`}>
            <button aria-label={t("zoomIn")} onclick={() => zoomButton(1.6)}>+</button><button
                aria-label={t("zoomOut")}
                onclick={() => zoomButton(1 / 1.6)}>−</button
            >
        </div>{/if}
</div>

<style>
    .floor-plan {
        position: relative;
        width: 100%;
        height: 100%;
        min-height: 0;
        overflow: hidden;
        background: #dfe7d2;
        touch-action: none;
        cursor: grab;
        user-select: none;
        -webkit-user-select: none;
    }
    .floor-plan:active {
        cursor: grabbing;
    }
    .floor-plan.picking {
        cursor: crosshair;
    }
    svg {
        display: block;
        width: 100%;
        height: 100%;
    }
    text {
        text-anchor: middle;
        dominant-baseline: central;
        pointer-events: none;
        paint-order: stroke;
        stroke-linejoin: round;
        font-family: inherit;
    }
    .walkway {
        fill: #f3eee2;
        stroke: #d6cbb3;
    }
    .shell {
        stroke: #4d6152;
        transition: filter 160ms ease;
    }
    .room {
        stroke: #93a08c;
    }
    .room-label {
        font-weight: 500;
        fill: #2e4235;
        stroke: #ffffffc0;
    }
    .name-tag rect {
        fill: #fffdf8;
        stroke: #1b2a2133;
    }
    .name-tag text {
        font-weight: 650;
        fill: #1f3a2b;
    }
    .name-tag {
        transition: opacity 200ms ease;
    }
    /* Zoomed in among the rooms, the building's name steps back. */
    .name-tag.faded {
        opacity: 0.45;
    }
    .route-casing {
        fill: none;
        stroke: #ffffff;
        stroke-linejoin: round;
        stroke-linecap: round;
    }
    .route-walked {
        fill: none;
        stroke: #a9b8ae;
        stroke-linejoin: round;
        stroke-linecap: round;
    }
    .route-line {
        fill: none;
        stroke: #2f7fc4;
        stroke-linejoin: round;
        stroke-linecap: round;
    }
    .flow {
        fill: none;
        stroke: #ffffffd9;
        stroke-linecap: round;
        animation: flow 1.1s linear infinite;
    }
    @keyframes flow {
        to {
            stroke-dashoffset: var(--flow);
        }
    }
    .you circle {
        fill: #2f7fc4;
        stroke: white;
        stroke-width: 3;
    }
    .you .halo {
        fill: #2f7fc433;
        stroke: none;
        animation: breathe 2s ease-in-out infinite;
        transform-box: fill-box;
        transform-origin: center;
    }
    @keyframes breathe {
        50% {
            transform: scale(1.35);
            opacity: 0.4;
        }
    }
    .pin path {
        fill: #d24b3b;
        stroke: white;
        stroke-width: 2.5;
    }
    .pin circle {
        fill: white;
    }
    .highlight {
        fill: #d24b3b1f;
        stroke: #d24b3b;
        animation: pulse 1.6s ease-in-out infinite;
    }
    @keyframes pulse {
        50% {
            stroke-opacity: 0.35;
        }
    }
    .parking polygon {
        fill: #c9ced2;
        stroke: #9ba2a6;
    }
    .parking line {
        stroke: white;
    }
    .parking .badge rect {
        fill: #3a5ba8;
        stroke: white;
        stroke-width: 2.5;
    }
    .parking .badge text {
        fill: white;
        font-size: 15px;
        font-weight: 700;
    }
    .gateway polygon {
        fill: #d9d6cf;
        stroke: #a9a49a;
    }
    .gateway line {
        stroke: #d24b3b;
        stroke-dasharray: 10 7;
        stroke-linecap: round;
    }
    .gateway rect {
        fill: #f4f2ec;
        stroke: #5c6266;
        stroke-width: 2;
    }
    .gateway.gate polygon {
        fill: #e6e0d2;
    }
    .gateway.gate line {
        stroke: #2f7d44;
        stroke-dasharray: none;
    }
    .gateway.gate rect {
        fill: #d8d2c4;
        stroke: #6f6a5e;
    }
    .landmark circle {
        fill: var(--color);
        stroke: white;
        stroke-width: 2.5;
    }
    .landmark.selected circle {
        stroke: #d24b3b;
        stroke-width: 3.5;
    }
    .landmark-label {
        font-size: 11px;
        font-weight: 600;
        fill: #5a3f10;
        stroke: #fffaf0;
        stroke-width: 3.5px;
    }
    .here circle {
        fill: #2f7fc4;
        stroke: white;
        stroke-width: 4;
    }
    .here .halo {
        fill: #2f7fc42e;
        stroke: none;
    }
    .here text {
        font-size: 14px;
        font-weight: 700;
        fill: #1d5a8f;
        stroke: #fff;
        stroke-width: 4px;
    }
    /* Back to the starting view, once the visitor has wandered from it. */
    .recenter {
        position: absolute;
        right: 12px;
        z-index: 2;
        display: flex;
        align-items: center;
        gap: 7px;
        height: 44px;
        padding: 0 16px 0 13px;
        border-radius: 22px;
        background: #fffdf8;
        color: #23463a;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        box-shadow:
            0 0 0 1px #1b2a2117,
            0 10px 28px -12px #1b2a2166;
        animation: recenter-in 200ms cubic-bezier(0.23, 1, 0.32, 1);
    }
    .recenter svg {
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
    }
    .recenter:active {
        transform: scale(0.96);
    }
    @keyframes recenter-in {
        from {
            opacity: 0;
            transform: translateY(6px) scale(0.96);
        }
    }
    /* A tap answered where it landed. */
    .ripple {
        position: absolute;
        width: 44px;
        height: 44px;
        margin: -22px 0 0 -22px;
        border-radius: 50%;
        background: #2d4a3833;
        pointer-events: none;
        animation: ripple 450ms cubic-bezier(0.23, 1, 0.32, 1) forwards;
    }
    @keyframes ripple {
        from {
            transform: scale(0.3);
            opacity: 1;
        }
        to {
            transform: scale(1.4);
            opacity: 0;
        }
    }
    .north {
        position: absolute;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1px;
        padding: 6px 7px 5px;
        border-radius: 12px;
        background: #fffdf8e6;
        box-shadow: 0 0 0 1px #1b2a2117;
        color: #3d5243;
        font-size: 10px;
        pointer-events: none;
    }
    .north path {
        fill: #d24b3b;
    }
    .zoom {
        position: absolute;
        right: 12px;
        display: flex;
        flex-direction: column;
        border-radius: 14px;
        background: #fffdf8;
        overflow: hidden;
        box-shadow:
            0 0 0 1px #1b2a2117,
            0 8px 24px -12px #1b2a2140;
    }
    .zoom button {
        display: grid;
        place-items: center;
        width: 40px;
        height: 40px;
        font-size: 18px;
        color: #2d4a38;
    }
    .zoom button + button {
        border-top: 1px solid #1b2a2112;
    }
    @media (hover: hover) and (pointer: fine) {
        /* A building lifts a little under the mouse: it can be clicked. */
        .building:hover .shell {
            filter: url(#plan-lift) brightness(1.03);
        }
        .floor-plan:not(.picking) .building {
            cursor: pointer;
        }
        .zoom button:hover {
            background: #f1efe6;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .flow,
        .highlight,
        .you .halo,
        .ripple,
        .recenter {
            animation: none;
        }
    }
</style>
