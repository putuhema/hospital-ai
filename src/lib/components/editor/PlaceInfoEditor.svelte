<script lang="ts">
    import { DAY_NAMES, hoursStatus, parseInfo, type Hours, type PlaceInfo } from "$lib/model/place-info";
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
        >Other names &amp; doctors<textarea
            rows="2"
            placeholder={"One per line, e.g.\nDr. Sari Wijaya\nX-ray\nPoli Anak"}
            value={info?.keywords?.join("\n") ?? ""}
            onchange={(e) => set({ keywords: e.currentTarget.value.split("\n").slice(0, 40).map((k) => k.slice(0, 80)) })}
        ></textarea></label
    >
    <p class="hint tight">Visitors who search for these find this place.</p>
    <label
        >Phone<input
            type="tel"
            maxlength="40"
            placeholder="e.g. +62 361 123 456"
            value={info?.phone ?? ""}
            onchange={(e) => set({ phone: e.currentTarget.value })}
        /></label
    >
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
