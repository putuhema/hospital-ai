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
        ["3D", "3D View"],
        ["Paths", "Wayfinding"],
    ];

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
            aria-label="Select tool"
            onclick={() => {
                active = null;
                pan = false;
            }}><Icon name="arrow" size={16} /></button
        >
        <button
            class:tool-active={pan}
            aria-pressed={pan}
            title="Pan canvas"
            aria-label="Pan canvas"
            onclick={() => {
                pan = !pan;
                active = null;
            }}><Icon name="hand" size={16} /></button
        >
        <span class="divider"></span>
        <button title="Undo (⌘Z)" aria-label="Undo" disabled={!canUndo} onclick={onundo}>
            <Icon name="undo" size={15} />
        </button>
        <button title="Redo (⇧⌘Z)" aria-label="Redo" disabled={!canRedo} onclick={onredo}>
            <Icon name="redo" size={15} />
        </button>
    </div>

    <div class="view-toggle" role="tablist" aria-label="Canvas view">
        {#each views as [v, label]}
            <button role="tab" aria-selected={view === v} class:active={view === v} onclick={() => show(v)}>
                {label}
            </button>
        {/each}
    </div>

    <button
        class="panel-toggle"
        class:active={propertiesOpen}
        aria-expanded={propertiesOpen}
        aria-controls="properties-panel"
        onclick={toggleProperties}>Properties</button
    >
</div>
