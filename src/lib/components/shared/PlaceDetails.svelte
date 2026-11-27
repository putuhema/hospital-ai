<script lang="ts">
    import { onMount } from "svelte";
    import { hoursLines, hoursStatus, type PlaceInfo } from "$lib/model/place-info";
    import { useLocale } from "$lib/i18n/locale.svelte";
    import { dateOf, doctorStatus, shortDate, type Doctor } from "$lib/model/doctors";
    import { fresh, liveFor, quotaLeft, type ClinicLive, type DoctorQueue } from "$lib/model/live";
    import { useLive } from "$lib/live.svelte";
    import MyNumberForm from "./MyNumberForm.svelte";

    type DoctorRow = { key: string; name: string; doctor?: Doctor; queue?: DoctorQueue };
    type ClinicGroup = { clinic: ClinicLive; doctors: DoctorRow[]; active: boolean };

    let { info, place }: { info: PlaceInfo; /** The place's id on the map, for "Nomor saya" to come back to. */ place?: string } = $props();
    // The visitor's own clock: they are at the hospital, so it is the hospital's
    // time too. Unknown during server rendering, so the badge waits for the browser.
    let now = $state<Date | null>(null);
    onMount(() => {
        now = new Date();
        const timer = setInterval(() => (now = new Date()), 30_000);
        return () => clearInterval(timer);
    });
    const locale = useLocale();
    let status = $derived(now && hoursStatus(info, now, locale.lang));
    // Leave that isn't over yet, to show beside the doctor.
    let today = $derived(now && dateOf(now));
    // Today's queue and the beds from SIMRS, for a place linked to a clinic or ward; gone when the bridge is silent.
    const liveData = useLive();
    let recent = $derived(now && fresh(liveData(), now.getTime()));
    let live = $derived(liveFor(info.simrs, recent));

    // Expanded state per clinic code when a place groups multiple clinics.
    let expanded = $state<Record<string, boolean>>({});
    function toggleClinic(code: string) {
        expanded = { ...expanded, [code]: !expanded[code] };
    }

    /**
     * Group doctors under their clinic when live SIMRS clinics are present so each
     * clinic's queue, doctors and queue tracker stay together. Any scheduled doctor
     * not matched to a live clinic is kept in `extraDoctors`.
     */
    let grouped = $derived.by(() => {
        const scheduled = info.doctors ?? [];
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
        const usedScheduled = new Set<number>();

        const groups: ClinicGroup[] = (live?.clinics ?? []).map((c) => {
            const matchedQueueCodes = new Set<string>();
            const doctors: DoctorRow[] = [];

            // First, match scheduled doctors that belong to this clinic.
            scheduled.forEach((d, idx) => {
                if (usedScheduled.has(idx)) return;
                const q = c.doctors.find((x) => (d.code && x.code === d.code) || norm(x.name) === norm(d.name));
                if (!q) return;
                usedScheduled.add(idx);
                matchedQueueCodes.add(q.code);
                doctors.push({ key: `d:${c.code}:${d.name}`, name: d.name, doctor: d, queue: q.registered || q.quota ? q : undefined });
            });

            // Then any doctor in today's SIMRS queue for this clinic not in the schedule.
            for (const q of c.doctors) {
                if (!matchedQueueCodes.has(q.code) && (q.registered || q.quota)) {
                    doctors.push({ key: `q:${c.code}:${q.code}`, name: q.name, queue: q });
                }
            }

            // Active doctors first: serving, then waiting, then registered.
            doctors.sort((a, b) => {
                const aServe = a.queue?.serving ? 1 : 0;
                const bServe = b.queue?.serving ? 1 : 0;
                if (bServe !== aServe) return bServe - aServe;
                const wDiff = (b.queue?.waiting ?? 0) - (a.queue?.waiting ?? 0);
                if (wDiff !== 0) return wDiff;
                return (b.queue?.registered ?? 0) - (a.queue?.registered ?? 0);
            });

            return { clinic: c, doctors, active: c.waiting > 0 || c.registered > 0 };
        });

        // For multi-clinic places, surface active queues first, then clinics with doctors.
        if (groups.length > 1) {
            groups.sort((a, b) => {
                if (b.clinic.waiting !== a.clinic.waiting) return b.clinic.waiting - a.clinic.waiting;
                if (b.clinic.registered !== a.clinic.registered) return b.clinic.registered - a.clinic.registered;
                return Number(b.doctors.length > 0) - Number(a.doctors.length > 0);
            });
        }

        const extraDoctors: DoctorRow[] = scheduled
            .map((d, idx) => ({ d, idx }))
            .filter(({ idx }) => !usedScheduled.has(idx))
            .map(({ d }) => ({ key: `s:${d.name}`, name: d.name, doctor: d }));

        return { groups, extraDoctors };
    });

    const doctorCountLabel = (n: number) => (n === 1 ? locale.t("doctorOne") : locale.t("doctorCount", { n }));
    // As printed on the ticket: "036".
    const number = (n: number) => String(n).padStart(3, "0");
    const time = (at: number) => new Date(at).toLocaleTimeString(locale.lang === "en" ? "en-GB" : "id-ID", { hour: "2-digit", minute: "2-digit" });
