<script lang="ts">
    import { onMount, tick, untrack } from "svelte";
    import { afterNavigate, replaceState } from "$app/navigation";
    import { rise, unblur } from "$lib/motion";
    import HospitalScene from "$lib/components/shared/HospitalScene.svelte";
    import Logo from "$lib/components/shared/Logo.svelte";
    import FloorPlan from "$lib/components/shared/FloorPlan.svelte";
    import RouteFinder from "$lib/components/shared/RouteFinder.svelte";
    import HospitalInfo from "$lib/components/shared/HospitalInfo.svelte";
    import PlaceIcon from "$lib/components/shared/PlaceIcon.svelte";
    import ChatPanel from "$lib/components/assistant/ChatPanel.svelte";
    import { Chat } from "$lib/assistant/chat.svelte";
    import { cannedReplier, suggestions, type ReplyContext } from "$lib/assistant/chat";
    import { Locale, provideLocale } from "$lib/i18n/locale.svelte";
    import { LANGS } from "$lib/i18n/lang";
    import type { Key } from "$lib/i18n/messages";
    import type { Piece } from "$lib/model/layout";
    import { answered, byTopic, type FaqEntry } from "$lib/model/faq";
    import { walkwayAt } from "$lib/model/interiors";
    import { hoursStatus } from "$lib/model/place-info";
    import type { Point, WalkingNetwork } from "$lib/wayfinding/navigation";
    import { buildGrid, places, planRoute, walkMinutes, type Place } from "$lib/wayfinding/routing";
    let {
        title,
        pieces,
        network,
        canvasWidth,
        canvasHeight,
        faq = [],
        shareUrl = null,
        editable = false,
        notice = null,
    }: {
        title: string;
        pieces: Piece[];
        network: WalkingNetwork;
        canvasWidth: number;
        canvasHeight: number;
        /** Hospital information: general questions the map can't answer. */
        faq?: FaqEntry[];
        /** The public address of this map; routes are shared from it. Null when unpublished. */
        shareUrl?: string | null;
        /** Show the link back to the editor (not on the public map). */
        editable?: boolean;
        /** A problem with the layout itself, e.g. it could not be loaded. */
        notice?: Key | null;
    } = $props();

    type Tab = "chat" | "route" | "info";
    const TABS: { id: Tab; key: Key }[] = [
        { id: "chat", key: "tabChat" },
        { id: "route", key: "tabRoute" },
        { id: "info", key: "tabInfo" },
    ];
    /** Width the conversation takes on wide screens; the map is framed beside it. */
    const COLUMN = 468;

    let view = $state<"3D" | "Plan">("3D"),
        tab = $state<Tab>("chat"),
        error = $state(""),
        toast = $state(""),
        ready = $state(false),
        wide = $state(true),
        /** Phones: the map fills the screen; the conversation is a sheet over it. */
        sheetOpen = $state(false),
        /** How far the sheet is being dragged down, while it is. */
        drag = $state(0),
        dragging = $state(false),
        layersOpen = $state(false),
        height = $state(800);
    let from = $state.raw<Place | Point | null>(null),
        to = $state.raw<Place | null>(null),
        picking = $state(false);
    let exporter: (() => Promise<void>) | null = null;
    let pane = $state<HTMLElement>();
    let grid = $derived(buildGrid(pieces, canvasWidth, canvasHeight));
    let placeList = $derived(places(pieces, network));
    let route = $derived(from && to ? planRoute(grid, from, to) : null);
    let questions = $derived(answered(faq));
    let landmarks = $derived(network.nodes.filter((n) => n.name.trim()));

    // The visitor's language: Indonesian unless they chose English on this device.
    const locale = new Locale();
    provideLocale(locale);
    const t = locale.t;

    // The assistant. Canned replies from the map and the hospital information
    // until the chat server route is built.
    let assistant = $derived({ places: placeList, grid, now: new Date() });
    let starters = $derived(suggestions(assistant, questions, locale.lang));
    const chat = new Chat(cannedReplier(() => ({ ctx: assistant, faq: questions })));
    const chatContext = (): ReplyContext => ({
        lang: locale.lang,
        ...(from && "id" in from && { from: from.id }),
    });
    let topics = $derived(byTopic(questions).map((g) => ({ id: g.topic.id, name: g.topic.name[locale.lang] })));
    // While chatting, the place the latest answer is about stands out on the
    // map; otherwise the chosen destination does.
    let chatFocus = $derived.by(() => {
        const reply = chat.messages.findLast((m) => m.role === "assistant");
        const card = reply?.parts.findLast((p) => p.type === "card");
        return card?.type === "card" ? (placeList.find((p) => p.id === card.show.to) ?? null) : null;
    });
    let highlight = $derived(tab === "chat" ? (chatFocus ?? to) : to);
    // A picked spot is named after the corridor or path it is on.
    let here = $derived(
        !from
            ? null
            : "id" in from
              ? from.name
              : t("spotOn", { name: walkwayAt(pieces, from)?.name ?? t("theMap") }),
    );
    let status = $derived(to?.info ? hoursStatus(to.info, new Date(), locale.lang) : null);

    // How much of the screen the conversation covers, so the camera frames the rest.
    let insetLeft = $derived(wide ? COLUMN : 0);
    // On phones, the chat bar (and the destination above it) cover the bottom.
    let insetBottom = $derived(wide ? 0 : to ? 170 : 90);

    const encode = (p: Place | Point) => ("id" in p ? p.id : `${p.x.toFixed(2)},${p.y.toFixed(2)}`);
    function decode(value: string | null): Place | Point | null {
        if (!value) return null;
        const place = placeList.find((p) => p.id === value);
        if (place) return place;
        const [x, y] = value.split(",").map(Number);
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    }
    onMount(() => {
        locale.restore();
        const desktop = window.matchMedia("(min-width: 761px)");
        wide = desktop.matches;
        desktop.onchange = () => (wide = desktop.matches);
        // Deep links, e.g. a QR code at an entrance: /?from=b:9&to=r:2:25
        const params = new URLSearchParams(location.search);
        from = decode(params.get("from"));
        const target = decode(params.get("to"));
        to = target && "id" in target ? target : null;
        if (params.get("view") === "plan") view = "Plan";
        // Someone who scanned a sign or opened a shared route wants the way.
        if (to) tab = "route";
        ready = true;
    });
    // When the layout changes (a new version is published or saved), keep the
    // chosen places but pick up where they are now.
    $effect(() => {
        const list = placeList;
        untrack(() => {
            if (from && "id" in from) from = list.find((p) => p.id === (from as Place).id) ?? null;
            if (to) to = list.find((p) => p.id === to!.id) ?? null;
        });
    });
    // The address bar follows the map, so it can be copied and shared.
    function syncUrl() {
        const params = new URLSearchParams();
        if (from) params.set("from", encode(from));
        if (to) params.set("to", to.id);
        if (view === "Plan") params.set("view", "plan");
        const query = params.toString();
        try {
            replaceState(query ? `?${query}` : location.pathname, {});
        } catch {
            // Before the router is ready (first render) the URL already matches.
        }
    }
    $effect(() => {
        if (ready) syncUrl();
    });
    // Map links followed on the page, e.g. a place card in the chat, select
    // their place or route. A link without a start keeps the visitor's own.
    afterNavigate(({ type, to: link }) => {
        if (type === "enter" || !ready || !link) return;
        // The link's own address: after a shallow replaceState, `location` can lag behind.
        const params = link.url.searchParams;
        const target = decode(params.get("to"));
        if (!target || !("id" in target)) return;
        if (params.has("from")) from = decode(params.get("from"));
        to = target;
        picking = false;
        sheetOpen = false;
        untrack(syncUrl);
    });
    // Choosing a start on the map needs the map.
    $effect(() => {
        if (picking) untrack(() => (sheetOpen = false));
    });
    function notify(s: string) {
        toast = s;
        setTimeout(() => (toast = ""), 2400);
    }
    function choose(place: Place | null, point?: Point) {
        if (picking) {
            // A room or building, or any spot on a corridor or path; not the open grounds.
            if (place) from = place;
            else if (point && walkwayAt(pieces, point)) from = point;
            else return notify(t("pickHere"));
            picking = false;
            tab = "route";
            sheetOpen = true;
        } else if (place) {
            to = place;
            tab = "route";
        }
    }
    function open(next: Tab) {
        tab = next;
        sheetOpen = true;
    }
    // Phones: the sheet follows a finger on its top edge, and goes when
    // pulled far enough or flicked down.
    let dragFrom = 0,
        lastY = 0,
        lastT = 0,
        speed = 0;
    function grab(e: PointerEvent) {
        if (wide || (e.target as Element).closest("button")) return;
        dragging = true;
        dragFrom = lastY = e.clientY;
        lastT = e.timeStamp;
        speed = 0;
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
    }
    function pull(e: PointerEvent) {
        if (!dragging) return;
        speed = (e.clientY - lastY) / Math.max(1, e.timeStamp - lastT);
        lastY = e.clientY;
        lastT = e.timeStamp;
        const d = e.clientY - dragFrom;
        // Upwards it gives a little, then resists.
        drag = d >= 0 ? d : -Math.sqrt(-d) * 2;
    }
    function release() {
        if (!dragging) return;
        dragging = false;
        if (drag > 120 || speed > 0.5) sheetOpen = false;
        drag = 0;
    }
    async function openTopic(id: string) {
        open("info");
        await tick();
        pane?.querySelector(`#topic-${id}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
    async function share() {
        const link = shareUrl ? shareUrl + location.search : location.href;
        try {
            await navigator.clipboard.writeText(link);
            notify(shareUrl ? t("linkCopied") : t("linkCopiedUnpublished"));
        } catch {
            notify(t("copyAddress"));
        }
    }
    async function download() {
        try {
            await exporter?.();
        } catch {
            error = t("modelsLoading");
        }
    }
</script>

<svelte:head
    ><title>{title} — P-Map</title><meta name="description" content={t("metaDescription")} /><meta
        name="theme-color"
        content="#f6f3ea"
    /></svelte:head
>
<svelte:window
    bind:innerHeight={height}
    onkeydown={(e) => {
        if (e.key === "Escape") {
            picking = false;
            layersOpen = false;
            sheetOpen = false;
        }
    }}
/>
<div
    class="concierge"
    class:picking
    class:mobile={ready && !wide}
    class:sheet-open={ready && !wide && sheetOpen}
    class:layers-open={layersOpen}
    style:--column={`${COLUMN}px`}
>
    <section class="stage" aria-label={t("mapRegion")}>
        {#if ready}{#if view === "3D"}<HospitalScene
                    presentation={true}
                    {pieces}
                    selected={null}
                    active={null}
                    grid={false}
                    zoom={100}
                    {canvasWidth}
                    {canvasHeight}
                    route={route?.points ?? null}
                    {highlight}
                    {insetLeft}
                    {insetBottom}
                    onselect={(id, roomId, point) => {
                        const keys = roomId ? [`r:${id}:${roomId}`] : [`b:${id}`, `a:${id}`];
                        choose(placeList.find((p) => keys.includes(p.id)) ?? null, point);
                    }}
                    onplace={() => {}}
                    onerror={(s) => (error = s)}
                    registerExport={(fn) => (exporter = fn)}
                />{:else}<div class="plan" style:--inset-bottom={`${insetBottom}px`}>
                    <FloorPlan
                        {pieces}
                        places={placeList}
                        width={canvasWidth}
                        height={canvasHeight}
                        route={route?.points ?? null}
                        {landmarks}
                        destination={highlight}
                        {picking}
                        onpick={(point, place) => choose(place, point)}
                    />
                </div>{/if}{/if}
    </section>
    {#snippet masthead()}<header class="masthead">
            <Logo size={30} title="" />
            <div class="name">
                <small>{t("guide")}</small>
                <h1>{title}</h1>
            </div>
            <div class="lang" role="group" aria-label={t("language")}>
                {#each LANGS as l}<button
                        lang={l}
                        aria-pressed={locale.lang === l}
                        title={l === "id" ? "Bahasa Indonesia" : "English"}
                        onclick={() => locale.set(l)}>{l.toUpperCase()}</button
                    >{/each}
            </div>
            <details class="more">
                <summary aria-label={t("moreOptions")}
                    ><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
                        ><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg
                    ></summary
                >
                <div class="menu">
                    {#if editable}<a href="/editor">{t("openEditor")}</a>{/if}
                    <button onclick={download}>{t("exportModel")}</button>
                </div>
            </details>
        </header>{/snippet}
    {#if ready && !wide}{@render masthead()}{/if}

    {#if ready && !wide}<button
            class="scrim"
            class:shown={sheetOpen}
            tabindex="-1"
            aria-label={t("closeChat")}
            onclick={() => (sheetOpen = false)}
        ></button>{/if}
    <aside
        class="column"
        class:open={sheetOpen}
        class:dragging
        style:translate={drag ? `0 ${drag}px` : null}
        inert={ready && !wide && !sheetOpen}
    >
        {#if wide || !ready}{@render masthead()}{/if}
        <div class="sheet-top" role="presentation" onpointerdown={grab} onpointermove={pull} onpointerup={release} onpointercancel={release}>
            {#if ready && !wide}<span class="grabber" aria-hidden="true"></span>{/if}
            <div class="tabs">
                <nav class="switcher" style:--at={TABS.findIndex((x) => x.id === tab)} aria-label={t("mapView")}>
                    <span class="thumb" aria-hidden="true"></span>
                    {#each TABS as x}<button aria-pressed={tab === x.id} onclick={() => (tab = x.id)}
                            >{t(x.key)}{#if x.id === "route" && to}<i class="badge"></i>{/if}</button
                        >{/each}
                </nav>
                {#if ready && !wide}<button class="close" aria-label={t("closeChat")} onclick={() => (sheetOpen = false)}
                        ><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg
                        ></button
                    >{/if}
            </div>
        </div>
        <div class="pane" bind:this={pane}>
            {#if tab === "chat"}<ChatPanel
                    {chat}
                    places={placeList}
                    suggestions={starters}
                    {title}
                    context={chatContext}
                    {topics}
                    shown={highlight?.id ?? null}
                    {here}
                    onshow={() => (sheetOpen = false)}
                    ontopic={openTopic}
                    onhere={() => open("route")}
                />{:else if tab === "route"}<div class="scroll" in:unblur>
                    <h2>{t("directions")}</h2>
                    <RouteFinder places={placeList} {grid} {route} bind:from bind:to bind:picking />
                </div>{:else}<div class="scroll" in:unblur>
                    <h2>{t("hospitalInfo")}</h2>
                    {#if questions.length}<HospitalInfo faq={questions} />{:else}<p class="empty">
                            {t("greetingLead")}
                        </p>{/if}
                </div>{/if}
        </div>
    </aside>

    <div class="map-controls">
        <div class="segmented" role="group" aria-label={t("mapView")}>
            {#each ["3D", "Plan"] as const as v}<button aria-pressed={view === v} onclick={() => (view = v)}
                    >{t(v === "3D" ? "view3d" : "viewPlan")}</button
                >{/each}
        </div>
        {#if view === "3D"}<button
                class="round"
                aria-pressed={layersOpen}
                aria-label={t("layers")}
                title={t("layers")}
                onclick={() => (layersOpen = !layersOpen)}
                ><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
                    ><path d="m12 4 9 5-9 5-9-5zM3 14l9 5 9-5" /></svg
                ></button
            >{/if}
        <button class="round" disabled={!to} aria-label={t("shareRoute")} title={t("shareRoute")} onclick={share}
            ><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
                ><path d="M12 15V4m-4 4 4-4 4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" /></svg
            ></button
        >
    </div>
    {#if ready && !wide}<button class="launcher" onclick={() => open("chat")} in:rise={{ y: 12 }}>
            <Logo size={26} title="" />
            <span>{chat.messages.length ? t("continueChat") : t("askQuestion")}</span>
            <i aria-hidden="true"
                ><svg viewBox="0 0 24 24" width="18" height="18"
                    ><path d="M5 18.5V7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H8.5z" /></svg
                ></i
            >
        </button>{/if}

    {#if to}{#key to.id}<div class="journey" in:rise={{ y: 10 }}>
                <PlaceIcon of={to} size={34} />
                <div class="where">
                    <b>{t("headingTo", { name: to.name })}</b>
                    <small
                        >{#if route}{t("minutes", { n: walkMinutes(route.meters) })} · {t("metresWalk", {
                                m: route.meters,
                            })}{:else if status}<span class:open={status.open}>{status.text}</span>{:else}{to.building ??
                                locale.type(to.detail)}{/if}</small
                    >
                </div>
                <button class="go" onclick={() => open("route")}>{route ? t("steps") : t("directions")}</button>
                <button class="x" aria-label={t("clearDestination")} onclick={() => (to = null)}
                    ><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg
                    ></button
                >
            </div>{/key}{/if}

    {#if picking}<div class="pick-banner" role="status">
            {t("pickBanner", { action: t(wide ? "click" : "tap") })} · <button onclick={() => (picking = false)}
                >{t("cancel")}</button
            >
        </div>{/if}
    {#if error || notice}<p class="viewer-error" role="alert">{error || (notice && t(notice))}</p>{/if}
    {#if toast}<div class="toast" role="status"><span>✓</span>{toast}</div>{/if}
</div>

<style>
    /* The visitor app: a conversation with the hospital's guide, set on a
       sheet of warm paper that dissolves into the living map behind it. */
    .concierge {
        --paper: #f6f3ea;
        --paper-2: #ece6d6;
        --card: #fffdf8;
        --ink: #1b2a21;
        --ink-2: #46574b;
        --muted: #7b877a;
        --forest: #23463a;
        --forest-2: #2f6150;
        --signal: #e0663d;
        --line: #1b2a2117;
        --display: "Fraunces", Georgia, serif;
        position: relative;
        height: 100dvh;
        overflow: hidden;
        background: var(--paper);
        color: var(--ink);
        font-family: "Figtree", "Avenir Next", system-ui, sans-serif;
        font-size: 14px;
        -webkit-font-smoothing: antialiased;
    }
    .stage {
        position: absolute;
        inset: 0;
    }
    .plan {
        position: absolute;
        inset: 0;
        padding: 80px 20px 20px calc(var(--column) + 8px);
    }

    /* The conversation column: a sheet of paper beside the map, with a clean edge. */
    .column {
        position: absolute;
        z-index: 5;
        top: 0;
        bottom: 0;
        left: 0;
        width: var(--column);
        display: flex;
        flex-direction: column;
        padding: 22px 30px 22px 34px;
        background: var(--paper);
        box-shadow:
            1px 0 0 var(--line),
            12px 0 32px -24px #1b2a2140;
    }
    .masthead {
        display: flex;
        align-items: center;
        gap: 12px;
        padding-bottom: 16px;
    }
    .name {
        flex: 1;
        min-width: 0;
    }
    .name small {
        display: block;
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--muted);
    }
    h1 {
        margin: 1px 0 0;
        font-family: var(--display);
        font-size: 21px;
        font-weight: 540;
        font-variation-settings: "opsz" 36;
        letter-spacing: -0.012em;
        line-height: 1.15;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .lang {
        display: flex;
        flex-shrink: 0;
        padding: 3px;
        border-radius: 11px;
        background: var(--paper-2);
    }
    .lang button {
        padding: 5px 8px;
        border-radius: 8px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.06em;
        color: var(--muted);
        transition:
            background 180ms,
            color 180ms,
            box-shadow 180ms;
    }
    .lang button[aria-pressed="true"],
    .concierge .lang button[aria-pressed="true"]:hover {
        background: var(--card);
        color: var(--ink);
        box-shadow: 0 1px 3px #1b2a211f;
    }
    .more {
        position: relative;
        flex-shrink: 0;
    }
    .more summary {
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        border-radius: 12px;
        list-style: none;
        cursor: pointer;
        color: var(--ink-2);
        transition: background 160ms;
    }
    .more summary svg {
        fill: currentColor;
    }
    .more summary::-webkit-details-marker {
        display: none;
    }
    .more[open] summary {
        background: var(--paper-2);
    }
    .menu {
        position: absolute;
        right: 0;
        top: calc(100% + 6px);
        z-index: 10;
        min-width: 210px;
        padding: 6px;
        border-radius: 14px;
        background: var(--card);
        box-shadow:
            0 0 0 1px var(--line),
            0 18px 40px -12px #1b2a2140;
        display: flex;
        flex-direction: column;
        transform-origin: top right;
        animation: menu-in 180ms cubic-bezier(0.23, 1, 0.32, 1);
    }
    @keyframes menu-in {
        from {
            opacity: 0;
            transform: scale(0.96);
        }
    }
    .menu a,
    .menu button {
        padding: 10px 12px;
        border-radius: 9px;
        font-size: 13.5px;
        color: var(--ink);
        text-decoration: none;
        text-align: left;
    }

    .tabs {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    /* Ask · Directions · Information, with a thumb that slides between them. */
    .switcher {
        position: relative;
        flex: 1;
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        padding: 4px;
        margin-bottom: 6px;
        border-radius: 14px;
        background: var(--paper-2);
    }
    .thumb {
        position: absolute;
        top: 4px;
        bottom: 4px;
        left: 4px;
        width: calc((100% - 8px) / 3);
        border-radius: 10px;
        background: var(--card);
        box-shadow:
            0 1px 2px #1b2a2114,
            0 4px 12px -4px #1b2a2126;
        transform: translateX(calc(var(--at) * 100%));
        transition: transform 380ms cubic-bezier(0.32, 0.72, 0, 1);
    }
    .switcher button {
        position: relative;
        height: 36px;
        border-radius: 10px;
        font-size: 13.5px;
        font-weight: 600;
        color: var(--muted);
        transition: color 200ms;
    }
    .switcher button[aria-pressed="true"],
    .concierge .switcher button[aria-pressed="true"]:hover {
        color: var(--ink);
    }
    .badge {
        position: absolute;
        top: 9px;
        margin-left: 4px;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--signal);
    }
    .pane {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        position: relative;
    }
    .scroll {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: 18px 2px 24px;
        scrollbar-width: thin;
        scrollbar-color: #1b2a2122 transparent;
    }
    .scroll h2 {
        margin: 0 0 16px;
        font-family: var(--display);
        font-size: 28px;
        font-weight: 480;
        font-variation-settings: "opsz" 72;
        letter-spacing: -0.02em;
    }
    .scroll :global(.hospital-info section) {
        scroll-margin-top: 8px;
    }
    .empty {
        color: var(--ink-2);
        line-height: 1.55;
    }

    /* Over the map */
    .map-controls {
        position: absolute;
        z-index: 6;
        top: 20px;
        right: 20px;
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .segmented {
        display: flex;
        padding: 3px;
        border-radius: 14px;
        background: #fffdf8e6;
        box-shadow:
            0 0 0 1px var(--line),
            0 8px 24px -12px #1b2a2140;
        backdrop-filter: blur(10px);
    }
    .segmented button {
        min-width: 54px;
        height: 34px;
        padding: 0 12px;
        border-radius: 11px;
        font-size: 13px;
        font-weight: 600;
        color: var(--ink-2);
        transition:
            background 180ms,
            color 180ms;
    }
    .segmented button[aria-pressed="true"],
    .concierge .segmented button[aria-pressed="true"]:hover {
        background: var(--forest);
        color: var(--paper);
    }
    .round,
    .close {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        height: 40px;
        min-width: 40px;
        border-radius: 14px;
        background: #fffdf8e6;
        color: var(--ink);
        box-shadow:
            0 0 0 1px var(--line),
            0 8px 24px -12px #1b2a2140;
        backdrop-filter: blur(10px);
        transition:
            transform 160ms cubic-bezier(0.23, 1, 0.32, 1),
            background 160ms,
            color 160ms;
    }
    .round:active,
    .close:active {
        transform: scale(0.95);
    }
    .round[aria-pressed="true"],
    .concierge .round[aria-pressed="true"]:hover {
        background: var(--forest);
        color: var(--paper);
    }
    .map-controls svg,
    .close svg,
    .launcher svg,
    .journey svg {
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
    }
    /* The 3D display options open under the map controls. */
    .concierge :global(.scene-options) {
        display: none;
    }
    .layers-open :global(.scene-options) {
        display: flex;
        flex-wrap: wrap;
        top: 72px;
        right: 20px;
        z-index: 7;
        max-width: 300px;
        padding: 6px;
        gap: 4px;
        border-radius: 16px;
        background: var(--card);
        box-shadow:
            0 0 0 1px var(--line),
            0 18px 40px -14px #1b2a2140;
        transform-origin: top right;
        animation: menu-in 200ms cubic-bezier(0.23, 1, 0.32, 1);
    }
    .concierge :global(.orbit-help) {
        left: var(--column);
        bottom: 22px;
        font-size: 10.5px;
        color: #5d6c5c;
    }

    /* Where the visitor is heading, over the map. */
    .journey {
        position: absolute;
        z-index: 6;
        bottom: 24px;
        left: calc(var(--column) + (100% - var(--column)) / 2);
        translate: -50% 0;
        display: flex;
        align-items: center;
        gap: 12px;
        width: max-content;
        max-width: min(520px, calc(100% - var(--column) - 40px));
        padding: 8px 8px 8px 10px;
        border-radius: 18px;
        background: var(--card);
        box-shadow:
            0 0 0 1px var(--line),
            0 22px 48px -18px #1b2a2166;
    }
    .where {
        display: flex;
        flex-direction: column;
        min-width: 0;
        padding-right: 6px;
    }
    .where b {
        font-family: var(--display);
        font-size: 16px;
        font-weight: 540;
        font-variation-settings: "opsz" 24;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .where small {
        font-size: 12.5px;
        color: var(--muted);
        white-space: nowrap;
    }
    .where small span {
        font-weight: 600;
        color: #b4472c;
    }
    .where small span.open {
        color: #2e7a47;
    }
    .go {
        flex-shrink: 0;
        height: 38px;
        padding: 0 16px;
        border-radius: 12px;
        background: var(--forest);
        color: var(--paper);
        font-size: 13px;
        font-weight: 600;
    }
    .concierge .go:hover {
        background: var(--forest-2);
    }
    .x {
        display: grid;
        place-items: center;
        flex-shrink: 0;
        width: 38px;
        height: 38px;
        border-radius: 12px;
        color: var(--muted);
    }

    .pick-banner {
        position: absolute;
        top: 22px;
        left: calc(var(--column) + (100% - var(--column)) / 2);
        translate: -50% 0;
        z-index: 7;
        padding: 11px 18px;
        border-radius: 14px;
        background: #2f7fc4;
        color: white;
        font-size: 13px;
        box-shadow: 0 10px 30px -10px #2f7fc4aa;
        animation: banner-in 280ms cubic-bezier(0.23, 1, 0.32, 1);
    }
    .pick-banner button {
        color: white;
        text-decoration: underline;
        font-size: 13px;
        font-weight: 600;
    }
    @keyframes banner-in {
        from {
            opacity: 0;
            transform: translateY(-8px);
        }
    }
    .picking .stage :global(canvas) {
        cursor: crosshair;
    }
    .viewer-error {
        position: absolute;
        bottom: 24px;
        right: 24px;
        max-width: 420px;
        z-index: 8;
        margin: 0;
        padding: 14px 16px;
        border-radius: 14px;
        background: #fff2dd;
        color: #785e33;
    }
    .concierge :global(.toast) {
        left: calc(var(--column) + (100% - var(--column)) / 2);
        bottom: 96px;
        border-radius: 14px;
        background: var(--forest);
        font-size: 13px;
    }

    @media (hover: hover) and (pointer: fine) {
        .menu a:hover,
        .concierge .menu button:hover,
        .concierge .more summary:hover {
            background: var(--paper-2);
        }
        .concierge .lang button:hover,
        .concierge .switcher button:hover {
            background: none;
            color: var(--ink);
        }
        .concierge .pick-banner button:hover {
            background: none;
        }
        .concierge .segmented button:hover,
        .concierge .round:hover:not(:disabled),
        .concierge .close:hover,
        .concierge .launcher:hover {
            background: var(--card);
        }
        .concierge .x:hover {
            background: var(--paper-2);
            color: var(--ink);
        }
    }

    /* Phones: the map fills the screen, like a maps app. The guide waits in
       a bar at the bottom and rises as a sheet when asked. */
    .mobile {
        --column: 100%;
        --top: calc(env(safe-area-inset-top) + 10px);
        --bottom: calc(env(safe-area-inset-bottom) + 12px);
    }
    .mobile .masthead {
        position: absolute;
        z-index: 6;
        top: var(--top);
        left: 12px;
        right: 12px;
        gap: 10px;
        padding: 7px 6px 7px 10px;
        border-radius: 18px;
        background: var(--card);
        box-shadow:
            0 0 0 1px var(--line),
            0 10px 28px -14px #1b2a2150;
    }
    .mobile h1 {
        font-size: 17px;
    }
    .mobile .name small {
        font-size: 9.5px;
    }
    .mobile .map-controls {
        top: calc(var(--top) + 66px);
        right: 12px;
    }
    .mobile .plan {
        padding: calc(env(safe-area-inset-top) + 120px) 8px calc(var(--inset-bottom) + 8px);
    }

    /* The chat bar */
    .launcher {
        position: absolute;
        z-index: 6;
        left: 12px;
        right: 12px;
        bottom: var(--bottom);
        display: flex;
        align-items: center;
        gap: 12px;
        height: 60px;
        padding: 0 8px 0 14px;
        border-radius: 22px;
        background: var(--card);
        color: var(--ink);
        text-align: left;
        box-shadow:
            0 0 0 1px var(--line),
            0 16px 40px -16px #1b2a2166;
        transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1);
    }
    .launcher:active {
        transform: scale(0.98);
    }
    .launcher span {
        flex: 1;
        min-width: 0;
        font-size: 16px;
        color: var(--ink-2);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .launcher i {
        display: grid;
        place-items: center;
        width: 44px;
        height: 44px;
        border-radius: 16px;
        background: var(--forest);
        color: var(--paper);
    }

    /* The sheet */
    .scrim {
        position: absolute;
        inset: 0;
        z-index: 7;
        background: #1b2a2140;
        opacity: 0;
        pointer-events: none;
        transition: opacity 400ms cubic-bezier(0.32, 0.72, 0, 1);
    }
    .scrim.shown {
        opacity: 1;
        pointer-events: auto;
    }
    .mobile .column {
        z-index: 8;
        top: calc(env(safe-area-inset-top) + 44px);
        width: 100%;
        padding: 0 16px var(--bottom);
        border-radius: 26px 26px 0 0;
        box-shadow: 0 -12px 40px -20px #1b2a2166;
        transform: translateY(calc(100% + 24px));
        transition: transform 460ms cubic-bezier(0.32, 0.72, 0, 1);
    }
    .mobile .column.open {
        transform: none;
    }
    .mobile .column.dragging {
        transition: none;
    }
    .sheet-top {
        touch-action: none;
    }
    .mobile .sheet-top {
        padding: 8px 0 10px;
        cursor: grab;
    }
    .grabber {
        display: block;
        width: 38px;
        height: 5px;
        margin: 0 auto 10px;
        border-radius: 3px;
        background: #1b2a2126;
    }
    .close {
        flex-shrink: 0;
        background: var(--paper-2);
        box-shadow: none;
        backdrop-filter: none;
    }
    .mobile .scroll {
        padding-top: 12px;
    }

    .mobile .journey {
        left: 12px;
        right: 12px;
        bottom: calc(var(--bottom) + 70px);
        translate: none;
        width: auto;
        max-width: none;
    }
    .mobile :global(.orbit-help) {
        display: none;
    }
    .mobile .pick-banner {
        top: calc(var(--top) + 66px);
        left: 50%;
        width: calc(100% - 24px);
        text-align: center;
        font-size: 14px;
        line-height: 1.4;
    }
    .mobile .viewer-error {
        top: calc(var(--top) + 66px);
        bottom: auto;
        left: 12px;
        right: 12px;
        max-width: none;
    }
    .mobile :global(.toast) {
        left: 50%;
        top: calc(var(--top) + 66px);
        bottom: auto;
        max-width: calc(100% - 24px);
    }
    .mobile.layers-open :global(.scene-options) {
        top: calc(var(--top) + 118px);
        right: 12px;
        left: 12px;
        max-width: none;
    }
    @media (prefers-reduced-motion: reduce) {
        .mobile .column,
        .scrim,
        .thumb {
            transition: none;
        }
    }
</style>
