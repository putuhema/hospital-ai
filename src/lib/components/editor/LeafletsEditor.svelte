<script lang="ts">
    import { upload } from "@vercel/blob/client";
    import { useConvexClient, useQuery } from "convex-svelte";
    import { api } from "../../../convex/_generated/api";
    import type { Id } from "../../../convex/_generated/dataModel";
    import { topics, type TopicId } from "$lib/model/faq";
    import { LEAFLET_TYPES, MAX_LEAFLET_TEXT, MAX_LEAFLET_TITLE, MAX_LEAFLETS, type Leaflet } from "$lib/model/leaflets";
    import { readyImage, titleFrom } from "$lib/editor/leaflet-image";

    let { slug, onnotify }: { slug: string | null; onnotify: (message: string) => void } = $props();

    // Saved in Convex as they change (convex/leaflets.ts); the images go straight to Vercel Blob.
    const convex = useConvexClient();
    const leaflets = useQuery(api.leaflets.list, () => ({ slug: slug ?? undefined }));
    let list = $derived(leaflets.data ?? []);

    /** Uploads and readings in progress, shown above the list. */
    let working = $state<{ key: number; name: string; step: string }[]>([]),
        reading = $state<string[]>([]),
        problem = $state(""),
        dragging = $state(false);
    let key = 0;
    const step = (k: number, text: string) => (working = working.map((w) => (w.key === k ? { ...w, step: text } : w)));

    async function failure(res: Response) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        return body?.error ?? `The server answered ${res.status}`;
    }

    async function add(files: FileList | File[] | null) {
        problem = "";
        const chosen = [...(files ?? [])].filter((f) => LEAFLET_TYPES.includes(f.type));
        if (files?.length && !chosen.length) problem = "Choose JPEG, PNG, WebP or GIF images.";
        for (const file of chosen.slice(0, Math.max(0, MAX_LEAFLETS - list.length))) {
            const k = ++key;
            working = [...working, { key: k, name: file.name, step: "Preparing…" }];
            try {
                const image = await readyImage(file);
                step(k, "Uploading…");
                const blob = await upload(`leaflets/${slug ?? "hospital"}/${image.name}`, image.body, {
                    access: "public",
                    handleUploadUrl: "/api/leaflets",
                    contentType: image.body.type,
                    onUploadProgress: ({ percentage }) => step(k, `Uploading… ${Math.round(percentage)}%`),
                });
                const id = await convex.mutation(api.leaflets.add, {
                    slug: slug ?? undefined,
                    url: blob.url,
                    title: titleFrom(file.name).slice(0, MAX_LEAFLET_TITLE),
                    width: image.width,
                    height: image.height,
                });
                working = working.filter((w) => w.key !== k);
                // Its text is read straight away; the admin checks it.
                void read({ id, url: blob.url, title: "", text: "", topic: "lainnya" }, true);
            } catch (err) {
                working = working.filter((w) => w.key !== k);
                problem = `${file.name}: ${err instanceof Error ? err.message : "couldn't be uploaded"}`;
            }
        }
    }

    /** Write out what the leaflet says, with a vision model (routes/api/leaflets/read). */
    async function read(l: Leaflet, fresh = false) {
        if (!fresh && l.text.trim() && !confirm("Replace the text written for this leaflet with what's read from the image?")) return;
        reading = [...reading, l.id];
        try {
            const res = await fetch("/api/leaflets/read", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ url: l.url }),
            });
            if (!res.ok) throw Error(await failure(res));
            const found = (await res.json()) as { title: string; text: string };
            const now = list.find((x) => x.id === l.id);
            await convex.mutation(api.leaflets.update, {
                id: l.id as Id<"leaflets">,
                text: found.text,
                // A title typed already stays; one taken from the file name is replaced.
                ...(found.title && (fresh || !now?.title) && { title: found.title }),
            });
            onnotify("Text read from the leaflet — check it below");
        } catch (err) {
            problem = `Couldn't read the text: ${err instanceof Error ? err.message : "try again"}. You can write it by hand.`;
        } finally {
            reading = reading.filter((id) => id !== l.id);
        }
    }

    async function change(l: Leaflet, patch: { title?: string; text?: string; topic?: TopicId }) {
        try {
            await convex.mutation(api.leaflets.update, { id: l.id as Id<"leaflets">, ...patch });
        } catch (err) {
            problem = err instanceof Error ? err.message : "Not saved — try again";
        }
    }

    async function remove(l: Leaflet) {
        if (!confirm(`Remove “${l.title || "this leaflet"}”? Visitors won't see it any more.`)) return;
        try {
            const url = await convex.mutation(api.leaflets.remove, { id: l.id as Id<"leaflets"> });
            // The image goes too; if that fails it is only an unused file.
            if (url)
                await fetch("/api/leaflets", {
                    method: "DELETE",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ url }),
                }).catch(() => null);
            onnotify("Leaflet removed");
        } catch (err) {
            problem = err instanceof Error ? err.message : "Couldn't remove it — try again";
        }
    }
</script>

