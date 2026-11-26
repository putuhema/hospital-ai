<script lang="ts">
    // The visitor's own queue number, followed live over the map: how many are before them, and when it's their turn.
    import { onMount } from "svelte";
    import { useLocale } from "$lib/i18n/locale.svelte";
    import { useMyTurn } from "$lib/my-turn.svelte";
    import { useLive } from "$lib/live.svelte";
    import { fresh, turnOf } from "$lib/model/live";
    import { useConvexClient } from "convex-svelte";
    import { alertSupport, startAlerts } from "$lib/turn-alerts";
    import { page } from "$app/state";
    let { onopen }: { /** Show the place the number was set on. */ onopen: (place: string) => void } = $props();
    const locale = useLocale();
    const t = locale.t;
    const mine = useMyTurn();
    const liveData = useLive();
    // Figures older than a few minutes don't count; the clock moves on even when SIMRS goes quiet.
    let now = $state(Date.now());
    onMount(() => {
        const timer = setInterval(() => (now = Date.now()), 15_000);
        return () => clearInterval(timer);
    });
    let ticket = $derived(mine?.ticket ?? null);
    let turn = $derived(ticket && turnOf(ticket, fresh(liveData(), now)));
    let soon = $derived(!!turn && (turn.state === "now" || (turn.state === "waiting" && turn.ahead <= 3)));
    const no = (n: number) => String(n).padStart(3, "0");
    let line = $derived.by(() => {
        if (!turn) return "";
        switch (turn.state) {
            case "waiting":
                return turn.ahead ? t("turnAhead", { n: turn.ahead }) : t("turnNext");
            case "now":
                return turn.counter ? t("turnNowCounter", { n: turn.counter }) : t("turnNow");
            case "passed":
                return t("turnPassed");
            case "missing":
                return t("turnMissing");
            default:
                return t("turnUnknown");
        }
    });
    // Alerts with the phone in a pocket: the server watches the number (turn-alerts.ts).
    const convex = useConvexClient();
    let support = $state<"yes" | "install" | "no">("no"),
        asking = $state(false),
        alertNote = $state("");
    onMount(() => (support = alertSupport()));
    async function remind() {
        if (!ticket || !mine) return;
        if (support === "install") return void (alertNote = t("alertInstall"));
        asking = true;
        const slug = page.params.slug;
        const result = await startAlerts(convex, slug, ticket, locale.lang);
        asking = false;
        if (result === "on") {
            mine.setAlerting(true);
            alertNote = "";
        } else alertNote = t(result === "denied" ? "alertDenied" : "alertFailed");
    }
    let canRemind = $derived(!!turn && (turn.state === "waiting" || turn.state === "unknown"));

    // A buzz when it gets close and when it's their turn, once each.
    let buzzed = "";
    $effect(() => {
        const step = turn?.state === "now" ? "now" : soon ? "soon" : "";
        if (!step || step === buzzed) return;
        buzzed = step;
        try {
            navigator.vibrate?.(step === "now" ? [300, 150, 300] : 200);
        } catch {
            // Not on this phone.
        }
    });
</script>

{#if ticket && turn}<div class="my-turn" class:soon class:now={turn.state === "now"} role="status" aria-live="polite">
        <button class="body" disabled={!ticket.place} onclick={() => ticket.place && onopen(ticket.place)}>
            <span class="no">{no(ticket.number)}</span>
            <span class="text">
                <small>{ticket.label ?? t("turnLoket")}</small>
                <b>{line}</b>
                {#if turn.state === "waiting" && turn.serving !== undefined}<em>{t("turnServing", { no: no(turn.serving) })}</em>{/if}
            </span>
        </button>
        {#if mine?.alerting}<button
                class="bell on"
                aria-label={t("alertOn")}
                title={t("alertOff")}
                onclick={() => mine?.setAlerting(false)}
                ><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
                    ><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5h4" /></svg
                ></button
            >{:else if support !== "no" && canRemind}<button class="bell" disabled={asking} onclick={remind}
                ><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
                    ><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5h4" /></svg
                ><span>{t("alertMe")}</span></button
            >{/if}
        <button class="stop" aria-label={t("turnStop")} title={t("turnStop")} onclick={() => mine?.clear()}
            ><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button
        >
    </div>
    {#if alertNote}<p class="alert-note" role="status">{alertNote}</p>{:else if mine?.alerting}<p class="alert-note">
            {t("alertOnNote")}
        </p>{/if}{/if}

<style>
    .my-turn {
        display: flex;
        align-items: stretch;
        max-width: 360px;
        border-radius: 16px;
        background: #fffdf8f2;
        box-shadow: 0 0 0 1px #dfe4d9;
        color: #1f3a2b;
    }
    .my-turn.soon {
        background: #fdf3df;
        box-shadow: 0 0 0 1.5px #d9a54a;
    }
    .my-turn.now {
        background: #2d4a38;
        color: white;
    }
    .body {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
        flex: 1;
        padding: 10px 6px 10px 12px;
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
    }
    .body:disabled {
        cursor: default;
    }
    .no {
        flex-shrink: 0;
        min-width: 52px;
        padding: 6px 8px;
        border-radius: 10px;
        background: #2d4a38;
        color: white;
        font-weight: 700;
        font-size: 18px;
        font-variant-numeric: tabular-nums;
        text-align: center;
    }
    .now .no {
        background: white;
        color: #2d4a38;
    }
    .text {
        display: flex;
        flex-direction: column;
        min-width: 0;
        line-height: 1.3;
    }
    .text small {
        overflow: hidden;
        font-size: 11px;
        white-space: nowrap;
        text-overflow: ellipsis;
        opacity: 0.75;
    }
    .text b {
        font-size: 14px;
    }
    .text em {
        font-style: normal;
        font-size: 12px;
        opacity: 0.8;
    }
    .bell {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
        margin: 8px 0;
        padding: 0 10px;
        border: 0;
        border-radius: 999px;
        background: #2d4a38;
        color: white;
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
    }
    .bell.on {
        padding: 0 8px;
        background: #e3ecdd;
        color: #2d4a38;
    }
    .now .bell {
        background: white;
        color: #2d4a38;
    }
    .bell:disabled {
        opacity: 0.6;
    }
    .bell svg {
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linejoin: round;
        stroke-linecap: round;
    }
    .alert-note {
        max-width: 360px;
        margin: 6px 0 0;
        padding: 6px 10px;
        border-radius: 10px;
        background: #fffdf8f2;
        box-shadow: 0 0 0 1px #dfe4d9;
        color: #4b5d47;
        font-size: 12px;
        line-height: 1.4;
    }
    .stop {
        flex-shrink: 0;
        width: 36px;
        border: 0;
        background: none;
        color: inherit;
        opacity: 0.6;
        cursor: pointer;
    }
    .stop svg {
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
    }
</style>
