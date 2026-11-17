<script lang="ts">
    import SignIn from "$lib/components/editor/SignIn.svelte";

    let { data } = $props();
</script>

<svelte:head><title>Sign in · AIRMA Editor</title></svelte:head>
<SignIn account={data.account} next={data.next} first={data.first} />
