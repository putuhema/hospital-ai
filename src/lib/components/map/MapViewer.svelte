<script lang="ts">
    import { flushSync, onMount, untrack } from "svelte";
    import { afterNavigate, replaceState } from "$app/navigation";
    import { rise, unblur } from "$lib/motion";
    import HospitalScene from "$lib/components/shared/HospitalScene.svelte";
    import Logo from "$lib/components/shared/Logo.svelte";
    import FloorPlan from "$lib/components/shared/FloorPlan.svelte";
    import RouteFinder from "$lib/components/shared/RouteFinder.svelte";
    import PlaceIcon from "$lib/components/shared/PlaceIcon.svelte";
    import PlaceDetails from "$lib/components/shared/PlaceDetails.svelte";
    import MyTurnBanner from "./MyTurnBanner.svelte";
    import QrScanner from "./QrScanner.svelte";
    import RouteSteps from "$lib/components/shared/RouteSteps.svelte";
    import ChatPanel from "$lib/components/assistant/ChatPanel.svelte";
    import { Chat } from "$lib/assistant/chat.svelte";
    import { cannedReplier, suggestions, type ReplyContext } from "$lib/assistant/chat";
    import { serverReplier } from "$lib/assistant/remote";
    import { Locale, provideLocale } from "$lib/i18n/locale.svelte";
    import { LANGS } from "$lib/i18n/lang";
    import { localizeRooms } from "$lib/i18n/places";
    import type { Key } from "$lib/i18n/messages";
    import type { Piece } from "$lib/model/layout";
    import { answered, type FaqEntry } from "$lib/model/faq";
    import { walkwayAt } from "$lib/model/interiors";
    import { hoursStatus } from "$lib/model/place-info";
    import type { Point, WalkingNetwork } from "$lib/wayfinding/navigation";
    import { buildGrid, places, planRoute, progress, stepText, walkMinutes, type Place } from "$lib/wayfinding/routing";
    import { createFollower, STRIDE } from "$lib/wayfinding/follow";
    import { startWalkSensor, type SensorState } from "$lib/wayfinding/walk-sensor";
    let {
        title,
        pieces,
        network,
        greenery = 1,
        tileMeters = 2,
        canvasWidth,
        canvasHeight,
        faq = [],
        shareUrl = null,
        slug,
        editable = false,
        notice = null,
    }: {
        title: string;
        pieces: Piece[];
        network: WalkingNetwork;
        /** Trees and foliage around the campus, set in the editor. */
        greenery?: number;
        /** Real metres per tile, as the hospital measured it: walking distances use it. */
        tileMeters?: number;
        canvasWidth: number;
        canvasHeight: number;
        /** Hospital information: general questions the map can't answer. */
        faq?: FaqEntry[];
        /** The public address of this map; routes are shared from it. Null before the hospital is saved. */
        shareUrl?: string | null;
        /** Which hospital in the database, for the assistant; the first one without it. */
        slug?: string;
        /** Show the link back to the editor (not on the public map). */
        editable?: boolean;
        /** A problem with the layout itself, e.g. it could not be loaded. */
        notice?: Key | null;
    } = $props();

    // Everything about the hospital (hours, doctors, BPJS…) is asked in the chat.
    type Tab = "chat" | "route";
    const TABS: { id: Tab; key: Key }[] = [
        { id: "chat", key: "tabChat" },
        { id: "route", key: "tabRoute" },
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
        picking = $state(false),
        /** The destination's card is open to show what is there: hours, phone, doctors. */
        about = $state(true),
        /** Phones: the route's steps in the card over the map, so the map stays in sight. */
        stepping = $state(false),
        /** Steps of the route ticked off; the map greys the way walked. */
        done = $state(0),
        journeyHeight = $state(0);
    let exporter: (() => Promise<void>) | null = null;
    let questions = $derived(answered(faq));
    let landmarks = $derived(network.nodes.filter((n) => n.name.trim()));

    // The visitor's language: Indonesian unless they chose English on this device.
    const locale = new Locale();
    provideLocale(locale);
    const t = locale.t;
    // Rooms the editor named by default ("Examination room 2") read in the visitor's language.
    let rooms = $derived(localizeRooms(pieces, locale.lang));
    let placeList = $derived(places(rooms, network));
    // Routes are planned on the rooms as visitors read them, so the steps name them that way too.
    let grid = $derived(buildGrid(rooms, canvasWidth, canvasHeight, tileMeters, network.nodes));
    let route = $derived(from && to ? planRoute(grid, from, to) : null);

    // The assistant. Canned replies from the map and the hospital information
    // until the chat server route is built.
    let assistant = $derived({ places: placeList, grid, now: new Date() });
    let starters = $derived(suggestions(assistant, questions, locale.lang));
    // Claude on the server when it is set up; the built-in replies otherwise.
    const chat = new Chat(
        serverReplier(
            () => ({ slug }),
            cannedReplier(() => ({ ctx: assistant, faq: questions })),
        ),
        // Kept for the browser session: visitors switch apps and come back. One hospital per page.
        untrack(() => `p-map-chat:${slug ?? "home"}`),
    );
    /**
     * Where the visitor is now: while following a route, the named place
     * nearest the point they have walked to; otherwise where they set out from.
     */
    function whereNow(): Place | null {
        if (route && (done > 0 || onward > 0)) {
            const p = route.points[walked],
                next = route.points[Math.min(walked + 1, route.points.length - 1)],
                span = Math.hypot(next.x - p.x, next.y - p.y) * 2,
                k = span ? Math.min(1, onward / span) : 0,
                here = { x: p.x + (next.x - p.x) * k, y: p.y + (next.y - p.y) * k };
            let best: Place | null = null,
                gap = 3; // tiles: farther than that, they are near nothing in particular
            for (const place of placeList) {
                if (place.kind === "listed" || place.kind === "area") continue;
                const d = Math.hypot(place.point.x - here.x, place.point.y - here.y);
                if (d < gap) [best, gap] = [place, d];
            }
            if (best) return best;
        }
        return from && "id" in from ? from : null;
    }
    const chatContext = (): ReplyContext => {
        const at = whereNow();
        return {
            lang: locale.lang,
            ...(at && { from: at.id }),
            // On the way: the assistant can say how far is left, or what is near from here.
            ...(route &&
                to &&
                stepping &&
                done < route.steps.length && {
                    walking: {
                        to: to.id,
                        step: done + 1,
                        total: route.steps.length,
                        metersLeft: Math.max(0, Math.round(progress(route, done).metersLeft - onward / drawn())),
                        ...(route.steps[done + 1] && {
                            next: `${stepText(route.steps[done + 1].say, locale.lang)}, ${t("nextIn", {
                                m: Math.max(0, Math.round(route.steps[done].meters - onward / drawn())),
                            })}`,
                        }),
                    },
                }),
        };
    };
    // While chatting, the place the latest answer is about stands out on the
    // map; otherwise the chosen destination does.
    let chatFocus = $derived.by(() => {
        const reply = chat.messages.findLast((m) => m.role === "assistant");
        const card = reply?.parts.findLast((p) => p.type === "card");
        return card?.type === "card" ? (placeList.find((p) => p.id === card.show.to) ?? null) : null;
    });
    let highlight = $derived(tab === "chat" ? (chatFocus ?? to) : to);
    /** The chat's place last carried over to directions, so each is carried over once. */
    let carried: string | null = null;
    /** Switch tabs; directions start from where the chat just pointed. */
    function show(next: Tab) {
        if (next === "route" && chatFocus && chatFocus.id !== carried) {
            carried = chatFocus.id;
            to = chatFocus;
        }
        tab = next;
    }
    // A picked spot is named after the corridor or path it is on; on the way, where they have got to.
    let here = $derived.by(() => {
        if (stepping && route && (done > 0 || onward > 0)) {
            const now = whereNow();
            if (now) return now.name;
        }
        return !from
            ? null
            : "id" in from
              ? from.name
              : t("spotOn", { name: walkwayAt(pieces, from)?.name ?? t("theMap") });
    });
    let status = $derived(to?.info ? hoursStatus(to.info, new Date(), locale.lang) : null);
    /** A building's clinics: the rooms in it where doctors practise. */
    let clinics = $derived(
        to?.kind === "building"
            ? placeList.filter((p) => p.kind === "room" && p.pieceId === to!.pieceId && p.info?.doctors?.length)
            : [],
    );
    // Each new destination opens on what is there, however it was chosen.
    $effect(() => {
        void to?.id;
        untrack(() => (about = true));
    });
    /** The destination has something to tell beyond its name. */
    let hasAbout = $derived(!!to && (!!placeInfo(to.info) || clinics.length > 0));
    /** Details in the card, unless the directions beside it already show them (wide screens, Rute tab). */
    let aboutHere = $derived(hasAbout && !(wide && tab === "route" && !!placeInfo(to?.info)));
    function placeInfo(info: Place["info"]) {
        return info && (info.description || info.phone || info.hours?.length || info.doctors?.length || info.simrs?.length) ? info : null;
    }

    // How much of the screen the conversation covers, so the camera frames the rest.
    let insetLeft = $derived(wide ? COLUMN : 0);
    // On phones, the chat bar (and the destination above it) cover the bottom.
    /** On a phone, following the steps: the map is for walking, so the bars that aren't go. */
    let navigating = $derived(ready && !wide && stepping && !!route);
    let insetBottom = $derived(wide ? 0 : to && journeyHeight ? journeyHeight + (navigating ? 24 : 92) : 90);
    // Steps belong to one route; a new one starts from the first.
    $effect(() => {
        if (!route || wide) stepping = false;
    });
    $effect(() => {
        route;
        done = 0;
    });
    let walked = $derived(route ? progress(route, done).at : 0);

    /*
     * On a phone, following the steps also follows the visitor: the motion
     * sensors count their steps and feel their turns, ticking steps off and
     * moving their dot along, so they needn't tap. Tapping still corrects it.
     */
    let sensing = $state<SensorState | null>(null),
        /** Metres walked into the current step. */
        onward = $state(0),
        /** Their walking speed (m/s), from their recent steps. */
        pace = $state<number | null>(null);
    // The follower counts in the map's drawn metres (2 a tile); a real metre is
    // 2 / tileMeters of them, as the hospital measured it. What corners teach on
    // top of that (the visitor's stride, a building drawn a bit off) is kept on
    // this phone, per hospital, as a correction to the measured scale.
    const drawn = () => 2 / tileMeters;
    const correctionKey = () => `p-map-stride:${slug ?? "home"}`;
    function savedCorrection() {
        try {
            const n = Number(localStorage.getItem(correctionKey()));
            return n > 0 ? n : 1;
        } catch {
            return 1;
        }
    }
    let follower = $derived(route ? createFollower(route, { scale: drawn() * untrack(savedCorrection) }) : null);
    let stopSensor: (() => void) | null = null,
        stepTimes: number[] = [],
        /** Degrees the visitor has turned since the current stretch began (positive left). */
        turned = 0;
    // Each stretch starts facing its own way (see `leg`).
    $effect(() => {
        leg;
        turned = 0;
    });
    /** For the map to turn with the visitor: only while the phone is following them. */
    const facing = () => (stepping && sensing === "on" ? (turned * Math.PI) / 180 : null);
    /** Start following; called from the tap that opens the steps, as iOS asks for motion access only then. */
    function follow() {
        stopSensor?.();
        sensing = null;
        pace = null;
        stepTimes = [];
        stopSensor = startWalkSensor({
            step: (time) => {
                if (!follower) return;
                // Speed from the last dozen steps, if they came at a walk (no long pause between).
                stepTimes = [...stepTimes.filter((t) => time - t < 9000), time].slice(-12);
                // In map metres a second, as the distances left are measured on the map.
                if (stepTimes.length >= 6)
                    pace = (STRIDE * follower.scale * (stepTimes.length - 1)) / ((time - stepTimes[0]) / 1000);
                if (follower.step()) done = follower.done;
                onward = follower.along;
                // Arrived: nothing left to follow.
                if (follower.done >= (route?.steps.length ?? 0)) unfollow();
            },
            // Slower than this is the sensor drifting, not the visitor turning.
            yaw: (rate, seconds) => {
                if (Math.abs(rate) > 3) turned += rate * seconds;
            },
            turn: (angle) => {
                if (follower?.turn(angle)) {
                    done = follower.done;
                    onward = 0;
                    try {
                        localStorage.setItem(correctionKey(), (follower.scale / drawn()).toFixed(3));
                    } catch {}
                }
            },
            state: (state) => (sensing = state),
        });
    }
    function unfollow() {
        stopSensor?.();
        stopSensor = null;
        sensing = null;
        onward = 0;
    }
    $effect(() => {
        if (!stepping || !route) untrack(unfollow);
    });
    // Ticked by hand (or started over): follow on from there.
    $effect(() => {
        if (follower && follower.done !== done) {
            follower.sync(done);
            onward = 0;
        }
    });
    onMount(() => () => stopSensor?.());
    /**
     * Following the steps (on a phone, the steps card; on a wide screen, once a
     * step is ticked): the stretch to walk now, up to the next turn. The map
     * looks along it, so what is ahead on the screen is ahead in the hospital.
     */
    let leg = $derived.by(() => {
        if (!route || !(stepping || (wide && done > 0)) || done >= route.steps.length - 1) return null;
        const from = route.steps[done].at,
            to = route.steps[done + 1]?.at ?? route.points.length - 1;
        return to > from ? { from, to } : null;
    });

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
        chat.restore();
        const desktop = window.matchMedia("(min-width: 761px)");
        wide = desktop.matches;
        desktop.onchange = () => (wide = desktop.matches);
        // Deep links, e.g. a QR code at an entrance: /?from=b:9&to=r:2:25
        const params = new URLSearchParams(location.search);
        from = decode(params.get("from"));
        let target = decode(params.get("to"));
        // A sign's link has only a start: on the way somewhere in the last two hours, carry on there.
        if (from && !target)
            try {
                const going = JSON.parse(localStorage.getItem(goingKey()) ?? "null");
                if (going && Date.now() - going.at < 2 * 3600_000) target = decode(going.to);
            } catch {}
        to = target && "id" in target ? target : null;
        // A conversation from earlier in the session doesn't replace the link's destination.
        if (to) carried = chatFocus?.id ?? null;
        if (params.get("view") === "plan") view = "Plan";
        // Someone who scanned a sign or opened a shared route wants the way.
        if (to) tab = "route";
        ready = true;
    });
    // When the layout changes (the editor saved a change), keep the
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
        carried = chatFocus?.id ?? null;
        picking = false;
        sheetOpen = false;
        untrack(syncUrl);
    });
    // Choosing a start on the map needs the map.
    $effect(() => {
        if (picking) untrack(() => (sheetOpen = false));
    });
    // Scanning a "You are here" sign: it sets where the visitor is. On the way,
    // the route is planned again from the sign, and following carries on from there.
    let scanning = $state(false);
    function atSign(id: string) {
        scanning = false;
        const place = placeList.find((p) => p.id === id);
        if (!place) return;
        from = place;
        notify(t("youAreAt", { name: place.name }));
    }
    // Where the visitor was going, kept a while on this phone: scanning a sign
    // with the phone's own camera opens the map afresh, and should carry on.
    const goingKey = () => `p-map-going:${slug ?? "home"}`;
    $effect(() => {
        if (!ready) return;
        try {
            if (to) localStorage.setItem(goingKey(), JSON.stringify({ to: to.id, at: Date.now() }));
            else localStorage.removeItem(goingKey());
        } catch {}
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
            // Tapped on the map: that place, not the chat's, with what is there (a clinic's doctors, opening hours).
            carried = chatFocus?.id ?? null;
            to = place;
        }
    }
    function open(next: Tab) {
        show(next);
        sheetOpen = true;
    }
    /**
     * Straight to directions: the route tab, its destination search ready to
     * type in. Focused in the tap itself (after drawing the tab at once), as
     * phones only bring up the keyboard for a focus the visitor asked for.
     */
    function findWay() {
        open("route");
        if (to) return;
        flushSync();
        document
            .querySelector<HTMLInputElement>(`.column .route-finder input[aria-label="${t("destination")}"]`)
            ?.focus({ preventScroll: true });
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
    /** The route when there is one, else the map. Phones open their share sheet. */
    async function share() {
        const link = shareUrl ? shareUrl + (to ? location.search : "") : to ? location.href : location.origin;
        if (!wide && navigator.share) {
            try {
                return await navigator.share({ title, url: link });
            } catch (e) {
                if ((e as Error).name === "AbortError") return;
            }
        }
        try {
            await navigator.clipboard.writeText(link);
            notify(!shareUrl ? t("linkCopiedUnpublished") : to ? t("linkCopied") : t("mapLinkCopied"));
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
    class:navigating
    style:--column={`${COLUMN}px`}
>
    <section class="stage" aria-label={t("mapRegion")}>
        {#if ready}{#if view === "3D"}<HospitalScene
                    presentation={true}
                    pieces={rooms}
                    selected={null}
                    active={null}
                    grid={false}
                    zoom={100}
                    {greenery}
                    {canvasWidth}
                    {canvasHeight}
                    route={route?.points ?? null}
                    {walked}
                    {onward}
                    {leg}
                    {facing}
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
                        pieces={rooms}
                        places={placeList}
                        width={canvasWidth}
                        height={canvasHeight}
                        route={route?.points ?? null}
                        {walked}
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
                <nav
                    class="switcher"
                    style:--at={TABS.findIndex((x) => x.id === tab)}
                    style:--tabs={TABS.length} aria-label={t("mapView")}>
                    <span class="thumb" aria-hidden="true"></span>
                    {#each TABS as x}<button aria-pressed={tab === x.id} onclick={() => show(x.id)}
                            >{t(x.key)}{#if x.id === "route" && to}<i class="to-dot"></i>{/if}</button
                        >{/each}
                </nav>
                {#if ready && !wide}<button class="close" aria-label={t("closeChat")} onclick={() => (sheetOpen = false)}
                        ><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg
                        ></button
                    >{/if}
            </div>
        </div>
        <div class="pane">
            {#if tab === "chat"}<ChatPanel
                    {chat}
                    places={placeList}
                    suggestions={starters}
                    context={chatContext}
                    shown={highlight?.id ?? null}
                    {here}
                    onshow={() => (sheetOpen = false)}
                    onhere={() => open("route")}
                    onclearhere={() => {
                        from = null;
                        picking = false;
                    }}
                />{:else}<div class="scroll" in:unblur>
                    <h2>{t("whereTo")}</h2>
                    <RouteFinder
                        places={placeList}
                        {grid}
                        {route}
                        bind:from
                        bind:to
                        bind:picking
                        bind:done
                        onscan={wide ? undefined : () => (scanning = true)}
                    />
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
        <button class="round" aria-label={t(to ? "shareRoute" : "shareMap")} title={t(to ? "shareRoute" : "shareMap")} onclick={share}
            ><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
                ><path d="M12 15V4m-4 4 4-4 4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" /></svg
            ></button
        >
    </div>
    <!-- Phones: the two things a visitor comes for, side by side. Most want
         the way somewhere, so that is the big one; asking is beside it. -->
    {#if ready && !wide}<div class="launcher" in:rise={{ y: 12 }}>
            <button class="find" onclick={findWay}>
                <i aria-hidden="true"
                    ><svg viewBox="0 0 24 24" width="18" height="18"
                        ><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg
                    ></i
                >
                <span>{t("whereTo")}</span>
            </button>
            <button
                class="ask"
                onclick={() => open("chat")}
                aria-label={chat.messages.length ? t("continueChat") : t("askQuestion")}
            >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
                    ><path d="M5 18.5V7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H8.5z" /></svg
                >{t("askOnTheWay")}{#if chat.messages.length}<b class="unread" aria-hidden="true"></b>{/if}
            </button>
        </div>{/if}

    {#if to}{#key to.id}<div
                class="journey"
                class:open={(about && aboutHere) || stepping}
                bind:clientHeight={journeyHeight}
                in:rise={{ y: 10 }}
            >
                <div class="journey-head">
                    <PlaceIcon of={to} size={34} />
                    <button
                        class="where"
                        disabled={!aboutHere}
                        aria-expanded={aboutHere ? about && !stepping : undefined}
                        title={aboutHere ? t(about && !stepping ? "hideDetails" : "showDetails") : undefined}
                        onclick={() => {
                            about = stepping || !about;
                            stepping = false;
                        }}
                    >
                        <b>{t("headingTo", { name: to.name })}</b>
                        <small
                            >{#if route}{t("minutes", { n: walkMinutes(route.meters) })} · {t("metresWalk", {
                                    m: route.meters,
                                })}{:else if status}<span class:open={status.open}>{status.text}</span>{:else}{to.building ??
                                    locale.type(to.detail)}{/if}{#if aboutHere}<i class="more-info" class:up={about && !stepping} aria-hidden="true"
                                    ><svg viewBox="0 0 24 24" width="14" height="14"><path d="m6 9 6 6 6-6" /></svg></i
                                >{/if}</small
                        >
                    </button>
                    {#if route && !wide}<button
                            class="go"
                            aria-pressed={stepping}
                            onclick={() => {
                                stepping = !stepping;
                                if (stepping) follow();
                            }}
                            >{t("steps")}</button
                        >{:else}<button class="go" onclick={() => open("route")}>{route ? t("steps") : t("directions")}</button>{/if}
                    <button class="x" aria-label={t("clearDestination")} onclick={() => (to = null)}
                        ><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg
                        ></button
                    >
                </div>
                {#if stepping && route}<div class="about steps"><RouteSteps
                            {route}
                            bind:done
                            following={sensing}
                            pace={pace && pace / drawn()}
                            onward={onward / drawn()}
                            compact
                            onscan={() => (scanning = true)}
                            onask={() => open("chat")}
                        /></div>
                {:else if about && aboutHere}
                    {@const info = placeInfo(to.info)}
                    <div class="about">
                        {#if info}<PlaceDetails {info} place={to.id} />{/if}
                        {#if clinics.length}<div class="clinics">
                                <small>{t("clinicsHere")}</small>
                                {#each clinics as c (c.id)}<button onclick={() => (to = c)}>
                                        <PlaceIcon of={c} size={28} />
                                        <span><b>{c.name}</b><em
                                                >{(c.info?.doctors?.length ?? 0) === 1
                                                    ? t("doctorOne")
                                                    : t("doctorCount", { n: c.info?.doctors?.length ?? 0 })}</em
                                            ></span>
                                        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
                                    </button>{/each}
                            </div>{/if}
                    </div>
                {/if}
            </div>{/key}{/if}

    {#if picking}<div class="pick-banner" role="status">
            {t("pickBanner", { action: t(wide ? "click" : "tap") })} · <button onclick={() => (picking = false)}
                >{t("cancel")}</button
            >
        </div>{/if}
    <div class="my-turn-slot">
        <MyTurnBanner
            onopen={(id) => {
                const place = placeList.find((p) => p.id === id);
                if (place) to = place;
            }}
        />
    </div>
    {#if error || notice}<p class="viewer-error" role="alert">{error || (notice && t(notice))}</p>{/if}
    {#if toast}<div class="toast" role="status"><span>✓</span>{toast}</div>{/if}
    {#if scanning}<QrScanner {slug} onfound={atSign} onclose={() => (scanning = false)} />{/if}
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
        /* Clip, not hidden: the closed sheet waits below the screen, and focus or scrollIntoView would scroll a hidden box to it, taking the map away. */
        overflow: clip;
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
        grid-template-columns: repeat(var(--tabs), 1fr);
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
        width: calc((100% - 8px) / var(--tabs));
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
    /* A destination is set. (`.badge` is taken by the editor's global styles.) */
    .to-dot {
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

    /* Directions: the two places on one card, like a ticket, in the paper style. */
    .scroll :global(.route-finder .fields) {
        gap: 0;
        padding-right: 0;
        border: 1px solid var(--line);
        border-radius: 18px;
        background: var(--card);
        box-shadow: 0 1px 2px #1b2a210d, 0 8px 24px -14px #1b2a2140;
        transition: box-shadow 0.2s;
    }
    .scroll :global(.route-finder .fields:focus-within) {
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--forest) 16%, transparent), 0 8px 24px -14px #1b2a2140;
    }
    .scroll :global(.route-finder .place-search input) {
        padding: 16px 54px 16px 42px;
        border: 0;
        border-radius: 0;
        background: transparent;
        font-size: 15px;
        color: var(--ink);
    }
    /* The clear button sits left of the swap button. */
    .scroll :global(.route-finder .place-search input.clearable) {
        padding-right: 88px;
    }
    .scroll :global(.route-finder .place-search .clear-field) {
        right: 52px;
        color: var(--muted);
    }
    .scroll :global(.route-finder .place-search .clear-field:hover) {
        background: var(--paper-2);
    }
    .scroll :global(.route-finder .place-search input::placeholder) {
        color: var(--muted);
    }
    .scroll :global(.route-finder .place-search input:focus) {
        outline: 0;
    }
    .scroll :global(.route-finder .place-search + .place-search) {
        border-top: 1px dashed #1b2a2124;
    }
    .scroll :global(.route-finder .marker) {
        left: 17px;
    }
    .scroll :global(.route-finder .marker.start) {
        background: var(--forest);
        box-shadow: 0 0 0 4px color-mix(in srgb, var(--forest) 14%, transparent);
    }
    .scroll :global(.route-finder .marker.end) {
        background: var(--signal);
    }
    .scroll :global(.route-finder .place-search ul) {
        border: 1px solid var(--line);
        border-radius: 16px;
        background: var(--card);
    }
    .scroll :global(.route-finder .place-search li.highlighted) {
        background: var(--paper-2);
    }
    .scroll :global(.route-finder .swap) {
        right: 12px;
        width: 34px;
        height: 34px;
        border: 1px solid var(--line);
        background: var(--paper);
        color: var(--forest);
    }
    .scroll :global(.route-finder .swap:hover:not(:disabled)) {
        background: var(--paper-2);
    }
    .scroll :global(.route-finder .tools) {
        gap: 8px;
        margin: 16px 0 6px;
    }
    .scroll :global(.route-finder .chip) {
        gap: 7px;
        padding: 8px 12px 8px 9px;
        border: 1px solid var(--line);
        border-radius: 12px;
        background: var(--card);
        font-size: 13px;
        color: var(--ink);
    }
    .scroll :global(.route-finder .chip:hover) {
        border-color: #1b2a2133;
        background: var(--card);
    }
    .scroll :global(.route-finder .chip.active) {
        border-color: var(--forest);
        background: var(--forest);
        color: #fff;
    }
    .scroll :global(.route-finder .tip),
    .scroll :global(.route-finder .notice) {
        margin-top: 14px;
        font-size: 13.5px;
        color: var(--ink-2);
    }
    .scroll :global(.route-finder .notice) {
        border-radius: 14px;
        background: #f6e7d6;
        color: #6e4a2a;
    }
    .scroll :global(.route-finder .result) {
        margin-top: 18px;
        padding: 18px 18px 8px;
        border: 1px solid var(--line);
        border-top: 1px solid var(--line);
        border-radius: 18px;
        background: var(--card);
    }
    .scroll :global(.route-finder .summary b) {
        font-family: var(--display);
        font-size: 34px;
        font-weight: 480;
        letter-spacing: -0.02em;
        color: var(--ink);
    }
    .scroll :global(.route-finder .summary span) {
        font-size: 13px;
        color: var(--muted);
    }
    .scroll :global(.route-finder .clear) {
        font-size: 12.5px;
        color: var(--forest);
    }
    .scroll :global(.route-finder ol li) {
        gap: 12px;
        padding: 11px 0;
        border-bottom: 1px solid var(--line);
        font-size: 14px;
        color: var(--ink);
    }
    .scroll :global(.route-finder ol li:last-child) {
        border-bottom: 0;
    }
    .scroll :global(.route-finder .glyph) {
        width: 28px;
        height: 28px;
        background: color-mix(in srgb, var(--forest) 10%, transparent);
        color: var(--forest);
    }
    .scroll :global(.route-finder ol li:last-child .glyph) {
        background: color-mix(in srgb, var(--signal) 16%, transparent);
        color: var(--signal);
    }
    .scroll :global(.route-finder .place-details) {
        margin-top: 16px;
        padding: 14px;
        border: 1px solid var(--line);
        border-radius: 18px;
        background: var(--paper-2);
        font-size: 13.5px;
        color: var(--ink);
    }
    .scroll :global(.route-finder .place-details small) {
        color: var(--muted);
    }
    .scroll :global(.route-finder .place-details .doctor) {
        padding: 11px 12px;
        border-radius: 12px;
        background: var(--card);
    }
    .scroll :global(.route-finder .place-details .phone) {
        color: var(--forest);
    }
    .scroll :global(.route-finder .step small) {
        margin-top: 2px;
        color: var(--muted);
        font-size: 12px;
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
        bottom: 18px;
        font-size: 11px;
        color: var(--ink-2);
    }
    .concierge :global(.orbit-help span) {
        display: inline-block;
        padding: 6px 12px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--card) 88%, transparent);
        box-shadow: 0 2px 10px #1b2a2114;
        backdrop-filter: blur(6px);
    }

    /* Where the visitor is heading, over the map. */
    .journey {
        position: absolute;
        z-index: 6;
        bottom: 24px;
        left: calc(var(--column) + (100% - var(--column)) / 2);
        translate: -50% 0;
        display: flex;
        flex-direction: column;
        width: max-content;
        max-width: min(520px, calc(100% - var(--column) - 40px));
        max-height: calc(100% - 120px);
        padding: 8px 8px 8px 10px;
        border-radius: 18px;
        background: var(--card);
        box-shadow:
            0 0 0 1px var(--line),
            0 22px 48px -18px #1b2a2166;
    }
    /* Open on what is there: wide enough to read a doctors' schedule. */
    .journey.open {
        width: min(440px, calc(100% - var(--column) - 40px));
    }
    .journey-head {
        display: flex;
        align-items: center;
        gap: 12px;
    }
    .where {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
        padding: 0 6px 0 0;
        text-align: left;
        color: inherit;
    }
    .where:disabled {
        opacity: 1;
        cursor: default;
    }
    .more-info {
        display: inline-grid;
        vertical-align: -3px;
        margin-left: 4px;
        transition: transform 200ms ease;
    }
    .more-info.up {
        transform: rotate(180deg);
    }
    .about {
        overflow-y: auto;
        overscroll-behavior: contain;
        margin: 4px -2px 0 0;
        padding: 0 2px 4px 0;
    }
    .about :global(.place-details) {
        margin-top: 8px;
    }
    .clinics {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 10px;
    }
    .clinics small {
        font-size: 10px;
        letter-spacing: 0.6px;
        text-transform: uppercase;
        color: var(--muted);
    }
    .clinics button {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        border-radius: 12px;
        background: #f5f8f1;
        text-align: left;
        color: inherit;
    }
    .clinics button span {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
    }
    .clinics em {
        font-style: normal;
        font-size: 12px;
        color: var(--muted);
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
    .concierge .go[aria-pressed="true"] {
        background: var(--paper-2);
        color: var(--forest);
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
    .my-turn-slot {
        position: absolute;
        z-index: 6;
        top: 20px;
        left: calc(var(--column) + 20px);
        right: 260px;
        pointer-events: none;
    }
    .my-turn-slot > :global(*) {
        pointer-events: auto;
    }
    .mobile .my-turn-slot {
        top: calc(var(--top) + 118px);
        left: 12px;
        right: 12px;
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
        .concierge .launcher .find:hover {
            background: var(--paper);
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
    /* It steps back while the sheet is up, so nothing half-shows behind the sheet's top edge. */
    .mobile .masthead {
        transition:
            opacity 300ms ease,
            visibility 300ms,
            transform 460ms cubic-bezier(0.32, 0.72, 0, 1);
    }
    .sheet-open .masthead {
        opacity: 0;
        transform: translateY(-14px) scale(0.98);
        pointer-events: none;
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
    /* On a phone the compass sits at the free left end of the map controls' row,
       clear of the "Nomor saya" banner below them. */
    .mobile :global(.compass) {
        top: calc(var(--top) + 66px);
        right: auto;
        left: 12px;
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
        gap: 8px;
        height: 60px;
        padding: 0 8px;
        border-radius: 22px;
        background: var(--card);
        color: var(--ink);
        box-shadow:
            0 0 0 1px var(--line),
            0 16px 40px -16px #1b2a2166;
    }
    .launcher button {
        display: flex;
        align-items: center;
        height: 44px;
        border-radius: 16px;
        font: inherit;
        transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1);
    }
    .launcher button:active {
        transform: scale(0.97);
    }
    .launcher .find {
        flex: 1;
        min-width: 0;
        gap: 10px;
        padding: 0 6px;
        text-align: left;
    }
    .launcher .find i {
        display: grid;
        place-items: center;
        flex-shrink: 0;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: var(--paper-2);
        color: var(--forest);
    }
    .launcher .find span {
        flex: 1;
        min-width: 0;
        font-size: 16px;
        color: var(--ink-2);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .launcher .ask {
        position: relative;
        flex-shrink: 0;
        gap: 7px;
        padding: 0 16px 0 14px;
        background: var(--forest);
        color: var(--paper);
        font-size: 15px;
        font-weight: 600;
    }
    /* An earlier conversation to go back to. */
    .launcher .unread {
        position: absolute;
        top: 7px;
        right: 8px;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--signal);
        box-shadow: 0 0 0 2px var(--forest);
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
        max-height: calc(100% - var(--top) - var(--bottom) - 150px);
    }
    /* Following the steps: the card stays low, the route on the map above it. */
    .mobile .journey:has(.steps) {
        max-height: 44%;
    }
    /* Before the page has worked out it is on a phone, the sheet already waits closed below the screen,
       so it doesn't show for a moment and then slide away. */
    @media (max-width: 760px) {
        .concierge:not(.mobile) .column {
            transform: translateY(calc(100% + 24px));
            transition: none;
        }
    }
    /* Following the steps on a phone: only the map, the steps card, the compass
       and the "Nomor saya" banner; the name bar, map controls and chat bar step aside. */
    .navigating .masthead,
    .navigating .map-controls,
    .navigating .launcher {
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
    }
    .mobile .map-controls {
        transition:
            opacity 200ms ease,
            visibility 200ms;
    }
    .mobile .launcher {
        transition:
            transform 160ms cubic-bezier(0.23, 1, 0.32, 1),
            opacity 200ms ease,
            visibility 200ms;
    }
    .mobile.navigating .journey {
        bottom: var(--bottom);
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
