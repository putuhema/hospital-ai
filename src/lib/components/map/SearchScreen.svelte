<script lang="ts">
    import { onMount } from "svelte";
    import { fade } from "svelte/transition";
    import type { Place } from "$lib/wayfinding/routing";
    import { search } from "$lib/wayfinding/search";
    import type { Shortcut } from "$lib/wayfinding/shortcuts";
    import { hoursStatus } from "$lib/model/place-info";
    import PlaceIcon from "$lib/components/shared/PlaceIcon.svelte";
    import { easeOut, motion, rise } from "$lib/motion";
    let {
        places,
        title,
        shortcuts,
        onselect,
        onshortcut,
        onclose,
    }: {
        places: Place[];
        title: string;
        /** Kinds of place to jump to, e.g. the nearest toilet. */
        shortcuts: Shortcut[];
        onselect: (place: Place) => void;
        onshortcut: (detail: string) => void;
        onclose: () => void;
    } = $props();
    let query = $state(""),
        input: HTMLInputElement;
    // Results cascade in when the screen opens, but not on every keystroke.
    let opening = $state(true);
    let results = $derived(search(places, query).slice(0, 60));
    const now = new Date();
    const status = (p: Place) => (p.info ? hoursStatus(p.info, now) : null);
    onMount(() => {
        input.focus();
        const timer = setTimeout(() => (opening = false), 450);
        return () => clearTimeout(timer);
    });
</script>

<div
    class="search-screen"
    role="dialog"
    aria-label="Search places"
    in:fade={{ duration: motion(180), easing: easeOut }}
    out:fade={{ duration: motion(140) }}
>
    <div class="bar" in:rise={{ y: -6, duration: 260 }}>
        <button class="round" aria-label="Back to the map" onclick={onclose}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"
                ><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg
            >
        </button>
        <input
            bind:this={input}
            bind:value={query}
            type="search"
            enterkeyhint="search"
            autocomplete="off"
            aria-label="Search rooms and buildings"
            placeholder={`Search ${title}`}
            onkeydown={(e) => {
                if (e.key === "Escape") onclose();
                else if (e.key === "Enter" && results[0]) onselect(results[0].place);
            }}
        />
        {#if query}<button class="round" aria-label="Clear search" onclick={() => ((query = ""), input.focus())}
                >×</button
            >{/if}
    </div>
    {#if !query && shortcuts.length}<div class="chips">
            {#each shortcuts as s}<button class="chip" onclick={() => onshortcut(s.name)}
                    ><PlaceIcon of={{ ...s, detail: s.name }} size={22} />{s.name}</button
                >{/each}
        </div>{/if}
    <ul role="listbox" aria-label="Places">
        {#if !query}<li class="heading">Places in {title}</li>{/if}
        {#each results as { place: p, via }, i (p.id)}<li
                role="option"
                aria-selected="false"
                in:rise={{ delay: Math.min(i, 10) * 30, duration: opening ? 320 : 0 }}
            >
                <button onclick={() => onselect(p)}>
                    <PlaceIcon of={p} />
                    <span class="text"
                        ><b>{p.name}</b><small
                            >{#if via}<span class="via">{via}</span>{" · "}{/if}{p.detail}{p.building
                                ? ` · ${p.building}`
                                : ""}</small
                        ></span
                    >
                    {#if status(p)}<em class:open={status(p)!.open}>{status(p)!.open ? "Open" : "Closed"}</em>{/if}
                </button>
            </li>{:else}<li class="none">
                {places.length ? `Nothing matches “${query}”` : "Add buildings and rooms in the editor first"}
            </li>{/each}
    </ul>
</div>

<style>
    .search-screen {
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
        gap: 4px;
        margin: 10px 12px 6px;
        padding: 4px;
        border-radius: 28px;
        background: #f1f4ee;
    }
    .bar input {
        flex: 1;
        height: 44px;
        border: 0;
        background: none;
        font-size: 16px; /* smaller zooms the page on iOS */
        color: #1f3a2b;
    }
    .bar input::-webkit-search-cancel-button {
        display: none;
    }
    .round {
        display: grid;
        place-items: center;
        width: 44px;
        height: 44px;
        flex-shrink: 0;
        border-radius: 50%;
        font-size: 22px;
        color: #3d5243;
        transition:
            transform 160ms var(--ease-out),
            background 150ms;
    }
    .round:active {
        transform: scale(0.94);
    }
    .chips {
        display: flex;
        gap: 8px;
        overflow-x: auto;
        padding: 6px 12px 10px;
        scrollbar-width: none;
    }
    .chips::-webkit-scrollbar {
        display: none;
    }
    ul {
        flex: 1;
        overflow: auto;
        overscroll-behavior: contain;
        margin: 0;
        padding: 0 0 calc(env(safe-area-inset-bottom) + 16px);
        list-style: none;
        border-top: 1px solid #eef2ea;
    }
    .heading {
        padding: 16px 20px 6px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.6px;
        text-transform: uppercase;
        color: #7b8c70;
    }
    li button {
        display: flex;
        align-items: center;
        gap: 14px;
        width: 100%;
        padding: 12px 20px;
        text-align: left;
        border-radius: 0;
    }
    li button:active {
        background: #f1f5ed;
    }
    .via {
        color: #0f6a73;
        font-weight: 600;
    }
    .text {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }
    .text b,
    .text small {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    b {
        font-size: 15px;
        font-weight: 600;
        color: #1f3a2b;
    }
    small {
        font-size: 13px;
        color: #7b8c70;
    }
    em {
        margin-left: auto;
        flex-shrink: 0;
        padding: 3px 9px;
        border-radius: 12px;
        font-size: 11px;
        font-style: normal;
        font-weight: 600;
        background: #fbe6e3;
        color: #9a3b2e;
    }
    em.open {
        background: #dff0dc;
        color: #2f6b3a;
    }
    .none {
        padding: 24px 20px;
        font-size: 14px;
        color: #7b8c70;
    }
</style>
