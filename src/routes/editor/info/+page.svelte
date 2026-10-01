<script lang="ts">
    import { onMount } from "svelte";
    import { parseLayout, starterPieces, type Piece } from "$lib/model/layout";
    import { answered, topicOf, topics, type FaqEntry, type TopicId } from "$lib/model/faq";
    import type { Doctor } from "$lib/model/doctors";
    import { emptyNetwork, type WalkingNetwork } from "$lib/wayfinding/navigation";
    import { layoutSnapshot } from "$lib/editor/export";
    import { clinics, withDoctors, withInfo } from "$lib/editor/hospital-info";
    import { normalize } from "$lib/wayfinding/search";
    import FaqEditor from "$lib/components/editor/FaqEditor.svelte";
    import DoctorsEditor from "$lib/components/editor/DoctorsEditor.svelte";
    import ShareMenu from "$lib/components/editor/ShareMenu.svelte";
    import { HospitalStore } from "$lib/editor/saving.svelte";
    import { mergeMessage } from "$lib/editor/merge";

    type Section = TopicId | "doctors";

    // The hospital as saved in the database. This page changes only the
    // hospital information and the doctors, and saves it back.
    let title = $state("Greenfield Hospital"),
        greenery = $state(1),
        grid = $state({ width: 24, height: 20 }),
        pieces: Piece[] = $state(structuredClone(starterPieces)),
        network: WalkingNetwork = $state(emptyNetwork()),
        faq: FaqEntry[] = $state([]);
    let section = $state<Section>("pendaftaran"),
        filter = $state(""),
        /** Clinics opened to add a first doctor. */
        opened = $state<string[]>([]),
        toast = $state("");

    const snapshot = () =>
        layoutSnapshot({ title, greenery, pieces, network, faq, width: grid.width, height: grid.height });
    function load(json: string) {
        const d = parseLayout(json);
        ({ title, greenery, pieces, network, faq } = d);
        grid = { width: d.grid.width, height: d.grid.height };
    }
    // Saved to the database as it is typed; changes from the editor show up here too.
    const store = new HospitalStore(snapshot, load, (merged) => merged && notify(mergeMessage(merged.conflicts)));
    const status = {
        loading: "Loading…",
        saving: "Saving…",
        saved: "Saved · live for visitors",
        failed: "Not saved — retrying",
    };
    onMount(() => {
        const hash = location.hash.slice(1);
        if (hash === "doctors" || topics.some((t) => t.id === hash)) section = hash as Section;
    });
    function go(to: Section) {
        section = to;
        history.replaceState(history.state, "", `#${to}`);
    }
    function notify(message: string) {
        toast = message;
        setTimeout(() => (toast = ""), 2800);
    }

    // Questions.
    let topic = $derived(topics.find((t) => t.id === section));
    const count = (id: TopicId) => faq.filter((e) => topicOf(e) === id).length;
    let live = $derived(answered(faq).length);

    // Doctors.
    let all = $derived(clinics(pieces));
    let doctorCount = $derived(all.reduce((n, c) => n + (c.info?.doctors?.length ?? 0), 0));
    let shown = $derived.by(() => {
        const q = normalize(filter);
        return all
            .filter((c) => c.info?.doctors?.length || opened.includes(c.id))
            .filter(
                (c) =>
                    !q ||
                    [c.name, c.building, ...(c.info?.doctors ?? []).flatMap((d) => [d.name, d.specialty])].some((t) =>
                        normalize(t ?? "").includes(q),
                    ),
            );
    });
    let addable = $derived(all.filter((c) => !c.info?.doctors?.length && !opened.includes(c.id)));
    function setDoctors(id: string, doctors: Doctor[]) {
        const place = all.find((c) => c.id === id);
        ({ pieces, network } = withInfo(pieces, network, id, withDoctors(place?.info, doctors)));
    }
    const where = (c: (typeof all)[number]) =>
        c.kind === "building" ? "Whole building" : c.name === c.detail ? c.building : `${c.detail} · ${c.building}`;
