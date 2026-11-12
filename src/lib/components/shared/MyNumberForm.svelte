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
    {#if !open}<button class="mine" onclick={() => (open = true)}>{locale.t("myNumber")}</button>
    {:else}<form class="mine-form" onsubmit={follow}>
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
    }
    .mine-form {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: 8px;
        margin-top: 8px;
        padding: 10px;
        border-radius: 8px;
        background: #f3f8f0;
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
