<script lang="ts">
    import { savePrefs, type DisplayPrefs } from "$lib/scene/display-prefs";
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
    function toggle(pref: "buildings" | "rooms" | "info") {
        prefs[pref] = !prefs[pref];
        savePrefs(prefs);
    }
</script>

<div class="scene-options" role="group" aria-label="Display options">
    <button
        aria-pressed={overhead}
        title={overhead ? "Back to the angled 3D view" : "Bird's-eye view from straight above"}
        onclick={() => (overhead = !overhead)}>Top view</button
    >{#if !routeShown}<button
            aria-pressed={cutaway}
            onclick={() => (cutaway = !cutaway)}
            >{cutaway ? "Show roofs" : "Look inside"}</button
        >{/if}<button
        aria-pressed={prefs.buildings}
        title={prefs.buildings ? "Hide building names" : "Show building names"}
        onclick={() => toggle("buildings")}>Buildings</button
    ><button
        aria-pressed={prefs.rooms}
        title={prefs.rooms
            ? "Hide room names (shown when looking inside)"
            : "Show room names (shown when looking inside)"}
        onclick={() => toggle("rooms")}>Rooms</button
    ><button
        aria-pressed={prefs.info}
        title={prefs.info
            ? "Hide the building/room tooltip on hover"
            : "Show the building/room tooltip on hover"}
        onclick={() => toggle("info")}>Hover info</button
    >{#if presentation}<label class="greenery" title="Amount of trees and foliage"
            >Trees<input
                type="range"
                min="0"
                max="2"
                step="0.25"
                aria-label="Amount of trees and foliage"
                aria-valuetext={prefs.greenery === 0
                    ? "None"
                    : prefs.greenery < 1
                      ? "Few"
                      : prefs.greenery > 1
                        ? "Lush"
                        : "Normal"}
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