</script>

<svelte:head><title>Hospital information — {title}</title></svelte:head>
<div class="info-page">
    <aside class="nav">
        <a class="back" href="/editor">← Back to editor</a>
        <h1>Hospital information</h1>
        <p class="lead">
            What visitors can read and ask about besides the map. Saved as you type and live straight away.
        </p>
        <nav aria-label="Sections">
            <small>Questions & answers</small>
            {#each topics as t}<button class:active={section === t.id} onclick={() => go(t.id)}
                    >{t.name.id}<span class="en">{t.name.en}</span><span class="n">{count(t.id) || ""}</span></button
                >{/each}
            <small>Doctors</small>
            <button class:active={section === "doctors"} onclick={() => go("doctors")}
                >Jadwal dokter<span class="en">Schedules</span><span class="n">{doctorCount || ""}</span></button
            >
        </nav>
        <div class="foot">
            <p class="status" class:failed={store.status === "failed"} title={store.problem}>
                <i class:pending={store.status !== "saved"}></i>{status[store.status]}
                · {live} question{live === 1 ? "" : "s"} answered
            </p>
            <ShareMenu slug={store.slug} onnotify={notify} />
        </div>
    </aside>
    <main>
        {#if store.status === "loading"}<p class="note">{store.problem || "Loading the hospital…"}</p>
        {:else if store.status === "failed"}<p class="note">{store.problem} Your changes are kept and saved once it works again.</p>{/if}
        {#if store.status === "loading"}{:else if topic}<header>
                <h2>{topic.name.id}</h2>
                <p>
                    {topic.name.en}. Visitors find these under <b>Informasi rumah sakit</b>, grouped by topic,
                    and the assistant answers from them. Write in Indonesian; the assistant also answers
                    English questions from it.
                </p>
            </header>
            <FaqEditor {faq} topic={topic.id} onchange={(next) => (faq = next)} />
        {:else}<header>
                <h2>Jadwal dokter</h2>
                <p>
                    Doctors' practice days and hours per clinic, and when they are on leave (cuti). Visitors see
                    the schedule when they choose the clinic, and find it by the doctor's name or specialty; the
                    assistant answers from it. Leave hides those days and says when the doctor is back. Click a
                    doctor to edit.
                </p>
            </header>
            {#if all.length}
                {#if doctorCount > 3}<input
                        class="filter"
                        type="search"
                        placeholder="Find a doctor, specialty or clinic"
                        bind:value={filter}
                    />{/if}
                {#each shown as c (c.id)}<section class="clinic">
                        <header>
                            <h3>{c.name}</h3>
                            <small>{where(c)}</small>
                        </header>
                        <DoctorsEditor doctors={c.info?.doctors ?? []} onchange={(d) => setDoctors(c.id, d)} />
                    </section>{:else}<p class="empty">
                        {filter ? "No doctor or clinic matches." : "No doctors yet. Choose the clinic they practise in."}
                    </p>{/each}
                {#if addable.length}<label class="add-clinic"
                        >Add doctors to<select
                            value=""
                            onchange={(e) => {
                                const id = e.currentTarget.value;
                                if (id) opened = [...opened, id];
                                filter = "";
                                e.currentTarget.value = "";
                            }}
                            ><option value="" disabled>Choose a clinic or room…</option>
                            {#each addable as c}<option value={c.id}
                                    >{c.name}{c.kind === "room" ? ` — ${c.building}` : " (building)"}</option
                                >{/each}</select
                        ></label
                    >{/if}
            {:else}<p class="note">
                    Draw the clinics first: add a building in the editor and put examination rooms in it.
                </p>{/if}
        {/if}
    </main>
</div>
{#if toast}<div class="toast" role="status"><span>✓</span>{toast}</div>{/if}

<style>
    .info-page {
        display: grid;
        grid-template-columns: 280px 1fr;
        min-height: 100dvh;
        background: #f3f5ef;
        color: #1f3a2b;
    }
    .nav {
        position: sticky;
        top: 0;
        height: 100dvh;
        overflow: auto;
        padding: 24px 18px;
        background: white;
        border-right: 1px solid #dfe4d9;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .back {
        color: #52664a;
        text-decoration: none;
        font-size: 12px;
    }
    h1 {
        margin: 0;
        font:
            24px Georgia,
            serif;
    }
    .lead {
        margin: 0;
        font-size: 12px;
        line-height: 1.5;
        color: #6f7c69;
    }
    nav {
        display: flex;
        flex-direction: column;
        gap: 1px;
    }
    nav small {
        margin: 12px 8px 4px;
        font-size: 10px;
        letter-spacing: 1.2px;
        text-transform: uppercase;
        color: #7b8c70;
    }
    nav button {
        display: flex;
        align-items: baseline;
        gap: 6px;
        padding: 8px 10px;
        border-radius: 7px;
        text-align: left;
        font-size: 13px;
        color: #2f4336;
    }
    nav button:hover {
        background: #f3f6ef;
    }
    nav button.active {
        background: #2d4a38;
        color: white;
    }
    nav .en {
        font-size: 11px;
        opacity: 0.6;
    }
    nav .n {
        margin-left: auto;
        font-size: 11px;
        opacity: 0.75;
    }
    .foot {
        margin-top: auto;
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .status {
        margin: 0;
        font-size: 11px;
        color: #6f7c69;
    }
    .status i {
        display: inline-block;
        width: 7px;
        height: 7px;
        margin-right: 6px;
        border-radius: 50%;
        background: #5b9b64;
    }
    .status i.pending {
        background: #d0a54a;
    }
    .status.failed {
        color: #9a4b2f;
    }
    .status.failed i {
        background: #c4623f;
    }
    .foot :global(.publish-panel) {
        top: auto;
        bottom: calc(100% + 8px);
        left: 0;
        right: auto;
    }
    main {
        display: block;
        width: 100%;
        max-width: 760px;
        height: auto;
        padding: 32px 40px 80px;
        min-height: 0;
        margin: 0;
        border: 0;
        border-radius: 0;
        overflow: visible;
        background: none;
        box-shadow: none;
        font-weight: normal;
    }
    main > header {
        margin-bottom: 18px;
    }
    h2 {
        margin: 0 0 6px;
        font:
            28px Georgia,
            serif;
    }
    main > header p {
        margin: 0;
        font-size: 13px;
        line-height: 1.55;
        color: #6f7c69;
    }
    .note {
        padding: 10px 12px;
        border-radius: 8px;
        background: #fff4df;
        color: #785e33;
        font-size: 13px;
    }
    .empty {
        color: #738466;
        font-size: 13px;
    }
    .filter,
    .add-clinic select {
        display: block;
        width: 100%;
        padding: 9px 12px;
        border: 1px solid #dce3d4;
        border-radius: 8px;
        background: white;
        font: inherit;
        font-size: 13px;
    }
    .filter {
        margin-bottom: 14px;
    }
    .clinic {
        margin-bottom: 14px;
        padding: 14px 16px 8px;
        border: 1px solid #dfe6d8;
        border-radius: 12px;
        background: white;
    }
    .clinic header {
        display: flex;
        align-items: baseline;
        gap: 8px;
        margin-bottom: 10px;
    }
    h3 {
        margin: 0;
        font-size: 15px;
    }
    .clinic header small {
        color: #7b8c70;
        font-size: 12px;
    }
    .add-clinic {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 11px;
        color: #738466;
    }
    @media (max-width: 760px) {
        .info-page {
            grid-template-columns: 1fr;
        }
        .nav {
            position: static;
            height: auto;
        }
        main {
            padding: 20px 16px 60px;
        }
    }
</style>
