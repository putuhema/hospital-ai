<script lang="ts">
    import { onMount } from "svelte";
    import { authClient } from "$lib/auth-client";
    import EditorRail from "$lib/components/editor/EditorRail.svelte";

    type Account = { id: string; name: string; email: string; role?: string | null; createdAt: Date };

    let { data } = $props();

    let accounts = $state<Account[]>([]),
        loading = $state(true),
        problem = $state(""),
        resetting = $state<string | null>(null),
        newPassword = $state(""),
        name = $state(""),
        email = $state(""),
        password = $state(""),
        busy = $state(false),
        toast = $state("");

    function notify(message: string) {
        toast = message;
        setTimeout(() => (toast = ""), 2800);
    }

    async function run(request: Promise<{ error: { message?: string } | null }>) {
        busy = true;
        problem = "";
        const { error } = await request;
        busy = false;
        if (error) problem = error.message || "That didn't work. Try again.";
        return !error;
    }

    async function load() {
        const { data: list, error } = await authClient.admin.listUsers({
            query: { limit: 200, sortBy: "createdAt", sortDirection: "asc" },
        });
        loading = false;
        if (error) problem = error.message || "Could not load the accounts.";
        else accounts = list.users as Account[];
    }
    onMount(load);

    async function add(e: SubmitEvent) {
        e.preventDefault();
        const added = email.trim();
        if (
            !(await run(
                authClient.admin.createUser({ name: name.trim() || added, email: added, password, role: "admin" }),
            ))
        )
            return;
        name = email = password = "";
        await load();
        notify(`${added} can sign in now. Give them their password.`);
    }

    async function reset(account: Account, e: SubmitEvent) {
        e.preventDefault();
        if (!(await run(authClient.admin.setUserPassword({ userId: account.id, newPassword })))) return;
        resetting = null;
        newPassword = "";
        notify(`New password set for ${account.email}.`);
    }

    async function remove(account: Account) {
        if (!confirm(`Remove ${account.email}? They are signed out and can no longer edit the map.`)) return;
        if (!(await run(authClient.admin.removeUser({ userId: account.id })))) return;
        await load();
        notify(`${account.email} was removed.`);
    }

    const isAdmin = (a: Account) => (a.role ?? "").split(",").some((r) => r.trim() === "admin");
    const initials = (a: Account) =>
        (a.name || a.email)
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase() ?? "")
            .join("") || "A";
</script>

<svelte:head><title>Accounts · AIRMA Editor</title></svelte:head>

