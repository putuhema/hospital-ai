<script lang="ts">
    import { walkwayAt } from "$lib/model/interiors";
    import { shortcuts as shortcutsFor } from "$lib/wayfinding/shortcuts";
    import PlaceIcon from "./PlaceIcon.svelte";
    import type { Point } from "$lib/wayfinding/navigation";
    import {
        nearestOfType,
        stepGlyph,
        stepText,
        walkMinutes,
        type NavGrid,
        type Place,
        type Route,
    } from "$lib/wayfinding/routing";
    import PlaceSearch from "$lib/components/shared/PlaceSearch.svelte";
    import PlaceDetails from "$lib/components/shared/PlaceDetails.svelte";
    import { useLocale } from "$lib/i18n/locale.svelte";
    let {
        places,
        grid,
        route,
        from = $bindable(null),
        to = $bindable(null),
        picking = $bindable(false),
    }: {
        places: Place[];
        grid: NavGrid;
        route: Route | null;
        from?: Place | Point | null;
        to?: Place | null;
        /** True while the user is choosing a start point on the map. */
        picking?: boolean;
    } = $props();
    const locale = useLocale();
    // A picked spot is named after the corridor or path it is on.
    let fromName = $derived(
        !from
            ? ""
            : "id" in from
              ? from.name
              : locale.t("spotOn", { name: walkwayAt(grid.pieces, from)?.name ?? locale.t("theMap") }),
    );
    // Kinds of place in this layout, e.g. "Toilets" or "Parking".
    let shortcuts = $derived(shortcutsFor(places, 5));
    function nearest(detail: string) {
        to = nearestOfType(grid, places, detail, from);
    }
</script>

<div class="route-finder">
    <div class="fields">
        <PlaceSearch
            {places}
            marker="start"
            label={locale.t("startingPoint")}
            placeholder={locale.t("whereAreYou")}
            value={fromName}
            onselect={(p) => {
                from = p;
                picking = false;
            }}
            onclear={() => {
                from = null;
                picking = false;
            }}
            clearLabel={locale.t("clearStart")}
        />
        <PlaceSearch
            {places}
            marker="end"
            label={locale.t("destination")}
            placeholder={locale.t("searchRoomOrBuilding")}
            value={to?.name ?? ""}
            onselect={(p) => (to = p)}
            onclear={() => (to = null)}
            clearLabel={locale.t("clearDestination")}
        />
        <button
            class="swap"
            title={locale.t("swap")}
            aria-label={locale.t("swap")}
            disabled={!from || !to || !("id" in from)}
            onclick={() => {
                if (from && "id" in from && to) [from, to] = [to, from];
            }}>⇅</button
        >
    </div>
    <div class="tools">
        <button
            class="chip pick"
            class:active={picking}
            aria-pressed={picking}
            onclick={() => (picking = !picking)}
            >{locale.t(picking ? "clickTheMap" : "pickStart")}</button
        >
        {#each shortcuts as t}<button
                class="chip"
                onclick={() => nearest(t.name)}
                ><PlaceIcon of={{ ...t, detail: t.name }} size={16} />{locale.shortcut(t.name, !!from)}</button
            >{/each}
    </div>
    {#if to?.info}<PlaceDetails info={to.info} />{/if}
    {#if from && to}
        {#if route}<section class="result" aria-live="polite">
                <div class="summary">
                    <b>{locale.t("minutes", { n: walkMinutes(route.meters) })}</b>
                    <span>{locale.t("metresWalk", { m: route.meters })}</span>
                    <button
                        class="clear"
                        onclick={() => {
                            to = null;
                        }}>{locale.t("clear")}</button
                    >
                </div>
                <ol>
                    {#each route.steps as step}<li>
                            <span class="glyph">{stepGlyph(step)}</span>
                            <span class="step"
                                >{stepText(step.say, locale.lang)}{#if step.meters}<small
                                        >{step.meters} m</small
                                    >{/if}</span
                            >
                        </li>{/each}
                </ol>
            </section>{:else}<p class="notice" role="status">
                <b>{locale.t("noRouteFound")}</b> {locale.t("noRouteHint")}
            </p>{/if}
    {:else if !places.length}<p class="notice">
            {locale.t("emptyMapLong")}
        </p>{:else}<p class="tip">
            {locale.t(from ? "nowChooseDestination" : "chooseStartTip")}
        </p>{/if}
</div>

<style>
    .fields {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding-right: 38px;
    }
    .swap {
        position: absolute;
        right: 0;
        top: 50%;
        transform: translateY(-50%);
        width: 30px;
        height: 30px;
        border-radius: 50%;
        border: 1px solid #d3ddca;
        background: white;
        font-size: 15px;
        color: #3f6b4e;
    }
    .swap:disabled {
        opacity: 0.4;
    }
    .tools {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin: 10px 0 4px;
    }
    .chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 6px 10px;
        border: 1px solid #d9e2d0;
        border-radius: 20px;
        background: white;
        font-size: 11px;
        color: #3d5243;
    }
    .chip:hover {
        border-color: #9fb394;
    }
    .chip.active {
        background: #2f7fc4;
        border-color: #2f7fc4;
        color: white;
    }
    .result {
        margin-top: 12px;
        border-top: 1px solid #e3e9dc;
        padding-top: 12px;
    }
    .summary {
        display: flex;
        align-items: baseline;
        gap: 10px;
    }
    .summary b {
        font:
            28px Georgia,
            serif;
        color: #243d2c;
    }
    .summary span {
        font-size: 12px;
        color: #6a7c62;
    }
    .clear {
        margin-left: auto;
        font-size: 11px;
        color: #4b6f53;
        text-decoration: underline;
    }
    ol {
        list-style: none;
        margin: 10px 0 0;
        padding: 0;
    }
    li {
        display: flex;
        gap: 10px;
        padding: 8px 0;
        border-bottom: 1px solid #eef2ea;
        font-size: 12.5px;
        color: #2f4336;
        line-height: 1.4;
    }
    li:last-child {
        border-bottom: 0;
        font-weight: 600;
    }
    .glyph {
        flex-shrink: 0;
        width: 24px;
        height: 24px;
        display: grid;
        place-items: center;
        border-radius: 50%;
        background: #e8f1f9;
        color: #2f7fc4;
        font-size: 13px;
    }
    li:last-child .glyph {
        background: #fbe6e3;
        color: #d24b3b;
    }
    .step small {
        display: block;
        color: #7b8c70;
        font-size: 11px;
        font-weight: 400;
    }
    .notice,
    .tip {
        font-size: 12px;
        line-height: 1.5;
        color: #6a7c62;
        margin: 12px 0 0;
    }
    .notice {
        background: #fff3e4;
        color: #7d5732;
        padding: 10px 12px;
        border-radius: 8px;
    }
</style>
