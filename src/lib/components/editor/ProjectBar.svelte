<script lang="ts">
    import Icon from "./Icon.svelte";
    import ShareMenu from "./ShareMenu.svelte";
    import type { SaveStatus } from "$lib/editor/saving.svelte";
    import { goto } from "$app/navigation";
    import { authClient } from "$lib/auth-client";
    let {
        title = $bindable(),
        exportOpen = $bindable(false),
        status,
        problem = "",
        slug,
        onnotify,
        onedit,
        onguide,
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
        onguide: () => void;
        oncanvassize: () => void;
        onopenmap: () => void;
        ondownload: (format: "json" | "obj") => void;
        onexportmodel: () => void;
    } = $props();
    let shareOpen = $state(false);
    const label: Record<SaveStatus, string> = {
        loading: "Loading…",
        saving: "Saving…",
        saved: "Saved · live for visitors",
        failed: "Not saved — retrying",
    };
    // Only one menu open at a time.
    $effect(() => {
        if (exportOpen) shareOpen = false;
    });
    $effect(() => {
        if (shareOpen) exportOpen = false;
    });
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
    <div class="header-actions">
        <button class="help" onclick={onguide}>? <span>Quick guide</span></button><a class="help" href="/editor/accounts"
            >Accounts</a
        ><button
            class="help"
            onclick={async () => {
                await authClient.signOut();
                goto("/login");
            }}>Sign out</button
        >
    </div>
</header>
<div class="project-bar">
    <div>
        <div class="title-row">
            <input
                class="project-title"
                aria-label="Project name"
                bind:value={title}
                oninput={onedit}
            /><span class="saved" class:failed={status === "failed"} title={problem}
                ><i class:dirty={status !== "saved"}></i>{label[status]}</span
            >
        </div>
        <p>Build the campus, add rooms — directions are generated for you.</p>
    </div>
    <div class="project-actions">
        <button class="btn" onclick={oncanvassize}>Canvas size</button><a
            class="btn"
            href="/editor/info">Hospital info</a
        ><button
            class="btn"
            onclick={onopenmap}>Open wayfinding map ↗</button
        >
        <div class="export-wrap">
            <button class="btn" onclick={() => (exportOpen = !exportOpen)}
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
        <ShareMenu {slug} bind:open={shareOpen} {onnotify} />
    </div>
</div>
