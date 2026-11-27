<script lang="ts">
    // Quick queue overview drawer: switch between registration counters (loket) and clinics (poli).
    import { onMount } from "svelte";
    import { useLocale } from "$lib/i18n/locale.svelte";
    import { useLive } from "$lib/live.svelte";
    import { COUNTER_KEY, clinicKey, fresh, quotaLeft } from "$lib/model/live";
    import type { Place } from "$lib/wayfinding/routing";
    import { easeDrawer, motion } from "$lib/motion";
    import MyNumberForm from "$lib/components/shared/MyNumberForm.svelte";

    type QueueTab = "registration" | "poli";

    let {
        places,
        wide = false,
        onselect,
        onclose,
    }: {
        places: Place[];
        wide?: boolean;
        onselect: (place: Place) => void;
        onclose: () => void;
    } = $props();

    const locale = useLocale();
    const t = locale.t;
    const liveData = useLive();

    let now = $state(new Date());
    onMount(() => {
        const timer = setInterval(() => (now = new Date()), 30_000);
        return () => clearInterval(timer);
    });

    let live = $derived(fresh(liveData(), now.getTime()));
    let tab = $state<QueueTab>("registration");
    let tabPicked = $state(false);
    let query = $state("");
    let expanded = $state<Record<string, boolean>>({});
    let closer = $state<HTMLButtonElement>();

    onMount(() => closer?.focus({ preventScroll: true }));

    // If there is no registration counter queue but clinics exist, open directly on Poliklinik.
    $effect(() => {
        if (!tabPicked && live && !live.counter && live.clinics.length > 0) {
            tab = "poli";
        }
    });

    function chooseTab(next: QueueTab) {
        tabPicked = true;
        tab = next;
    }

    function toggleClinic(code: string) {
        expanded = { ...expanded, [code]: !expanded[code] };
    }

    // Map SIMRS keys back to places so visitors can jump to a counter or clinic on the map.
    let counterPlace = $derived(places.find((p) => p.info?.simrs?.includes(COUNTER_KEY)) ?? null);
    let clinicPlaces = $derived.by(() => {
        const map = new Map<string, Place>();
        for (const p of places) {
            for (const key of p.info?.simrs ?? []) {
                if (key.startsWith("poli:") && !map.has(key)) map.set(key, p);
            }
        }
        return map;
    });

    const placeForClinic = (code: string) => clinicPlaces.get(clinicKey(code)) ?? null;

    // Clinics sorted with active queues first, filtered by search query.
    let clinics = $derived.by(() => {
        const list = (live?.clinics ?? []).map((c) => {
            const doctors = c.doctors
                .filter((d) => d.registered || d.quota)
                .sort((a, b) => {
                    const sDiff = Number(!!b.serving) - Number(!!a.serving);
                    if (sDiff !== 0) return sDiff;
                    if (b.waiting !== a.waiting) return b.waiting - a.waiting;
                    return b.registered - a.registered;
                });
            return { clinic: c, doctors, active: c.waiting > 0 || c.registered > 0 };
        });

        list.sort((a, b) => {
            if (b.clinic.waiting !== a.clinic.waiting) return b.clinic.waiting - a.clinic.waiting;
            if (b.clinic.registered !== a.clinic.registered) return b.clinic.registered - a.clinic.registered;
            return Number(b.doctors.length > 0) - Number(a.doctors.length > 0);
        });

        const q = query.trim().toLowerCase();
        if (!q) return list;
        return list.filter(
            ({ clinic, doctors }) =>
                clinic.name.toLowerCase().includes(q) || doctors.some((d) => d.name.toLowerCase().includes(q)),
        );
    });

    let totalPoliWaiting = $derived((live?.clinics ?? []).reduce((sum, c) => sum + c.waiting, 0));

    const number = (n: number) => String(n).padStart(3, "0");
    const time = (at: number) => new Date(at).toLocaleTimeString(locale.lang === "en" ? "en-GB" : "id-ID", { hour: "2-digit", minute: "2-digit" });
    const doctorCountLabel = (n: number) => (n === 1 ? t("doctorOne") : t("doctorCount", { n }));

    function slide(_: Element) {
        return {
            duration: motion(320),
            easing: easeDrawer,
            css: (_t: number, u: number) => (wide ? `transform: translateX(${u * 100}%)` : `transform: translateY(${u * 100}%)`),
        };
    }
    function fade(_: Element) {
        return { duration: motion(200), css: (t: number) => `opacity: ${t}` };
    }
    function openPlace(place: Place) {
        onselect(place);
        onclose();
    }
