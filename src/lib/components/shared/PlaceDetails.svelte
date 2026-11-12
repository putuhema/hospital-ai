<script lang="ts">
    import { onMount } from "svelte";
    import { hoursLines, hoursStatus, type PlaceInfo } from "$lib/model/place-info";
    import { useLocale } from "$lib/i18n/locale.svelte";
    import { dateOf, doctorStatus, shortDate } from "$lib/model/doctors";
    import { doctorToday, fresh, liveFor, quotaLeft, started } from "$lib/model/live";
    import { useLive } from "$lib/live.svelte";
    let { info }: { info: PlaceInfo } = $props();
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
    let fromSimrs = $derived(!!info.doctors?.some((d) => d.code));
    /** While a doctor is practising: whether they have started on today's patients, from SIMRS. */
    function serving(code: string | undefined) {
        const today = doctorToday(recent, code),
            begun = started(today);
        if (begun === undefined || !today) return null;
        return begun ? locale.t("doctorStarted", { n: today.registered - today.waiting }) : locale.t("doctorNotStarted");
    }
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
    {#if live}<div class="live" aria-live="polite">
            {#if live.counter}
                <small>{locale.t("liveCounter")}</small>
                <b class="total">{locale.t("liveTickets", { n: live.counter.tickets, w: live.counter.waiting })}</b>
                {#if live.counter.called}<em class="called">{locale.t("liveCalled", { no: number(live.counter.called) })}</em>{/if}
                {#each live.counter.counters as c (c.no)}<span class="line"
                        >{locale.t("liveCounterAt", { n: c.no, no: number(c.serving) })}</span
                    >{/each}
            {/if}
            {#each live.clinics as c (c.code)}
                <small>{locale.t("liveQueue")}{live.clinics.length > 1 ? ` · ${c.name}` : ""}</small>
                <b class="total">{locale.t("liveRegistered", { n: c.registered, w: c.waiting })}</b>
                {#each c.doctors.filter((d) => d.registered || d.quota) as d (d.code)}
                    {@const left = quotaLeft(d)}
                    <div class="queue">
                        <span class="who">{d.name}</span>
                        {#if d.serving}<em>{locale.t("liveServing", { no: d.serving })}</em>{/if}
                        <span class="line"
                            >{locale.t("liveRegistered", { n: d.registered, w: d.waiting })}{left === undefined
                                ? ""
                                : ` · ${left ? locale.t("liveQuotaLeft", { n: left }) : locale.t("liveQuotaFull")}`}</span
                        >
                    </div>
                {/each}
            {/each}
            {#each live.wards as w (w.code)}
                <small>{locale.t("liveBeds")}{live.wards.length > 1 ? ` · ${w.name}` : ""}</small>
                <b class="total" class:full={!w.empty}
                    >{w.empty ? locale.t("liveBedsEmpty", { empty: w.empty, beds: w.beds }) : locale.t("liveBedsFull")}</b
                >
                {#if w.classes.length > 1}{#each w.classes as k (k.name)}<span class="line"
                            >{k.name}: {k.empty ? locale.t("liveBedsEmpty", { empty: k.empty, beds: k.beds }) : locale.t("liveBedsFull")}</span
                        >{/each}{/if}
            {/each}
            <span class="from"><i></i>{locale.t("liveFrom", { time: time(live.at) })}</span>
        </div>{/if}
    {#if info.doctors?.length}<div class="doctors">
            <small>{locale.t("doctorSchedule")}{fromSimrs ? ` · ${locale.t("scheduleFromSimrs")}` : ""}</small>
            {#each info.doctors as d (d.name)}
                {@const s = now && doctorStatus(d, now, locale.lang)}
                <div class="doctor">
                    <b>{d.name}</b>{#if d.specialty}<span class="specialty">{d.specialty}</span>{/if}
                    {#if s}<em class:in={s.practising} class:away={s.onLeave}>{s.text}</em>{/if}
                    {#if s?.practising && serving(d.code)}<span class="serving" class:waiting={!started(doctorToday(recent, d.code))}
                            >{serving(d.code)}</span
                        >{/if}
                    {#each hoursLines(d.hours, locale.lang) as line}<span class="line">{line}</span>{/each}
                    {#each (d.leave ?? []).filter((l) => today && l.to >= today) as l}<span class="line leave"
                            >{l.from === l.to
                                ? locale.t("leaveDay", { date: shortDate(l.from, locale.lang) })
                                : locale.t("leaveDates", { from: shortDate(l.from, locale.lang), to: shortDate(l.to, locale.lang) })}</span
                        >{/each}
                </div>
            {/each}
        </div>{/if}
</section>

<style>
    .place-details {
        margin-top: 12px;
        padding: 12px;
        border-radius: 10px;
        background: #f5f8f1;
        font-size: 12px;
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
    .hours small {
        font-size: 10px;
        letter-spacing: 0.6px;
        text-transform: uppercase;
        color: #7b8c70;
        margin-bottom: 2px;
    }
    .live {
        display: flex;
        flex-direction: column;
        margin-top: 10px;
        padding: 8px 10px;
        border-radius: 8px;
        background: white;
    }
    .live small {
        font-size: 10px;
        letter-spacing: 0.6px;
        text-transform: uppercase;
        color: #7b8c70;
    }
    .live small:not(:first-child) {
        margin-top: 8px;
    }
    .live .total {
        font-size: 13px;
        font-weight: 600;
        color: #1f3a2b;
    }
    .live .total.full {
        color: #9a3b2e;
    }
    .queue {
        display: flex;
        flex-direction: column;
        margin-top: 6px;
    }
    .queue .who {
        font-weight: 600;
        color: #2f4336;
    }
    .queue em,
    .live .called {
        font-style: normal;
        font-weight: 600;
        color: #2f6b3a;
    }
    .live .from {
        display: flex;
        align-items: center;
        gap: 5px;
        margin-top: 8px;
        font-size: 10.5px;
        color: #7b8c70;
    }
    .live .from i {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #3f9a52;
    }
    .doctors {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 10px;
    }
    .doctors > small {
        font-size: 10px;
        letter-spacing: 0.6px;
        text-transform: uppercase;
        color: #7b8c70;
        margin-bottom: -4px;
    }
    .doctor {
        display: flex;
        flex-direction: column;
        padding: 8px 10px;
        border-radius: 8px;
        background: white;
    }
    .doctor b {
        font-weight: 600;
        color: #1f3a2b;
    }
    .specialty,
    .line {
        color: #6a7a66;
    }
    .doctor em {
        align-self: flex-start;
        margin: 3px 0 2px;
        font-style: normal;
        font-weight: 600;
        font-size: 11.5px;
        color: #9a3b2e;
    }
    .doctor em.in {
        color: #2f6b3a;
    }
    .doctor em.away {
        color: #9a6a1e;
    }
    .leave {
        color: #9a6a1e;
    }
    .serving {
        font-weight: 600;
        color: #2f6b3a;
    }
    .serving.waiting {
        color: #9a6a1e;
    }
    .place-details > :last-child {
        margin-bottom: 0;
    }
</style>