<div class="admin-layout">
    <EditorRail onnotify={notify} />

    <div class="accounts-wrap">
        <div class="accounts-page">
            <span class="eyebrow">TEAM ACCESS</span>
            <h1>Accounts</h1>
            <p class="lead">
                Admins edit the 3D campus map and hospital information, and manage accounts here. Changes are live for
                visitors straight away, so add only people you trust.
            </p>

            {#if problem}<p class="problem" role="alert">{problem}</p>{/if}

            <section class="card">
                <div class="card-head">
                    <h2>Who can edit</h2>
                    {#if !loading}<span class="count">{accounts.length}</span>{/if}
                </div>
                {#if loading}
                    <p class="note">Loading…</p>
                {:else}
                    <ul>
                        {#each accounts as a (a.id)}
                            <li>
                                <div class="person">
                                    <div class="avatar">{initials(a)}</div>
                                    <div class="who">
                                        <b>{a.name}</b>
                                        {#if a.id === data.me.id}<span class="tag">You</span>{/if}
                                        {#if !isAdmin(a)}<span class="tag muted">No access</span>{/if}
                                        <small>{a.email}</small>
                                    </div>
                                </div>
                                {#if resetting === a.id}
                                    <form class="inline" onsubmit={(e) => reset(a, e)}>
                                        <input
                                            type="password"
                                            aria-label="New password for {a.email}"
                                            placeholder="New password"
                                            autocomplete="new-password"
                                            minlength="8"
                                            required
                                            bind:value={newPassword}
                                        />
                                        <button class="btn primary" disabled={busy}>Set</button>
                                        <button type="button" class="btn" onclick={() => (resetting = null)}>
                                            Cancel
                                        </button>
                                    </form>
                                {:else}
                                    <div class="actions">
                                        <button
                                            class="btn"
                                            onclick={() => ((resetting = a.id), (newPassword = ""))}
                                        >
                                            Reset password
                                        </button>
                                        {#if a.id !== data.me.id}
                                            <button class="btn danger" disabled={busy} onclick={() => remove(a)}>
                                                Remove
                                            </button>
                                        {/if}
                                    </div>
                                {/if}
                            </li>
                        {/each}
                    </ul>
                {/if}
            </section>

            <section class="card">
                <h2>Add an admin</h2>
                <p class="note">
                    Choose a first password and share it with them; they can sign in at <b>/login</b> straight away.
                </p>
                <form class="add" onsubmit={add}>
                    <label>Name<input bind:value={name} placeholder="Full name" autocomplete="off" required /></label>
                    <label
                        >Email<input
                            type="email"
                            placeholder="name@hospital.org"
                            bind:value={email}
                            autocomplete="off"
                            required
                        /></label
                    >
                    <label class="full"
                        >Temporary password<input
                            type="password"
                            placeholder="At least 8 characters"
                            bind:value={password}
                            autocomplete="new-password"
                            minlength="8"
                            required
                        /></label
                    >
                    <button class="btn primary" disabled={busy}>Add admin</button>
                </form>
            </section>
        </div>
    </div>

    {#if toast}<div class="toast" role="status"><span>✓</span>{toast}</div>{/if}
</div>

<style>
    .admin-layout {
        display: flex;
        min-height: 100dvh;
        background: var(--bg);
        color: var(--ink);
    }

    .accounts-wrap {
        flex: 1;
        min-width: 0;
        padding: 36px 28px 80px;
    }

    .accounts-page {
        max-width: 740px;
        margin: 0 auto;
    }

    .eyebrow {
        display: inline-block;
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.09em;
        color: var(--accent);
        background: var(--accent-soft);
        padding: 3px 9px;
        border-radius: 999px;
        margin-bottom: 10px;
    }

    h1 {
        margin: 0 0 8px;
        font-family: var(--font-serif);
        font-size: 30px;
        font-weight: 550;
        letter-spacing: -0.02em;
        color: var(--ink);
    }

    .lead,
    .note {
        margin: 0;
        font-size: 13.5px;
        line-height: 1.55;
        color: var(--muted);
    }

    .card {
        margin-top: 24px;
        padding: 22px 24px;
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        background: var(--surface);
        box-shadow: var(--shadow-sm);
    }

    .card-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
    }

    .card-head h2 {
        margin: 0;
    }

    h2 {
        margin: 0 0 8px;
        font-size: 15.5px;
        font-weight: 650;
        color: var(--ink);
    }

    ul {
        margin: 0;
        padding: 0;
        list-style: none;
    }

    li {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
        padding: 14px 0;
        border-top: 1px solid var(--border);
    }

    li:first-child {
        border-top: 0;
        padding-top: 4px;
    }

    .person {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
    }

    .avatar {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: var(--accent-soft);
        color: var(--accent);
        display: grid;
        place-items: center;
        font-size: 12.5px;
        font-weight: 700;
        flex-shrink: 0;
    }

    .who {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 8px;
        min-width: 0;
    }

    .who b {
        font-size: 14px;
        font-weight: 600;
        color: var(--ink);
    }

    .who small {
        flex-basis: 100%;
        font-size: 12.5px;
        color: var(--muted);
    }

    .tag.muted {
        background: var(--danger-bg);
        color: var(--danger);
    }

    .actions,
    .inline {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
    }

    .add {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px;
        margin-top: 16px;
    }

    .add .full,
    .add .btn {
        grid-column: 1 / -1;
    }

    .add .btn {
        justify-self: start;
        height: 38px;
        padding: 0 18px;
    }

    label {
        display: grid;
        gap: 6px;
        font-size: 12.5px;
        font-weight: 600;
        color: var(--ink);
    }

    input {
        height: 38px;
        padding: 0 12px;
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        background: var(--surface-subtle);
        font-size: 13.5px;
        color: var(--ink);
    }

    input:focus {
        background: var(--surface);
    }

    .problem {
        margin: 18px 0 0;
        padding: 10px 14px;
        border-radius: var(--radius-md);
        background: var(--danger-bg);
        color: var(--danger);
        font-size: 13px;
    }

    @media (max-width: 640px) {
        .accounts-wrap {
            padding: 20px 16px 60px;
        }
        .add {
            grid-template-columns: 1fr;
        }
    }
</style>
