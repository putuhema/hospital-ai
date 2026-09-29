<script lang="ts">
    import { onMount, untrack } from "svelte";
    import { fly } from "svelte/transition";
    import { easeOut, motion } from "$lib/motion";
    import { afterNavigate, replaceState } from "$app/navigation";
    import HospitalScene from "$lib/components/shared/HospitalScene.svelte";
    import Logo from "$lib/components/shared/Logo.svelte";
    import FloorPlan from "$lib/components/shared/FloorPlan.svelte";
    import RouteFinder from "$lib/components/shared/RouteFinder.svelte";
    import HospitalInfo from "$lib/components/shared/HospitalInfo.svelte";
    import MobileMap from "./MobileMap.svelte";
    import ChatPanel from "$lib/components/assistant/ChatPanel.svelte";
    import { Chat } from "$lib/assistant/chat.svelte";
    import { cannedReplier, suggestions, type ReplyContext } from "$lib/assistant/chat";
    import { Locale, provideLocale } from "$lib/i18n/locale.svelte";
    import { LANGS } from "$lib/i18n/lang";
    import type { Key } from "$lib/i18n/messages";
    import type { Piece } from "$lib/model/layout";
    import { answered, type FaqEntry } from "$lib/model/faq";
    import { walkwayAt } from "$lib/model/interiors";
    import type { Point, WalkingNetwork } from "$lib/wayfinding/navigation";
    import {
        buildGrid,
        places,
        planRoute,
        type Place,
    } from "$lib/wayfinding/routing";
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
    let view = $state<"3D" | "Plan">("3D"),
        error = $state(""),
        toast = $state(""),
        ready = $state(false),
        panelOpen = $state(true),
        wide = $state(true),
        layersOpen = $state(false),
        sheetInset = $state(0),
        chatInset = $state(0);
    let from = $state.raw<Place | Point | null>(null),
        to = $state.raw<Place | null>(null),
        picking = $state(false);
    let exporter: (() => Promise<void>) | null = null;
    let mobile: MobileMap | undefined = $state();
    let grid = $derived(buildGrid(pieces, canvasWidth, canvasHeight));
    let placeList = $derived(places(pieces, network));
    let route = $derived(from && to ? planRoute(grid, from, to) : null);
    let questions = $derived(answered(faq));
    // The assistant. Canned replies from the map and the hospital information
    // until the chat server route is built.
    let assistant = $derived({ places: placeList, grid, now: new Date() });
    // The visitor's language: Indonesian unless they chose English on this device.
    const locale = new Locale();
    provideLocale(locale);
    let starters = $derived(suggestions(assistant, questions, locale.lang));
    const chat = new Chat(cannedReplier(() => ({ ctx: assistant, faq: questions })));
    let chatOpen = $state(false);
    const chatContext = (): ReplyContext => ({
        lang: locale.lang,
        ...(from && "id" in from && { from: from.id }),
    });
    // While the chat is open, the place its latest answer is about stands out
    // on the map; otherwise the chosen destination does.
    let chatFocus = $derived.by(() => {
        if (!chatOpen) return null;
        const reply = chat.messages.findLast((m) => m.role === "assistant");
        const card = reply?.parts.findLast((p) => p.type === "card");
        return card?.type === "card" ? (placeList.find((p) => p.id === card.show.to) ?? null) : null;
    });
    let highlight = $derived(chatFocus ?? to);
    let landmarks = $derived(network.nodes.filter((n) => n.name.trim()));

    const encode = (p: Place | Point) =>
        "id" in p ? p.id : `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    function decode(value: string | null): Place | Point | null {
        if (!value) return null;
        const place = placeList.find((p) => p.id === value);
        if (place) return place;
        const [x, y] = value.split(",").map(Number);
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    }
    onMount(() => {
        locale.restore();
        const desktop = window.matchMedia("(min-width: 701px)");
        wide = desktop.matches;
        desktop.onchange = () => (wide = desktop.matches);
        // Deep links, e.g. a QR code at an entrance: /?from=b:9&to=r:2:25
        const params = new URLSearchParams(location.search);
        from = decode(params.get("from"));
        const target = decode(params.get("to"));
        to = target && "id" in target ? target : null;
        if (params.get("view") === "plan") view = "Plan";
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
        const route = params.has("from");
        if (route) from = decode(params.get("from"));
        to = target;
        picking = false;
        panelOpen = true;
        mobile?.show(route && !!from);
        untrack(syncUrl);
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
            else return notify(locale.t("pickHere"));
            picking = false;
        } else if (place) to = place;
    }
    async function share() {
        const link = shareUrl ? shareUrl + location.search : location.href;
        try {
            await navigator.clipboard.writeText(link);
            notify(
                shareUrl
                    ? locale.t("linkCopied")
                    : locale.t("linkCopiedUnpublished"),
            );
        } catch {
            notify(locale.t("copyAddress"));
        }
    }
    async function download() {
        try {
            await exporter?.();
        } catch {
            error = locale.t("modelsLoading");
        }
    }
</script>

<svelte:head
    ><title>{title} — P-Map</title><meta
        name="description"
        content={locale.t("metaDescription")}
    /></svelte:head
>
<svelte:window
    onkeydown={(e) => {
        if (e.key === "Escape") picking = false;
    }}
/>
<div
    class="map-viewer"
    class:picking
    class:mobile={ready && !wide}
    class:layers-open={layersOpen}
    class:chat-open={chatOpen && wide}
    style:--sheet-inset={`${wide ? 0 : sheetInset}px`}
>
    <section class="stage" aria-label={locale.t("mapRegion")}>
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
                    insetLeft={panelOpen && wide ? 400 : 0}
                    insetBottom={wide ? 0 : Math.max(sheetInset, chatInset)}
                    onselect={(id, roomId, point) => {
                        const keys = roomId ? [`r:${id}:${roomId}`] : [`b:${id}`, `a:${id}`];
                        choose(placeList.find((p) => keys.includes(p.id)) ?? null, point);
                    }}
                    onplace={() => {}}
                    onerror={(s) => (error = s)}
                    registerExport={(fn) => (exporter = fn)}
                />{:else}<div class="plan">
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
    {#if ready && !wide}<MobileMap
            bind:this={mobile}
            {title}
            faq={questions}
            {chat}
            suggestions={starters}
            {chatContext}
            bind:chatOpen
            bind:chatInset
            places={placeList}
            {grid}
            {route}
            {editable}
            bind:from
            bind:to
            bind:picking
            bind:view
            bind:layersOpen
            bind:inset={sheetInset}
            onshare={share}
            ondownload={download}
        />{:else}
    <aside class="panel" class:collapsed={!panelOpen}>
        <header>
            <div>
                <small class="product"><Logo size={16} title="" /> {locale.t("product")}</small>
                <h1>{title}</h1>
            </div>
            <div class="lang" role="group" aria-label={locale.t("language")}>
                {#each LANGS as l}<button
                        lang={l}
                        aria-pressed={locale.lang === l}
                        title={l === "id" ? "Bahasa Indonesia" : "English"}
                        onclick={() => locale.set(l)}>{l.toUpperCase()}</button
                    >{/each}
            </div>
            <button
                class="collapse"
                aria-expanded={panelOpen}
                aria-label={locale.t(panelOpen ? "hideDirections" : "showDirections")}
                onclick={() => (panelOpen = !panelOpen)}
                >{panelOpen ? "−" : "+"}</button
            >
        </header>
        {#if panelOpen}<RouteFinder
                places={placeList}
                {grid}
                {route}
                bind:from
                bind:to
                bind:picking
            />{#if questions.length}<details class="info">
                    <summary>{locale.t("hospitalInfo")} <span>{questions.length}</span></summary>
                    <HospitalInfo faq={questions} />
                </details>{/if}{/if}
    </aside>
    <div class="top-actions">
        <div class="segmented" role="group" aria-label={locale.t("mapView")}>
            {#each ["3D", "Plan"] as const as v}<button
                    class:active={view === v}
                    aria-pressed={view === v}
                    onclick={() => (view = v)}>{locale.t(v === "3D" ? "view3d" : "viewPlan")}</button
                >{/each}
        </div>
        <button class="btn" disabled={!to} onclick={share}>{locale.t("shareRoute")}</button>
        <button class="btn ask" aria-pressed={chatOpen} onclick={() => (chatOpen = !chatOpen)}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
                ><path d="M5 18.5V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /></svg
            >{locale.t("ask")}
        </button>
        <details class="more">
            <summary class="btn" aria-label={locale.t("moreOptions")}>•••</summary>
            <div class="menu">
                {#if editable}<a href="/editor">{locale.t("openEditor")}</a>{/if}
                <button onclick={download}>{locale.t("exportModel")}</button>
            </div>
        </details>
    </div>
    {#if chatOpen}<aside class="chat-panel" transition:fly={{ x: 24, duration: motion(260), easing: easeOut }}>
            <ChatPanel
                {chat}
                places={placeList}
                suggestions={starters}
                {title}
                context={chatContext}
                onclose={() => (chatOpen = false)}
            />
        </aside>{/if}{/if}
    {#if picking}<div class="pick-banner" role="status">
            {locale.t("pickBanner", { action: locale.t(wide ? "click" : "tap") })} · <button
                onclick={() => (picking = false)}>{locale.t("cancel")}</button
            >
        </div>{/if}
    {#if error || notice}<p class="viewer-error" role="alert">{error || (notice && locale.t(notice))}</p>{/if}
    {#if toast}<div class="toast" role="status"><span>✓</span>{toast}</div>{/if}
</div>

<style>
    .map-viewer {
        position: relative;
        height: 100dvh;
        overflow: hidden;
        background: #edf0e7;
    }
    .stage {
        position: absolute;
        inset: 0;
    }
    .plan {
        position: absolute;
        inset: 0;
        padding: 16px 16px 16px 400px;
    }
    .panel {
        position: absolute;
        top: 16px;
        left: 16px;
        bottom: 16px;
        width: 368px;
        z-index: 6;
        padding: 20px;
        overflow: auto;
        background: #fffffff5;
        border: 1px solid #fff;
        border-radius: 18px;
        box-shadow: 0 12px 50px #243d241c;
    }
    .panel.collapsed {
        bottom: auto;
    }
    .panel small.product {
        display: flex;
        align-items: center;
        gap: 6px;
        text-transform: uppercase;
    }
    .panel header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 16px;
    }
    .panel small {
        font-size: 9px;
        letter-spacing: 1.4px;
        color: #7b8c70;
    }
    .panel h1 {
        font:
            24px Georgia,
            serif;
        margin: 4px 0 0;
        color: #1f3a2b;
    }
    .lang {
        display: flex;
        flex-shrink: 0;
        margin-left: auto;
        padding: 2px;
        border-radius: 8px;
        background: #eef2e9;
    }
    .lang button {
        padding: 4px 7px;
        border-radius: 6px;
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.5px;
        color: #6a7a66;
    }
    .lang button[aria-pressed="true"] {
        background: white;
        color: #1f3a2b;
        box-shadow: 0 1px 3px #243d241f;
    }
    .collapse {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        background: #eef2e9;
        font-size: 17px;
        color: #3f6b4e;
        flex-shrink: 0;
    }
    .info {
        margin-top: 18px;
        padding-top: 14px;
        border-top: 1px solid #eef2ea;
        font-size: 13px;
    }
    .info > summary {
        display: flex;
        align-items: center;
        gap: 8px;
        list-style: none;
        cursor: pointer;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.6px;
        text-transform: uppercase;
        color: #52664a;
    }
    .info > summary::-webkit-details-marker {
        display: none;
    }
    .info > summary span {
        padding: 1px 7px;
        border-radius: 10px;
        background: #eef2e9;
        letter-spacing: 0;
    }
    .info > summary::after {
        content: "+";
        margin-left: auto;
        font-size: 16px;
        color: #3f6b4e;
    }
    .info[open] > summary::after {
        content: "−";
    }
    /* The chat sits beside the map: the map narrows to make room. */
    .chat-panel {
        position: absolute;
        top: 16px;
        right: 16px;
        bottom: 16px;
        width: 380px;
        z-index: 6;
        overflow: hidden;
        background: #fffffff5;
        border: 1px solid #fff;
        border-radius: 18px;
        box-shadow: 0 12px 50px #243d241c;
    }
    .chat-open .stage {
        right: 412px;
    }
    .chat-open .top-actions {
        right: 428px;
    }
    .ask {
        gap: 6px;
    }
    .ask[aria-pressed="true"] {
        background: #2d4a38;
        color: white;
    }
    .top-actions {
        position: absolute;
        top: 16px;
        right: 16px;
        z-index: 6;
        display: flex;
        gap: 8px;
        align-items: flex-start;
    }
    .segmented {
        display: flex;
        padding: 3px;
        background: white;
        border-radius: 10px;
        box-shadow: 0 3px 16px #243d2414;
    }
    .segmented button {
        padding: 8px 14px;
        border-radius: 7px;
        font-size: 12px;
        color: #52664a;
    }
    .segmented .active {
        background: #2d4a38;
        color: white;
    }
    .top-actions .btn {
        box-shadow: 0 3px 16px #243d2414;
    }
    .more {
        position: relative;
    }
    .more summary {
        list-style: none;
        cursor: pointer;
    }
    .more summary::-webkit-details-marker {
        display: none;
    }
    .menu {
        position: absolute;
        right: 0;
        top: calc(100% + 6px);
        min-width: 200px;
        padding: 6px;
        background: white;
        border-radius: 10px;
        box-shadow: 0 12px 34px #1f35261f;
        display: flex;
        flex-direction: column;
    }
    .menu a,
    .menu button {
        padding: 10px 12px;
        border-radius: 7px;
        font-size: 12px;
        color: #2f4336;
        text-decoration: none;
        text-align: left;
    }
    .menu a:hover,
    .menu button:hover {
        background: #eef3e8;
    }
    .pick-banner {
        position: absolute;
        top: 72px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 7;
        padding: 10px 16px;
        border-radius: 30px;
        background: #2f7fc4;
        color: white;
        font-size: 12px;
        box-shadow: 0 6px 24px #2f7fc440;
    }
    .pick-banner button {
        color: white;
        text-decoration: underline;
        font-size: 12px;
    }
    .map-viewer.picking .stage :global(canvas) {
        cursor: crosshair;
    }
    .map-viewer :global(.scene-options) {
        top: 70px;
        right: 16px;
    }
    .map-viewer :global(.orbit-help) {
        left: 400px;
        bottom: 18px;
    }
    .viewer-error {
        position: absolute;
        bottom: 20px;
        right: 20px;
        max-width: 420px;
        z-index: 8;
        background: #fff2dd;
        color: #785e33;
        padding: 14px 16px;
        border-radius: 10px;
    }
    /* Phones get the mobile layout once the page knows the screen size; the
       desktop panel never shows there. */
    @media (max-width: 700px) {
        .panel,
        .top-actions {
            visibility: hidden;
        }
        .map-viewer :global(.orbit-help) {
            display: none;
        }
    }
    .mobile .plan {
        padding: calc(env(safe-area-inset-top) + 124px) 8px calc(var(--sheet-inset) + 8px);
    }
    .mobile .pick-banner {
        top: calc(env(safe-area-inset-top) + 12px);
        width: calc(100% - 24px);
        padding: 12px 16px;
        border-radius: 16px;
        font-size: 14px;
        line-height: 1.4;
        text-align: center;
        animation: banner-in 280ms cubic-bezier(0.23, 1, 0.32, 1);
    }
    .mobile .pick-banner button {
        font-size: 14px;
        font-weight: 600;
    }
    @keyframes banner-in {
        from {
            opacity: 0;
            transform: translate(-50%, -8px);
        }
    }
    .mobile :global(.toast) {
        top: calc(env(safe-area-inset-top) + 76px);
        bottom: auto;
        max-width: calc(100% - 32px);
        border-radius: 14px;
        font-size: 14px;
    }
    .mobile .viewer-error {
        top: calc(env(safe-area-inset-top) + 76px);
        bottom: auto;
        left: 12px;
        right: 12px;
        max-width: none;
    }
    /* The 3D display options open under the map type card, as one menu. */
    .mobile :global(.scene-options) {
        display: none;
    }
    .mobile.layers-open :global(.scene-options) {
        display: flex;
        flex-wrap: wrap;
        top: calc(env(safe-area-inset-top) + 318px);
        right: 12px;
        z-index: 20;
        width: 240px;
        padding: 8px;
        gap: 4px;
        border-radius: 16px;
        background: white;
        box-shadow:
            0 2px 6px #1f352614,
            0 16px 40px #1f352629;
        transform-origin: top right;
        transition:
            opacity 200ms cubic-bezier(0.23, 1, 0.32, 1),
            transform 200ms cubic-bezier(0.23, 1, 0.32, 1);
        @starting-style {
            opacity: 0;
            transform: scale(0.96);
        }
    }
    .mobile.layers-open :global(.scene-options button) {
        padding: 9px 12px;
        font-size: 13px;
    }
    .mobile.layers-open :global(.scene-options .greenery) {
        padding: 6px 8px;
        font-size: 13px;
    }
</style>
