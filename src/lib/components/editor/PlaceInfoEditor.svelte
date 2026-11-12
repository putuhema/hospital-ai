<script lang="ts">
    import { DAY_NAMES, hoursStatus, parseInfo, type Hours, type PlaceInfo } from "$lib/model/place-info";
    import { clinicKey, COUNTER_KEY, MAX_LINKS, wardKey } from "$lib/model/live";
    import { useLive } from "$lib/live.svelte";
    let {
        info,
        onchange,
    }: {
        info: PlaceInfo | undefined;
        /** The tidied details, or undefined when everything is empty. */
        onchange: (info: PlaceInfo | undefined) => void;
    } = $props();
    let hours = $derived(info?.hours ?? []);
    let status = $derived(info && hoursStatus(info, new Date()));
    // Monday first, as the hours read on the map.
    const week = [1, 2, 3, 4, 5, 6, 0];
    const set = (patch: Partial<PlaceInfo>) => onchange(parseInfo({ ...info, ...patch }));
    const setRule = (i: number, patch: Partial<Hours>) =>
        set({ hours: hours.map((h, j) => (j === i ? { ...h, ...patch } : h)) });
    function toggleDay(i: number, day: number) {
        const days = hours[i].days.includes(day) ? hours[i].days.filter((d) => d !== day) : [...hours[i].days, day];
        // A rule without days is meaningless; remove it instead.
        if (days.length) setRule(i, { days });
    }
    // The clinics and wards the SIMRS bridge reports; a place linked to one shows its queue or beds live.
    const live = useLive();
    let links = $derived(info?.simrs ?? []);
    let sources = $derived([
        ...(live()?.clinics ?? []).map((c) => ({ key: clinicKey(c.code), name: c.name, kind: "Clinic queue" })),
        ...(live()?.wards ?? []).map((w) => ({ key: wardKey(w.code), name: w.name, kind: "Ward beds" })),
        ...(live()?.counter ? [{ key: COUNTER_KEY, name: "Registration counters (loket)", kind: "Counter queue" }] : []),
    ]);
    const source = (key: string) => sources.find((s) => s.key === key);
</script>

