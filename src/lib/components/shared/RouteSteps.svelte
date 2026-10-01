<script lang="ts">
    import { progress, stepGlyph, stepText, type Route } from "$lib/wayfinding/routing";
    import { useLocale } from "$lib/i18n/locale.svelte";
    let {
        route,
        done = $bindable(0),
    }: {
        route: Route;
        /** Steps the visitor has ticked off, from the first. */
        done?: number;
    } = $props();
    const locale = useLocale();
    let steps = $derived(route.steps);
    let left = $derived(progress(route, done).metersLeft);
    let list: HTMLOListElement;
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

<div class="progress" aria-live="polite">
    <span class="bar" style:--done={done / steps.length}></span>
    <p>
        {#if done >= steps.length}<b>{locale.t("stepsArrived")}</b>{:else if done}{locale.t("stepsProgress", {
                n: done + 1,
                total: steps.length,
                m: left,
            })}{:else}{locale.t("stepsHint")}{/if}
        {#if done}<button onclick={() => (done = 0)}>{locale.t("stepsReset")}</button>{/if}
    </p>
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
