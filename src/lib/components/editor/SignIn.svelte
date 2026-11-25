<script lang="ts">
    import { goto } from "$app/navigation";
    import { authClient } from "$lib/auth-client";
    import Icon from "./Icon.svelte";

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

    const creating = $derived(first);
    let name = $state(""),
        email = $state(""),
        password = $state(""),
        showPassword = $state(false),
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
        await goto(next, { invalidateAll: true });
        busy = false;
    }

    async function signOut() {
        await authClient.signOut();
        await goto(`/login?next=${encodeURIComponent(next)}`, { invalidateAll: true });
    }
</script>

<div class="login-shell">
    <section class="brand-pane" aria-hidden="true">
        <div class="brand-top">
            <div class="mascot-badge">
                <img src="/mascot/airma-front.webp" width="44" height="44" alt="" draggable="false" />
            </div>
            <div>
                <div class="brand-name">AIRMA Studio</div>
                <div class="brand-sub">Hospital Wayfinding &amp; Assistant</div>
            </div>
        </div>

        <div class="brand-hero">
            <h1>Guide every visitor with clarity.</h1>
            <p>
                Design your 3D hospital campus, keep clinic hours and doctors in sync, and answer visitor questions
                from one calm workspace.
            </p>
        </div>

        <div class="live-card">
            <span class="pulse"></span>
            <span>Every edit saves automatically and publishes straight to visitor phones &amp; QR signs.</span>
        </div>
    </section>

    <section class="form-pane">
        <div class="form-card">
            <div class="mobile-brand">
                <img src="/mascot/airma-head.webp" width="36" height="36" alt="" draggable="false" />
                <span>AIRMA Studio</span>
            </div>

            {#if account}
                <span class="eyebrow">ACCESS REQUIRED</span>
                <h2>This account can't edit</h2>
                <p class="lead">
                    <b>{account.email}</b> is not an admin for this hospital's map. Ask an existing admin to grant
                    access, or sign in with an admin account.
                </p>
                <button class="btn primary submit-btn" onclick={signOut}>Sign out</button>
            {:else}
                <span class="eyebrow">{creating ? "FIRST-TIME SETUP" : "ADMIN SIGN IN"}</span>
                <h2>{creating ? "Create the admin account" : "Sign in to edit"}</h2>
                <p class="lead">
                    {#if creating}
                        There are no accounts yet. This first account becomes the hospital admin and can invite
                        everyone else.
                    {:else}
                        Changes are live for visitors straight away, so only hospital admins can edit the map and
                        schedules.
                    {/if}
                </p>

                <form onsubmit={submit}>
                    {#if creating}
                        <label class="field-group">
                            <span>Full name</span>
                            <input
                                type="text"
                                placeholder="e.g. dr. Rina Kusuma"
                                bind:value={name}
                                autocomplete="name"
                                required
                            />
                        </label>
                    {/if}

                    <label class="field-group">
                        <span>Work email</span>
                        <input
                            type="email"
                            placeholder="admin@hospital.org"
                            bind:value={email}
                            autocomplete="email"
                            required
                        />
                    </label>

                    <label class="field-group">
                        <span>Password</span>
                        <div class="password-wrap">
                            <input
                                type={showPassword ? "text" : "password"}
                                placeholder="At least 8 characters"
                                bind:value={password}
                                autocomplete={creating ? "new-password" : "current-password"}
                                minlength="8"
                                required
                            />
                            <button
                                type="button"
                                class="toggle-pw"
                                aria-label={showPassword ? "Hide password" : "Show password"}
                                onclick={() => (showPassword = !showPassword)}
                            >
                                <Icon name={showPassword ? "eye-off" : "eye"} size={16} />
                            </button>
                        </div>
                    </label>

                    {#if problem}
                        <p class="problem" role="alert">{problem}</p>
                    {/if}

                    <button class="btn primary submit-btn" disabled={busy}>
                        {busy ? "One moment…" : creating ? "Create admin account" : "Sign in to AIRMA"}
                    </button>
                </form>

                {#if !creating}
                    <p class="foot-note">No account yet? Ask a hospital admin to add you under Accounts.</p>
                {/if}
            {/if}
        </div>
    </section>
</div>

<style>
    .login-shell {
        min-height: 100dvh;
        display: grid;
        grid-template-columns: minmax(340px, 44%) 1fr;
        background: var(--bg);
    }

    .brand-pane {
        position: relative;
        overflow: hidden;
        padding: 40px 44px;
        background: linear-gradient(155deg, #1e4031 0%, #2a5642 58%, #3c7157 100%);
        color: #ffffff;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 32px;
    }

    .brand-pane::after {
        content: "";
        position: absolute;
        inset: 0;
        background-image: radial-gradient(rgba(255, 255, 255, 0.13) 1px, transparent 1px);
        background-size: 20px 20px;
        pointer-events: none;
    }

    .brand-top,
    .brand-hero,
    .live-card {
        position: relative;
        z-index: 1;
    }

    .brand-top {
        display: flex;
        align-items: center;
        gap: 14px;
    }

    .mascot-badge {
        width: 52px;
        height: 52px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.14);
        border: 1px solid rgba(255, 255, 255, 0.2);
        display: grid;
        place-items: center;
        flex-shrink: 0;
    }

    .mascot-badge img {
        width: 40px;
        height: 40px;
        object-fit: contain;
        user-select: none;
        -webkit-user-drag: none;
    }

    .brand-name {
        font-size: 16px;
        font-weight: 700;
        letter-spacing: 0.01em;
    }

    .brand-sub {
        font-size: 12.5px;
        opacity: 0.78;
        margin-top: 2px;
    }

    .brand-hero {
        max-width: 400px;
    }

    .brand-hero h1 {
        margin: 0 0 14px;
        font-family: var(--font-serif);
        font-size: clamp(28px, 3vw, 38px);
        font-weight: 500;
        line-height: 1.15;
        letter-spacing: -0.02em;
    }

    .brand-hero p {
        margin: 0;
        font-size: 14.5px;
        line-height: 1.6;
        opacity: 0.86;
    }

    .live-card {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 16px;
        border-radius: var(--radius-lg);
        background: rgba(255, 255, 255, 0.11);
        border: 1px solid rgba(255, 255, 255, 0.18);
        font-size: 13px;
        line-height: 1.45;
    }

    .pulse {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: #5ee68a;
        box-shadow: 0 0 0 4px rgba(94, 230, 138, 0.25);
        flex-shrink: 0;
    }

    .form-pane {
        background: var(--surface);
        display: grid;
        place-items: center;
        padding: 32px 24px;
    }

    .form-card {
        width: min(390px, 100%);
    }

    .mobile-brand {
        display: none;
        align-items: center;
        gap: 10px;
        margin-bottom: 20px;
        font-weight: 700;
        font-size: 15px;
        color: var(--ink);
    }

    .eyebrow {
        display: inline-block;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.1em;
        color: var(--accent);
        background: var(--accent-soft);
        padding: 3px 9px;
        border-radius: 999px;
        margin-bottom: 12px;
    }

    h2 {
        margin: 0 0 8px;
        font-family: var(--font-serif);
        font-size: 28px;
        font-weight: 550;
        letter-spacing: -0.02em;
        color: var(--ink);
    }

    .lead {
        margin: 0 0 24px;
        font-size: 13.5px;
        color: var(--muted);
        line-height: 1.55;
    }

    form {
        display: grid;
        gap: 16px;
    }

    .field-group {
        display: grid;
        gap: 6px;
    }

    .field-group > span {
        font-size: 12.5px;
        font-weight: 600;
        color: var(--ink);
    }

    .field-group input {
        width: 100%;
        height: 42px;
        padding: 0 13px;
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        background: var(--surface-subtle);
        font-size: 14px;
        color: var(--ink);
        transition: border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
    }

    .field-group input:focus {
        background: var(--surface);
    }

    .password-wrap {
        position: relative;
        display: flex;
        align-items: center;
    }

    .password-wrap input {
        padding-right: 42px;
    }

    .toggle-pw {
        position: absolute;
        right: 6px;
        width: 32px;
        height: 32px;
        border-radius: var(--radius-sm);
        display: grid;
        place-items: center;
        color: var(--muted);
    }

    .toggle-pw:hover {
        color: var(--ink);
        background: var(--surface-2);
    }

    .submit-btn {
        height: 42px;
        width: 100%;
        margin-top: 4px;
        font-size: 14px;
        font-weight: 600;
    }

    .problem {
        margin: 0;
        padding: 10px 12px;
        border-radius: var(--radius-md);
        background: var(--danger-bg);
        color: var(--danger);
        font-size: 13px;
        line-height: 1.45;
    }

    .foot-note {
        margin: 22px 0 0;
        padding-top: 16px;
        border-top: 1px solid var(--border);
        font-size: 12.5px;
        color: var(--muted);
        text-align: center;
    }

    @media (max-width: 840px) {
        .login-shell {
            grid-template-columns: 1fr;
        }
        .brand-pane {
            display: none;
        }
        .mobile-brand {
            display: flex;
        }
    }
</style>
