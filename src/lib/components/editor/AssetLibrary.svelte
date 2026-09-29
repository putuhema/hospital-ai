<script lang="ts">
    import { assets } from "$lib/model/layout";
    import { pieceType } from "$lib/model/interiors";
    import Icon from "./Icon.svelte";
    let {
        active = $bindable(),
        hidden,
        onnotify,
    }: {
        /** Index into `assets` of the asset being placed. */
        active: number | null;
        hidden: boolean;
        onnotify: (message: string) => void;
    } = $props();
    const categories = ["All assets", "Buildings", "Corridors", "Outdoor", "Templates"];
    let category = $state("All assets"),
        search = $state("");
    let filtered = $derived(
        assets
            .map((a, i) => ({ ...a, i }))
            .filter(
                (a) =>
                    (a.name + " " + (a.description ?? ""))
                        .toLowerCase()
                        .includes(search.toLowerCase()) &&
                    (category === "All assets" || a.group === category),
            ),
    );
    function pick(a: (typeof filtered)[number]) {
        active = active === a.i ? null : a.i;
        onnotify(
            active === null
                ? "Selection tool active"
                : "Click an empty grid area to place " + a.name,
        );
    }
</script>

<aside class="library" id="asset-panel" aria-label="Asset library" {hidden}>
    <div class="section-heading">
        <h2>Asset library</h2>
        <span class="count">{String(assets.length).padStart(2, "0")}</span>
    </div>
    <p class="muted">The building blocks of your hospital.</p>
    <div class="search">
        <Icon name="search" size={16} /><input
            placeholder="Search assets…"
            bind:value={search}
            aria-label="Search assets"
        /><kbd>⌕</kbd>
    </div>
    <div class="tabs">
        {#each categories as c}<button
                title={c}
                class:active={category === c}
                onclick={() => (category = c)}>{c === "All assets" ? "All" : c}</button
            >{/each}
    </div>
    <div class="asset-section">
        <span
            >{category === "Corridors"
                ? "MODULAR CORRIDORS"
                : category === "Outdoor"
                  ? "PATHS, PARKING & GATES"
                  : category === "Templates"
                  ? "READY-MADE DEPARTMENTS"
                  : "HOSPITAL ESSENTIALS"}</span
        ><span>{filtered.length} {filtered.length === 1 ? "asset" : "assets"}</span>
    </div>
    <div class="assets">
        {#each filtered as a}<button
                class="asset"
                class:chosen={active === a.i}
                onclick={() => pick(a)}
                ><div class="asset-preview" style={`--asset-color:${a.color}`}>
                    {#if a.group === "Templates"}<span class="template-badge"
                            >{a.roomAssets?.length} rooms</span
                        >{/if}
                    <img
                        class="asset-render"
                        src={`${a.image ?? `/models/${a.kind}.png`}?v=continuous-corridor-4`}
                        alt={`${a.name} model`}
                    /><span class="asset-add">+</span>
                </div>
                <strong>{a.name}</strong><small
                    >{a.description ??
                        `${a.w} × ${a.h} tiles · ${pieceType(a)}`}</small
                ></button
            >{/each}
    </div>
    {#if !filtered.length}<p class="empty">No matching assets.</p>{/if}
    <div class="library-tip">
        <span>↖</span>
        <p>
            <b>A place for every space</b>Pick an asset, then click the ground to place it.
            Templates come with rooms already inside.
        </p>
    </div>
    <div class="library-footer">
        <Icon name="cube" size={16} /> Blender-authored models
    </div>
</aside>
