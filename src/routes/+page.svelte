<script lang="ts">
    import { onMount } from "svelte";
    import MapViewer from "$lib/components/map/MapViewer.svelte";
    import { starterPieces, parseLayout, STORAGE_KEY, type Piece } from "$lib/model/layout";
    import { emptyNetwork, type WalkingNetwork } from "$lib/wayfinding/navigation";
    import type { FaqEntry } from "$lib/model/faq";
    import { publicUrl, readPublication } from "$lib/publish";

    // The map as saved by the editor in this browser. Visitors on other
    // devices use the published copy at /m/<slug>.
    let pieces: Piece[] = $state(structuredClone(starterPieces));
    let network: WalkingNetwork = $state(emptyNetwork());
    let faq: FaqEntry[] = $state([]);
    let title = $state("Greenfield Hospital"),
        canvasWidth = $state(24),
        canvasHeight = $state(20),
        error = $state<"savedLayoutFailed" | null>(null),
        shareUrl = $state<string | null>(null),
        ready = $state(false);
    onMount(() => {
        function load() {
            try {
                const saved = localStorage.getItem(STORAGE_KEY);
                if (saved) {
                    const d = parseLayout(saved);
                    pieces = d.pieces;
                    network = d.network;
                    faq = d.faq;
                    title = d.title;
                    canvasWidth = d.grid.width;
                    canvasHeight = d.grid.height;
                }
                error = null;
            } catch {
                error = "savedLayoutFailed";
            }
            const publication = readPublication();
            shareUrl = publication && publicUrl(publication.slug);
        }
        load();
        ready = true;
        function changed(e: StorageEvent) {
            if (e.key === STORAGE_KEY) load();
        }
        window.addEventListener("storage", changed);
        return () => window.removeEventListener("storage", changed);
    });
</script>

{#if ready}<MapViewer
        {title}
        {pieces}
        {network}
        {canvasWidth}
        {canvasHeight}
        {faq}
        {shareUrl}
        editable
        notice={error}
    />{:else}<div class="blank"></div>{/if}

<style>
    .blank {
        height: 100dvh;
        background: #edf0e7;
    }
</style>
