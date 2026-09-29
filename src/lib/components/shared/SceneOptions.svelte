<script lang="ts">
    import { savePrefs, type DisplayPrefs } from "$lib/scene/display-prefs";
    import { useLocale } from "$lib/i18n/locale.svelte";
    let {
        prefs = $bindable(),
        cutaway = $bindable(),
        overhead = $bindable(),
        routeShown,
        presentation,
    }: {
        prefs: DisplayPrefs;
        cutaway: boolean;
        /** Bird's-eye view: looking straight down on the campus. */
        overhead: boolean;
        /** Roofs are always off while a route is shown. */
        routeShown: boolean;
        /** The map also offers the trees slider. */
        presentation: boolean;
    } = $props();
    const { t } = useLocale();
    function toggle(pref: "buildings" | "rooms" | "info") {
        prefs[pref] = !prefs[pref];
        savePrefs(prefs);
    }
</script>

<div class="scene-options" role="group" aria-label={t("displayOptions")}>
    <button
        aria-pressed={overhead}
        title={t(overhead ? "topViewOn" : "topViewOff")}
        onclick={() => (overhead = !overhead)}>{t("topView")}</button
    >{#if !routeShown}<button
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
    ><button
        aria-pressed={prefs.info}
        title={t(prefs.info ? "hideHoverInfo" : "showHoverInfo")}
        onclick={() => toggle("info")}>{t("hoverInfo")}</button
    >{#if presentation}<label class="greenery" title={t("treesLabel")}
            >{t("trees")}<input
                type="range"
                min="0"
                max="2"
                step="0.25"
                aria-label={t("treesLabel")}
                aria-valuetext={t(
                    prefs.greenery === 0
                        ? "treesNone"
                        : prefs.greenery < 1
                          ? "treesFew"
                          : prefs.greenery > 1
                            ? "treesLush"
                            : "treesNormal",
                )}
                bind:value={prefs.greenery}
                onchange={() => savePrefs(prefs)}
            /></label
        >{/if}
</div>

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
    .greenery {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 0 10px 0 8px;
        font-size: 11px;
        color: #52664a;
    }
    .greenery input {
        width: 76px;
        accent-color: #2d4a38;
    }
</style>
