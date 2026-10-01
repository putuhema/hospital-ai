<script lang="ts">
    import { onMount } from "svelte";
    import { authClient } from "$lib/auth-client";

    type Account = { id: string; name: string; email: string; role?: string | null; createdAt: Date };

    let { data } = $props();

    let accounts = $state<Account[]>([]),
        loading = $state(true),
        problem = $state(""),
        /** The account whose new password is being typed. */
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

    /** Runs an admin request; false (and the reason shown) when it failed. */
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
        if (!(await run(authClient.admin.createUser({ name: name.trim() || added, email: added, password, role: "admin" }))))
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
</script>

<svelte:head><title>Accounts · P-Map Editor</title></svelte:head>

<div class="accounts-page">
    <a class="back" href="/editor">← Back to the editor</a>
    <h1>Accounts</h1>
    <p class="lead">
        Admins edit the map and the hospital information, and add or remove accounts here. Changes are live for
        visitors straight away, so add only people you trust with that.
    </p>

    {#if problem}<p class="problem" role="alert">{problem}</p>{/if}

    <section>
        <h2>Who can edit</h2>
        {#if loading}<p class="note">Loading…</p>
        {:else}
            <ul>
                {#each accounts as a (a.id)}
                    <li>
                        <div class="who">
                            <b>{a.name}</b>{#if a.id === data.me.id}<span class="tag">You</span>{/if}
                            {#if !isAdmin(a)}<span class="tag muted">No access</span>{/if}
                            <small>{a.email}</small>
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
                                <button type="button" class="btn" onclick={() => (resetting = null)}>Cancel</button>
                            </form>
                        {:else}
                            <div class="actions">
                                <button class="btn" onclick={() => ((resetting = a.id), (newPassword = ""))}
                                    >Reset password</button
                                >{#if a.id !== data.me.id}<button
                                        class="btn danger"
                                        disabled={busy}
                                        onclick={() => remove(a)}>Remove</button
                                    >{/if}
                            </div>
                        {/if}
                    </li>
                {/each}
            </ul>
        {/if}
    </section>

    <section>
        <h2>Add an admin</h2>
        <p class="note">Choose a first password and give it to them; they can sign in at <b>/login</b> straight away.</p>
        <form class="add" onsubmit={add}>
            <label>Name<input bind:value={name} autocomplete="off" required /></label>
            <label>Email<input type="email" bind:value={email} autocomplete="off" required /></label>
            <label
                >Password<input
                    type="password"
                    bind:value={password}
                    autocomplete="new-password"
                    minlength="8"
                    required
                /></label
            >
            <button class="btn primary" disabled={busy}>Add admin</button>
        </form>
    </section>

    {#if toast}<div class="toast" role="status">{toast}</div>{/if}
</div>

<style>
    .accounts-page {
        max-width: 720px;
        margin: 0 auto;
        padding: 32px 24px 80px;
        color: #1f3a2b;
    }
    .back {
        color: #52664a;
        text-decoration: none;
        font-size: 12px;
    }
    h1 {
        margin: 14px 0 8px;
        font:
            28px Georgia,
            serif;
    }
    .lead,
    .note {
        margin: 0;
        font-size: 12px;
        line-height: 1.5;
        color: #6f7c69;
    }
    section {
        margin-top: 28px;
        padding: 20px;
        border: 1px solid #dfe4d9;
        border-radius: 12px;
        background: white;
    }
    h2 {
        margin: 0 0 12px;
        font-size: 14px;
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
        gap: 12px;
        padding: 12px 0;
        border-top: 1px solid #eef1ea;
    }
    li:first-child {
        border-top: 0;
    }
    .who {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 4px 8px;
        min-width: 0;
    }
    .who small {
        flex-basis: 100%;
        color: #6f7c69;
    }
    .tag {
        background: #eaf0e1;
        color: #456a39;
    }
    .tag.muted {
        background: #f6ece6;
        color: #9a4b2f;
    }
    .actions,
    .inline {
        display: flex;
        gap: 8px;
    }
    .danger {
        color: #9a4b2f;
    }
    .add {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        margin-top: 14px;
    }
    .add .btn {
        grid-column: 1 / -1;
        justify-self: start;
    }
    label {
        display: grid;
        gap: 6px;
        font-size: 11px;
        color: #5d6a58;
    }
    input {
        padding: 10px 12px;
        border: 1px solid #dfe4d9;
        border-radius: 6px;
        background: #fff;
        font-size: 13px;
    }
    .problem {
        margin: 18px 0 0;
        color: #9a4b2f;
        font-size: 12px;
    }
</style>
