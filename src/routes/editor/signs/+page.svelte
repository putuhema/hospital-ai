<script lang="ts">
    import { useQuery } from "convex-svelte";
    import { renderSVG } from "uqr";
    import { api } from "../../../convex/_generated/api";
    import EditorRail from "$lib/components/editor/EditorRail.svelte";
    import FloorPlan from "$lib/components/shared/FloorPlan.svelte";
    import Logo from "$lib/components/shared/Logo.svelte";
    import { parseLayout } from "$lib/model/layout";
    import { publicUrl } from "$lib/publish";
    import { signLink, signablePlaces, suggestedSpots } from "$lib/signs";
    import { places, type Place } from "$lib/wayfinding/routing";

    const hospital = useQuery(api.hospital.get, {});
    let layout = $derived.by(() => {
        if (!hospital.data) return null;
        try {
            return parseLayout(hospital.data.layout);
        } catch {
            return null;
        }
    });
    let mapUrl = $derived(hospital.data ? publicUrl(hospital.data.slug) : "");
    let list = $derived(layout ? signablePlaces(places(layout.pieces, layout.network)) : []);
    let landmarks = $derived(layout?.network.nodes.filter((n) => n.name.trim()) ?? []);

    let CHOSEN = $derived(`p-map-signs:${hospital.data?.slug}`);
    let chosen = $state<string[] | null>(null);
    $effect(() => {
        if (chosen || !list.length) return;
        try {
            chosen = JSON.parse(localStorage.getItem(CHOSEN) ?? "null");
        } catch {}
        chosen ??= suggestedSpots(list).map((p) => p.id);
    });
    $effect(() => {
        if (chosen) localStorage.setItem(CHOSEN, JSON.stringify(chosen));
    });
    let signs = $derived(list.filter((p) => chosen?.includes(p.id)));
    const toggle = (id: string) =>
        (chosen = chosen?.includes(id) ? chosen.filter((c) => c !== id) : [...(chosen ?? []), id]);

    const groups: { kind: Place["kind"]; label: string }[] = [
        { kind: "landmark", label: "Landmarks" },
        { kind: "room", label: "Rooms" },
        { kind: "building", label: "Buildings" },
    ];
    const subtitle = (p: Place) =>
        p.kind !== "room" ? "" : p.name === p.detail ? p.building : `${p.detail} · ${p.building}`;
    const qr = (link: string) => renderSVG(link, { border: 2, ecc: "M" });
</script>

