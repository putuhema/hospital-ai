<script lang="ts">
    let {
        label,
        value,
        fallback,
        swatches = [
            "#e4e8df",
            "#d3ddd0",
            "#efe3dc",
            "#e6ddd0",
            "#d6e3ea",
            "#e5d3dc",
            "#c6e2e0",
            "#8fa39a",
            "#154a4f",
            "#b0564a",
            "#5b6b8c",
            "#6b7a6f",
        ],
        onchange,
    }: {
        label: string;
        value: string;
        /** Offered as a "Default" reset when the value differs from it. */
        fallback?: string;
        swatches?: string[];
        onchange: (color: string) => void;
    } = $props();
    const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
</script>

<div class="color-field">
    <div class="top">
        <span>{label}</span>
        {#if fallback && !same(value, fallback)}<button
                class="reset"
                onclick={() => onchange(fallback)}>Reset</button
            >{/if}
        <label class="custom" title="Custom colour"
            ><input
                type="color"
                aria-label={`${label}: custom colour`}
                {value}
                onchange={(e) => onchange(e.currentTarget.value)}
            /><code>{value.toUpperCase()}</code></label
        >
    </div>
    <div class="swatches" role="radiogroup" aria-label={label}>
        {#each swatches as color}<button
                role="radio"
                aria-checked={same(color, value)}
                aria-label={color}
                class:active={same(color, value)}
                style={`background:${color}`}
                onclick={() => onchange(color)}
            ></button>{/each}
    </div>
</div>

<style>
    .color-field {
        margin: 4px 0 12px;
    }
    .top {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 11px;
        color: #62745a;
        margin-bottom: 7px;
    }
    .top > span {
        flex: 1;
    }
    .reset {
        font-size: 10px;
        color: #4b6f53;
        text-decoration: underline;
    }
    .custom {
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 2px 6px 2px 2px;
        border: 1px solid #dce3d4;
        border-radius: 5px;
        background: white;
        cursor: pointer;
    }
    .custom input {
        width: 20px;
        height: 20px;
        padding: 0;
        border: 0;
        margin: 0;
        background: none;
        cursor: pointer;
    }
    code {
        font-size: 10px;
        color: #52664a;
    }
    .swatches {
        display: grid;
        grid-template-columns: repeat(12, 1fr);
        gap: 4px;
    }
    .swatches button {
        aspect-ratio: 1;
        border-radius: 50%;
        box-shadow: inset 0 0 0 1px #0000001f;
        transition: transform 0.12s ease;
    }
    .swatches button:hover {
        transform: scale(1.15);
    }
    .swatches .active {
        outline: 2px solid #3f6b4e;
        outline-offset: 2px;
    }
</style>
