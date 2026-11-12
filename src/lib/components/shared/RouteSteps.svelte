<script lang="ts">
    import { progress, stepGlyph, stepText, type Route } from "$lib/wayfinding/routing";
    import { useLocale } from "$lib/i18n/locale.svelte";
    import type { SensorState } from "$lib/wayfinding/walk-sensor";
    let {
        route,
        done = $bindable(0),
        following = null,
        pace = null,
        onward = 0,
        compact = false,
    }: {
        route: Route;
        /** Steps the visitor has ticked off, from the first. */
        done?: number;
        /** The phone following the visitor's walking, if it is trying to. */
        following?: SensorState | null;
        /** The visitor's own walking speed, m/s, once measured. */
        pace?: number | null;
        /** Metres walked into the current step, as the phone follows them. */
        onward?: number;
        /** Over the map on a phone: just the next thing to do, the whole list a tap away. */
        compact?: boolean;
    } = $props();
    const locale = useLocale();
    let steps = $derived(route.steps);
    let showAll = $state(false);
    let brief = $derived(compact && !showAll);
    /** On the way: the step being walked, the next thing to do, and how far off it is. */
    let current = $derived(steps[Math.min(done, steps.length - 1)]);
    let upcoming = $derived(steps[done + 1]);
    let toNext = $derived(Math.max(0, Math.round(current.meters - onward)));
    let left = $derived(Math.max(0, Math.round(progress(route, done).metersLeft - onward)));
    let list = $state<HTMLOListElement>();
    // Tapping a step ticks it off with those before it; tapping a ticked one takes it back.
    const mark = (i: number) => (done = i < done ? i : i + 1);
    // The step to do next stays in sight as steps are ticked off (not on opening: the list starts where it is).
    let shownDone = done;
    $effect(() => {
        if (done === shownDone) return;
        shownDone = done;
        list?.children[Math.min(done, steps.length - 1)]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
</script>

{#if brief}
    <div class="brief" aria-live="polite">
        {#if done >= steps.length}<p class="now arrived"><span class="glyph">⚑</span><b>{locale.t("stepsArrived")}</b></p>
        {:else}
            <!-- Tapping it says "done": on to the next step, as the full list does. -->
            <button class="now" onclick={() => mark(done)}>
                <span class="glyph">{stepGlyph(upcoming ?? current)}</span>
                <span class="what"
                    ><b>{stepText((upcoming ?? current).say, locale.lang)}</b>{#if upcoming}<em>{locale.t("nextIn", { m: toNext })}</em>{/if}
                    {#if upcoming && done === 0}<small>{stepText(current.say, locale.lang)}</small>{/if}</span
                >
            </button>
        {/if}
        <p class="meta">
            {#if following === "on" && done < steps.length}<span class="live"><i aria-hidden="true"></i>{locale.t("followShort")}</span>{/if}
            {#if done < steps.length}<span>{locale.t("metersLeft", { m: left })}{#if pace && left > 0}
                        · {locale.t("minutesLeft", { n: Math.max(1, Math.round(left / pace / 60)) })}{/if}</span
                >{/if}
            <button onclick={() => (showAll = true)}>{locale.t("allSteps", { n: steps.length })}</button>
        </p>
        {#if following === "denied" && done < steps.length}<p class="following">{locale.t("followOff")}</p>{/if}
    </div>
{:else}
<div class="progress" aria-live="polite">
    <span class="bar" style:--done={done / steps.length}></span>
    <p>
        {#if done >= steps.length}<b>{locale.t("stepsArrived")}</b>{:else if done}{locale.t("stepsProgress", {
                n: done + 1,
                total: steps.length,
                m: left,
            })}{:else if following !== "on"}{locale.t("stepsHint")}{/if}
        {#if done}<button onclick={() => (done = 0)}>{locale.t("stepsReset")}</button>{/if}
    </p>
    {#if following && done < steps.length}<p class="following" class:on={following === "on"}>
            {#if following === "on"}<i aria-hidden="true"></i>{locale.t("followOn")}{#if pace && left > 0}<br
                    />{locale.t("stepsPace", { n: Math.max(1, Math.round(left / pace / 60)) })}{/if}{:else if following === "asking"}{locale.t(
                    "followAsking",
                )}{:else if following === "denied"}{locale.t("followOff")}{/if}
        </p>{/if}
</div>
<ol class="route-steps" bind:this={list}>
    {#each steps as step, i}<li class:done={i < done} class:next={i === done}>
            <button aria-pressed={i < done} onclick={() => mark(i)}>
                <span class="glyph">{i < done ? "✓" : stepGlyph(step)}</span>
                <span class="step"
                    >{stepText(step.say, locale.lang)}{#if step.meters}<small>{step.meters} m</small>{/if}</span
                >
            </button>
        </li>{/each}
</ol>
{#if compact}<button class="fewer" onclick={() => (showAll = false)}>{locale.t("fewerSteps")}</button>{/if}
{/if}

<style>
    .progress {
        margin-top: 10px;
    }
    .bar {
        display: block;
        height: 4px;
        border-radius: 2px;
        background: linear-gradient(90deg, #3f8a52 calc(var(--done) * 100%), #e3e9dc 0);
        transition: background 300ms ease;
    }
    .progress p {
        display: flex;
        align-items: baseline;
        gap: 8px;
        margin: 6px 0 0;
        font-size: 11.5px;
        color: #6a7c62;
    }
    .progress b {
        color: #2f6b3a;
    }
    .progress p button {
        margin-left: auto;
        font-size: 11px;
        color: #4b6f53;
        text-decoration: underline;
    }
    .brief {
        margin-top: 8px;
    }
    .now {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        margin: 0;
        padding: 10px;
        border-radius: 12px;
        background: #eef5fb;
        color: #1f3326;
        font: inherit;
        text-align: left;
    }
    .now .glyph {
        width: 40px;
        height: 40px;
        font-size: 22px;
        background: #2f7fc4;
        color: white;
    }
    .now.arrived .glyph {
        background: #d24b3b;
    }
    .now b {
        font-size: 15px;
        line-height: 1.3;
    }
    .now em {
        display: block;
        font-style: normal;
        font-size: 13px;
        font-weight: 600;
        color: #2f7fc4;
    }
    .now small {
        display: block;
        margin-top: 2px;
        font-size: 11.5px;
        color: #6a7c62;
    }
    .meta {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 8px 2px 0;
        font-size: 11.5px;
        color: #6a7c62;
    }
    .meta button,
    .fewer {
        margin-left: auto;
        font-size: 11.5px;
        color: #4b6f53;
        text-decoration: underline;
    }
    .fewer {
        display: block;
        margin-top: 4px;
    }
    .live {
        color: #2f6b3a;
        white-space: nowrap;
    }
    .live i {
        display: inline-block;
        width: 7px;
        height: 7px;
        margin-right: 5px;
        border-radius: 50%;
        background: #3f8a52;
        animation: beat 1.6s ease-in-out infinite;
    }
    .following {
        margin: 6px 0 0;
        font-size: 11.5px;
        line-height: 1.45;
        color: #6a7c62;
    }
    .following.on {
        color: #2f6b3a;
    }
    .following i {
        display: inline-block;
        width: 7px;
        height: 7px;
        margin-right: 6px;
        border-radius: 50%;
        background: #3f8a52;
        vertical-align: 1px;
        animation: beat 1.6s ease-in-out infinite;
    }
    @keyframes beat {
        50% {
            opacity: 0.35;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .following i,
        .live i {
            animation: none;
        }
    }
    ol {
        list-style: none;
        margin: 6px 0 0;
        padding: 0;
    }
    li {
        border-bottom: 1px solid #eef2ea;
    }
    li:last-child {
        border-bottom: 0;
        font-weight: 600;
    }
    li button {
        display: flex;
        gap: 10px;
        width: 100%;
        padding: 8px 6px;
        border-radius: 8px;
        font: inherit;
        font-size: 12.5px;
        color: #2f4336;
        line-height: 1.4;
        text-align: left;
        transition: background 160ms ease;
    }
    li.next button {
        background: #eef5fb;
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
    li.done .glyph {
        background: #dff0dc;
        color: #2f6b3a;
    }
    li.done .step {
        color: #8a998a;
        text-decoration: line-through;
        text-decoration-color: #8a998a80;
    }
    .step small {
        display: block;
        color: #7b8c70;
        font-size: 11px;
        font-weight: 400;
        text-decoration: none;
    }
</style>
