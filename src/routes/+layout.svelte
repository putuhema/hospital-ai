<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.png';
	import { setupConvex } from 'convex-svelte';
	import { PUBLIC_CONVEX_URL } from '$env/static/public';

	setupConvex(PUBLIC_CONVEX_URL);

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
