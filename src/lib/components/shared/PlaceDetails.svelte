<script lang="ts">
    import { onMount } from "svelte";
    import { hoursLines, hoursStatus, type PlaceInfo } from "$lib/model/place-info";
    import { useLocale } from "$lib/i18n/locale.svelte";
    import { dateOf, doctorStatus, shortDate, type Doctor } from "$lib/model/doctors";
    import { fresh, liveFor, quotaLeft, type DoctorQueue } from "$lib/model/live";
    import { useLive } from "$lib/live.svelte";
    import MyNumberForm from "./MyNumberForm.svelte";
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
    /**
     * The doctors, each once: from the schedule, with today's queue from SIMRS
     * beside them (matched by SIMRS's doctor code, or the name), and any doctor
     * in the queue who isn't in the schedule after them.
     */
    let rows = $derived.by(() => {
        const queues = live?.clinics.flatMap((c) => c.doctors.filter((d) => d.registered || d.quota)) ?? [],
            name = (s: string) => s.toLowerCase().replace(/[^a-z]/g, ""),
            matched = new Set<string>();
        const rows: { key: string; name: string; doctor?: Doctor; queue?: DoctorQueue }[] = (info.doctors ?? []).map((d) => {
            const queue = queues.find((q) => (d.code && q.code === d.code) || name(q.name) === name(d.name));
            if (queue) matched.add(queue.code);
            return { key: `d:${d.name}`, name: d.name, doctor: d, queue };
        });
        for (const q of queues) if (!matched.has(q.code)) rows.push({ key: `q:${q.code}`, name: q.name, queue: q });
        return rows;
    });
    // As printed on the ticket: "036".
    const number = (n: number) => String(n).padStart(3, "0");
    const time = (at: number) => new Date(at).toLocaleTimeString(locale.lang === "en" ? "en-GB" : "id-ID", { hour: "2-digit", minute: "2-digit" });
</script>

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
    <!-- Each doctor once: today's status, their queue from SIMRS, then their hours. -->
    {#if rows.length}<div class="doctors" aria-live="polite">
            <small>{locale.t(live?.clinics.length ? "doctorsToday" : "doctorSchedule")}</small>
            {#each live?.clinics ?? [] as c (c.code)}<b class="total"
                    >{locale.t("liveRegistered", { n: c.registered, w: c.waiting })}{live!.clinics.length > 1 ? ` · ${c.name}` : ""}</b
                >{/each}
            {#each rows as r (r.key)}
                {@const s = r.doctor && now ? doctorStatus(r.doctor, now, locale.lang) : null}
                {@const q = r.queue}
                {@const left = q ? quotaLeft(q) : undefined}
                <div class="doctor">
                    <b>{r.name}</b>{#if r.doctor?.specialty}<span class="specialty">{r.doctor.specialty}</span>{/if}
                    {#if s}<em class:in={s.practising} class:away={s.onLeave}>{s.text}</em>{/if}
                    {#if q}<span class="queue"
                            >{#if q.serving}<strong>{locale.t("liveServing", { no: q.serving })}</strong> · {/if}{locale.t("liveRegistered", {
                                n: q.registered,
                                w: q.waiting,
                            })}{left === undefined ? "" : ` · ${left ? locale.t("liveQuotaLeft", { n: left }) : locale.t("liveQuotaFull")}`}</span
                        >{/if}
                    {#each r.doctor ? hoursLines(r.doctor.hours, locale.lang) : [] as line}<span class="line">{line}</span>{/each}
                    {#each (r.doctor?.leave ?? []).filter((l) => today && l.to >= today) as l}<span class="line leave"
                            >{l.from === l.to
                                ? locale.t("leaveDay", { date: shortDate(l.from, locale.lang) })
                                : locale.t("leaveDates", { from: shortDate(l.from, locale.lang), to: shortDate(l.to, locale.lang) })}</span
                        >{/each}
                </div>
            {/each}
            {#each live?.clinics ?? [] as c (c.code)}<MyNumberForm clinic={c} {place} />{/each}
        </div>{/if}
    <!-- When the live figures were last updated. -->
    {#if live}<span class="from"><i></i>{locale.t("liveFrom", { time: time(live.at) })}</span>{/if}
</section>

<style>
    /* On the card's own colour: sections and doctors set apart by thin lines, not boxes. */
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
    .total {
        font-size: 13.5px;
        font-weight: 600;
        color: #1f3a2b;
    }
    .total.full {
        color: #9a3b2e;
    }
    .called,
    .queue strong {
        font-style: normal;
        font-weight: 600;
        color: #2f6b3a;
    }
    .doctor {
        display: flex;
        flex-direction: column;
        padding: 10px 0;
        border-bottom: 1px solid #1b2a2114;
    }
    .doctor:first-of-type {
        margin-top: 4px;
        border-top: 1px solid #1b2a2114;
    }
    .doctor b {
        font-weight: 600;
        font-size: 13.5px;
        color: #1f3a2b;
    }
    .specialty,
    .line {
        color: #6a7a66;
    }
    .queue {
        color: #2f4336;
    }
    .doctor em {
        align-self: flex-start;
        margin: 2px 0 1px;
        font-style: normal;
        font-weight: 600;
        font-size: 12px;
        color: #9a3b2e;
    }
    .doctor em.in {
        color: #2f6b3a;
    }
    .doctor em.away,
    .leave {
        color: #9a6a1e;
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
