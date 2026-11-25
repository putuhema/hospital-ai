<script lang="ts">
    import { publicUrl } from "$lib/publish";
    import Icon from "./Icon.svelte";

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
    <button class="btn primary" aria-expanded={open} onclick={() => (open = !open)}>
        Share <Icon name="chevron-down" size={14} />
    </button>
    {#if open}
        <div class="publish-panel" role="dialog" aria-label="Share the hospital">
            {#if link}
                <b>Public visitor link</b>
                <p>
                    Visitors open the hospital here on their own phones. Every change you make is saved
                    automatically and live straight away.
                </p>
                <div class="link-row">
                    <input readonly value={link} aria-label="Public link" onfocus={(e) => e.currentTarget.select()} />
                    <button class="btn" onclick={copy}>Copy</button>
                </div>
                <div class="actions">
                    <a class="btn" href={link} target="_blank" rel="noopener">
                        Open map <Icon name="external" size={13} />
                    </a>
                </div>
                <a class="signs" href="/editor/signs">
                    <Icon name="qr" size={15} />
                    <span>Print “You are here” QR signs →</span>
                </a>
            {:else}
                <p>Saving the hospital for the first time…</p>
            {/if}
        </div>
    {/if}
</div>

<style>
    .publish-panel {
        position: absolute;
        right: 0;
        top: calc(100% + 6px);
        width: 320px;
        z-index: 30;
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 16px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-md);
        font-size: 12.5px;
    }
    b {
        font-size: 13.5px;
        color: var(--ink);
    }
    p {
        margin: 0;
        color: var(--muted);
        line-height: 1.5;
    }
    .link-row {
        display: flex;
        gap: 6px;
    }
    .link-row input {
        flex: 1;
        min-width: 0;
        height: 34px;
        padding: 0 10px;
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        background: var(--surface-subtle);
        font-size: 12px;
        color: var(--ink);
    }
    .actions {
        display: flex;
        justify-content: flex-end;
        gap: 6px;
    }
    .signs {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border-radius: var(--radius-md);
        background: var(--accent-soft);
        color: var(--accent);
        font-weight: 500;
        text-decoration: none;
    }
    .signs:hover {
        background: #dce8e0;
    }
</style>
