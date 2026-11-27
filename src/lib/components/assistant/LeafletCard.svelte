<script lang="ts">
    import type { LeafletImage } from "$lib/model/leaflets";
    import { useLocale } from "$lib/i18n/locale.svelte";
    let { image }: { image: LeafletImage } = $props();
    const t = useLocale().t;
    let viewer = $state<HTMLDialogElement>(),
        failed = $state(false);
    // Its own shape while it loads, so the reply doesn't jump; a tall leaflet is cut at the bottom, whole when opened.
    let ratio = $derived(image.width && image.height ? `${image.width} / ${image.height}` : "3 / 4");

    // Zoom: the image's width as a multiple of the fitted width, from 1 (whole leaflet) to 4.
    const MIN = 1,
        MAX = 4,
        STEP = 1.5;
    let zoom = $state(1),
        scroller = $state<HTMLDivElement>(),
        picture = $state<HTMLImageElement>(),
        fitted = $state(0),
        saving = $state(false);

    /** Zoom to `next`, keeping the point at (x, y) in the scroller (its centre by default) where it was. */
    function zoomTo(next: number, x?: number, y?: number) {
        const el = scroller;
        next = Math.min(MAX, Math.max(MIN, next));
        if (!el || !picture || next === zoom) return;
        // The width it has when it fits, which zooming multiplies.
        if (zoom === MIN) fitted = picture.clientWidth;
        const r = el.getBoundingClientRect();
        const px = x ?? r.width / 2,
            py = y ?? r.height / 2;
        const k = next / zoom;
        const left = (el.scrollLeft + px) * k - px,
            top = (el.scrollTop + py) * k - py;
        zoom = next;
        // After the image has its new size.
        requestAnimationFrame(() => el.scrollTo({ left, top }));
    }
    function at(e: MouseEvent) {
        const r = scroller!.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top] as const;
    }
    function onWheel(e: WheelEvent) {
        // Ctrl + wheel (and trackpad pinch, which arrives as it) zooms; plain wheel scrolls.
        if (!e.ctrlKey) return;
        e.preventDefault();
        zoomTo(zoom * Math.exp(-e.deltaY / 200), ...at(e));
    }
    function onDouble(e: MouseEvent) {
        zoomTo(zoom > MIN ? MIN : 2.5, ...at(e));
    }

    // Two-finger pinch zoom on touchscreens, attached with passive: false so the browser doesn't zoom the chrome.
    $effect(() => {
        const el = scroller;
        if (!el) return;
        let pinch: { dist: number; zoom: number } | null = null;
        const measure = (e: TouchEvent) => {
            const [a, b] = [e.touches[0], e.touches[1]];
            return {
                dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
                x: (a.clientX + b.clientX) / 2,
                y: (a.clientY + b.clientY) / 2,
            };
        };
        const onTouchStart = (e: TouchEvent) => {
            if (e.touches.length === 2) {
                const { dist } = measure(e);
                if (dist > 0) pinch = { dist, zoom };
            } else {
                pinch = null;
            }
        };
        const onTouchMove = (e: TouchEvent) => {
            if (!pinch || e.touches.length !== 2) return;
            e.preventDefault();
            const { dist, x, y } = measure(e);
            const r = el.getBoundingClientRect();
            zoomTo(pinch.zoom * (dist / pinch.dist), x - r.left, y - r.top);
        };
        const onTouchEnd = (e: TouchEvent) => {
            if (e.touches.length < 2) pinch = null;
        };
        el.addEventListener("touchstart", onTouchStart, { passive: true });
        el.addEventListener("touchmove", onTouchMove, { passive: false });
        el.addEventListener("touchend", onTouchEnd, { passive: true });
        el.addEventListener("touchcancel", onTouchEnd, { passive: true });
        return () => {
            el.removeEventListener("touchstart", onTouchStart);
            el.removeEventListener("touchmove", onTouchMove);
            el.removeEventListener("touchend", onTouchEnd);
            el.removeEventListener("touchcancel", onTouchEnd);
        };
    });

    function fileName() {
        const ext = image.url.match(/\.(png|jpe?g|webp|gif|avif)(?:$|\?)/i)?.[1] ?? "jpg";
        const base = image.title.trim().replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "-") || "leaflet";
        return `${base}.${ext}`;
    }
    async function download() {
        if (saving) return;
        saving = true;
        try {
            // Fetched first: a link's `download` is ignored for images on another origin.
            const res = await fetch(image.url);
            if (!res.ok) throw new Error(String(res.status));
            const blob = await res.blob();
            const href = URL.createObjectURL(blob);
            const a = Object.assign(document.createElement("a"), { href, download: fileName() });
            document.body.append(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(href), 10_000);
        } catch {
            // Not fetchable here: open it, where the browser can save it.
            window.open(image.url, "_blank", "noopener");
        } finally {
            saving = false;
        }
    }
