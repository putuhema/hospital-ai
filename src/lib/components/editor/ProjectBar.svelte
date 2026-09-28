<script lang="ts">
    import Icon from "./Icon.svelte";
    let {
        title = $bindable(),
        exportOpen = $bindable(false),
        saved,
        onedit,
        onguide,
        oncanvassize,
        onopenmap,
        ondownload,
        onexportmodel,
    }: {
        title: string;
        exportOpen?: boolean;
        saved: boolean;
        /** The title is being typed. */
        onedit: () => void;
        onguide: () => void;
        oncanvassize: () => void;
        onopenmap: () => void;
        ondownload: (format: "json" | "obj") => void;
        onexportmodel: () => void;
    } = $props();
    /** Menu items close the menu, then act. */
    const choose = (action: () => void) => () => {
        exportOpen = false;
        action();
    };
</script>

<header>
    <div class="breadcrumb">
        <b class="product">P-Map Editor</b> <span>/</span> {title || "Untitled map"}
    </div>
    <button class="help" onclick={onguide}>? <span>Quick guide</span></button>
</header>
<div class="project-bar">
    <div>
        <div class="title-row">
            <input
                class="project-title"
                aria-label="Project name"
                bind:value={title}
                oninput={onedit}
            /><span class="saved"
                ><i class:dirty={!saved}></i>{saved ? "Saved on this device" : "Saving…"}</span
            >
        </div>
        <p>Build the campus, add rooms — directions are generated for you.</p>
    </div>
    <div class="project-actions">
        <button class="btn" onclick={oncanvassize}>Canvas size</button><button
            class="btn"
            onclick={onopenmap}>Open wayfinding map ↗</button
        >
        <div class="export-wrap">
            <button class="btn primary" onclick={() => (exportOpen = !exportOpen)}
                ><Icon name="export" size={16} /> Export
                <span>⌄</span></button
            >{#if exportOpen}<div class="export-menu">
                    <button onclick={choose(() => ondownload("json"))}>Layout file (.json)</button
                    ><button onclick={choose(onexportmodel)}>Detailed 3D model (.glb)</button
                    ><button onclick={choose(() => ondownload("obj"))}>Layout blockout (.obj)</button
                    ><a class="source-download" href="/models/hospital-assets.blend" download
                        >Blender source (.blend)</a
                    >
                </div>{/if}
        </div>
    </div>
</div>
