<script lang="ts">
    // A round mini map while walking about the 3D map, as in a game: the campus around the walker, turned
    // so the way they face is up. During the guiding game it shows the lost visitor, where to take them,
    // and the route; a target out of view sits on the rim, pointing the way.
    import type { Piece } from "$lib/model/layout";
    import type { Point } from "$lib/wayfinding/navigation";
    import { footprint, isBuilding } from "$lib/model/interiors";
    let {
        pieces,
        at,
        lost = null,
        goal = null,
        label,
    }: {
        pieces: Piece[];
        /** The walker (tiles), which way they face (radians, 0 towards +y), and the route the arrow follows. */
        at: (Point & { facing: number; route: Point[] }) | null;
        /** The lost visitor waiting to be found (tiles). */
        lost?: Point | null;
        /** Where to take them (tiles). */
        goal?: Point | null;
        label: string;
    } = $props();
    /** Pixels across; tiles seen across it. */
    const SIZE = 168,
        SPAN = 44;
    let canvas: HTMLCanvasElement;
    const ratio = typeof devicePixelRatio === "number" ? Math.min(2, devicePixelRatio) : 1;

    function draw() {
        const c = canvas?.getContext("2d");
        if (!c || !at) return;
        const scale = SIZE / SPAN,
            r = SIZE / 2;
        c.setTransform(ratio, 0, 0, ratio, 0, 0);
        c.clearRect(0, 0, SIZE, SIZE);
        c.save();
        c.beginPath();
        c.arc(r, r, r - 1, 0, Math.PI * 2);
        c.clip();
        c.fillStyle = "#d3e2c4";
        c.fillRect(0, 0, SIZE, SIZE);
        // Centred on the walker, turned so the way they face is up.
        c.translate(r, r);
        c.rotate(at.facing + Math.PI);
        c.scale(scale, scale);
        c.translate(-at.x, -at.y);
        // Corridors, paths and open areas as one paved network: the edge drawn behind them all first, then
        // one fill over it, so where pieces meet there is no seam and the walkways read as joined up.
        const shape = (list: Piece[]) => {
            const path = new Path2D();
            for (const p of list) {
                const outline = footprint(p);
                outline.forEach((q, i) => (i ? path.lineTo(q.x, q.y) : path.moveTo(q.x, q.y)));
                path.closePath();
            }
            return path;
        };
        const walks = shape(pieces.filter((p) => !isBuilding(p))),
            houses = shape(pieces.filter(isBuilding));
        c.lineJoin = "round";
        c.lineWidth = 0.7;
        c.strokeStyle = "#b9ad92";
        c.stroke(walks);
        c.fillStyle = "#faf6ec";
        c.fill(walks, "nonzero");
        // Buildings on top, with a soft edge, joined to the walkways at their doors.
        c.lineWidth = 0.35;
        c.strokeStyle = "#6f9f97";
        c.stroke(houses);
        c.fillStyle = "#9ccbc4";
        c.fill(houses, "nonzero");
        // The route the arrow follows.
        if (at.route.length > 1) {
            c.beginPath();
            at.route.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)));
            c.lineWidth = 0.55;
            c.lineCap = c.lineJoin = "round";
            c.strokeStyle = "#2e9e4d";
            c.stroke();
        }
        c.restore();

        // Markers, kept upright; out of view, on the rim.
        const onMap = (p: Point) => {
            const dx = (p.x - at.x) * scale,
                dy = (p.y - at.y) * scale,
                a = at.facing + Math.PI,
                x = dx * Math.cos(a) - dy * Math.sin(a),
                y = dx * Math.sin(a) + dy * Math.cos(a),
                d = Math.hypot(x, y),
                room = r - 13;
            return d > room ? { x: r + (x / d) * room, y: r + (y / d) * room, rim: true } : { x: r + x, y: r + y, rim: false };
        };
        const marker = (p: Point, fill: string, text: string) => {
            const m = onMap(p);
            c.beginPath();
            c.arc(m.x, m.y, m.rim ? 8 : 9, 0, Math.PI * 2);
            c.fillStyle = fill;
            c.fill();
            c.lineWidth = 2;
            c.strokeStyle = "#ffffff";
            c.stroke();
            c.fillStyle = "#1b2a21";
            c.font = "bold 11px system-ui, sans-serif";
            c.textAlign = "center";
            c.textBaseline = "middle";
            c.fillText(text, m.x, m.y + 0.5);
        };
        if (goal) marker(goal, "#7cc47f", "✓");
        if (lost) marker(lost, "#f2b134", "?");
        // The walker: an arrow pointing up, the way they face.
        c.beginPath();
        c.moveTo(r, r - 9);
        c.lineTo(r + 7, r + 7);
        c.lineTo(r, r + 3);
        c.lineTo(r - 7, r + 7);
        c.closePath();
        c.fillStyle = "#c5ee3a";
        c.fill();
        c.lineWidth = 2;
        c.strokeStyle = "#1b2a21";
        c.stroke();
    }
    $effect(() => {
        void at;
        void lost;
        void goal;
        void pieces;
        draw();
    });
</script>

<div role="img" aria-label={label}>
    <canvas
        class="mini-map"
        bind:this={canvas}
        width={SIZE * ratio}
        height={SIZE * ratio}
        style:width={`${SIZE}px`}
        style:height={`${SIZE}px`}
        aria-hidden="true"
    ></canvas>
</div>

<style>
    .mini-map {
        display: block;
        border-radius: 50%;
        box-shadow:
            0 0 0 3px #fffdf8,
            0 0 0 4px #dfe4d9,
            0 14px 30px -14px #1b2a21aa;
    }
</style>
