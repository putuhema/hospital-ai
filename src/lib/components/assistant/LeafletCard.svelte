<script lang="ts">
    import type { LeafletImage } from "$lib/model/leaflets";
    import { useLocale } from "$lib/i18n/locale.svelte";
    let { image }: { image: LeafletImage } = $props();
    const t = useLocale().t;
    let viewer = $state<HTMLDialogElement>(),
        failed = $state(false);
    // Its own shape while it loads, so the reply doesn't jump; a tall leaflet is cut at the bottom, whole when opened.
    let ratio = $derived(image.width && image.height ? `${image.width} / ${image.height}` : "3 / 4");
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
        onclick={(e) => {
            // A tap beside the image closes it.
            if (e.target === e.currentTarget) viewer?.close();
        }}
    >
        <header>
            <b>{image.title}</b>
            <a href={image.url} target="_blank" rel="noopener">{t("leafletOpen")}</a>
            <button class="close" aria-label={t("close")} onclick={() => viewer?.close()}
                ><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button
            >
        </header>
        <div class="scroll"><img src={image.url} alt={image.title} /></div>
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
        box-shadow:
            0 0 0 1px var(--line, #1d2b221a),
            0 8px 22px -16px #1d2b2255;
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
    .viewer header a {
        font-size: 13px;
        color: #cfe0c3;
        white-space: nowrap;
    }
    .close {
        display: grid;
        place-items: center;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: #ffffff1a;
        color: inherit;
    }
    .close svg {
        fill: none;
        stroke: currentColor;
        stroke-width: 2.4;
        stroke-linecap: round;
    }
    /* Scrolls and pinches like a photo; the whole leaflet fits the width. */
    .scroll {
        flex: 1;
        min-height: 0;
        overflow: auto;
        overscroll-behavior: contain;
        touch-action: pan-x pan-y pinch-zoom;
        padding: 0 12px max(12px, env(safe-area-inset-bottom));
    }
    .scroll img {
        display: block;
        max-width: 100%;
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
            box-shadow:
                0 0 0 1px #1d2b2226,
                0 14px 30px -14px #1d2b2244;
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
