<script lang="ts">
    import { publicUrl } from "$lib/publish";
    let {
        slug,
        open = $bindable(false),
        onnotify,
    }: {
        /** The hospital's public address; null until it is first saved. */
        slug: string | null;
        open?: boolean;
        onnotify: (message: string) => void;
    } = $props();
    let link = $derived(slug ? publicUrl(slug) : "");

    async function copy() {
        try {
            await navigator.clipboard.writeText(link);
            onnotify("Public link copied");
        } catch {
            onnotify("Select the link to copy it");
        }
    }
</script>

<div class="export-wrap">
    <button class="btn primary" aria-expanded={open} onclick={() => (open = !open)}
        >Share <span>⌄</span></button
    >{#if open}<div class="publish-panel" role="dialog" aria-label="Share the hospital">
            {#if link}<b>Public link</b>
                <p>
                    Visitors open the hospital here on their own phones. Every change you make is saved
                    to the database and is live straight away.
                </p>
                <div class="link-row">
                    <input readonly value={link} aria-label="Public link" onfocus={(e) => e.currentTarget.select()} />
                    <button class="btn" onclick={copy}>Copy</button>
                </div>
                <div class="actions">
                    <a class="btn" href={link} target="_blank" rel="noopener">Open ↗</a>
                </div>
                <a class="signs" href="/editor/signs">Print “You are here” QR signs →</a>
            {:else}<p>Saving the hospital for the first time…</p>{/if}
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
    .actions {
        display: flex;
        justify-content: flex-end;
        gap: 6px;
    }
    .actions a {
        text-decoration: none;
        color: inherit;
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
</style>