</script>

{#if failed}<p class="leaflet gone">{t("leafletGone")}</p>
{:else}<button class="leaflet" onclick={() => viewer?.showModal()} aria-label={`${image.title} · ${t("leafletEnlarge")}`}>
        <span class="frame" style:aspect-ratio={ratio}>
            <img src={image.url} alt={image.title} loading="lazy" decoding="async" onerror={() => (failed = true)} />
        </span>
        <span class="caption">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
                ><path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h4" /></svg
            >
            <b>{image.title}</b>
            <small>{t("leafletEnlarge")}</small>
        </span>
    </button>
    <dialog
        class="viewer"
        bind:this={viewer}
        aria-label={image.title}
        onclose={() => (zoom = 1)}
        onclick={(e) => {
            // A tap beside the image closes it.
            if (e.target === e.currentTarget) viewer?.close();
        }}
    >
        <header>
            <b>{image.title}</b>
            <button class="tool download" onclick={download} disabled={saving} aria-label={t("leafletDownload")} title={t("leafletDownload")}
                ><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 4v11m-4-4 4 4 4-4M5 19h14" /></svg
                ><span>{t("leafletDownload")}</span></button
            >
            <button class="close" aria-label={t("close")} onclick={() => viewer?.close()}
                ><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button
            >
        </header>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="scroll" class:zoomed={zoom > MIN} bind:this={scroller} onwheel={onWheel} ondblclick={onDouble}>
            <img bind:this={picture} src={image.url} alt={image.title} style:width={zoom > MIN ? `${fitted * zoom}px` : undefined} draggable="false" />
        </div>
        <div class="zoom" role="group" aria-label={`${t("zoomIn")} / ${t("zoomOut")}`}>
            <button onclick={() => zoomTo(zoom / STEP)} disabled={zoom <= MIN} aria-label={t("zoomOut")} title={t("zoomOut")}
                ><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 12h12" /></svg></button
            >
            <button class="level" onclick={() => zoomTo(MIN)} disabled={zoom <= MIN} aria-label={t("leafletZoomReset")} title={t("leafletZoomReset")}
                >{Math.round(zoom * 100)}%</button
            >
            <button onclick={() => zoomTo(zoom * STEP)} disabled={zoom >= MAX} aria-label={t("zoomIn")} title={t("zoomIn")}
                ><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 6v12M6 12h12" /></svg></button
            >
        </div>
    </dialog>
{/if}

<style>
    .leaflet {
        display: flex;
        flex-direction: column;
        width: 100%;
        max-width: 340px;
        padding: 0;
        overflow: hidden;
        border-radius: 16px;
        background: var(--card, #fffdf8);
        box-shadow: 0 0 0 1px var(--line, #1d2b221a);
        text-align: left;
        transition:
            transform 180ms cubic-bezier(0.23, 1, 0.32, 1),
            box-shadow 180ms;
    }
    .leaflet:active {
        transform: scale(0.985);
    }
    .frame {
        display: block;
        max-height: 360px;
        overflow: hidden;
        background: var(--paper-2, #efece3);
    }
    .frame img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
        object-position: top;
    }
    .caption {
        display: grid;
        grid-template-columns: auto 1fr;
        column-gap: 8px;
        align-items: center;
        padding: 10px 14px 11px 12px;
        border-top: 1px solid var(--line, #1d2b221a);
    }
    .caption svg {
        grid-row: span 2;
        fill: none;
        stroke: var(--forest, #24473a);
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
    }
    .caption b {
        font-size: 14px;
        line-height: 1.3;
        color: var(--ink, #1d2b22);
    }
    .caption small {
        font-size: 12px;
        color: var(--muted, #7d8a7c);
    }
    .gone {
        margin: 0;
        padding: 12px 14px;
        font-size: 13px;
        color: var(--muted, #7d8a7c);
    }
    .viewer {
        width: 100vw;
        max-width: 100vw;
        height: 100dvh;
        max-height: 100dvh;
        margin: 0;
        padding: 0;
        border: 0;
        background: #10170fee;
        color: #f6f3ea;
    }
    .viewer[open] {
        position: fixed;
        display: flex;
        flex-direction: column;
        animation: fade 180ms ease-out;
    }
    .viewer::backdrop {
        background: transparent;
    }
    .viewer header {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: max(10px, env(safe-area-inset-top)) 12px 10px 16px;
    }
    .viewer header b {
        flex: 1;
        min-width: 0;
        font-size: 14px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .viewer .tool {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 40px;
        padding: 0 14px 0 12px;
        border-radius: 999px;
        background: #ffffff24;
        color: #ffffff;
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
    }
    .viewer .tool:hover:not(:disabled),
    .viewer .close:hover {
        background: #ffffff38;
        color: #ffffff;
    }
    .viewer .tool:disabled {
        opacity: 0.55;
    }
    .tool svg,
    .zoom svg {
        fill: none;
        stroke: currentColor;
        stroke-width: 2.2;
        stroke-linecap: round;
        stroke-linejoin: round;
    }
    .viewer .zoom {
        position: absolute;
        left: 0;
        right: 0;
        bottom: max(16px, calc(env(safe-area-inset-bottom) + 8px));
        width: fit-content;
        margin: 0 auto;
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 4px;
        border-radius: 999px;
        background: #141f18f2;
        color: #ffffff;
        box-shadow:
            0 4px 18px #00000059,
            0 0 0 1px #ffffff33;
        backdrop-filter: blur(10px);
    }
    .viewer .zoom button {
        display: grid;
        place-items: center;
        width: auto;
        min-width: 40px;
        height: 40px;
        padding: 0 10px;
        border-radius: 999px;
        background: transparent;
        color: #ffffff;
        transition: background-color 150ms, transform 140ms;
    }
    .viewer .zoom button:hover:not(:disabled) {
        background: #ffffff29;
        color: #ffffff;
    }
    .viewer .zoom button:active:not(:disabled) {
        transform: scale(0.94);
    }
    .viewer .zoom button:disabled {
        opacity: 0.42;
    }
    .viewer .zoom .level {
        min-width: 56px;
        font-size: 13px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
    }
    .viewer .zoom .level:disabled {
        opacity: 0.9;
    }
    .viewer .close {
        display: grid;
        place-items: center;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: #ffffff24;
        color: #ffffff;
    }
    .close svg {
        fill: none;
        stroke: currentColor;
        stroke-width: 2.4;
        stroke-linecap: round;
    }
    /* One-finger scroll, two-finger pinch handled in script; the whole leaflet fits the width. */
    .scroll {
        flex: 1;
        min-height: 0;
        overflow: auto;
        overscroll-behavior: contain;
        touch-action: pan-x pan-y;
        /* Room below for the zoom controls. */
        padding: 0 12px calc(72px + env(safe-area-inset-bottom));
    }
    .scroll.zoomed {
        cursor: zoom-out;
    }
    .scroll.zoomed img {
        max-width: none;
    }
    .scroll:not(.zoomed) {
        cursor: zoom-in;
    }
    .scroll img {
        display: block;
        max-width: 100%;
        user-select: none;
        height: auto;
        margin: 0 auto;
        border-radius: 6px;
    }
    @keyframes fade {
        from {
            opacity: 0;
        }
    }
    @media (hover: hover) and (pointer: fine) {
        .leaflet:hover {
            background: var(--card, #fffdf8);
            box-shadow: 0 0 0 1px #1d2b2233;
        }
        .tool:hover:not(:disabled),
        .close:hover,
        .zoom button:hover:not(:disabled) {
            background: #ffffff2e;
            color: inherit;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .leaflet {
            transition: none;
        }
        .viewer[open] {
            animation: none;
        }
    }
</style>
