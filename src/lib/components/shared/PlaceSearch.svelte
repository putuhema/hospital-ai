<script lang="ts">
    import type { Place } from "$lib/wayfinding/routing";
    import { search } from "$lib/wayfinding/search";
    import PlaceIcon from "./PlaceIcon.svelte";
    import { hoursStatus } from "$lib/model/place-info";
    import { useLocale } from "$lib/i18n/locale.svelte";
    let {
        places,
        value,
        label,
        placeholder,
        marker,
        onselect,
        onclear,
        clearLabel = "",
    }: {
        places: Place[];
        /** Text shown when not searching, e.g. the chosen place's name. */
        value: string;
        label: string;
        placeholder: string;
        marker: "start" | "end";
        onselect: (place: Place) => void;
        /** Forget the chosen place; a × shows in the field while one is chosen. */
        onclear?: () => void;
        clearLabel?: string;
    } = $props();
    const locale = useLocale();
    let query = $state(""),
        open = $state(false),
        highlighted = $state(0),
        input: HTMLInputElement;
    const id = `place-${Math.random().toString(36).slice(2)}`;
    let results = $derived(search(places, query).slice(0, 40));
    // The list only opens in the browser, so this is the visitor's own clock.
    const status = (p: Place) => (p.info ? hoursStatus(p.info, new Date()) : null);
    function choose(p: Place) {
        onselect(p);
        query = "";
        open = false;
        input.blur();
    }
    function key(e: KeyboardEvent) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            open = true;
            const n = results.length;
            if (n) highlighted = (highlighted + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
        } else if (e.key === "Enter" && open && results[highlighted]) {
            e.preventDefault();
            choose(results[highlighted].place);
        } else if (e.key === "Escape") {
            open = false;
            query = "";
        }
    }
</script>

<div class="place-search">
    <span class={`marker ${marker}`} aria-hidden="true"></span>
    <input
        bind:this={input}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-autocomplete="list"
        aria-activedescendant={open && results[highlighted]
            ? `${id}-${highlighted}`
            : undefined}
        placeholder={value || placeholder}
        class:filled={!!value}
        class:clearable={!!value && !!onclear}
        bind:value={query}
        onfocus={() => {
            open = true;
            highlighted = 0;
        }}
        oninput={() => {
            open = true;
            highlighted = 0;
        }}
        onblur={() => setTimeout(() => (open = false), 120)}
        onkeydown={key}
    />
    {#if open}<ul id={id} role="listbox" aria-label={label}>
            {#each results as { place: p, via }, i}<li
                    id={`${id}-${i}`}
                    role="option"
                    aria-selected={i === highlighted}
                    class:highlighted={i === highlighted}
                    onpointerdown={(e) => {
                        e.preventDefault();
                        choose(p);
                    }}
                    onpointerenter={() => (highlighted = i)}
                >
                    <PlaceIcon of={p} size={26} />
                    <span class="text"
                        ><b>{p.name}</b><small
                            >{#if via}<span class="via">{via}</span>{" · "}{/if}{locale.type(p.detail)}{p.building
                                ? ` · ${p.building}`
                                : ""}</small
                        ></span
                    >{#if status(p)}<em class:open={status(p)!.open}
                            >{locale.t(
                                status(p)!.open
                                    ? p.info?.visiting ? "visiting" : "open"
                                    : p.info?.visiting ? "noVisits" : "closed",
                            )}</em
                        >{/if}
                </li>{:else}<li class="none">
                    {locale.t(places.length ? "noMatches" : "emptyMap")}
                </li>{/each}
        </ul>{/if}
    {#if value && onclear && !query}<button
            type="button"
            class="clear-field"
            aria-label={clearLabel}
            title={clearLabel}
            onclick={() => {
                onclear();
                input.focus();
            }}
            ><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg
            ></button
        >{/if}
</div>

<style>
    .place-search {
        position: relative;
    }
    .clear-field {
        position: absolute;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        color: #6f7c69;
    }
    .clear-field:hover {
        background: #edf3e7;
    }
    .clear-field svg {
        fill: none;
        stroke: currentColor;
        stroke-width: 2.2;
        stroke-linecap: round;
    }
    .marker {
        position: absolute;
        left: 13px;
        top: 50%;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        transform: translateY(-50%);
        z-index: 1;
    }
    .marker.start {
        background: #2f7fc4;
        box-shadow: 0 0 0 3px #d7e8f6;
    }
    .marker.end {
        background: #d24b3b;
        border-radius: 50% 50% 50% 0;
        transform: translateY(-60%) rotate(-45deg);
    }
    input {
        width: 100%;
        padding: 12px 12px 12px 34px;
        border: 1px solid #d3ddca;
        border-radius: 10px;
        background: white;
        font: inherit;
        font-size: 13px;
        color: #243d2c;
    }
    input.clearable {
        padding-right: 40px;
    }
    input.filled::placeholder {
        color: #243d2c;
        font-weight: 600;
    }
    input:focus {
        outline: 2px solid #4f7d5c;
        outline-offset: 0;
        border-color: transparent;
    }
    ul {
        position: absolute;
        left: 0;
        right: 0;
        top: calc(100% + 4px);
        z-index: 20;
        max-height: 290px;
        overflow: auto;
        margin: 0;
        padding: 5px;
        list-style: none;
        background: white;
        border: 1px solid #d3ddca;
        border-radius: 10px;
        box-shadow: 0 12px 34px #1f35261f;
    }
    li {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 9px;
        border-radius: 7px;
        cursor: pointer;
    }
    li.highlighted {
        background: #edf3e7;
    }
    .via {
        color: #2f6b8f;
        font-weight: 600;
    }
    .text {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }
    b {
        font-size: 13px;
        font-weight: 600;
        color: #243d2c;
    }
    small {
        font-size: 11px;
        color: #7b8c70;
    }
    em {
        margin-left: auto;
        flex-shrink: 0;
        padding: 2px 7px;
        border-radius: 10px;
        font-size: 10px;
        font-style: normal;
        font-weight: 600;
        background: #fbe6e3;
        color: #9a3b2e;
    }
    em.open {
        background: #dff0dc;
        color: #2f6b3a;
    }
    @media (max-width: 700px) {
        /* Smaller text makes iOS zoom the page when the field is focused. */
        input {
            font-size: 16px;
            padding: 10px 12px 10px 34px;
        }
        li {
            padding: 11px 10px;
        }
    }
    .none {
        font-size: 12px;
        color: #7b8c70;
        cursor: default;
    }
</style>
