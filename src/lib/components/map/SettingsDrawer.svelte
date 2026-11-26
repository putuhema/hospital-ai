<script lang="ts">
    // Settings, out of the way in a drawer: the language and the text size, and how to walk about the
    // map while doing so. Up from the bottom on a phone, in from the side on a wider screen.
    import { onMount } from "svelte";
    import { useLocale } from "$lib/i18n/locale.svelte";
    import { LANGS, type Lang } from "$lib/i18n/lang";
    import { easeDrawer, motion } from "$lib/motion";
    let {
        largeText,
        roaming = false,
        touchScreen = false,
        wide = false,
        ontext,
        onclose,
    }: {
        largeText: boolean;
        /** Walking about the map: the drawer says how. */
        roaming?: boolean;
        touchScreen?: boolean;
        /** A wider screen: in from the side; else up from the bottom. */
        wide?: boolean;
        ontext: (large: boolean) => void;
        onclose: () => void;
    } = $props();
    const locale = useLocale();
    const t = locale.t;
    const NAMES: Record<Lang, string> = { id: "Bahasa Indonesia", en: "English" };
    let closer = $state<HTMLButtonElement>();
    onMount(() => closer?.focus({ preventScroll: true }));
    /** Up from the bottom, or in from the right. */
    function slide(_: Element) {
        return {
            duration: motion(320),
            easing: easeDrawer,
            css: (_t: number, u: number) => (wide ? `transform: translateX(${u * 100}%)` : `transform: translateY(${u * 100}%)`),
        };
    }
    function fade(_: Element) {
        return { duration: motion(200), css: (t: number) => `opacity: ${t}` };
    }
</script>

<button class="scrim" tabindex="-1" aria-label={t("close")} onclick={onclose} transition:fade></button>
<div class="drawer" class:wide role="dialog" aria-modal="true" aria-labelledby="settings-title" transition:slide>
    {#if !wide}<span class="grabber" aria-hidden="true"></span>{/if}
    <header>
        <h2 id="settings-title">{t("settings")}</h2>
        <button class="close" bind:this={closer} aria-label={t("close")} onclick={onclose}
            ><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button
        >
    </header>

    <section>
        <h3>{t("language")}</h3>
        <div class="choices">
            {#each LANGS as l}<button lang={l} aria-pressed={locale.lang === l} onclick={() => locale.set(l)}
                    ><b>{l.toUpperCase()}</b>{NAMES[l]}</button
                >{/each}
        </div>
    </section>

    <section>
        <h3>{t("textSize")}</h3>
        <div class="choices">
            <button aria-pressed={!largeText} onclick={() => ontext(false)}><b class="sample">Aa</b>{t("textSizeNormal")}</button>
            <button aria-pressed={largeText} onclick={() => ontext(true)}><b class="sample big">Aa</b>{t("textSizeLarge")}</button>
        </div>
    </section>

    {#if roaming}<section>
            <h3>{t("roamControls")}</h3>
            <ul class="keys">
                {#if touchScreen}<li>{t("roamControlStick")}</li>
                    <li>{t("roamControlDrag")}</li>
                {:else}<li><kbd>W</kbd><kbd>S</kbd> {t("roamControlWalk")}</li>
                    <li><kbd>A</kbd><kbd>D</kbd> {t("roamControlTurn")}</li>
                    <li><kbd>Shift</kbd> {t("roamControlRun")}</li>
                    <li>{t("roamControlDrag")}</li>
                    <li><kbd>Esc</kbd> {t("roamControlStop")}</li>{/if}
            </ul>
        </section>{/if}
</div>

<style>
    .scrim {
        position: fixed;
        inset: 0;
        z-index: 40;
        background: #1b2a2159;
        border: 0;
        cursor: default;
    }
    .drawer {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 41;
        display: flex;
        flex-direction: column;
        gap: 18px;
        max-height: 85dvh;
        overflow-y: auto;
        padding: 10px 20px calc(env(safe-area-inset-bottom) + 24px);
        border-radius: 22px 22px 0 0;
        border-top: 1px solid #1b2a2117;
        background: #fffdf8;
        color: #1f3a2b;
    }
    .drawer.wide {
        left: auto;
        top: 0;
        width: 360px;
        max-height: none;
        padding: 22px 24px;
        border-top: 0;
        border-left: 1px solid #1b2a2117;
        border-radius: 22px 0 0 22px;
    }
    .grabber {
        align-self: center;
        width: 38px;
        height: 4px;
        border-radius: 2px;
        background: #1b2a2126;
    }
    header {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }
    h2 {
        margin: 0;
        font-family: var(--display, Georgia, serif);
        font-size: 22px;
        font-weight: 540;
    }
    .close {
        display: grid;
        place-items: center;
        width: 38px;
        height: 38px;
        border: 0;
        border-radius: 12px;
        background: #f1ede2;
        color: inherit;
        cursor: pointer;
    }
    .close svg {
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
    }
    h3 {
        margin: 0 0 8px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #7b8c70;
    }
    .choices {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
    }
    .choices button {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 54px;
        padding: 10px 12px;
        border: 1.5px solid #e4e0d4;
        border-radius: 14px;
        background: white;
        color: inherit;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        text-align: left;
        cursor: pointer;
        transition:
            border-color 160ms,
            background 160ms;
    }
    .choices button[aria-pressed="true"] {
        border-color: #2d4a38;
        background: #eef4ea;
    }
    .choices b {
        display: grid;
        place-items: center;
        flex-shrink: 0;
        min-width: 32px;
        height: 28px;
        border-radius: 8px;
        background: #f1ede2;
        font-size: 11px;
        letter-spacing: 0.06em;
    }
    .choices button[aria-pressed="true"] b {
        background: #2d4a38;
        color: white;
    }
    .choices .sample {
        font-size: 13px;
        letter-spacing: 0;
    }
    .choices .sample.big {
        font-size: 18px;
    }
    .keys {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin: 0;
        padding: 0;
        list-style: none;
        font-size: 14px;
    }
    kbd {
        display: inline-block;
        min-width: 22px;
        margin-right: 3px;
        padding: 2px 6px;
        border: 1px solid #d8d2c2;
        border-bottom-width: 2px;
        border-radius: 6px;
        background: white;
        font: inherit;
        font-size: 12px;
        font-weight: 700;
        text-align: center;
    }
</style>
