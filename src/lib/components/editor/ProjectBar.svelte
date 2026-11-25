<script lang="ts">
    import Icon from "./Icon.svelte";
    import ShareMenu from "./ShareMenu.svelte";
    import type { SaveStatus } from "$lib/editor/saving.svelte";

    let {
        title = $bindable(),
        exportOpen = $bindable(false),
        status,
        problem = "",
        slug,
        onnotify,
        onedit,
        oncanvassize,
        onopenmap,
        ondownload,
        onexportmodel,
    }: {
        title: string;
        exportOpen?: boolean;
        /** Saving to the database, which visitors' maps read from. */
        status: SaveStatus;
        /** Why saving failed, while it is retried. */
        problem?: string;
        /** The hospital's public address. */
        slug: string | null;
        onnotify: (message: string) => void;
        /** The title is being typed. */
        onedit?: () => void;
        oncanvassize: () => void;
        onopenmap: () => void;
        ondownload: (format: "json" | "obj") => void;
        onexportmodel: () => void;
    } = $props();

    let shareOpen = $state(false);
    const label: Record<SaveStatus, string> = {
        loading: "Loading…",
        saving: "Saving…",
        saved: "Live",
        failed: "Not saved",
    };

    // Only one menu open at a time.
    $effect(() => {
        if (exportOpen) shareOpen = false;
    });
    $effect(() => {
        if (shareOpen) exportOpen = false;
    });

    const choose = (action: () => void) => () => {
        exportOpen = false;
        action();
    };
</script>

<header class="editor-topbar">
    <div class="topbar-left">
        <input
            class="project-title"
            aria-label="Project name"
            bind:value={title}
            oninput={onedit}
            placeholder="Untitled hospital"
        />
        <span
            class="saved"
            class:failed={status === "failed"}
            title={problem || "Changes are saved automatically and live for visitors"}
        >
            <i class:dirty={status !== "saved"}></i>{label[status]}
        </span>
    </div>

    <div class="project-actions">
        <button class="btn" onclick={oncanvassize} title="Resize campus grid">
            <Icon name="grid" size={15} />
            <span class="btn-label">Canvas</span>
        </button>

        <button class="btn" onclick={onopenmap} title="Open visitor wayfinding map">
            <span class="btn-label">Visitor map</span>
            <Icon name="external" size={14} />
        </button>

        <div class="export-wrap">
            <button class="btn" aria-expanded={exportOpen} onclick={() => (exportOpen = !exportOpen)}>
                <Icon name="export" size={15} />
                <span class="btn-label">Export</span>
                <Icon name="chevron-down" size={14} />
            </button>
            {#if exportOpen}
                <div class="export-menu">
                    <button onclick={choose(() => ondownload("json"))}>Layout file (.json)</button>
                    <button onclick={choose(onexportmodel)}>Detailed 3D model (.glb)</button>
                    <button onclick={choose(() => ondownload("obj"))}>Layout blockout (.obj)</button>
                    <a class="source-download" href="/models/hospital-assets.blend" download>
                        Blender source (.blend)
                    </a>
                </div>
            {/if}
        </div>

        <ShareMenu {slug} bind:open={shareOpen} {onnotify} />
    </div>
</header>
