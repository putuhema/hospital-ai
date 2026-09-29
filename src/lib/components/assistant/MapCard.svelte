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
    }: {
        /** What the assistant's show_on_map returned. */
        selection: MapSelection;
        /** The places on the map now, so the card follows the published layout. */
        places: Place[];
        /** Called when the card is followed, e.g. to close the chat on phones. */
        onshow?: () => void;
    } = $props();
    // The visitor's own clock, as on the place details; the badge waits for the browser.
    let now = $state<Date | null>(null);
    onMount(() => {
        now = new Date();
        const timer = setInterval(() => (now = new Date()), 30_000);
        return () => clearInterval(timer);
    });
    const locale = useLocale();
    let card = $derived(mapCard(selection, places, now ?? new Date(), locale.lang));
</script>

{#if card}<a
        class="map-card"
        href={card.href}
        data-sveltekit-replacestate
        data-sveltekit-noscroll
        onclick={() => onshow?.()}
    >
        <PlaceIcon of={card.place} size={36} />
        <span class="text">
            <b>{card.place.name}</b>
            <small>{card.detail}</small>
            {#if now && card.status}<small class="status" class:open={card.status.open}>{card.status.text}</small>{/if}
        </span>
        <span class="action">{card.action}</span>
    </a>{:else}<p class="map-card gone">{locale.t("placeGone")}</p>{/if}

<style>
    .map-card {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 12px;
        border: 1px solid #dfe6d8;
        border-radius: 14px;
        background: white;
        color: inherit;
        text-decoration: none;
        transition:
            transform 160ms cubic-bezier(0.23, 1, 0.32, 1),
            border-color 150ms;
    }
    .map-card:active {
        transform: scale(0.98);
    }
    .text {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-width: 0;
    }
    b {
        font-size: 14px;
        font-weight: 600;
        color: #1f3a2b;
    }
    small {
        font-size: 12px;
        color: #7b8c70;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .status {
        font-weight: 600;
        color: #b2442f;
    }
    .status.open {
        color: #2f7d44;
    }
    .action {
        flex-shrink: 0;
        padding: 7px 12px;
        border-radius: 16px;
        background: #0f6a73;
        color: white;
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
    }
    .gone {
        margin: 0;
        font-size: 13px;
        color: #7b8c70;
    }
    @media (hover: hover) and (pointer: fine) {
        .map-card:hover {
            border-color: #0f6a73;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .map-card {
            transition: none;
        }
    }
</style>
