<script lang="ts">
    import MapViewer from "./MapViewer.svelte";
    import { parseLayout } from "$lib/model/layout";
    import { publicUrl } from "$lib/publish";
    import { page } from "$app/state";
    import { onMount } from "svelte";
    import { Locale } from "$lib/i18n/locale.svelte";

    // The hospital from the database; it updates live as the editor saves.
    let {
        map,
        editable = false,
    }: {
        map: { data?: { slug: string; title: string; layout: string } | null; isLoading: boolean; error?: Error };
        /** Link to the editor from the map's menu. */
        editable?: boolean;
    } = $props();
    // Only for the messages before the map is there; the map keeps its own.
    const locale = new Locale();
    onMount(() => locale.restore());
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
        faq={layout.faq}
        shareUrl={publicUrl(map.data.slug, page.url.origin)}
        slug={map.data.slug}
        {editable}
    />{:else}<main class="missing">
        {#if map.isLoading}<p>{locale.t("loadingMap")}</p>{:else if map.error}<h1>{locale.t("mapFailed")}</h1>
            <p>{locale.t("mapFailedHint")}</p>{:else}<h1>{locale.t("notPublished")}</h1>
            <p>{locale.t("notPublishedHint")}</p>
            {#if editable}<a href="/editor">{locale.t("openEditor")}</a>{/if}{/if}
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
    .missing a {
        justify-self: center;
        margin-top: 8px;
        color: #1f3a2b;
    }
</style>
