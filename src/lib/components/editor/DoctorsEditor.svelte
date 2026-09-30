<script lang="ts">
    import { dateOf, MAX_DOCTORS, type Doctor, type Leave } from "$lib/model/doctors";
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
</script>

<div class="doctors-editor">
    <p class="hint">
        Practice schedules (jadwal praktik) shown to visitors with this place, and what the assistant answers
        from. Leave (cuti) hides those days and says when the doctor is back.
    </p>
    {#each doctors as d, i}<div class="doctor">
            <div class="head">
                <small>Doctor {i + 1}</small>
                <button class="remove" aria-label="Remove {d.name || `doctor ${i + 1}`}" onclick={() => onchange(doctors.filter((_, j) => j !== i))}
                    >×</button
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
        </div>{/each}
    <button
        class="btn add"
        disabled={doctors.length >= MAX_DOCTORS}
        onclick={() => onchange([...doctors, { name: "", hours: [{ days: [1, 2, 3, 4, 5], open: "08:00", close: "12:00" }] }])}
        >+ Add doctor</button
    >
</div>

<style>
    .hint {
        font-size: 11px;
        color: #738466;
        line-height: 1.5;
        margin: 0 0 10px;
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
    .head small {
        flex: 1;
        font-size: 10px;
        color: #738466;
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
        width: 100%;
        justify-content: center;
        font-size: 11px;
        margin-bottom: 8px;
    }
</style>
