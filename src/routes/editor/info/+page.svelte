<script lang="ts">
    import { onMount } from "svelte";
    import { parseLayout, starterPieces, type Piece } from "$lib/model/layout";
    import { answered, MAX_FAQ, topicOf, topics, type FaqEntry, type TopicId } from "$lib/model/faq";
    import type { Doctor } from "$lib/model/doctors";
    import { emptyNetwork, type WalkingNetwork } from "$lib/wayfinding/navigation";
    import { layoutSnapshot } from "$lib/editor/export";
    import { clinics, withDoctors, withInfo } from "$lib/editor/hospital-info";
    import { normalize } from "$lib/wayfinding/search";
    import EditorRail from "$lib/components/editor/EditorRail.svelte";
    import FaqEditor from "$lib/components/editor/FaqEditor.svelte";
    import GapsList from "$lib/components/editor/GapsList.svelte";
    import DoctorsEditor from "$lib/components/editor/DoctorsEditor.svelte";
    import LeafletsEditor from "$lib/components/editor/LeafletsEditor.svelte";
    import ShareMenu from "$lib/components/editor/ShareMenu.svelte";
    import { HospitalStore } from "$lib/editor/saving.svelte";
    import { mergeMessage } from "$lib/editor/merge";
    import { useConvexClient, useQuery } from "convex-svelte";
    import { api } from "../../../convex/_generated/api";
    import { places, type Place } from "$lib/wayfinding/routing";

    type Section = TopicId | "doctors" | "unanswered" | "leaflets" | "analytics";

    let title = $state("Greenfield Hospital"),
        greenery = $state(1),
        grid = $state({ width: 24, height: 20, tileMeters: 2 }),
        pieces: Piece[] = $state(structuredClone(starterPieces)),
        network: WalkingNetwork = $state(emptyNetwork()),
        faq: FaqEntry[] = $state([]);
    let section = $state<Section>("pendaftaran"),
        filter = $state(""),
        opened = $state<string[]>([]),
        toast = $state("");

    const snapshot = () =>
        layoutSnapshot({
            title,
            greenery,
            pieces,
            network,
            faq,
            width: grid.width,
            height: grid.height,
            tileMeters: grid.tileMeters,
        });
    function load(json: string) {
        const d = parseLayout(json);
        ({ title, greenery, pieces, network, faq } = d);
        grid = { width: d.grid.width, height: d.grid.height, tileMeters: d.grid.tileMeters };
    }
    const store = new HospitalStore(snapshot, load, (merged) => merged && notify(mergeMessage(merged.conflicts)));
    const status = {
        loading: "Loading…",
        saving: "Saving…",
        saved: "Live for visitors",
        failed: "Not saved — retrying",
    };
    onMount(() => {
        const hash = location.hash.slice(1);
        if (
            hash === "doctors" ||
            hash === "unanswered" ||
            hash === "leaflets" ||
            hash === "analytics" ||
            topics.some((t) => t.id === hash)
        )
            section = hash as Section;
    });
    function go(to: Section) {
        section = to;
        history.replaceState(history.state, "", `#${to}`);
    }
    function notify(message: string) {
        toast = message;
        setTimeout(() => (toast = ""), 2800);
    }

    // Questions & KPIs.
    let topic = $derived(topics.find((t) => t.id === section));
    const count = (id: TopicId) => faq.filter((e) => topicOf(e) === id).length;
    let live = $derived(answered(faq).length);
    let mappedCount = $derived(places(pieces, network).length);

    const convex = useConvexClient();
    const gaps = useQuery(api.gaps.list, () => ({ slug: store.slug ?? undefined }));
    const leaflets = useQuery(api.leaflets.list, () => ({ slug: store.slug ?? undefined }));
    const insights = useQuery(api.analytics.summary, () => ({ slug: store.slug ?? undefined }));
    let open = $derived(gaps.data ?? []);

    function answer(gap: (typeof open)[number]) {
        if (faq.length >= MAX_FAQ) return notify(`That's the most questions a map can hold (${MAX_FAQ}).`);
        faq = [...faq, { question: gap.questions[0] ?? gap.subject, answer: "", topic: gap.topic as TopicId }];
        void markDone(gap, false);
        go(gap.topic as TopicId);
        notify("Added — write the answer below");
        requestAnimationFrame(() => {
            const boxes = document.querySelectorAll<HTMLTextAreaElement>(".faq-editor textarea");
            const box = boxes[boxes.length - 1];
            box?.scrollIntoView({ block: "center", behavior: "smooth" });
            box?.focus({ preventScroll: true });
        });
    }
    async function markDone(gap: (typeof open)[number], say = true) {
        try {
            await convex.mutation(api.gaps.done, { id: gap._id });
            if (say) notify(`“${gap.subject}” marked as done`);
        } catch {
            notify("Couldn't update it — try again");
        }
    }

    // Doctors.
    let all = $derived(clinics(pieces));
    const simrs = useQuery(api.live.schedules, {});
    function fromSimrs(c: Place) {
        const codes = (c.info?.simrs ?? []).filter((k) => k.startsWith("poli:")).map((k) => k.slice(5));
        return (simrs.data ?? []).filter((s) => codes.includes(s.code)).flatMap((s) => s.doctors);
    }
    let doctorCount = $derived(all.reduce((n, c) => n + (c.info?.doctors?.length ?? 0), 0));
    let shown = $derived.by(() => {
        const q = normalize(filter);
        return all
            .filter((c) => c.info?.doctors?.length || opened.includes(c.id) || fromSimrs(c).length)
            .filter(
                (c) =>
                    !q ||
                    [c.name, c.building, ...fromSimrs(c), ...(c.info?.doctors ?? []).flatMap((d) => [d.name, d.specialty])].some((t) =>
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
<div class="admin-layout">
    <EditorRail onnotify={notify} />

    <div class="info-page">
        <aside class="nav">
            <div class="nav-head">
                <span class="eyebrow">{title}</span>
                <h1>Hospital Hub</h1>
                <p class="lead">
                    Manage visitor answers, leaflets, and doctor schedules. Saved automatically and live straight away.
                </p>
            </div>

            <nav aria-label="Sections">
                <small>From visitors</small>
                <button class:active={section === "unanswered"} onclick={() => go("unanswered")}>
                    Belum terjawab<span class="en">Unanswered</span><span class="n" class:alert={open.length}
                        >{open.length || ""}</span
                    >
                </button>
                <button class:active={section === "analytics"} onclick={() => go("analytics")}>
                    Wawasan<span class="en">Insights</span><span class="n"
                        >{(insights.data?.totals.routes ?? 0) +
                            (insights.data?.totals.qr ?? 0) +
                            (insights.data?.totals.chat ?? 0) || ""}</span
                    >
                </button>

                <small>Questions &amp; answers</small>
                {#each topics as t}
                    <button class:active={section === t.id} onclick={() => go(t.id)}>
                        {t.name.id}<span class="en">{t.name.en}</span><span class="n">{count(t.id) || ""}</span>
                    </button>
                {/each}

                <small>Leaflets</small>
                <button class:active={section === "leaflets"} onclick={() => go("leaflets")}>
                    Brosur &amp; leaflet<span class="en">Images</span><span class="n">{leaflets.data?.length || ""}</span>
                </button>

                <small>Doctors</small>
                <button class:active={section === "doctors"} onclick={() => go("doctors")}>
                    Jadwal dokter<span class="en">Schedules</span><span class="n">{doctorCount || ""}</span>
                </button>
            </nav>

            <div class="foot">
                <p class="status" class:failed={store.status === "failed"} title={store.problem}>
                    <i class:pending={store.status !== "saved"}></i>{status[store.status]}
                </p>
                <ShareMenu slug={store.slug} onnotify={notify} />
            </div>
        </aside>

        <div class="info-main">
            <!-- Botanical Calm KPI Overview Strip -->
            <div class="kpi-strip" aria-label="Hospital summary">
                <a class="kpi-card" href="/editor">
                    <span class="kpi-label">Mapped places</span>
                    <strong class="kpi-val">{mappedCount}</strong>
                    <span class="kpi-sub">Open 3D editor →</span>
                </a>
                <button class="kpi-card" class:highlight={open.length > 0} onclick={() => go("unanswered")}>
                    <span class="kpi-label">Unanswered Qs</span>
                    <strong class="kpi-val">{open.length}</strong>
                    <span class="kpi-sub">From visitor chat</span>
                </button>
                <button class="kpi-card" onclick={() => go("doctors")}>
                    <span class="kpi-label">Doctor schedules</span>
                    <strong class="kpi-val">{doctorCount}</strong>
                    <span class="kpi-sub">Across {all.length} clinic{all.length === 1 ? "" : "s"}</span>
                </button>
                <button class="kpi-card" onclick={() => go("leaflets")}>
                    <span class="kpi-label">Live FAQ &amp; leaflets</span>
                    <strong class="kpi-val">{live}</strong>
                    <span class="kpi-sub">{leaflets.data?.length ?? 0} leaflet{leaflets.data?.length === 1 ? "" : "s"}</span>
                </button>
            </div>

            <div class="content-area">
                {#if store.status === "loading"}
                    <p class="note">{store.problem || "Loading the hospital…"}</p>
                {:else if store.status === "failed"}
                    <p class="note">{store.problem} Your changes are kept and saved once it works again.</p>
                {/if}

                {#if store.status === "loading"}
                    <!-- loading -->
                {:else if section === "unanswered"}
                    <header class="section-head">
                        <h2>Belum terjawab</h2>
                        <p>
                            What visitors asked that AIRMA couldn't answer, most asked first. Write an answer and AIRMA
                            uses it from then on; mark as done what needs no answer. Questions are kept without who
                            asked, long numbers are blanked, and a subject is forgotten after 90 days without questions.
                        </p>
                    </header>
                    {#if gaps.error}
                        <p class="note">Couldn't load them: {gaps.error.message}</p>
                    {:else if gaps.isLoading}
                        <p class="empty">Loading…</p>
                    {:else}
                        <GapsList gaps={open} onanswer={answer} ondone={(g) => markDone(g)} />
                    {/if}
                {:else if section === "analytics"}
                    <header class="section-head">
                        <h2>Wawasan pengunjung</h2>
                        <p>
                            Anonymous aggregate counts of the most searched destinations, QR sign scans, and asked
                            questions. No personal data or patient numbers are ever stored.
                        </p>
                    </header>
                    {#if insights.error}
                        <p class="note">
                            Analytics aren't live on Convex yet. Run <code>npx convex dev --once</code> or
                            <code>npx convex deploy</code> to enable them.
                        </p>
                    {:else if insights.isLoading}
                        <p class="empty">Loading…</p>
                    {:else if insights.data}
                        {@const a = insights.data}
                        {@const totalVotes = (a.feedback?.helpful ?? 0) + (a.feedback?.unhelpful ?? 0)}
                        {@const satPct = totalVotes ? Math.round(((a.feedback?.helpful ?? 0) / totalVotes) * 100) : null}
                        <div class="insights-grid">
                            <section class="clinic">
                                <header>
                                    <h3>Answer helpfulness</h3>
                                    <small>{totalVotes} rating{totalVotes === 1 ? "" : "s"}</small>
                                </header>
                                {#if satPct !== null}
                                    <div class="bar-row">
                                        <span>👍 {a.feedback.helpful} helpful · 👎 {a.feedback.unhelpful} not helpful</span>
                                        <b>{satPct}%</b>
                                    </div>
                                    <div class="bar-track" style="margin-bottom:8px">
                                        <span style:width={`${satPct}%`}></span>
                                    </div>
                                {:else}
                                    <p class="empty">No answer ratings yet.</p>
                                {/if}
                            </section>
                            <section class="clinic">
                                <header>
                                    <h3>Top destinations</h3>
                                    <small>{a.totals.routes} total</small>
                                </header>
                                {#if a.routes.length}
                                    {@const max = Math.max(1, a.routes[0].count)}
                                    <ul class="bar-list">
                                        {#each a.routes as item}
                                            <li>
                                                <div class="bar-row">
                                                    <span>{item.label}</span>
                                                    <b>{item.count}</b>
                                                </div>
                                                <div class="bar-track">
                                                    <span style:width={`${(item.count / max) * 100}%`}></span>
                                                </div>
                                            </li>
                                        {/each}
                                    </ul>
                                {:else}
                                    <p class="empty">No destination searches recorded yet.</p>
                                {/if}
                            </section>

                            <section class="clinic">
                                <header>
                                    <h3>QR sign scans</h3>
                                    <small>{a.totals.qr} total</small>
                                </header>
                                {#if a.qr.length}
                                    {@const max = Math.max(1, a.qr[0].count)}
                                    <ul class="bar-list">
                                        {#each a.qr as item}
                                            <li>
                                                <div class="bar-row">
                                                    <span>{item.label}</span>
                                                    <b>{item.count}</b>
                                                </div>
                                                <div class="bar-track">
                                                    <span style:width={`${(item.count / max) * 100}%`}></span>
                                                </div>
                                            </li>
                                        {/each}
                                    </ul>
                                {:else}
                                    <p class="empty">No QR sign scans recorded yet.</p>
                                {/if}
                            </section>

                            <section class="clinic">
                                <header>
                                    <h3>Most asked questions</h3>
                                    <small>{a.totals.chat} total</small>
                                </header>
                                {#if a.chat.length}
                                    {@const max = Math.max(1, a.chat[0].count)}
                                    <ul class="bar-list">
                                        {#each a.chat as item}
                                            <li>
                                                <div class="bar-row">
                                                    <span>{item.label}</span>
                                                    <b>{item.count}</b>
                                                </div>
                                                <div class="bar-track">
                                                    <span style:width={`${(item.count / max) * 100}%`}></span>
                                                </div>
                                            </li>
                                        {/each}
                                    </ul>
                                {:else}
                                    <p class="empty">No chat questions recorded yet.</p>
                                {/if}
                            </section>
                        </div>
                    {/if}
                {:else if section === "leaflets"}
                    <header class="section-head">
                        <h2>Brosur &amp; leaflet</h2>
                        <p>
                            Brochures, posters and notices as images: the BPJS flow, a price list, a service or a
                            campaign. AIRMA answers from what each says and shows the image in the chat, where visitors
                            can open it full size. After uploading, the text is read from the image; check it, as AIRMA
                            answers from the text, not from the picture.
                        </p>
                    </header>
                    {#if store.slug}
                        <LeafletsEditor slug={store.slug} onnotify={notify} />
                    {:else}
                        <p class="note">Save the map once in the editor before adding leaflets.</p>
                    {/if}
                {:else if topic}
                    <header class="section-head">
                        <h2>{topic.name.id}</h2>
                        <p>
                            {topic.name.en}. Visitors find these under <b>Informasi rumah sakit</b>, grouped by topic,
                            and the assistant answers from them. Write in Indonesian; the assistant also answers English
                            questions from it.
                        </p>
                    </header>
                    <FaqEditor {faq} topic={topic.id} onchange={(next) => (faq = next)} />
                {:else}
                    <header class="section-head">
                        <h2>Jadwal dokter</h2>
                        <p>
                            Doctors' practice days and hours per clinic, and when they are on leave (cuti). Visitors see
                            the schedule when they choose the clinic, and find it by the doctor's name or specialty; the
                            assistant answers from it. Leave hides those days and says when the doctor is back. Click a
                            doctor to edit.
                        </p>
                    </header>
                    {#if all.length}
                        {#if doctorCount > 3}
                            <input
                                class="filter"
                                type="search"
                                placeholder="Find a doctor, specialty or clinic"
                                bind:value={filter}
                            />
                        {/if}
                        {#each shown as c (c.id)}
                            <section class="clinic">
                                <header>
                                    <h3>{c.name}</h3>
                                    <small>{where(c)}</small>
                                </header>
                                {#if fromSimrs(c).length}
                                    <p class="synced">
                                        <b>Days and hours come from SIMRS</b> ({fromSimrs(c).join(", ")}). Visitors see
                                        SIMRS's schedule here, so change hours in SIMRS. Add a doctor below only for
                                        their leave (cuti), specialty or how their name is written; they are matched by
                                        name.
                                    </p>
                                {/if}
                                <DoctorsEditor doctors={c.info?.doctors ?? []} onchange={(d) => setDoctors(c.id, d)} />
                            </section>
                        {:else}
                            <p class="empty">
                                {filter
                                    ? "No doctor or clinic matches."
                                    : "No doctors yet. Choose the clinic they practise in."}
                            </p>
                        {/each}
                        {#if addable.length}
                            <label class="add-clinic">
                                Add doctors to
                                <select
                                    value=""
                                    onchange={(e) => {
                                        const id = e.currentTarget.value;
                                        if (id) opened = [...opened, id];
                                        filter = "";
                                        e.currentTarget.value = "";
                                    }}
                                >
                                    <option value="" disabled>Choose a clinic or room…</option>
                                    {#each addable as c}
                                        <option value={c.id}>
                                            {c.name}{c.kind === "room" ? ` — ${c.building}` : " (building)"}
                                        </option>
                                    {/each}
                                </select>
                            </label>
                        {/if}
                    {:else}
                        <p class="note">
                            Draw the clinics first: add a building in the editor and put examination rooms in it.
                        </p>
                    {/if}
                {/if}
            </div>
        </div>
    </div>
</div>
{#if toast}<div class="toast" role="status"><span>✓</span>{toast}</div>{/if}

<style>
    .admin-layout {
        display: flex;
        min-height: 100dvh;
        background: var(--bg);
        color: var(--ink);
    }

    .info-page {
        flex: 1;
        min-width: 0;
        display: grid;
        grid-template-columns: 270px 1fr;
        min-height: 100dvh;
    }

    .nav {
        position: sticky;
        top: 0;
        height: 100dvh;
        overflow: auto;
        padding: 22px 16px;
        background: var(--surface);
        border-right: 1px solid var(--border);
        display: flex;
        flex-direction: column;
        gap: 14px;
    }

    .eyebrow {
        display: inline-block;
        font-size: 11px;
        font-weight: 600;
        color: var(--accent);
        background: var(--accent-soft);
        padding: 2px 8px;
        border-radius: 999px;
        margin-bottom: 8px;
    }

    h1 {
        margin: 0 0 6px;
        font-family: var(--font-serif);
        font-size: 24px;
        font-weight: 550;
        letter-spacing: -0.02em;
        color: var(--ink);
    }

    .lead {
        margin: 0;
        font-size: 12.5px;
        line-height: 1.5;
        color: var(--muted);
    }

    nav {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    nav small {
        margin: 12px 8px 4px;
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted-2);
    }

    nav button {
        display: flex;
        align-items: baseline;
        gap: 6px;
        padding: 8px 10px;
        border-radius: var(--radius-md);
        text-align: left;
        font-size: 13px;
        font-weight: 500;
        color: var(--ink-2);
    }

    nav button:hover {
        background: var(--surface-2);
        color: var(--ink);
    }

    nav button.active {
        background: var(--accent);
        color: var(--accent-fg);
    }

    nav .en {
        font-size: 11px;
        opacity: 0.65;
    }

    nav .n {
        margin-left: auto;
        font-size: 11px;
        font-variant-numeric: tabular-nums;
        opacity: 0.8;
    }

    nav .n.alert {
        padding: 1px 7px;
        border-radius: 999px;
        background: var(--warn-dot);
        color: #ffffff;
        font-weight: 600;
        opacity: 1;
    }

    .foot {
        margin-top: auto;
        padding-top: 12px;
        border-top: 1px solid var(--border);
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .status {
        margin: 0;
        font-size: 12px;
        color: var(--muted);
        display: flex;
        align-items: center;
        gap: 7px;
    }

    .status i {
        display: inline-block;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--success);
    }

    .status i.pending {
        background: var(--warn-dot);
    }

    .status.failed {
        color: var(--danger);
    }

    .status.failed i {
        background: var(--danger);
    }

    .foot :global(.publish-panel) {
        top: auto;
        bottom: calc(100% + 8px);
        left: 0;
        right: auto;
    }

    .info-main {
        padding: 28px 36px 80px;
        max-width: 920px;
        width: 100%;
    }

    .kpi-strip {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        margin-bottom: 28px;
    }

    .kpi-card {
        text-align: left;
        text-decoration: none;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        padding: 14px 16px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        box-shadow: var(--shadow-sm);
        transition: border-color 0.15s ease, transform 0.15s ease;
    }

    .kpi-card:hover {
        border-color: var(--border-strong);
        background: var(--surface);
        transform: translateY(-1px);
    }

    .kpi-card.highlight {
        border-color: rgba(201, 130, 43, 0.4);
        background: var(--warn-bg);
    }

    .kpi-label {
        font-size: 11.5px;
        font-weight: 500;
        color: var(--muted);
    }

    .kpi-val {
        font-size: 24px;
        font-weight: 700;
        color: var(--ink);
        font-variant-numeric: tabular-nums;
        line-height: 1.15;
    }

    .kpi-card.highlight .kpi-val {
        color: var(--warn-ink);
    }

    .kpi-sub {
        font-size: 11.5px;
        color: var(--muted);
    }

    .content-area {
        max-width: 760px;
    }

    .section-head {
        margin-bottom: 20px;
    }

    h2 {
        margin: 0 0 6px;
        font-family: var(--font-serif);
        font-size: 28px;
        font-weight: 550;
        letter-spacing: -0.02em;
        color: var(--ink);
    }

    .section-head p {
        margin: 0;
        font-size: 13.5px;
        line-height: 1.55;
        color: var(--muted);
    }

    .note {
        padding: 12px 14px;
        border-radius: var(--radius-md);
        background: var(--warn-bg);
        color: var(--warn-ink);
        font-size: 13px;
        margin-bottom: 16px;
    }

    .filter,
    .add-clinic select {
        display: block;
        width: 100%;
        height: 40px;
        padding: 0 12px;
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        background: var(--surface);
        font-size: 13.5px;
    }

    .filter {
        margin-bottom: 16px;
    }

    .clinic {
        margin-bottom: 14px;
        padding: 16px 18px 10px;
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        background: var(--surface);
        box-shadow: var(--shadow-sm);
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
        font-weight: 650;
        color: var(--ink);
    }

    .clinic header small {
        color: var(--muted);
        font-size: 12px;
    }

    .synced {
        margin: 0 0 12px;
        padding: 10px 12px;
        border-radius: var(--radius-md);
        background: var(--accent-soft);
        color: var(--accent);
        font-size: 12.5px;
        line-height: 1.5;
    }

    .add-clinic {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 12px;
        font-weight: 500;
        color: var(--muted);
        margin-top: 16px;
    }

    .insights-grid {
        display: flex;
        flex-direction: column;
        gap: 14px;
    }

    .bar-list {
        list-style: none;
        margin: 4px 0 8px;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .bar-row {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        font-size: 13px;
        color: var(--ink);
        margin-bottom: 4px;
    }

    .bar-row b {
        font-variant-numeric: tabular-nums;
        color: var(--accent);
    }

    .bar-track {
        height: 6px;
        border-radius: 999px;
        background: var(--surface-2);
        overflow: hidden;
    }

    .bar-track span {
        display: block;
        height: 100%;
        border-radius: 999px;
        background: var(--accent);
    }

    @media (max-width: 1020px) {
        .kpi-strip {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }

    @media (max-width: 820px) {
        .info-page {
            grid-template-columns: 1fr;
        }
        .nav {
            position: static;
            height: auto;
            border-right: 0;
            border-bottom: 1px solid var(--border);
        }
        .info-main {
            padding: 20px 16px 60px;
        }
    }
</style>
