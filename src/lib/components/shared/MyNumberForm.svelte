<script lang="ts">
    // "Nomor saya": the visitor types the number on their ticket and the map follows it (MyTurnBanner).
    import { useLocale } from "$lib/i18n/locale.svelte";
    import { useMyTurn } from "$lib/my-turn.svelte";
    import type { ClinicLive } from "$lib/model/live";
    let {
        clinic,
        place,
    }: {
        /** A clinic's queue; without one, the registration counters'. */
        clinic?: ClinicLive;
        /** The map place it is set on. */
        place?: string;
    } = $props();
    const locale = useLocale();
    const turn = useMyTurn();
    let open = $state(false),
        number = $state(""),
        doctor = $state("");
    // Doctors with patients today, the one calling numbers first.
    let doctors = $derived(
        (clinic?.doctors ?? []).filter((d) => d.registered).sort((a, b) => Number(!!b.serving) - Number(!!a.serving)),
    );
    let chosen = $derived(doctors.find((d) => d.code === doctor) ?? doctors[0]);
    let value = $derived(Number.parseInt(number, 10));
    let valid = $derived(Number.isInteger(value) && value > 0 && value < 100_000 && (!clinic || !!chosen));
    function follow(e: SubmitEvent) {
        e.preventDefault();
        if (!turn || !valid) return;
        if (clinic && chosen)
            turn.set({ kind: "poli", clinic: clinic.code, doctor: chosen.code, number: value, place, label: `${clinic.name} · ${chosen.name}` });
        else turn.set({ kind: "loket", number: value, place, label: locale.t("turnLoket") });
        open = false;
        number = "";
    }
</script>

{#if turn && (!clinic || doctors.length)}
    {#if !open}<button
            type="button"
            class="mine"
            aria-label={clinic ? `${locale.t("myNumber")} (${clinic.name})` : locale.t("myNumber")}
            onclick={() => (open = true)}
        >
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"
                ><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg
            >
            {locale.t("myNumber")}
        </button>
    {:else}<form class="mine-form" onsubmit={follow}>
            <div class="mine-head">
                <b>{clinic ? clinic.name : locale.t("turnLoket")}</b>
                <button
                    type="button"
                    class="mine-close"
                    aria-label={locale.t("close")}
                    onclick={() => {
                        open = false;
                        number = "";
                    }}
                    ><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button
                >
            </div>
            {#if doctors.length > 1}<label
                    >{locale.t("myNumberDoctor")}<select bind:value={doctor}>
                        {#each doctors as d (d.code)}<option value={d.code}>{d.name}</option>{/each}
                    </select></label
                >{/if}
            <label
                >{locale.t("myNumberLabel")}<input
                    inputmode="numeric"
                    pattern="[0-9]*"
                    maxlength="5"
                    autocomplete="off"
                    placeholder="012"
                    bind:value={number}
                /></label
            >
            <button class="go" disabled={!valid}>{locale.t("myNumberFollow")}</button>
            <small>{locale.t("myNumberHint")}</small>
        </form>{/if}
{/if}

<style>
    .mine {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        align-self: flex-start;
        margin-top: 8px;
        padding: 6px 12px;
        border: 1px solid #cfdcc9;
        border-radius: 20px;
        background: #f3f8f0;
        color: #2f6b3a;
        font: inherit;
        font-weight: 600;
        font-size: 12px;
        cursor: pointer;
        transition: background 120ms ease, border-color 120ms ease;
    }
    .mine:hover {
        background: #e6f2e2;
        border-color: #b7ccb0;
    }
    .mine svg {
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
        flex-shrink: 0;
    }
    .mine-form {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: 8px;
        margin-top: 8px;
        padding: 10px;
        border: 1px solid #d5e2cf;
        border-radius: 10px;
        background: #f3f8f0;
    }
    .mine-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-basis: 100%;
    }
    .mine-head b {
        font-size: 12px;
        font-weight: 600;
        color: #1f3a2b;
    }
    .mine-close {
        display: grid;
        place-items: center;
        width: 24px;
        height: 24px;
        padding: 0;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: #6a7a66;
        cursor: pointer;
    }
    .mine-close:hover {
        background: #1b2a2112;
        color: #1f3a2b;
    }
    .mine-close svg {
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
    }
    .mine-form label {
        display: flex;
        flex-direction: column;
        gap: 3px;
        font-size: 10.5px;
        color: #6a7a66;
    }
    .mine-form label:has(select) {
        flex-basis: 100%;
    }
    /* 16px, so phones don't zoom in on the field. */
    .mine-form input,
    .mine-form select {
        padding: 7px 9px;
        border: 1px solid #cfdcc9;
        border-radius: 6px;
        background: white;
        font: inherit;
        font-size: 16px;
        color: #1f3a2b;
    }
    .mine-form input {
        width: 92px;
    }
    .go {
        padding: 8px 16px;
        border: 0;
        border-radius: 6px;
        background: #2d4a38;
        color: white;
        font: inherit;
        font-weight: 600;
        font-size: 13px;
        cursor: pointer;
    }
    .go:disabled {
        opacity: 0.45;
        cursor: default;
    }
    .mine-form small {
        flex-basis: 100%;
        font-size: 10.5px;
        color: #7b8c70;
    }
</style>
