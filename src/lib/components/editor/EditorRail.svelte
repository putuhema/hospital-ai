<script lang="ts">
    import { page } from "$app/state";
    import { goto } from "$app/navigation";
    import { authClient } from "$lib/auth-client";
    import Icon from "./Icon.svelte";
    import Logo from "$lib/components/shared/Logo.svelte";

    let {
        onimport,
        onguide,
        onnotify,
    }: {
        onimport?: () => void;
        onguide?: () => void;
        onnotify?: (message: string) => void;
    } = $props();

    let path = $derived(page.url.pathname);
    const isEditor = $derived(path === "/editor" || path === "/editor/");
    const isInfo = $derived(path.startsWith("/editor/info"));
    const isSigns = $derived(path.startsWith("/editor/signs"));
    const isAccounts = $derived(path.startsWith("/editor/accounts"));

    async function signOut() {
        await authClient.signOut();
        await goto("/login");
    }
</script>

<nav class="rail" aria-label="AIRMA Admin navigation">
    <a class="brand" href="/editor" title="AIRMA Editor"><Logo size={32} title="AIRMA Editor home" /></a>

    <a
        class="rail-item"
        class:rail-active={isEditor}
        href="/editor"
        title="Campus Editor"
        aria-label="Campus Editor"
        aria-current={isEditor ? "page" : undefined}
    >
        <Icon name="layers" size={18} />
    </a>

    <a
        class="rail-item"
        class:rail-active={isInfo}
        href="/editor/info"
        title="Hospital Info, FAQ & Doctors"
        aria-label="Hospital Info, FAQ and Doctors"
        aria-current={isInfo ? "page" : undefined}
    >
        <Icon name="book" size={18} />
    </a>

    <a
        class="rail-item"
        class:rail-active={isSigns}
        href="/editor/signs"
        title="QR Signs"
        aria-label="Print QR signs"
        aria-current={isSigns ? "page" : undefined}
    >
        <Icon name="qr" size={18} />
    </a>

    <a
        class="rail-item"
        class:rail-active={isAccounts}
        href="/editor/accounts"
        title="Admin Accounts"
        aria-label="Admin Accounts"
        aria-current={isAccounts ? "page" : undefined}
    >
        <Icon name="users" size={18} />
    </a>

    {#if onimport}
        <span class="rail-line" aria-hidden="true"></span>
        <button class="rail-item" title="Import layout (.json)" aria-label="Import layout" onclick={onimport}>
            <Icon name="upload" size={18} />
        </button>
    {/if}

    <div class="rail-spacer"></div>

    {#if onguide}
        <button class="rail-item" title="Quick guide (?)" aria-label="Quick guide" onclick={onguide}>
            <Icon name="help" size={18} />
        </button>
    {/if}

    {#if onnotify}
        <button
            class="rail-item"
            title="Auto-saved to database"
            aria-label="Where is my work saved?"
            onclick={() =>
                onnotify("Every change is saved to the database and is live for visitors. Use Export for a copy.")}
        >
            <Icon name="save" size={18} />
        </button>
    {/if}

    <span class="rail-line" aria-hidden="true"></span>
    <button class="rail-item" title="Sign out" aria-label="Sign out" onclick={signOut}>
        <Icon name="logout" size={18} />
    </button>
</nav>