<svelte:head><title>QR signs — AIRMA Editor</title></svelte:head>
<div class="admin-layout">
    <div class="rail-print-hide">
        <EditorRail />
    </div>

    <div class="signs-page">
        <aside class="controls">
            <span class="eyebrow">PRINTABLE POSTERS</span>
            <h1>“You are here” signs</h1>
            <p>
                Print a sign for each entrance, lift lobby or landmark. Visitors scan it and the map opens with that
                spot as their starting point — they only choose where they're going.
            </p>
            {#if hospital.isLoading}
                <p>Loading the hospital…</p>
            {:else if !layout}
                <p class="note">
                    {hospital.error
                        ? "Could not reach the database. Check your connection and try again."
                        : "Nothing saved yet. Open the editor to build the hospital first."}
                </p>
            {:else}
                <div class="bulk">
                    <button class="btn" onclick={() => (chosen = suggestedSpots(list).map((p) => p.id))}>
                        Suggested
                    </button>
                    <button class="btn" onclick={() => (chosen = [])}>Clear all</button>
                </div>
                {#each groups as g}
                    {@const items = list.filter((p) => p.kind === g.kind)}
                    {#if items.length}
                        <fieldset>
                            <legend>{g.label}</legend>
                            {#each items as p}
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={chosen?.includes(p.id)}
                                        onchange={() => toggle(p.id)}
                                    />
                                    <span>{p.name}</span>
                                    {#if p.building}<small>{p.building}</small>{/if}
                                </label>
                            {/each}
                        </fieldset>
                    {/if}
                {/each}
                <button class="btn primary print" disabled={!signs.length} onclick={() => print()}>
                    Print {signs.length} sign{signs.length === 1 ? "" : "s"}
                </button>
                <p class="hint">A4, one sign per page. Test one with your phone before printing them all.</p>
            {/if}
        </aside>

        <div class="sheets">
            {#if layout}
                {#each signs as p (p.id)}
                    {@const link = signLink(mapUrl, p)}
                    <article class="poster">
                        <header><Logo size={28} title="" /><span>{layout.title}</span></header>
                        <div class="here">
                            <span class="dot"></span>
                            <div>
                                <small>You are here</small>
                                <h2>{p.name}</h2>
                                {#if subtitle(p)}<p>{subtitle(p)}</p>{/if}
                            </div>
                        </div>
                        <div class="plan">
                            <FloorPlan
                                pieces={layout.pieces}
                                places={list}
                                width={layout.grid.width}
                                height={layout.grid.height}
                                {landmarks}
                                here={p.point}
                                controls={false}
                            />
                        </div>
                        <div class="scan">
                            <div class="qr">{@html qr(link)}</div>
                            <div>
                                <h3>Scan for directions</h3>
                                <p>
                                    Point your phone's camera at the code, then choose where you're going. Walking
                                    directions start from this sign.
                                </p>
                                <code>{link}</code>
                            </div>
                        </div>
                        <footer>No phone? Ask at reception for directions.</footer>
                    </article>
                {:else}
                    <p class="empty">Choose where signs go from the list on the left.</p>
                {/each}
            {/if}
        </div>
    </div>
</div>

<style>
    .admin-layout {
        display: flex;
        min-height: 100dvh;
        background: var(--canvas-bg);
    }

    .rail-print-hide {
        display: flex;
    }

    .signs-page {
        flex: 1;
        min-width: 0;
        display: grid;
        grid-template-columns: 310px 1fr;
        min-height: 100dvh;
    }

    .controls {
        position: sticky;
        top: 0;
        height: 100dvh;
        overflow: auto;
        padding: 24px 20px;
        background: var(--surface);
        border-right: 1px solid var(--border);
        display: flex;
        flex-direction: column;
        gap: 14px;
    }

    .eyebrow {
        display: inline-block;
        align-self: flex-start;
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.09em;
        color: var(--accent);
        background: var(--accent-soft);
        padding: 2px 8px;
        border-radius: 999px;
    }

    h1 {
        margin: 0;
        font-family: var(--font-serif);
        font-size: 24px;
        font-weight: 550;
        letter-spacing: -0.02em;
        color: var(--ink);
    }

    .controls p {
        margin: 0;
        font-size: 13px;
        color: var(--muted);
        line-height: 1.5;
    }

    .controls .note {
        padding: 12px 14px;
        border-radius: var(--radius-md);
        background: var(--warn-bg);
        color: var(--warn-ink);
    }

    .bulk {
        display: flex;
        gap: 8px;
    }

    .bulk .btn {
        height: 30px;
        font-size: 12px;
        padding: 0 10px;
    }

    fieldset {
        margin: 0;
        padding: 0;
        border: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    legend {
        margin-bottom: 6px;
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted-2);
    }

    label {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 6px;
        border-radius: var(--radius-sm);
        font-size: 13px;
        color: var(--ink);
        cursor: pointer;
    }

    label:hover {
        background: var(--surface-subtle);
    }

    label input[type="checkbox"] {
        accent-color: var(--accent);
    }

    label small {
        margin-left: auto;
        color: var(--muted);
        font-size: 11.5px;
    }

    .print {
        margin-top: 8px;
        height: 40px;
        font-size: 13.5px;
        font-weight: 600;
    }

    .controls .hint {
        font-size: 12px;
    }

    .sheets {
        display: flex;
        flex-wrap: wrap;
        align-content: flex-start;
        gap: 24px;
        padding: 28px;
    }

    /* One A4 sign. Shown at 45% on screen, full size on paper. */
    .poster {
        zoom: 0.45;
        width: 210mm;
        height: 297mm;
        padding: 16mm 16mm 12mm;
        display: flex;
        flex-direction: column;
        gap: 9mm;
        background: white;
        border-radius: 6px;
        box-shadow: var(--shadow-lg);
        color: #1f3a2b;
        overflow: hidden;
    }
    .poster header {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 20px;
        color: #52664a;
    }
    .poster .here {
        display: flex;
        align-items: center;
        gap: 8mm;
    }
    .poster .dot {
        flex-shrink: 0;
        width: 22mm;
        height: 22mm;
        border-radius: 50%;
        background: #2f7fc4;
        border: 4mm solid #cfe2f3;
    }
    .poster small {
        font-size: 22px;
        font-weight: 700;
        letter-spacing: 3px;
        text-transform: uppercase;
        color: #2f7fc4;
    }
    .poster h2 {
        margin: 2mm 0 0;
        font:
            60px/1.05 Georgia,
            serif;
    }
    .poster .here p {
        margin: 2mm 0 0;
        font-size: 22px;
        color: #6f7c69;
    }
    .poster .plan {
        flex: 1;
        min-height: 0;
        border: 1px solid #dfe4d9;
        border-radius: 4mm;
        overflow: hidden;
        background: #f6f8f1;
    }
    .poster .scan {
        display: flex;
        align-items: center;
        gap: 10mm;
    }
    .poster .qr {
        flex-shrink: 0;
        width: 70mm;
        height: 70mm;
    }
    .poster .qr :global(svg) {
        display: block;
        width: 100%;
        height: 100%;
    }
    .poster h3 {
        margin: 0 0 3mm;
        font-size: 34px;
    }
    .poster .scan p {
        margin: 0 0 4mm;
        font-size: 19px;
        line-height: 1.45;
        color: #52664a;
    }
    .poster code {
        font-size: 13px;
        color: #7b8c70;
        word-break: break-all;
    }
    .poster footer {
        padding-top: 5mm;
        border-top: 1px solid #dfe4d9;
        font-size: 18px;
        color: #6f7c69;
    }

    @media (max-width: 820px) {
        .signs-page {
            grid-template-columns: 1fr;
        }
        .controls {
            position: static;
            height: auto;
            border-right: 0;
            border-bottom: 1px solid var(--border);
        }
    }

    @page {
        size: A4;
        margin: 0;
    }
    @media print {
        .admin-layout,
        .signs-page {
            display: block;
            background: none;
        }
        .rail-print-hide,
        .controls,
        .empty {
            display: none;
        }
        .sheets {
            display: block;
            padding: 0;
        }
        .poster {
            zoom: 1;
            border-radius: 0;
            box-shadow: none;
            break-after: page;
        }
    }
</style>
