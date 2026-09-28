<script lang="ts">
    import MapViewer from "$lib/components/map/MapViewer.svelte";
    import { parseLayout } from "$lib/model/layout";
    import { publicUrl } from "$lib/publish";
    import { page } from "$app/state";

    // The published map; it updates live when the editor publishes again.
    let { data } = $props();
    const map = $derived(data.map);
    const layout = $derived.by(() => {
        if (!map.data) return null;
        try {
            return parseLayout(map.data.layout);
        } catch {
            return null;
        }
    });
</script>

<svelte:head>
    {#if map.data}<title>{map.data.title} — P-Map</title>{:else}<title>P-Map</title>{/if}
</svelte:head>
{#if layout && map.data}<MapViewer
        title={layout.title}
        pieces={layout.pieces}
        network={layout.network}
        canvasWidth={layout.grid.width}
        canvasHeight={layout.grid.height}
        shareUrl={publicUrl(map.data.slug, page.url.origin)}
    />{:else}<main class="missing">
        {#if map.isLoading}<p>Loading the map…</p>{:else if map.error}<h1>The map could not be loaded</h1>
            <p>Check your connection and try again.</p>{:else}<h1>This map isn't published</h1>
            <p>The link may be mistyped, or the map was taken down. Ask at reception for directions.</p>{/if}
    </main>{/if}

<style>
    .missing {
        min-height: 100dvh;
        display: grid;
        place-content: center;
        gap: 8px;
        padding: 24px;
        text-align: center;
        background: #edf0e7;
        color: #52664a;
    }
    .missing h1 {
        margin: 0;
        font:
            24px Georgia,
            serif;
        color: #1f3a2b;
    }
    .missing p {
        margin: 0;
    }
</style>
