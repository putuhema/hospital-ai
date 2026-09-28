<script module lang="ts">
    export type EditorView = "2D" | "3D" | "Paths";
</script>

<script lang="ts">
    import Icon from "./Icon.svelte";
    let {
        active = $bindable(),
        pan = $bindable(),
        view = $bindable(),
        assetsOpen = $bindable(),
        propertiesOpen = $bindable(),
        canUndo,
        canRedo,
        onundo,
        onredo,
    }: {
        active: number | null;
        pan: boolean;
        view: EditorView;
        assetsOpen: boolean;
        propertiesOpen: boolean;
        canUndo: boolean;
        canRedo: boolean;
        onundo: () => void;
        onredo: () => void;
    } = $props();
    const views: [EditorView, string][] = [
        ["2D", "Plan"],
        ["3D", "3D"],
        ["Paths", "Wayfinding"],
    ];
    // On narrow screens only one side panel fits at a time.
    const narrow = () => window.matchMedia("(max-width: 900px)").matches;
    function toggleAssets() {
        assetsOpen = !assetsOpen;
        if (assetsOpen && narrow()) propertiesOpen = false;
    }
    function toggleProperties() {
        propertiesOpen = !propertiesOpen;
        if (propertiesOpen && narrow()) assetsOpen = false;
    }
    function show(v: EditorView) {
        view = v;
        // Wayfinding takes the whole canvas and ignores the editing tools.
        if (v === "Paths") {
            active = null;
            pan = false;
            assetsOpen = false;
            propertiesOpen = false;
        }
    }
</script>

<div class="canvas-toolbar" aria-label="Canvas controls">
    <button
        class="panel-toggle"
        class:active={assetsOpen}
        aria-expanded={assetsOpen}
        aria-controls="asset-panel"
        onclick={toggleAssets}>Assets</button
    >
    <div class="tool-group">
        <button
            class:tool-active={active === null && !pan}
            title="Select (Esc)"
            onclick={() => {
                active = null;
                pan = false;
            }}><Icon name="arrow" size={17} /></button
        ><span class="divider"></span><button title="Undo" disabled={!canUndo} onclick={onundo}
            >↶</button
        ><button title="Redo" disabled={!canRedo} onclick={onredo}>↷</button>
    </div>
    <button
        class="btn"
        class:tool-active={pan}
        aria-pressed={pan}
        onclick={() => {
            pan = !pan;
            active = null;
        }}>✋ Pan</button
    >
    <div class="view-toggle">
        {#each views as [v, label]}<button class:active={view === v} onclick={() => show(v)}
                >{label}</button
            >{/each}
    </div>
    <button
        class="panel-toggle"
        class:active={propertiesOpen}
        aria-expanded={propertiesOpen}
        aria-controls="properties-panel"
        onclick={toggleProperties}>Properties</button
    >
</div>
