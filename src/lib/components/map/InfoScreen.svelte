<script lang="ts">
    import { fade } from "svelte/transition";
    import type { FaqEntry } from "$lib/model/faq";
    import HospitalInfo from "$lib/components/shared/HospitalInfo.svelte";
    import { easeOut, motion, rise } from "$lib/motion";
    import { useLocale } from "$lib/i18n/locale.svelte";
    let { faq, title, onclose }: { faq: FaqEntry[]; title: string; onclose: () => void } = $props();
    const locale = useLocale();
</script>

<div
    class="info-screen"
    role="dialog"
    aria-label={locale.t("hospitalInfo")}
    in:fade={{ duration: motion(180), easing: easeOut }}
    out:fade={{ duration: motion(140) }}
>
    <div class="bar" in:rise={{ y: -6, duration: 260 }}>
        <button class="round" aria-label={locale.t("backToMap")} onclick={onclose}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"
                ><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg
            >
        </button>
        <div>
            <small>{title}</small>
            <h2>{locale.t("hospitalInfo")}</h2>
        </div>
    </div>
    <div class="body" in:rise={{ delay: 60, duration: 320 }}>
        <HospitalInfo {faq} />
    </div>
</div>

<style>
    .info-screen {
        position: absolute;
        inset: 0;
        z-index: 30;
        display: flex;
        flex-direction: column;
        background: white;
        pointer-events: auto;
        padding-top: env(safe-area-inset-top);
    }
    .bar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border-bottom: 1px solid #eef2ea;
    }
    .bar small {
        font-size: 12px;
        color: #7b8c70;
    }
    .bar h2 {
        margin: 0;
        font:
            600 20px/1.2 Georgia,
            serif;
        color: #1f3a2b;
    }
    .round {
        display: grid;
        place-items: center;
        width: 44px;
        height: 44px;
        flex-shrink: 0;
        border-radius: 50%;
        color: #3d5243;
        transition: transform 160ms var(--ease-out);
    }
    .round:active {
        transform: scale(0.94);
    }
    .body {
        flex: 1;
        overflow: auto;
        overscroll-behavior: contain;
        padding: 4px 20px calc(env(safe-area-inset-bottom) + 16px);
        font-size: 15px;
    }
</style>
