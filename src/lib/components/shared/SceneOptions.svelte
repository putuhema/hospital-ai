<script lang="ts">
    import { savePrefs, type DisplayPrefs } from "$lib/scene/display-prefs";
    import { useLocale } from "$lib/i18n/locale.svelte";
    let {
        prefs = $bindable(),
        cutaway = $bindable(),
        overhead = $bindable(),
        routeShown,
        plan = false,
    }: {
        prefs: DisplayPrefs;
        cutaway: boolean;
        /** Bird's-eye view: looking straight down on the campus. */
        overhead: boolean;
        /** Roofs are always off while a route is shown. */
        routeShown: boolean;
        /** On the 2D plan: only the name labels apply. */
        plan?: boolean;
    } = $props();
    const { t } = useLocale();
    function toggle(pref: "buildings" | "rooms" | "info" | "people") {
        prefs[pref] = !prefs[pref];
        savePrefs(prefs);
    }
</script>

<div class="scene-options" role="group" aria-label={t("displayOptions")}>
    {#if !plan}<button
            aria-pressed={overhead}
            title={t(overhead ? "topViewOn" : "topViewOff")}
            onclick={() => (overhead = !overhead)}>{t("topView")}</button
        >{/if}{#if !routeShown && !plan}<button
            aria-pressed={cutaway}
            onclick={() => (cutaway = !cutaway)}
            >{t(cutaway ? "showRoofs" : "lookInside")}</button
        >{/if}<button
        aria-pressed={prefs.buildings}
        title={t(prefs.buildings ? "hideBuildingNames" : "showBuildingNames")}
        onclick={() => toggle("buildings")}>{t("buildings")}</button
    ><button
        aria-pressed={prefs.rooms}
        title={t(prefs.rooms ? "hideRoomNames" : "showRoomNames")}
        onclick={() => toggle("rooms")}>{t("rooms")}</button
    >{#if !plan}<button
            aria-pressed={prefs.info}
            title={t(prefs.info ? "hideHoverInfo" : "showHoverInfo")}
            onclick={() => toggle("info")}>{t("hoverInfo")}</button
        ><button
            aria-pressed={prefs.people}
            title={t(prefs.people ? "hidePeople" : "showPeople")}
            onclick={() => toggle("people")}>{t("people")}</button
        >{/if}</div>

<style>
    .scene-options {
        position: absolute;
        right: 15px;
        top: 15px;
        z-index: 3;
        display: flex;
        gap: 2px;
        padding: 3px;
        background: #ffffffed;
        border-radius: 20px;
        box-shadow: 0 4px 18px #2b402414;
    }
    .scene-options button {
        padding: 7px 12px;
        border-radius: 16px;
        font-size: 11px;
        color: #52664a;
        white-space: nowrap;
    }
    .scene-options button[aria-pressed="true"] {
        background: #2d4a38;
        color: white;
    }
</style>