</script>

{#snippet doctorItem(r: DoctorRow)}
    {@const s = r.doctor && now ? doctorStatus(r.doctor, now, locale.lang) : null}
    {@const q = r.queue}
    {@const left = q ? quotaLeft(q) : undefined}
    <div class="doctor">
        <div class="doctor-head">
            <b>{r.name}</b>
            {#if r.doctor?.specialty}<span class="specialty">{r.doctor.specialty}</span>{/if}
        </div>
        {#if s}<em class="doc-status" class:in={s.practising} class:away={s.onLeave}>{s.text}</em>{/if}
        {#if q}
            <div class="queue-meta">
                {#if q.serving}<span class="pill serving">{locale.t("liveServing", { no: q.serving })}</span>{/if}
                <span class="queue-counts" class:muted-counts={!q.registered && !q.waiting}
                    >{locale.t("liveRegistered", { n: q.registered, w: q.waiting })}</span
                >
                {#if left !== undefined}
                    <span class="pill quota" class:full={!left}
                        >{left ? locale.t("liveQuotaLeft", { n: left }) : locale.t("liveQuotaFull")}</span
                    >
                {/if}
            </div>
        {/if}
        {#each r.doctor ? hoursLines(r.doctor.hours, locale.lang) : [] as line}<span class="line">{line}</span>{/each}
        {#each (r.doctor?.leave ?? []).filter((l) => today && l.to >= today) as l}<span class="line leave"
                >{l.from === l.to
                    ? locale.t("leaveDay", { date: shortDate(l.from, locale.lang) })
                    : locale.t("leaveDates", { from: shortDate(l.from, locale.lang), to: shortDate(l.to, locale.lang) })}</span
            >{/each}
    </div>
{/snippet}

<section class="place-details" aria-label={locale.t("aboutPlace")}>
    {#if status}<p class="badge" class:open={status.open}><i></i>{status.text}</p>{/if}
    {#if info.description}<p class="description">{info.description}</p>{/if}
    {#if info.phone}<a class="phone" href={`tel:${info.phone.replace(/[^\d+]/g, "")}`}>☎ {info.phone}</a>{/if}
    {#if info.hours?.length}<div class="hours">
            <small>{locale.t(info.visiting ? "visitingHours" : "openingHours")}</small>
            {#each hoursLines(info.hours, locale.lang) as line}<span>{line}</span>{/each}
        </div>{/if}
    <!-- What isn't a doctor's: the registration counters and empty beds. -->
    {#if live && (live.counter || live.wards.length)}<div class="live" aria-live="polite">
            {#if live.counter}
                <small>{locale.t("liveCounter")}</small>
                <b class="total">{locale.t("liveTickets", { n: live.counter.tickets, w: live.counter.waiting })}</b>
                {#if live.counter.called}<em class="called">{locale.t("liveCalled", { no: number(live.counter.called) })}</em>{/if}
                {#each live.counter.counters as c (c.no)}<span class="line"
                        >{locale.t("liveCounterAt", { n: c.no, no: number(c.serving) })}</span
                    >{/each}
                <MyNumberForm {place} />
            {/if}
            {#each live.wards as w (w.code)}
                <small>{locale.t("liveBeds")}{live.wards.length > 1 ? ` · ${w.name}` : ""}</small>
                <b class="total" class:full={!w.empty}
                    >{w.empty ? locale.t("liveBedsEmpty", { empty: w.empty, beds: w.beds }) : locale.t("liveBedsFull")}</b
                >
                {#if w.classes.length > 1}{#each w.classes as k (k.name)}<span class="line"
                            >{k.name}: {k.empty ? locale.t("liveBedsEmpty", { empty: k.empty, beds: k.beds }) : locale.t("liveBedsFull")}</span
                        >{/each}{/if}
            {/each}
        </div>{/if}

    <!-- Clinics & doctors: grouped by clinic when multiple clinics are linked so each queue & tracker is unmistakable. -->
    {#if grouped.groups.length || grouped.extraDoctors.length}
        <div class="doctors" aria-live="polite">
            {#if grouped.groups.length === 1}
                {@const g = grouped.groups[0]}
                <div class="section-head">
                    <small>{locale.t("doctorsToday")}</small>
                    {#if g.clinic.waiting > 0}
                        <span class="pill waiting">{locale.t("cardLiveWaiting", { n: g.clinic.waiting })}</span>
                    {:else if g.clinic.registered > 0}
                        <span class="pill neutral">{locale.t("liveRegisteredOnly", { n: g.clinic.registered })}</span>
                    {:else}
                        <span class="quiet-label">{locale.t("liveNoQueue")}</span>
                    {/if}
                </div>
                <div class="doctor-list">
                    {#each g.doctors as r (r.key)}{@render doctorItem(r)}{/each}
                </div>
                <MyNumberForm clinic={g.clinic} {place} />
            {:else if grouped.groups.length > 1}
                <div class="section-head">
                    <small>{locale.t("doctorsToday")}</small>
                </div>
                <div class="clinic-groups">
                    {#each grouped.groups as g (g.clinic.code)}
                        {@const isExpandable = g.doctors.length > 0}
                        {@const isOpen = isExpandable && !!expanded[g.clinic.code]}
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
                                            {#if g.clinic.registered > 0}{locale.t("liveRegisteredOnly", { n: g.clinic.registered })} · {/if}{doctorCountLabel(
                                                g.doctors.length,
                                            )}
                                        </span>
                                    </span>
                                    <span class="clinic-right">
                                        {#if g.clinic.waiting > 0}
                                            <span class="pill waiting">{locale.t("cardLiveWaiting", { n: g.clinic.waiting })}</span>
                                        {:else if g.clinic.registered > 0}
                                            <span class="pill neutral">{locale.t("cardLiveWaiting", { n: 0 })}</span>
                                        {:else}
                                            <span class="quiet-label">{locale.t("liveNoQueue")}</span>
                                        {/if}
                                        <svg class="chev" class:up={isOpen} viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"
                                            ><path d="m6 9 6 6 6-6" /></svg
                                        >
                                    </span>
                                </button>
                                {#if isOpen}
                                    <div class="clinic-body">
                                        {#each g.doctors as r (r.key)}{@render doctorItem(r)}{/each}
                                        <MyNumberForm clinic={g.clinic} {place} />
                                    </div>
                                {/if}
                            {:else}
                                <div class="clinic-head static">
                                    <span class="clinic-title">
                                        <b>{g.clinic.name}</b>
                                    </span>
                                    <span class="clinic-right">
                                        <span class="quiet-label">{locale.t("liveNoQueue")}</span>
                                    </span>
                                </div>
                            {/if}
                        </div>
                    {/each}
                </div>
            {/if}

            {#if grouped.extraDoctors.length}
                <div class="extra-doctors">
                    <small>{locale.t(grouped.groups.length ? "otherDoctors" : "doctorSchedule")}</small>
                    <div class="doctor-list">
                        {#each grouped.extraDoctors as r (r.key)}{@render doctorItem(r)}{/each}
                    </div>
                </div>
            {/if}
        </div>
    {/if}

    <!-- When the live figures were last updated. -->
    {#if live}<span class="from"><i></i>{locale.t("liveFrom", { time: time(live.at) })}</span>{/if}
</section>

<style>
    .place-details {
        margin-top: 10px;
        font-size: 12.5px;
        color: #2f4336;
        line-height: 1.45;
    }
    .badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin: 0 0 8px;
        padding: 4px 10px;
        border-radius: 20px;
        background: #fbe6e3;
        color: #9a3b2e;
        font-weight: 600;
        font-size: 11.5px;
    }
    .badge i {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: currentColor;
    }
    .badge.open {
        background: #dff0dc;
        color: #2f6b3a;
    }
    .description {
        margin: 0 0 8px;
    }
    .phone {
        display: inline-block;
        margin-bottom: 8px;
        color: #2f6b8f;
        font-weight: 600;
        text-decoration: none;
    }
    .hours {
        display: flex;
        flex-direction: column;
    }
    small {
        font-size: 10px;
        letter-spacing: 0.6px;
        text-transform: uppercase;
        color: #7b8c70;
    }
    .live,
    .doctors {
        display: flex;
        flex-direction: column;
        margin-top: 12px;
    }
    .live small:not(:first-child) {
        margin-top: 10px;
    }
    .section-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 6px;
    }
    .total {
        font-size: 13.5px;
        font-weight: 600;
        color: #1f3a2b;
    }
    .total.full {
        color: #9a3b2e;
    }
    .called {
        font-style: normal;
        font-weight: 600;
        color: #2f6b3a;
    }

    /* Multi-clinic accordion cards */
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
        transition: border-color 120ms ease, background 120ms ease;
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
        padding: 9px 11px;
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
        padding: 8px 11px;
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
        font-size: 13px;
        font-weight: 600;
        color: #1f3a2b;
        line-height: 1.3;
    }
    .clinic-card.quiet .clinic-title b {
        font-weight: 500;
        color: #5c6d5c;
    }
    .clinic-sub {
        font-size: 11px;
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
        padding: 2px 11px 10px;
        border-top: 1px solid #1b2a2110;
        background: #fbfdfa;
    }
    .clinic-body .doctor:first-of-type {
        border-top: 0;
        margin-top: 0;
    }
    .clinic-body .doctor:last-of-type {
        border-bottom: 0;
        padding-bottom: 4px;
    }

    /* Pills & status indicators */
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
        font-size: 11px;
        color: #889882;
        white-space: nowrap;
    }

    /* Doctor rows */
    .doctor-list {
        display: flex;
        flex-direction: column;
    }
    .doctor {
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding: 9px 0;
        border-bottom: 1px solid #1b2a2112;
    }
    .doctor-list .doctor:first-of-type {
        border-top: 1px solid #1b2a2112;
    }
    .doctor-head {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 2px 6px;
    }
    .doctor b {
        font-weight: 600;
        font-size: 13px;
        color: #1f3a2b;
    }
    .specialty,
    .line {
        font-size: 12px;
        color: #6a7a66;
    }
    .queue-meta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 5px 8px;
        margin-top: 1px;
    }
    .queue-counts {
        font-size: 12px;
        color: #2f4336;
    }
    .queue-counts.muted-counts {
        color: #7b8c70;
    }
    .doc-status {
        align-self: flex-start;
        font-style: normal;
        font-weight: 600;
        font-size: 11.5px;
        color: #9a3b2e;
    }
    .doc-status.in {
        color: #2f6b3a;
    }
    .doc-status.away,
    .leave {
        color: #9a6a1e;
    }
    .extra-doctors {
        display: flex;
        flex-direction: column;
        margin-top: 10px;
    }
    .extra-doctors small {
        margin-bottom: 4px;
    }
    .from {
        display: flex;
        align-items: center;
        gap: 5px;
        margin-top: 10px;
        font-size: 10.5px;
        color: #7b8c70;
    }
    .from i {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #3f9a52;
    }
    .place-details > :last-child {
        margin-bottom: 0;
    }
</style>
