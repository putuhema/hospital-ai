<script lang="ts">
    import { onMount } from "svelte";
    import { mapCard } from "$lib/assistant/cards";
    import type { MapSelection } from "$lib/assistant/tools";
    import type { Place } from "$lib/wayfinding/routing";
    import PlaceIcon from "$lib/components/shared/PlaceIcon.svelte";
    import { useLocale } from "$lib/i18n/locale.svelte";
    import { useLive } from "$lib/live.svelte";
    import { fresh } from "$lib/model/live";

    let {
        selection,
        places,
        onshow,
        shown = false,
        doctor,
        fromId = null,
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
        /** The visitor's current starting place id, to offer a direct route shortcut. */
        fromId?: string | null;
    } = $props();

    let now = $state<Date | null>(null);
    onMount(() => {
        now = new Date();
        const timer = setInterval(() => (now = new Date()), 30_000);
        return () => clearInterval(timer);
    });
    const locale = useLocale();
    const liveData = useLive();
    let card = $derived(mapCard(selection, places, now ?? new Date(), locale.lang, doctor));
    let canRoute = $derived(
        !!card && selection.kind === "place" && !!fromId && fromId !== selection.to,
    );
    // Live SIMRS queue or bed summary directly on the card when linked.
    let liveSummary = $derived.by(() => {
        if (!card?.place.info?.simrs?.length) return null;
        const snap = fresh(liveData(), (now ?? new Date()).getTime());
        if (!snap) return null;
        const codes = card.place.info.simrs;
        const poliCodes = codes.filter((c) => c.startsWith("poli:")).map((c) => c.slice(5));
        if (poliCodes.length) {
            const matched = snap.clinics.filter((c) => poliCodes.includes(c.code));
            if (matched.length) {
                const waiting = matched.reduce((n, c) => n + c.waiting, 0);
                const serving = matched.flatMap((c) => c.doctors).find((d) => d.serving)?.serving;
                const parts = [
                    ...(serving ? [locale.t("cardLiveServing", { no: serving })] : []),
                    locale.t("cardLiveWaiting", { n: waiting }),
                ];
                return parts.join(" · ");
            }
        }
        const wardCodes = codes.filter((c) => c.startsWith("ward:")).map((c) => c.slice(5));
        if (wardCodes.length) {
            const matched = snap.wards.filter((w) => wardCodes.includes(w.code));
            if (matched.length) {
                const empty = matched.reduce((n, w) => n + w.empty, 0);
                return locale.t("cardLiveBeds", { n: empty });
            }
        }
        return null;
    });
</script>

{#if card}
    <div class="map-card-wrap" class:shown>
        <a
            class="map-card"
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
                {#if now && card.status}
                    <small class="status" class:open={card.status.open}><i></i>{card.status.text}</small>
                {/if}
                {#if liveSummary}
                    <small class="live-chip"><i></i>{liveSummary}</small>
                {/if}
            </span>
            <span class="action">
                {#if shown}
                    <span class="live"></span>{locale.t("onMap")}
                {:else}
                    {card.action}<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                        <path d="M5 12h14m-6-6 6 6-6 6" />
                    </svg>
                {/if}
            </span>
        </a>
        {#if canRoute}
            <div class="card-footer">
                <a
                    class="route-shortcut"
                    href={`?from=${fromId}&to=${selection.to}`}
                    data-sveltekit-replacestate
                    data-sveltekit-noscroll
                    onclick={() => onshow?.()}
                >
                    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                        <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" />
                    </svg>
                    <span>{locale.t("startWalk")}</span>
                </a>
            </div>
        {/if}
    </div>
{:else}
    <p class="map-card-wrap gone">{locale.t("placeGone")}</p>
{/if}

<style>
    .map-card-wrap {
        border-radius: 16px;
        background: var(--card, #ffffff);
        overflow: hidden;
        box-shadow:
            0 0 0 1px var(--line, #e1e7dd),
            0 1px 2px rgba(26, 46, 35, 0.05),
            0 8px 24px -12px rgba(26, 46, 35, 0.18);
        transition:
            transform 180ms cubic-bezier(0.23, 1, 0.32, 1),
            box-shadow 180ms cubic-bezier(0.23, 1, 0.32, 1);
    }
    .map-card-wrap.shown {
        box-shadow:
            0 0 0 1.5px var(--forest, #1e4031),
            0 10px 28px -12px rgba(30, 64, 49, 0.32);
    }
    .map-card {
        position: relative;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px;
        color: inherit;
        text-decoration: none;
    }
    .map-card:active {
        transform: scale(0.99);
    }
    .plate {
        display: grid;
        place-items: center;
        flex-shrink: 0;
        width: 46px;
        height: 46px;
        border-radius: 12px;
        background: var(--paper-2, #eef2eb);
    }
    .text {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }
    b {
        font-family: var(--display, var(--font-serif, Georgia, serif));
        font-size: 16px;
        font-weight: 560;
        font-variation-settings: "opsz" 24;
        letter-spacing: -0.01em;
        color: var(--ink, #1a2e23);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    small {
        font-size: 12.5px;
        color: var(--muted, #66786b);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .status {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-weight: 600;
        color: #b44332;
    }
    .status i {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: currentColor;
    }
    .status.open {
        color: #2a7d4f;
    }
    .live-chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        margin-top: 2px;
        font-size: 11.5px;
        font-weight: 600;
        color: var(--forest, #1e4031);
    }
    .live-chip i {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #2a7d4f;
    }
    .action {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
        height: 34px;
        padding: 0 12px 0 14px;
        border-radius: 10px;
        background: var(--forest, #1e4031);
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
        color: var(--forest, #1e4031);
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
    .card-footer {
        display: flex;
        border-top: 1px solid var(--line, #e1e7dd);
        background: var(--surface-subtle, #f9faf7);
    }
    .route-shortcut {
        flex: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 8px 12px;
        font-size: 12.5px;
        font-weight: 600;
        color: var(--forest, #1e4031);
        text-decoration: none;
        transition: background-color 150ms ease;
    }
    .route-shortcut:hover {
        background: var(--accent-soft, #e6efe9);
    }
    .route-shortcut svg {
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
    }
    .gone {
        margin: 0;
        padding: 12px 14px;
        font-size: 13px;
        color: var(--muted, #66786b);
    }
    @media (hover: hover) and (pointer: fine) {
        .map-card-wrap:hover {
            box-shadow:
                0 0 0 1px rgba(26, 46, 35, 0.16),
                0 14px 30px -14px rgba(26, 46, 35, 0.25);
        }
        .map-card:hover .action svg {
            transform: translateX(3px);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .map-card-wrap,
        .action svg {
            transition: none;
        }
        .live {
            animation: none;
        }
    }
</style>