</script>

<button class="scrim" tabindex="-1" aria-label={t("close")} onclick={onclose} transition:fade></button>
<div class="drawer" class:wide role="dialog" aria-modal="true" aria-labelledby="queue-title" transition:slide>
    {#if !wide}<span class="grabber" aria-hidden="true"></span>{/if}
    <header>
        <div class="head-copy">
            <h2 id="queue-title">{t("liveQueue")}</h2>
            {#if live}<span class="updated"><i></i>{t("liveFrom", { time: time(live.at) })}</span>{/if}
        </div>
        <button class="close" bind:this={closer} aria-label={t("close")} onclick={onclose}
            ><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button
        >
    </header>

    <div class="tab-bar" role="tablist" aria-label={t("liveQueue")}>
        <button
            type="button"
            role="tab"
            aria-selected={tab === "registration"}
            class:selected={tab === "registration"}
            onclick={() => chooseTab("registration")}
        >
            <span>{t("queueTabRegistration")}</span>
            {#if live?.counter?.waiting}<em class="tab-badge">{live.counter.waiting}</em>{/if}
        </button>
        <button
            type="button"
            role="tab"
            aria-selected={tab === "poli"}
            class:selected={tab === "poli"}
            onclick={() => chooseTab("poli")}
        >
            <span>{t("queueTabClinic")}</span>
            {#if totalPoliWaiting > 0}<em class="tab-badge">{totalPoliWaiting}</em>{/if}
        </button>
    </div>

    <div class="body">
        {#if tab === "registration"}
            {#if live?.counter}
                {@const k = live.counter}
                <div class="reg-panel">
                    <div class="reg-hero">
                        {#if k.called}
                            <div class="reg-called">
                                <small>{t("liveCounter")}</small>
                                <strong>{t("liveCalled", { no: number(k.called) })}</strong>
                            </div>
                        {/if}
                        <div class="reg-stats">
                            <div class="stat-box">
                                <small>{t("queueTicketsTaken")}</small>
                                <b>{k.tickets}</b>
                            </div>
                            <div class="stat-box accent">
                                <small>{t("queueWaitingLabel")}</small>
                                <b>{k.waiting}</b>
                            </div>
                        </div>
                    </div>

                    {#if k.counters.length}
                        <div class="counters-grid">
                            {#each k.counters as c (c.no)}
                                <div class="counter-card">
                                    <small>{t("queueCounterLabel", { n: c.no })}</small>
                                    <b>{number(c.serving)}</b>
                                </div>
                            {/each}
                        </div>
                    {/if}

                    <div class="reg-actions">
                        <MyNumberForm place={counterPlace?.id} />
                        {#if counterPlace}
                            <button type="button" class="map-link" onclick={() => openPlace(counterPlace)}>
                                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"
                                    ><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z" /><circle
                                        cx="12"
                                        cy="10"
                                        r="2.2"
                                    /></svg
                                >
                                {t("queueViewOnMap")}
                            </button>
                        {/if}
                    </div>
                </div>
            {:else}
                <p class="empty">{t("queueNoCounter")}</p>
            {/if}
        {:else if live?.clinics.length}
            {#if live.clinics.length > 4}
                <div class="search-wrap">
                    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"
                        ><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg
                    >
                    <input type="search" bind:value={query} placeholder={t("queueSearchPlaceholder")} />
                </div>
            {/if}
            {#if clinics.length}
                <div class="clinic-groups">
                    {#each clinics as g (g.clinic.code)}
                        {@const isExpandable = g.doctors.length > 0}
                        {@const isOpen = isExpandable && (!!expanded[g.clinic.code] || !!query.trim())}
                        {@const linkedPlace = placeForClinic(g.clinic.code)}
                        <div class="clinic-card" class:active={g.active} class:open={isOpen} class:quiet={!g.active && !isExpandable}>
                            {#if isExpandable}
                                <button
                                    type="button"
                                    class="clinic-head"
                                    aria-expanded={isOpen}
                                    onclick={() => toggleClinic(g.clinic.code)}
                                >
                                    <span class="clinic-title">
                                        <b>{g.clinic.name}</b>
                                        <span class="clinic-sub">
                                            {#if g.clinic.registered > 0}{t("liveRegisteredOnly", { n: g.clinic.registered })} · {/if}{doctorCountLabel(
                                                g.doctors.length,
                                            )}
                                        </span>
                                    </span>
                                    <span class="clinic-right">
                                        {#if g.clinic.waiting > 0}
                                            <span class="pill waiting">{t("cardLiveWaiting", { n: g.clinic.waiting })}</span>
                                        {:else if g.clinic.registered > 0}
                                            <span class="pill neutral">{t("cardLiveWaiting", { n: 0 })}</span>
                                        {:else}
                                            <span class="quiet-label">{t("liveNoQueue")}</span>
                                        {/if}
                                        <svg class="chev" class:up={isOpen} viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"
                                            ><path d="m6 9 6 6 6-6" /></svg
                                        >
                                    </span>
                                </button>
                                {#if isOpen}
                                    <div class="clinic-body">
                                        {#each g.doctors as d (d.code)}
                                            {@const left = quotaLeft(d)}
                                            <div class="doctor">
                                                <b>{d.name}</b>
                                                <div class="queue-meta">
                                                    {#if d.serving}<span class="pill serving">{t("liveServing", { no: d.serving })}</span>{/if}
                                                    <span class="queue-counts" class:muted-counts={!d.registered && !d.waiting}
                                                        >{t("liveRegistered", { n: d.registered, w: d.waiting })}</span
                                                    >
                                                    {#if left !== undefined}
                                                        <span class="pill quota" class:full={!left}
                                                            >{left ? t("liveQuotaLeft", { n: left }) : t("liveQuotaFull")}</span
                                                        >
                                                    {/if}
                                                </div>
                                            </div>
                                        {/each}
                                        <div class="clinic-foot">
                                            <MyNumberForm clinic={g.clinic} place={linkedPlace?.id} />
                                            {#if linkedPlace}
                                                <button type="button" class="map-link" onclick={() => openPlace(linkedPlace)}>
                                                    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"
                                                        ><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z" /><circle
                                                            cx="12"
                                                            cy="10"
                                                            r="2.2"
                                                        /></svg
                                                    >
                                                    {t("queueViewOnMap")}
                                                </button>
                                            {/if}
                                        </div>
                                    </div>
                                {/if}
                            {:else}
                                <div class="clinic-head static">
                                    <span class="clinic-title">
                                        <b>{g.clinic.name}</b>
                                    </span>
                                    <span class="clinic-right">
                                        <span class="quiet-label">{t("liveNoQueue")}</span>
                                    </span>
                                </div>
                            {/if}
                        </div>
                    {/each}
                </div>
            {:else}
                <p class="empty">{t("noMatches")}</p>
            {/if}
        {:else}
            <p class="empty">{t("queueNoClinics")}</p>
        {/if}
    </div>
</div>

<style>
    .scrim,
    button.scrim:hover:not(:disabled) {
        position: fixed;
        inset: 0;
        z-index: 40;
        background: #1b2a2159;
        border: 0;
        cursor: default;
    }
    .drawer {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 41;
        display: flex;
        flex-direction: column;
        gap: 14px;
        max-height: 85dvh;
        padding: 10px 18px calc(env(safe-area-inset-bottom) + 20px);
        border-radius: 22px 22px 0 0;
        border-top: 1px solid #1b2a2117;
        background: #fffdf8;
        color: #1f3a2b;
    }
    .drawer.wide {
        left: auto;
        top: 0;
        width: 400px;
        max-height: none;
        padding: 20px 22px;
        border-top: 0;
        border-left: 1px solid #1b2a2117;
        border-radius: 22px 0 0 22px;
    }
    .grabber {
        align-self: center;
        width: 38px;
        height: 4px;
        border-radius: 2px;
        background: #1b2a2126;
        flex-shrink: 0;
    }
    header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
        flex-shrink: 0;
    }
    .head-copy {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    h2 {
        margin: 0;
        font-family: var(--display, inherit);
        font-size: 18px;
        font-weight: 560;
        line-height: 1.2;
        color: #1f3a2b;
    }
    .updated {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 11px;
        color: #7b8c70;
    }
    .updated i {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #3f9a52;
    }
    .close {
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        border: 0;
        border-radius: 50%;
        background: #ece6d6;
        color: #1b2a21;
        cursor: pointer;
        flex-shrink: 0;
    }
    .close:hover {
        background: #e1d9c6;
    }
    .close svg {
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
    }

    /* Two-tab segmented control */
    .tab-bar {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 4px;
        padding: 4px;
        border-radius: 14px;
        background: #ece6d6;
        flex-shrink: 0;
    }
    .tab-bar button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        height: 36px;
        padding: 0 10px;
        border: 0;
        border-radius: 10px;
        background: transparent;
        color: #46574b;
        font: inherit;
        font-size: 13.5px;
        font-weight: 600;
        cursor: pointer;
        transition: background 140ms ease, color 140ms ease;
    }
    .tab-bar button.selected,
    .tab-bar button.selected:hover:not(:disabled) {
        background: #fffdf8;
        color: #1b2a21;
        box-shadow: 0 1px 2px #1b2a2114;
    }
    .tab-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 20px;
        height: 18px;
        padding: 0 6px;
        border-radius: 999px;
        background: #dff0dc;
        color: #245c30;
        font-style: normal;
        font-size: 11px;
        font-weight: 700;
    }

    .body {
        display: flex;
        flex-direction: column;
        gap: 12px;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding-bottom: 4px;
    }

    /* Registration tab */
    .reg-panel {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .reg-hero {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 14px;
        border: 1px solid #cde0c6;
        border-radius: 14px;
        background: #f5faf3;
    }
    .reg-called {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .reg-called small {
        font-size: 10.5px;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        color: #6a7a66;
    }
    .reg-called strong {
        font-size: 18px;
        font-weight: 700;
        color: #245c30;
        font-variant-numeric: tabular-nums;
    }
    .reg-stats {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
    }
    .stat-box {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 10px 12px;
        border-radius: 10px;
        background: #ffffff;
        border: 1px solid #1b2a2110;
    }
    .stat-box.accent {
        border-color: #c5ddc0;
    }
    .stat-box small {
        font-size: 11px;
        color: #6a7a66;
    }
    .stat-box b {
        font-size: 20px;
        font-weight: 700;
        color: #1f3a2b;
        font-variant-numeric: tabular-nums;
        line-height: 1.2;
    }
    .stat-box.accent b {
        color: #245c30;
    }
    .counters-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
    }
    .counter-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        border: 1px solid #1b2a2114;
        border-radius: 11px;
        background: #ffffff;
    }
    .counter-card small {
        font-size: 12px;
        font-weight: 500;
        color: #5c6d5c;
    }
    .counter-card b {
        font-size: 15px;
        font-weight: 700;
        color: #1f3a2b;
        font-variant-numeric: tabular-nums;
    }
    .reg-actions,
    .clinic-foot {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .map-link {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        align-self: flex-start;
        padding: 5px 10px;
        border: 1px solid #1b2a211a;
        border-radius: 999px;
        background: #ffffff;
        color: #23463a;
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
    }
    .map-link:hover {
        background: #f3f1e8;
    }
    .map-link svg {
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
    }

    /* Poli search + clinic cards */
    .search-wrap {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 12px;
        height: 40px;
        border: 1px solid #1b2a211a;
        border-radius: 12px;
        background: #ffffff;
        color: #6a7a66;
        flex-shrink: 0;
    }
    .search-wrap svg {
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        flex-shrink: 0;
    }
    .search-wrap input {
        width: 100%;
        border: 0;
        background: transparent;
        font: inherit;
        font-size: 14px;
        color: #1f3a2b;
        outline: none;
    }
    .clinic-groups {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .clinic-card {
        border: 1px solid #1b2a2114;
        border-radius: 11px;
        background: #fafcf9;
        overflow: hidden;
    }
    .clinic-card.active {
        border-color: #cde0c6;
        background: #ffffff;
    }
    .clinic-card.open {
        border-color: #b7d0ae;
        background: #ffffff;
    }
    .clinic-card.quiet {
        background: #f6f8f5;
        border-color: #1b2a210d;
    }
    .clinic-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        width: 100%;
        padding: 10px 12px;
        border: 0;
        background: transparent;
        text-align: left;
        font: inherit;
        color: inherit;
        cursor: pointer;
    }
    .clinic-head:hover {
        background: #1b2a2106;
    }
    .clinic-head.static {
        cursor: default;
        padding: 9px 12px;
    }
    .clinic-head.static:hover {
        background: transparent;
    }
    .clinic-title {
        display: flex;
        flex-direction: column;
        min-width: 0;
        gap: 1px;
    }
    .clinic-title b {
        font-size: 13.5px;
        font-weight: 600;
        color: #1f3a2b;
        line-height: 1.3;
    }
    .clinic-card.quiet .clinic-title b {
        font-weight: 500;
        color: #5c6d5c;
    }
    .clinic-sub {
        font-size: 11.5px;
        color: #6a7a66;
    }
    .clinic-right {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
    }
    .chev {
        fill: none;
        stroke: #6a7a66;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
        transition: transform 160ms ease;
        flex-shrink: 0;
    }
    .chev.up {
        transform: rotate(180deg);
    }
    .clinic-body {
        display: flex;
        flex-direction: column;
        padding: 2px 12px 11px;
        border-top: 1px solid #1b2a2110;
        background: #fbfdfa;
    }
    .doctor {
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding: 9px 0;
        border-bottom: 1px solid #1b2a2110;
    }
    .doctor:last-of-type {
        border-bottom: 0;
        padding-bottom: 4px;
    }
    .doctor b {
        font-size: 13px;
        font-weight: 600;
        color: #1f3a2b;
    }
    .queue-meta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 5px 8px;
    }
    .queue-counts {
        font-size: 12px;
        color: #2f4336;
    }
    .queue-counts.muted-counts {
        color: #7b8c70;
    }
    .pill {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 600;
        line-height: 1.4;
        white-space: nowrap;
    }
    .pill.waiting {
        background: #dff0dc;
        color: #245c30;
    }
    .pill.neutral {
        background: #edf2eb;
        color: #3d5242;
    }
    .pill.serving {
        background: #2f6b3a;
        color: #ffffff;
    }
    .pill.quota {
        background: #edf2eb;
        color: #3d5242;
        font-weight: 500;
    }
    .pill.quota.full {
        background: #fbe6e3;
        color: #9a3b2e;
        font-weight: 600;
    }
    .quiet-label {
        font-size: 11.5px;
        color: #889882;
        white-space: nowrap;
    }
    .empty {
        margin: 18px 0;
        text-align: center;
        font-size: 13.5px;
        color: #6a7a66;
    }
</style>
