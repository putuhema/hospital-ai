<script lang="ts">
    import { DAY_NAMES, type Hours } from "$lib/model/hours";
    let {
        hours,
        label,
        max = 14,
        onchange,
    }: {
        hours: Hours[];
        /** What the add button adds, e.g. "opening hours". */
        label: string;
        max?: number;
        onchange: (hours: Hours[]) => void;
    } = $props();
    // Monday first, as the hours read on the map.
    const week = [1, 2, 3, 4, 5, 6, 0];
    const setRule = (i: number, patch: Partial<Hours>) =>
        onchange(hours.map((h, j) => (j === i ? { ...h, ...patch } : h)));
    function toggleDay(i: number, day: number) {
        const days = hours[i].days.includes(day) ? hours[i].days.filter((d) => d !== day) : [...hours[i].days, day];
        // A rule without days is meaningless; remove it instead.
        if (days.length) setRule(i, { days });
    }
</script>

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
                aria-label="From"
                value={h.open}
                onchange={(e) => e.currentTarget.value && setRule(i, { open: e.currentTarget.value })}
            /><span>–</span><input
                type="time"
                aria-label="Until"
                value={h.close}
                onchange={(e) => e.currentTarget.value && setRule(i, { close: e.currentTarget.value })}
            /><button class="remove" aria-label="Remove these hours" onclick={() => onchange(hours.filter((_, j) => j !== i))}
                >×</button
            >
        </div>
    </div>{/each}
<button
    class="btn add"
    disabled={hours.length >= max}
    onclick={() => onchange([...hours, { days: [1, 2, 3, 4, 5], open: "08:00", close: "17:00" }])}>+ Add {label}</button
>

<style>
    .days {
        display: flex;
        gap: 2px;
        padding: 2px;
        border: 1px solid #dce3d4;
        border-radius: 6px;
        background: white;
        margin-bottom: 6px;
    }
    .days button {
        flex: 1;
        padding: 5px 0;
        border-radius: 4px;
        font-size: 11px;
        color: #52664a;
    }
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
    .times {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .times input {
        display: block;
        width: 100%;
        min-width: 0;
        padding: 7px;
        border: 1px solid #dce3d4;
        border-radius: 5px;
        background: white;
        font: inherit;
        font-size: 12px;
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
