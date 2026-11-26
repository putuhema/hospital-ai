<script lang="ts">
    // An on-screen stick for walking about the map on a phone: push to walk, all the way to run.
    import type { RoamInput } from "$lib/scene/roam";
    let { input, label }: { /** Written as the stick moves; the scene reads it every frame. */ input: RoamInput; label: string } = $props();
    const REACH = 46;
    let knob = $state({ x: 0, y: 0 }),
        running = $state(false),
        held: number | null = null,
        base: HTMLDivElement;
    function set(e: PointerEvent) {
        const r = base.getBoundingClientRect();
        let x = e.clientX - (r.left + r.width / 2),
            y = e.clientY - (r.top + r.height / 2);
        const d = Math.hypot(x, y);
        if (d > REACH) [x, y] = [(x / d) * REACH, (y / d) * REACH];
        knob = { x, y };
        input.x = x / REACH;
        input.y = -y / REACH;
        // Pushed all the way: running.
        input.run = running = d > REACH * 0.92;
    }
    function down(e: PointerEvent) {
        held = e.pointerId;
        base.setPointerCapture(e.pointerId);
        set(e);
    }
    function up(e: PointerEvent) {
        if (e.pointerId !== held) return;
        held = null;
        knob = { x: 0, y: 0 };
        input.x = input.y = 0;
        input.run = running = false;
    }
</script>

<div
    class="pad"
    role="slider"
    aria-label={label}
    aria-valuenow={0}
    tabindex="-1"
    bind:this={base}
    onpointerdown={down}
    onpointermove={(e) => e.pointerId === held && set(e)}
    onpointerup={up}
    onpointercancel={up}
>
    <span class="knob" class:run={running} style:translate={`${knob.x}px ${knob.y}px`}></span>
</div>

<style>
    .pad {
        position: relative;
        width: 128px;
        height: 128px;
        border-radius: 50%;
        background: #fffdf8b3;
        box-shadow: 0 0 0 1px #dfe4d9;
        backdrop-filter: blur(8px);
        touch-action: none;
        user-select: none;
    }
    .knob {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 56px;
        height: 56px;
        margin: -28px 0 0 -28px;
        border-radius: 50%;
        background: #2d4a38;
        transition: background 160ms;
    }
    .knob.run {
        background: #a8c08a;
    }
</style>
