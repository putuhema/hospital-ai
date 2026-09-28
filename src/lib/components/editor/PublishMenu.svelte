<script lang="ts">
    import { onMount } from "svelte";
    import { useMutation, useQuery } from "convex-svelte";
    import { ConvexError } from "convex/values";
    import { api } from "../../../convex/_generated/api";
    import {
        forgetPublication,
        newPublishKey,
        publicUrl,
        readPublication,
        savePublication,
        type Publication,
    } from "$lib/publish";
    let {
        layout,
        open = $bindable(false),
        onnotify,
    }: {
        /** The current layout, as autosave stores it. */
        layout: string;
        open?: boolean;
        onnotify: (message: string) => void;
    } = $props();

    let publication = $state<Publication | null>(null),
        busy = $state(false),
        problem = $state("");
    onMount(() => (publication = readPublication()));
    const publish = useMutation(api.maps.publish);
    const unpublish = useMutation(api.maps.unpublish);
    // The live published copy, to tell whether the editor has unpublished changes.
    const published = useQuery(api.maps.get, () =>
        publication ? { slug: publication.slug } : "skip",
    );
    let live = $derived(publication && published.data ? published.data : null);
    let link = $derived(live ? publicUrl(live.slug) : "");
    let upToDate = $derived(live?.layout === layout);
    let when = $derived(
        live &&
            new Date(live.publishedAt).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
            }),
    );

    async function send() {
        busy = true;
        problem = "";
        // Update this device's map; if it has gone (or was never published), start a new one.
        const current = live && publication;
        const key = current ? current.key : newPublishKey();
        try {
            const { slug } = await publish({ layout, key, slug: current ? current.slug : undefined });
            publication = { slug, key };
            savePublication(publication);
            onnotify(current ? "Published — visitors now see this version" : "Map published");
        } catch (e) {
            problem =
                e instanceof ConvexError
                    ? String(e.data)
                    : "Could not reach the server. Check your connection and try again.";
        } finally {
            busy = false;
        }
    }
    async function copy() {
        try {
            await navigator.clipboard.writeText(link);
            onnotify("Public link copied");
        } catch {
            onnotify("Select the link to copy it");
        }
    }
    async function takeDown() {
        if (!publication || !confirm("Take the map offline? The public link will stop working.")) return;
        busy = true;
        problem = "";
        try {
            await unpublish(publication);
            forgetPublication();
            publication = null;
            onnotify("The public map is offline");
        } catch (e) {
            problem = e instanceof ConvexError ? String(e.data) : "Could not reach the server. Try again.";
        } finally {
            busy = false;
        }
    }
</script>

<div class="export-wrap">
    <button class="btn primary" aria-expanded={open} onclick={() => (open = !open)}
        >Publish <span>⌄</span></button
    >{#if open}<div class="publish-panel" role="dialog" aria-label="Publish the map">
            {#if publication && published.isLoading}<p>Checking the published map…</p>
            {:else if live}<b>Public link</b>
                <p>Anyone with this link can open the map on their own phone.</p>
                <div class="link-row">
                    <input readonly value={link} aria-label="Public link" onfocus={(e) => e.currentTarget.select()} />
                    <button class="btn" onclick={copy}>Copy</button>
                </div>
                <p class="status" class:dirty={!upToDate}>
                    <i></i>{upToDate ? "Up to date" : "Unpublished changes"} · published {when}
                </p>
                <div class="actions">
                    <a class="btn" href={link} target="_blank" rel="noopener">Open ↗</a>
                    <button class="btn primary" disabled={busy || upToDate} onclick={send}
                        >{busy ? "Publishing…" : "Publish changes"}</button
                    >
                </div>
                <a class="signs" href="/editor/signs">Print “You are here” QR signs →</a>
                <button class="unlink" disabled={busy} onclick={takeDown}>Take the map offline</button>
            {:else}<b>Publish the map</b>
                <p>
                    Give the map a public address so visitors can open it on their own phones. You
                    choose when changes go live.
                </p>
                <div class="actions">
                    <button class="btn primary" disabled={busy} onclick={send}
                        >{busy ? "Publishing…" : "Publish map"}</button
                    >
                </div>{/if}
            {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
        </div>{/if}
</div>

<style>
    .publish-panel {
        position: absolute;
        right: 0;
        top: 43px;
        width: 320px;
        z-index: 10;
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 16px;
        background: white;
        border: 1px solid #dfe4d9;
        border-radius: 7px;
        box-shadow: 0 8px 25px #253a2215;
        font-size: 12px;
    }
    b {
        font-size: 13px;
        color: #2f4336;
    }
    p {
        margin: 0;
        color: #6f7c69;
        line-height: 1.45;
    }
    .link-row {
        display: flex;
        gap: 6px;
    }
    .link-row input {
        flex: 1;
        min-width: 0;
        padding: 9px 10px;
        border: 1px solid #dfe4d9;
        border-radius: 6px;
        font-size: 12px;
        color: #2f4336;
    }
    .status {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
    }
    .status i {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #73916a;
    }
    .status.dirty i {
        background: #c59a50;
    }
    .actions {
        display: flex;
        justify-content: flex-end;
        gap: 6px;
    }
    .actions a {
        text-decoration: none;
        color: inherit;
    }
    .btn:disabled {
        opacity: 0.55;
        cursor: default;
    }
    .signs {
        padding: 10px 12px;
        border-radius: 6px;
        background: #eef3e8;
        color: #2f4336;
        text-decoration: none;
    }
    .signs:hover {
        background: #e3ebdb;
    }
    .unlink {
        align-self: flex-start;
        font-size: 11px;
        color: #8a9384;
        text-decoration: underline;
    }
    .problem {
        color: #9a4b2f;
    }
</style>
