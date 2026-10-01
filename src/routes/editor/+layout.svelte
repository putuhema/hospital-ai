<script lang="ts">
    import { goto } from "$app/navigation";
    import { page } from "$app/state";
    import { createSvelteAuthClient, useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
    import { authClient } from "$lib/auth-client";

    let { children } = $props();

    // The server let only a signed-in editor in (+layout.server.ts); saving to Convex uses the same session.
    // Visitors' pages never load this.
    createSvelteAuthClient({ authClient, getServerState: () => ({ isAuthenticated: true }) });
    const auth = useAuth();
    // Signed out, here or in another tab: back to sign-in.
    $effect(() => {
        if (!auth.isLoading && !auth.isAuthenticated)
            goto(`/login?next=${encodeURIComponent(page.url.pathname + page.url.search)}`);
    });
</script>

{@render children()}
