<script lang="ts">
    import { onMount, tick, type Snippet } from "svelte";
    import { easeOut, motion } from "$lib/motion";
    let {
        label,
        hidden = false,
        top = "72px",
        snap = $bindable("peek"),
        inset = $bindable(0),
        ondismiss,
        peek,
        children,
    }: {
        label: string;
        /** Slide off screen but stay open, e.g. while picking a spot on the map. */
        hidden?: boolean;
        /** Space kept clear above the fully open sheet. */
        top?: string;
        /** Resting position: only the peek part showing, or all of it. */
        snap?: "peek" | "full";
        /** Pixels of the map the sheet covers at rest. */
        inset?: number;
        /** Dragged or flicked down past the peek. */
        ondismiss: () => void;
        /** The top part: always showing, and where the sheet is dragged from. */
        peek: Snippet;
        children?: Snippet;
    } = $props();

    // A flick faster than this (px/ms) settles in its direction, however short.
    const FLICK = 0.4;
    let sheet: HTMLElement, head: HTMLElement;
    let body = $state<HTMLElement>();
    let height = $state(0),
        peekHeight = $state(0),
        entered = $state(false),
        dragY = $state<number | null>(null);
    let drag: { y: number; t: number; base: number; id: number; moved: boolean } | null = null;

    let peekY = $derived(Math.max(0, height - peekHeight));
    let restY = $derived(hidden || !entered ? null : snap === "full" ? 0 : peekY);
    let y = $derived(dragY ?? restY);
    $effect(() => {
        if (dragY === null) inset = restY === null ? 0 : height - restY;
    });
    // Back to the top of the content whenever it collapses.
    $effect(() => {
        if (snap === "peek" && body) body.scrollTop = 0;
    });

    onMount(() => {
        const measure = new ResizeObserver(() => {
            height = sheet.offsetHeight;
            peekHeight = head.offsetHeight;
        });
        measure.observe(sheet);
        measure.observe(head);
        // Start below the screen, then slide up on the next frame.
        requestAnimationFrame(() => requestAnimationFrame(() => (entered = true)));
        return () => measure.disconnect();
    });

    function down(e: PointerEvent) {
        if (drag || e.button !== 0) return; // one finger at a time
        drag = { y: e.clientY, t: performance.now(), base: restY ?? height, id: e.pointerId, moved: false };
    }
    function move(e: PointerEvent) {
        if (!drag || e.pointerId !== drag.id) return;
        const dy = e.clientY - drag.y;
        if (!drag.moved) {
            // Below this it's a tap on a button in the peek, not a drag.
            if (Math.abs(dy) < 6) return;
            drag.moved = true;
            // Keep the drag when the finger leaves the sheet; gone pointers can't be captured.
            if (head.hasPointerCapture?.(e.pointerId) === false)
                try {
                    head.setPointerCapture(e.pointerId);
                } catch {}
        }
        const next = drag.base + dy;
        // Past the top it resists more the further it goes.
        dragY = next < 0 ? -((-next) ** 0.7) : next;
    }
    async function up(e: PointerEvent) {
        if (!drag || e.pointerId !== drag.id) return;
        const { moved, t, y: startY } = drag;
        drag = null;
        if (!moved || dragY === null) return (dragY = null);
        const velocity = (e.clientY - startY) / (performance.now() - t),
            at = dragY;
        let next: "full" | "peek" | "dismiss";
        if (e.type !== "pointercancel" && Math.abs(velocity) > FLICK)
            next = velocity < 0 ? "full" : at < peekY ? "peek" : "dismiss";
        else {
            const nearest = [
                ["full", 0],
                ["peek", peekY],
                ["dismiss", height],
            ] as const;
            next = nearest.reduce((a, b) => (Math.abs(b[1] - at) < Math.abs(a[1] - at) ? b : a))[0];
        }
        if (next !== "dismiss") {
            snap = next;
            dragY = null;
            return;
        }
        // Stay where it was let go; the exit starts from there. If the sheet
        // stays open with new content, it glides back up.
        ondismiss();
        await tick();
        snap = "peek";
        dragY = null;
    }

    /** Leave from wherever the sheet is, not from its resting place. */
    function leave(node: HTMLElement) {
        const from = new DOMMatrix(getComputedStyle(node).transform).m42,
            to = node.offsetHeight + 24;
        return {
            duration: motion(260),
            easing: easeOut,
            css: (_: number, u: number) => `transform: translate3d(0, ${from + (to - from) * u}px, 0)`,
        };
    }
</script>

<section
    class="sheet"
    class:dragging={dragY !== null}
    aria-label={label}
    style:--top={top}
    style:transform={y === null ? "translate3d(0, calc(100% + 24px), 0)" : `translate3d(0, ${y}px, 0)`}
    bind:this={sheet}
    out:leave|global
>
    <!-- svelte-ignore a11y_no_static_element_interactions (the handle button is the keyboard way) -->
    <div
        class="head"
        bind:this={head}
        onpointerdown={down}
        onpointermove={move}
        onpointerup={up}
        onpointercancel={up}
    >
        <button
            class="handle"
            aria-label={snap === "full" ? "Show less" : "Show more"}
            aria-expanded={snap === "full"}
            onclick={() => (snap = snap === "full" ? "peek" : "full")}><i></i></button
        >
        {@render peek()}
    </div>
    {#if children}<div class="body" bind:this={body} class:locked={snap !== "full"}>
            {@render children()}
        </div>{/if}
</section>

<style>
    .sheet {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 10;
        display: flex;
        flex-direction: column;
        max-height: calc(100dvh - env(safe-area-inset-top) - var(--top));
        padding-bottom: env(safe-area-inset-bottom);
        background: white;
        border-radius: 22px 22px 0 0;
        box-shadow:
            0 -1px 0 #1f352608,
            0 -6px 32px #1f35261f;
        pointer-events: auto;
        transition: transform 480ms var(--ease-drawer);
        will-change: transform;
    }
    .sheet.dragging {
        transition: none;
    }
    /* Pulled up past the top, the sheet shows more of itself, not the map. */
    .sheet::after {
        content: "";
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        height: 200px;
        background: white;
    }
    .head {
        flex-shrink: 0;
        padding: 0 18px 14px;
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
    }
    .handle {
        display: grid;
        place-items: center;
        width: 100%;
        height: 22px;
        margin-bottom: 2px;
        background: none;
    }
    .handle:hover {
        background: none;
    }
    .handle i {
        width: 36px;
        height: 4px;
        border-radius: 4px;
        background: #d5dccf;
    }
    .body {
        flex: 1;
        min-height: 0;
        overflow: auto;
        overscroll-behavior: contain;
        padding: 0 18px 20px;
        touch-action: pan-y;
    }
    .body.locked {
        overflow: hidden;
    }
    @media (prefers-reduced-motion: reduce) {
        .sheet {
            transition: none;
        }
    }
</style>
