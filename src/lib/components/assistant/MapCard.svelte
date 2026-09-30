<script lang="ts">
    import { onMount } from "svelte";
    import { mapCard } from "$lib/assistant/cards";
    import type { MapSelection } from "$lib/assistant/tools";
    import type { Place } from "$lib/wayfinding/routing";
    import PlaceIcon from "$lib/components/shared/PlaceIcon.svelte";
    import { useLocale } from "$lib/i18n/locale.svelte";
    let {
        selection,
        places,
        onshow,
        shown = false,
        doctor,
    }: {
        /** What the assistant's show_on_map returned. */
        selection: MapSelection;
        /** The places on the map now, so the card follows the saved layout. */
        places: Place[];
        /** Called when the card is followed, e.g. to close the chat on phones. */
        onshow?: () => void;
        /** This place or route is the one on the map now. */
        shown?: boolean;
        /** The card is about this doctor, who practises there: it shows their schedule. */
        doctor?: string;
    } = $props();
    // The visitor's own clock, as on the place details; the badge waits for the browser.
    let now = $state<Date | null>(null);
    onMount(() => {
        now = new Date();
        const timer = setInterval(() => (now = new Date()), 30_000);
        return () => clearInterval(timer);
    });
    const locale = useLocale();
    let card = $derived(mapCard(selection, places, now ?? new Date(), locale.lang, doctor));
</script>

{#if card}<a
        class="map-card"
        class:shown
        href={card.href}
        data-sveltekit-replacestate
        data-sveltekit-noscroll
        onclick={() => onshow?.()}
    >
        <span class="plate"><PlaceIcon of={card.place} size={34} /></span>
        <span class="text">
            <b>{card.place.name}</b>
            <small>{card.detail}</small>
            {#if card.schedule}<small>{card.schedule}</small>{/if}
            {#if now && card.status}<small class="status" class:open={card.status.open}><i></i>{card.status.text}</small>{/if}
        </span>
        <span class="action"
            >{#if shown}<span class="live"></span>{locale.t("onMap")}{:else}{card.action}<svg
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg
                >{/if}</span
        >
    </a>{:else}<p class="map-card gone">{locale.t("placeGone")}</p>{/if}

<style>
    /* A card reads like a hospital direction sign: a plate with the place's
       mark, its name, and where the arrow leads. */
    .map-card {
        position: relative;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 10px 10px 10px;
        border-radius: 16px;
        background: var(--card, #fffdf8);
        color: inherit;
        text-decoration: none;
        box-shadow:
            0 0 0 1px var(--line, #1d2b2214),
            0 1px 2px #1d2b220a,
            0 8px 24px -12px #1d2b2233;
        transition:
            transform 180ms cubic-bezier(0.23, 1, 0.32, 1),
            box-shadow 180ms cubic-bezier(0.23, 1, 0.32, 1);
    }
    .map-card:active {
        transform: scale(0.985);
    }
    .map-card.shown {
        box-shadow:
            0 0 0 1.5px var(--forest, #24473a),
            0 10px 28px -12px #24473a55;
    }
    .plate {
        display: grid;
        place-items: center;
        flex-shrink: 0;
        width: 46px;
        height: 46px;
        border-radius: 12px;
        background: var(--paper-2, #efeadc);
    }
    .text {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }
    b {
        font-family: var(--display, Georgia, serif);
        font-size: 16.5px;
        font-weight: 560;
        font-variation-settings: "opsz" 24;
        letter-spacing: -0.005em;
        color: var(--ink, #1d2b22);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    small {
        font-size: 12.5px;
        color: var(--muted, #7d8a7c);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .status {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-weight: 600;
        color: #b4472c;
    }
    .status i {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: currentColor;
    }
    .status.open {
        color: #2e7a47;
    }
    .action {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
        height: 34px;
        padding: 0 12px 0 14px;
        border-radius: 10px;
        background: var(--forest, #24473a);
        color: #f6f3ea;
        font-size: 12.5px;
        font-weight: 600;
        white-space: nowrap;
    }
    .action svg {
        fill: none;
        stroke: currentColor;
        stroke-width: 2.4;
        stroke-linecap: round;
        stroke-linejoin: round;
        transition: transform 200ms cubic-bezier(0.23, 1, 0.32, 1);
    }
    .shown .action {
        padding: 0 12px;
        background: transparent;
        color: var(--forest, #24473a);
    }
    .live {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--signal, #e0663d);
        box-shadow: 0 0 0 0 #e0663d88;
        animation: live 1.8s cubic-bezier(0.23, 1, 0.32, 1) infinite;
    }
    @keyframes live {
        70% {
            box-shadow: 0 0 0 8px #e0663d00;
        }
        100% {
            box-shadow: 0 0 0 0 #e0663d00;
        }
    }
    .gone {
        margin: 0;
        padding: 12px 14px;
        font-size: 13px;
        color: var(--muted, #7d8a7c);
    }
    @media (hover: hover) and (pointer: fine) {
        .map-card:hover {
            box-shadow:
                0 0 0 1px #1d2b2226,
                0 14px 30px -14px #1d2b2244;
        }
        .map-card:hover .action svg {
            transform: translateX(3px);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .map-card,
        .action svg {
            transition: none;
        }
        .live {
            animation: none;
        }
    }
</style>