<div class="place-info">
    <p class="hint">Shown to visitors when they choose this destination.</p>
    <label
        >Description<textarea
            rows="2"
            maxlength="500"
            placeholder="e.g. Adult inpatient ward, 2 visitors per bed"
            value={info?.description ?? ""}
            onchange={(e) => set({ description: e.currentTarget.value })}
        ></textarea></label
    >
    <label
        >Other names<textarea
            rows="2"
            placeholder={"One per line, e.g.\nX-ray\nPoli Anak\nRuang laktasi"}
            value={info?.keywords?.join("\n") ?? ""}
            onchange={(e) => set({ keywords: e.currentTarget.value.split("\n").slice(0, 40).map((k) => k.slice(0, 80)) })}
        ></textarea></label
    >
    <p class="hint tight">
        Visitors who search for these find this place. Doctors and their schedules are on
        <a href="/editor/info#doctors">Hospital info</a>{info?.doctors?.length ? ` (${info.doctors.length} here)` : ""}.
    </p>
    <label
        >Phone<input
            type="tel"
            maxlength="40"
            placeholder="e.g. +62 361 123 456"
            value={info?.phone ?? ""}
            onchange={(e) => set({ phone: e.currentTarget.value })}
        /></label
    >
    <div class="simrs">
        <span class="title">Live from SIMRS</span>
        {#each links as key (key)}<div class="link">
                <span><b>{source(key)?.name ?? key}</b> · {source(key)?.kind ?? "not reported by SIMRS now"}</span>
                <button class="remove" aria-label="Stop showing this" onclick={() => set({ simrs: links.filter((k) => k !== key) })}
                    >×</button
                >
            </div>{/each}
        {#if sources.length}<select
                aria-label="Show a clinic's queue or a ward's beds here"
                disabled={links.length >= MAX_LINKS}
                onchange={(e) => {
                    if (e.currentTarget.value) set({ simrs: [...links, e.currentTarget.value] });
                    e.currentTarget.value = "";
                }}
            >
                <option value="">+ Show a clinic's queue or a ward's beds…</option>
                {#each [["Counter queue", "Registration"], ["Clinic queue", "Clinics (today's queue)"], ["Ward beds", "Wards (beds)"]] as [kind, label]}<optgroup {label}>
                        {#each sources.filter((s) => s.kind === kind && !links.includes(s.key)) as s (s.key)}<option value={s.key}
                                >{s.name}</option
                            >{/each}
                    </optgroup>{/each}
            </select>{:else}<p class="hint">
                Nothing from SIMRS yet. Once the bridge at the hospital is running, its clinics and wards are listed here.
            </p>{/if}
    </div>
    <div class="kind" role="group" aria-label="Kind of hours">
        {#each [[false, "Opening hours"], [true, "Visiting hours"]] as const as [visiting, label]}<button
                class:active={!!info?.visiting === visiting}
                aria-pressed={!!info?.visiting === visiting}
                onclick={() => set({ visiting })}>{label}</button
            >{/each}
    </div>
    {#each hours as h, i}<div class="rule">
            <div class="days" role="group" aria-label="Days">
                {#each week as d}<button
                        class:active={h.days.includes(d)}
                        aria-pressed={h.days.includes(d)}
                        aria-label={DAY_NAMES[d]}
                        onclick={() => toggleDay(i, d)}>{DAY_NAMES[d].slice(0, 2)}</button
                    >{/each}
            </div>
            <div class="times">
                <input
                    type="time"
                    aria-label="Opens"
                    value={h.open}
                    onchange={(e) => e.currentTarget.value && setRule(i, { open: e.currentTarget.value })}
                /><span>–</span><input
                    type="time"
                    aria-label="Closes"
                    value={h.close}
                    onchange={(e) => e.currentTarget.value && setRule(i, { close: e.currentTarget.value })}
                /><button
                    class="remove"
                    aria-label="Remove these hours"
                    onclick={() => set({ hours: hours.filter((_, j) => j !== i) })}>×</button
                >
            </div>
        </div>{/each}
    <button
        class="btn add"
        disabled={hours.length >= 14}
        onclick={() => set({ hours: [...hours, { days: [1, 2, 3, 4, 5], open: "08:00", close: "17:00" }] })}
        >+ Add {info?.visiting ? "visiting" : "opening"} hours</button
    >
    {#if hours.length}<p class="hint">
            A closing time at or before the opening time runs past midnight; 00:00–00:00 is 24 hours.
            {#if status}<br />Right now: <b>{status.text}</b>{/if}
        </p>{:else}<p class="hint">No hours set — the map won't show an open/closed badge.</p>{/if}
</div>

<style>
    .hint {
        font-size: 11px;
        color: #738466;
        line-height: 1.5;
        margin: 0 0 10px;
    }
    .hint.tight {
        margin-top: -5px;
    }
    .hint a {
        color: #3f5a45;
        font-weight: 600;
    }
    .hint b {
        color: #3f5a45;
    }
    label {
        display: block;
        font-size: 10px;
        color: #738466;
    }
    input,
    textarea {
        display: block;
        width: 100%;
        padding: 7px;
        border: 1px solid #dce3d4;
        border-radius: 5px;
        margin: 5px 0 9px;
        background: white;
        font: inherit;
        font-size: 12px;
        resize: vertical;
    }
    .simrs {
        margin-bottom: 10px;
    }
    .simrs .title {
        display: block;
        font-size: 10px;
        color: #738466;
        margin-bottom: 5px;
    }
    .simrs .link {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        padding: 3px 4px 3px 8px;
        margin-bottom: 4px;
        border: 1px solid #dfe6d8;
        border-radius: 6px;
        background: #fbfcf8;
        font-size: 11.5px;
        color: #52664a;
    }
    .simrs .link b {
        color: #2d4a38;
    }
    .simrs select {
        display: block;
        width: 100%;
        padding: 7px;
        border: 1px solid #dce3d4;
        border-radius: 5px;
        background: white;
        font: inherit;
        font-size: 12px;
        color: #52664a;
    }
    .kind,
    .days {
        display: flex;
        gap: 2px;
        padding: 2px;
        border: 1px solid #dce3d4;
        border-radius: 6px;
        background: white;
        margin-bottom: 8px;
    }
    .kind button,
    .days button {
        flex: 1;
        padding: 5px 0;
        border-radius: 4px;
        font-size: 11px;
        color: #52664a;
    }
    .kind .active,
    .days .active {
        background: #2d4a38;
        color: white;
    }
    .rule {
        border: 1px solid #dfe6d8;
        border-radius: 8px;
        padding: 8px;
        margin-bottom: 8px;
        background: #fbfcf8;
    }
    .rule .days {
        margin-bottom: 6px;
    }
    .times {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .times input {
        margin: 0;
        min-width: 0;
    }
    .times span {
        color: #738466;
    }
    .remove {
        flex-shrink: 0;
        width: 26px;
        height: 26px;
        border-radius: 50%;
        color: #9a4d3c;
        font-size: 15px;
    }
    .add {
        width: 100%;
        justify-content: center;
        font-size: 11px;
        margin-bottom: 8px;
    }
</style>