<div class="leaflets">
    <label
        class="drop"
        class:dragging
        class:full={list.length >= MAX_LEAFLETS}
        ondragover={(e) => {
            e.preventDefault();
            dragging = true;
        }}
        ondragleave={() => (dragging = false)}
        ondrop={(e) => {
            e.preventDefault();
            dragging = false;
            void add(e.dataTransfer?.files ?? null);
        }}
    >
        <input
            type="file"
            accept={LEAFLET_TYPES.join(",")}
            multiple
            disabled={list.length >= MAX_LEAFLETS}
            onchange={(e) => {
                void add(e.currentTarget.files);
                e.currentTarget.value = "";
            }}
        />
        <b>{list.length >= MAX_LEAFLETS ? `That's the most a hospital can hold (${MAX_LEAFLETS})` : "+ Upload leaflets"}</b>
        <small>Drop images here or click to choose: photos or scans of brochures, posters and notices (JPEG, PNG, WebP).</small>
    </label>
    {#if problem}<p class="problem">{problem}</p>{/if}
    {#each working as w (w.key)}<p class="working"><i></i>{w.name} · {w.step}</p>{/each}

    {#if leaflets.error}<p class="problem">Couldn't load the leaflets: {leaflets.error.message}</p>
    {:else if leaflets.isLoading}<p class="empty">Loading…</p>
    {:else}
        {#each list as l (l.id)}<article class="leaflet">
                <a class="thumb" href={l.url} target="_blank" rel="noopener" title="Open the image"
                    ><img src={l.url} alt={l.title} loading="lazy" /></a
                >
                <div class="fields">
                    <div class="row">
                        <input
                            aria-label="Title"
                            maxlength={MAX_LEAFLET_TITLE}
                            placeholder="e.g. Alur pendaftaran pasien BPJS"
                            value={l.title}
                            onchange={(e) => change(l, { title: e.currentTarget.value })}
                        />
                        <select
                            aria-label="Topic"
                            value={l.topic}
                            onchange={(e) => change(l, { topic: e.currentTarget.value as TopicId })}
                            >{#each topics as t}<option value={t.id}>{t.name.id}</option>{/each}</select
                        >
                    </div>
                    <textarea
                        aria-label="What the leaflet says"
                        rows="6"
                        maxlength={MAX_LEAFLET_TEXT}
                        placeholder="What the leaflet says, written out: steps, times, prices, phone numbers. AIRMA answers from this and shows the image."
                        value={l.text}
                        disabled={reading.includes(l.id)}
                        onchange={(e) => change(l, { text: e.currentTarget.value })}
                    ></textarea>
                    {#if !l.text.trim() && !reading.includes(l.id)}<p class="draft">
                            Without its text AIRMA knows only the title. Read it from the image or write it here.
                        </p>{/if}
                    <div class="actions">
                        <button class="btn" disabled={reading.includes(l.id)} onclick={() => read(l)}
                            >{reading.includes(l.id) ? "Reading the image…" : "Read text from image"}</button
                        >
                        <button class="remove" onclick={() => remove(l)}>Remove</button>
                    </div>
                </div>
            </article>{:else}{#if !working.length}<p class="empty">No leaflets yet.</p>{/if}{/each}
    {/if}
</div>

<style>
    .drop {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 18px;
        margin-bottom: 14px;
        border: 1.5px dashed #c9d4c0;
        border-radius: 12px;
        background: white;
        cursor: pointer;
        color: #2f4336;
        transition:
            border-color 150ms,
            background 150ms;
    }
    .drop input {
        position: absolute;
        inset: 0;
        opacity: 0;
        cursor: pointer;
    }
    .drop.dragging,
    .drop:hover {
        border-color: #5b9b64;
        background: #f6faf2;
    }
    .drop.full {
        cursor: default;
        opacity: 0.6;
    }
    .drop b {
        font-size: 14px;
    }
    .drop small {
        font-size: 12px;
        color: #6f7c69;
    }
    .problem {
        margin: 0 0 12px;
        padding: 9px 12px;
        border-radius: 8px;
        background: #fbeee8;
        color: #8a3f28;
        font-size: 12.5px;
    }
    .working {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0 0 8px;
        font-size: 12.5px;
        color: #52664a;
    }
    .working i {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #d0a54a;
        animation: pulse 1s ease-in-out infinite alternate;
    }
    @keyframes pulse {
        to {
            opacity: 0.3;
        }
    }
    .leaflet {
        display: grid;
        grid-template-columns: 120px 1fr;
        gap: 14px;
        margin-bottom: 14px;
        padding: 14px;
        border: 1px solid #dfe6d8;
        border-radius: 12px;
        background: white;
    }
    .thumb {
        display: block;
        align-self: start;
        overflow: hidden;
        border-radius: 8px;
        background: #f3f5ef;
        box-shadow: 0 0 0 1px #dfe6d8;
    }
    .thumb img {
        display: block;
        width: 100%;
        max-height: 180px;
        object-fit: cover;
        object-position: top;
    }
    .fields {
        min-width: 0;
    }
    .row {
        display: flex;
        gap: 8px;
    }
    input,
    select,
    textarea {
        display: block;
        width: 100%;
        padding: 8px 10px;
        border: 1px solid #dce3d4;
        border-radius: 6px;
        background: white;
        font: inherit;
        font-size: 13px;
        line-height: 1.5;
    }
    input {
        flex: 1;
        min-width: 0;
        font-weight: 600;
    }
    select {
        width: auto;
        font-size: 12px;
        color: #52664a;
    }
    textarea {
        margin-top: 8px;
        resize: vertical;
    }
    textarea:disabled {
        opacity: 0.55;
    }
    .draft,
    .empty {
        margin: 6px 0 0;
        font-size: 11px;
        color: #9a7a3c;
    }
    .empty {
        color: #738466;
        font-size: 13px;
    }
    .actions {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 8px;
    }
    .actions .btn {
        font-size: 12px;
    }
    .remove {
        margin-left: auto;
        font-size: 12px;
        color: #9a4d3c;
    }
    @media (max-width: 560px) {
        .leaflet {
            grid-template-columns: 1fr;
        }
        .thumb img {
            max-height: 220px;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .working i {
            animation: none;
        }
    }
</style>
