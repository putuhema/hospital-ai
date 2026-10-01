<script lang="ts">
    import { dateOf, MAX_DOCTORS, shortDate, specialtyOf, type Doctor, type Leave } from "$lib/model/doctors";
    import { hoursLines } from "$lib/model/hours";
    import HoursRules from "./HoursRules.svelte";
    let {
        doctors,
        onchange,
    }: {
        /** The doctors who practise at one clinic, room or building. */
        doctors: Doctor[];
        /** As edited; blank names are dropped when the layout is loaded. */
        onchange: (doctors: Doctor[]) => void;
    } = $props();
    const set = (i: number, patch: Partial<Doctor>) =>
        onchange(doctors.map((d, j) => (j === i ? { ...d, ...patch } : d)));
    const setLeave = (i: number, k: number, patch: Partial<Leave>) =>
        set(i, { leave: (doctors[i].leave ?? []).map((l, j) => (j === k ? fixed({ ...l, ...patch }) : l)) });
    /** A leave never ends before it starts. */
    const fixed = (l: Leave): Leave => (l.to < l.from ? { from: l.from, to: l.from } : l);
    function addLeave(i: number) {
        const today = dateOf(new Date());
        set(i, { leave: [...(doctors[i].leave ?? []), { from: today, to: today }] });
    }
    // One doctor is open for editing at a time; the others are a line each.
    let open = $state<number | null>(null);
    const today = dateOf(new Date());
    /** Leave that hasn't ended, e.g. "Leave 3 Oct – 5 Oct". */
    function leaveNote(d: Doctor) {
        const next = d.leave?.find((l) => l.to >= today);
        if (!next) return "";
        return `Leave ${shortDate(next.from, "en")}${next.to === next.from ? "" : ` – ${shortDate(next.to, "en")}`}`;
    }
    function add() {
        onchange([...doctors, { name: "", hours: [{ days: [1, 2, 3, 4, 5], open: "08:00", close: "12:00" }] }]);
        open = doctors.length;
    }
</script>

<div class="doctors-editor">
    {#each doctors as d, i}{#if open !== i}<button class="summary" aria-expanded="false" onclick={() => (open = i)}>
                <b>{d.name || "New doctor"}</b>
                <span
                    >{[specialtyOf(d), hoursLines(d.hours).join(", ") || "No practice hours"].filter(Boolean).join(" · ")}</span
                >
                {#if leaveNote(d)}<em>{leaveNote(d)}</em>{/if}
            </button>{:else}<div class="doctor">
            <div class="head">
                <button class="done" aria-expanded="true" onclick={() => (open = null)}>Done</button>
                <button
                    class="remove"
                    aria-label="Remove {d.name || `doctor ${i + 1}`}"
                    onclick={() => {
                        onchange(doctors.filter((_, j) => j !== i));
                        open = null;
                    }}>×</button
                >
            </div>
            <input
                aria-label="Doctor {i + 1} name"
                maxlength="100"
                placeholder="e.g. dr. Sari Wijaya, Sp.A"
                value={d.name}
                onchange={(e) => set(i, { name: e.currentTarget.value })}
            /><input
                aria-label="Doctor {i + 1} specialty"
                maxlength="100"
                placeholder="Specialty (poli), e.g. Anak"
                value={d.specialty ?? ""}
                onchange={(e) => set(i, { specialty: e.currentTarget.value || undefined })}
            />
            <HoursRules hours={d.hours} label="practice hours" onchange={(hours) => set(i, { hours })} />
            {#each d.leave ?? [] as l, k}<div class="leave">
                    <span>Leave</span><input
                        type="date"
                        aria-label="Leave from"
                        value={l.from}
                        onchange={(e) => e.currentTarget.value && setLeave(i, k, { from: e.currentTarget.value })}
                    /><span>–</span><input
                        type="date"
                        aria-label="Leave until"
                        min={l.from}
                        value={l.to}
                        onchange={(e) => e.currentTarget.value && setLeave(i, k, { to: e.currentTarget.value })}
                    /><button
                        class="remove"
                        aria-label="Remove this leave"
                        onclick={() => set(i, { leave: (d.leave ?? []).filter((_, j) => j !== k) })}>×</button
                    >
                </div>{/each}
            <button class="link" disabled={(d.leave?.length ?? 0) >= 20} onclick={() => addLeave(i)}>+ Add leave (cuti)</button>
        </div>{/if}{/each}
    <button class="link add" disabled={doctors.length >= MAX_DOCTORS} onclick={add}>+ Add doctor</button>
</div>

<style>
    .summary {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 2px 10px;
        width: 100%;
        padding: 8px 10px;
        margin-bottom: 4px;
        border: 1px solid #e4e9de;
        border-radius: 8px;
        background: white;
        text-align: left;
    }
    .summary:hover {
        border-color: #c9d4bf;
    }
    .summary b {
        font-size: 12px;
        font-weight: 600;
        color: #2c3d2f;
    }
    .summary span {
        grid-column: 1;
        font-size: 11px;
        color: #738466;
    }
    .summary em {
        grid-column: 2;
        grid-row: 1 / span 2;
        align-self: center;
        font-style: normal;
        font-size: 10px;
        padding: 2px 7px;
        border-radius: 10px;
        background: #fff2dd;
        color: #785e33;
    }
    .doctor {
        border: 1px solid #dfe6d8;
        border-radius: 8px;
        padding: 8px;
        margin-bottom: 8px;
        background: #fbfcf8;
    }
    .head {
        display: flex;
        align-items: center;
    }
    .done {
        flex: 1;
        text-align: left;
        font-size: 11px;
        font-weight: 600;
        color: #3f6b4e;
    }
    input {
        display: block;
        width: 100%;
        padding: 7px;
        border: 1px solid #dce3d4;
        border-radius: 5px;
        margin: 5px 0;
        background: white;
        font: inherit;
        font-size: 12px;
    }
    input[aria-label$="name"] {
        font-weight: 600;
    }
    .leave {
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 11px;
        color: #738466;
    }
    .leave input {
        min-width: 0;
        margin: 3px 0;
    }
    .remove {
        flex-shrink: 0;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        color: #9a4d3c;
        font-size: 15px;
    }
    .link {
        padding: 4px 0;
        font-size: 11px;
        color: #3f6b4e;
    }
    .add {
        margin-top: 2px;
    }
</style>
