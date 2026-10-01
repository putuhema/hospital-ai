<script lang="ts">
    import { goto } from "$app/navigation";
    import { authClient } from "$lib/auth-client";
    import Logo from "$lib/components/shared/Logo.svelte";

    let {
        account,
        next,
        first = false,
    }: {
        /** Signed in, but with an account that may not edit. */
        account: { email: string } | null;
        /** Where to go once signed in. */
        next: string;
        /** No accounts yet: this one is created here and becomes the admin. */
        first?: boolean;
    } = $props();

    // Only the first account signs up here; admins add the others in the editor.
    const creating = $derived(first);
    let name = $state(""),
        email = $state(""),
        password = $state(""),
        busy = $state(false),
        problem = $state("");

    async function submit(e: SubmitEvent) {
        e.preventDefault();
        busy = true;
        problem = "";
        const { error } = creating
            ? await authClient.signUp.email({ name: name.trim() || email, email, password })
            : await authClient.signIn.email({ email, password });
        if (error) {
            busy = false;
            problem = error.message || "Could not sign in. Try again.";
            return;
        }
        // The editor checks the account again; one that may not edit comes back here.
        await goto(next, { invalidateAll: true });
        busy = false;
    }

    async function signOut() {
        await authClient.signOut();
        await goto(`/login?next=${encodeURIComponent(next)}`, { invalidateAll: true });
    }
</script>

<main class="sign-in-page">
    <div class="guide sign-in">
        <Logo size={36} title="" />
        <small>P-MAP EDITOR</small>
        {#if account}
            <h2>This account can't edit</h2>
            <p>
                <b>{account.email}</b> is not an admin of this hospital's map. Ask an admin to give it access, or sign in
                with another account.
            </p>
            <button class="btn primary" onclick={signOut}>Sign out</button>
        {:else}
            <h2>{creating ? "Create the admin account" : "Sign in to edit"}</h2>
            <p>
                {#if creating}There are no accounts yet. This one becomes the admin, who adds everyone else's.
                {:else}Changes are live for visitors, so only the hospital's admins can make them. No account? Ask an
                    admin to add you.{/if}
            </p>
            <form onsubmit={submit}>
                {#if creating}<label
                        >Name<input bind:value={name} autocomplete="name" required /></label
                    >{/if}
                <label>Email<input type="email" bind:value={email} autocomplete="email" required /></label>
                <label
                    >Password<input
                        type="password"
                        bind:value={password}
                        autocomplete={creating ? "new-password" : "current-password"}
                        minlength="8"
                        required
                    /></label
                >
                {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
                <button class="btn primary" disabled={busy}
                    >{busy ? "One moment…" : creating ? "Create account" : "Sign in"}</button
                >
            </form>
        {/if}
    </div>
</main>

<style>
    .sign-in-page {
        min-height: 100dvh;
        display: grid;
        place-items: center;
        padding: 16px;
    }
    .sign-in {
        width: min(400px, 100%);
    }
    .sign-in small {
        display: block;
        margin-top: 14px;
    }
    .sign-in p {
        margin: 0 0 18px;
        color: #6f7a6a;
        line-height: 1.5;
    }
    form {
        display: grid;
        gap: 12px;
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
    form .btn {
        margin-top: 6px;
    }
    .sign-in .problem {
        margin: 0;
        color: #9a4b2f;
        font-size: 12px;
    }
</style>
