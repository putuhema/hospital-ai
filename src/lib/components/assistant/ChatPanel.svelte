<script lang="ts">
    import { onMount, tick } from "svelte";
    import type { Chat } from "$lib/assistant/chat.svelte";
    import type { ChatMessage, ReplyContext } from "$lib/assistant/chat";
    import type { Place } from "$lib/wayfinding/routing";
    import { rise } from "$lib/motion";
    import type { Key } from "$lib/i18n/messages";
    import { blocks } from "$lib/assistant/format";
    import MapCard from "./MapCard.svelte";
    import LeafletCard from "./LeafletCard.svelte";
    import Logo from "$lib/components/shared/Logo.svelte";
    import { useLocale } from "$lib/i18n/locale.svelte";

    let {
        chat,
        places,
        suggestions,
        context,
        shown = null,
        here = null,
        fromId = null,
        onshow,
        onhere,
        onclearhere,
    }: {
        chat: Chat;
        places: Place[];
        /** Questions to start with. */
        suggestions: string[];
        /** Where the visitor is, for "nearest" and routes. */
        context: () => ReplyContext;
        /** The place on the map now, so its card says so. */
        shown?: string | null;
        /** Where the visitor said they are, if they did. */
        here?: string | null;
        /** The visitor's current starting place id, for direct route shortcuts on cards. */
        fromId?: string | null;
        /** A card was followed to the map. */
        onshow?: () => void;
        /** Set or change where the visitor is. */
        onhere?: () => void;
        /** Forget where the visitor is. */
        onclearhere?: () => void;
    } = $props();

    const locale = useLocale();
    const t = locale.t;

    // What the assistant is looking up, while it waits on a tool.
    const LOOKING: Record<string, Key> = {
        search_places: "lookingPlaces",
        get_place_details: "lookingDetails",
        get_doctor_schedule: "lookingDoctors",
        get_clinic_queue: "lookingLive",
        get_registration_queue: "lookingLive",
        get_bed_availability: "lookingLive",
        find_nearest: "lookingNearest",
        get_directions: "lookingRoute",
        show_on_map: "lookingMap",
        search_leaflets: "lookingLeaflets",
    };
    const looking = (tool: string): Key => LOOKING[tool] ?? "writingReply";

    let draft = $state(""),
        log = $state<HTMLElement>(),
        input = $state<HTMLTextAreaElement>(),
        stick = $state(true),
        copiedAt = $state<number | null>(null),
        confirmClear = $state(false),
        voiceSupported = $state(false),
        listening = $state(false);

    // SpeechRecognition typing (browser-prefixed on Safari/Chrome).
    type SpeechRec = {
        lang: string;
        interimResults: boolean;
        continuous: boolean;
        onresult: ((e: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
        onend: (() => void) | null;
        onerror: (() => void) | null;
        start: () => void;
        stop: () => void;
    };
    let recognition: SpeechRec | null = null;
    let clearTimer: ReturnType<typeof setTimeout> | null = null;

    onMount(() => {
        const w = window as unknown as {
            SpeechRecognition?: new () => SpeechRec;
            webkitSpeechRecognition?: new () => SpeechRec;
        };
        const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
        if (SR) voiceSupported = true;

        // Keep the latest reply visible when the mobile virtual keyboard opens.
        const vv = window.visualViewport;
        const onViewport = () => {
            if (stick && log) log.scrollTop = log.scrollHeight;
        };
        vv?.addEventListener("resize", onViewport);
        return () => {
            vv?.removeEventListener("resize", onViewport);
            recognition?.stop();
            if (clearTimer) clearTimeout(clearTimer);
        };
    });

    function toggleVoice() {
        if (listening) {
            recognition?.stop();
            listening = false;
            return;
        }
        const w = window as unknown as {
            SpeechRecognition?: new () => SpeechRec;
            webkitSpeechRecognition?: new () => SpeechRec;
        };
        const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
        if (!SR) return;
        const rec = new SR();
        rec.lang = locale.lang === "id" ? "id-ID" : "en-US";
        rec.interimResults = true;
        rec.continuous = false;
        rec.onresult = (e) => {
            let text = "";
            for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
            draft = text;
        };
        rec.onerror = () => (listening = false);
        rec.onend = () => {
            listening = false;
            input?.focus();
        };
        recognition = rec;
        listening = true;
        rec.start();
    }

    // The box grows with the question, up to a few lines, then scrolls.
    $effect(() => {
        void draft;
        if (!input) return;
        input.style.height = "auto";
        input.style.height = `${input.scrollHeight}px`;
    });

    function ask(text: string) {
        if (!text.trim() || chat.busy) return;
        if (listening) {
            recognition?.stop();
            listening = false;
        }
        draft = "";
        confirmClear = false;
        stick = true;
        chat.send(text, context());
    }

    function jumpToBottom() {
        stick = true;
        if (log) log.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
    }

    // Follow the reply as it is written, unless the visitor scrolled up to read.
    $effect(() => {
        const last = chat.messages.at(-1);
        void last?.parts.length;
        void (last?.parts.at(-1) as { text?: string } | undefined)?.text;
        if (!last || !stick || !log) return;
        tick().then(() => log && (log.scrollTop = log.scrollHeight));
    });

    const scrolled = () => {
        if (log) stick = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
    };

    export const focus = () => input?.focus();
    const cardShown = (to: string) => shown === to;

    function requestClear() {
        if (!confirmClear) {
            confirmClear = true;
            if (clearTimer) clearTimeout(clearTimer);
            clearTimer = setTimeout(() => (confirmClear = false), 3200);
            return;
        }
        confirmClear = false;
        chat.clear();
    }

    function plainText(m: ChatMessage) {
        return m.parts
            .filter((p): p is { type: "text"; text: string } => p.type === "text")
            .map((p) => p.text)
            .join("\n\n")
            .trim();
    }

    async function copyMessage(index: number, m: ChatMessage) {
        const text = plainText(m);
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            copiedAt = index;
            setTimeout(() => {
                if (copiedAt === index) copiedAt = null;
            }, 1800);
        } catch {}
    }

    // Smart contextual follow-ups derived strictly from the latest reply and conversation.
    // Never shows unrelated filler; returns [] when no directly connected follow-up applies.
    let followUps = $derived.by(() => {
        if (chat.busy || !chat.messages.length) return [] as string[];
        const last = chat.messages.at(-1);
        if (!last || last.role !== "assistant" || last.error || !last.parts.length) return [] as string[];

        const isId = locale.lang === "id";
        const replyText = plainText(last);
        const prevUser = [...chat.messages]
            .reverse()
            .find((m) => m.role === "user");
        const askedText = prevUser ? plainText(prevUser).toLowerCase() : "";
        const combined = `${askedText} ${replyText.toLowerCase()}`;

        const out: string[] = [];
        const pushUnique = (q: string) => {
            const norm = q.trim().toLowerCase();
            if (!norm || norm === askedText) return;
            if (!out.some((x) => x.toLowerCase() === norm)) out.push(q);
        };

        const mapPart = last.parts.find((p) => p.type === "card");
        const cardPlace = mapPart ? places.find((p) => p.id === mapPart.show.to) : undefined;

        if (cardPlace && mapPart?.show.kind === "place") {
            pushUnique(t("followDirections", { name: cardPlace.name }));
            if (cardPlace.info?.doctors?.length || /poli|klinik|clinic/i.test(cardPlace.name)) {
                pushUnique(t("followDoctors", { name: cardPlace.name }));
            }
            if (/poli|klinik|clinic|daftar|regist|farmasi|apotek|pharmacy/i.test(cardPlace.name)) {
                pushUnique(
                    isId
                        ? `Berapa antrean di ${cardPlace.name}?`
                        : `How is the queue at ${cardPlace.name}?`,
                );
            }
        } else if (cardPlace && mapPart?.show.kind === "route") {
            if (cardPlace.info?.doctors?.length) {
                pushUnique(t("followDoctors", { name: cardPlace.name }));
            }
            if (cardPlace.info?.hours) {
                pushUnique(
                    isId ? `Jam buka ${cardPlace.name}?` : `Opening hours for ${cardPlace.name}?`,
                );
            }
        } else {
            // 1. Find real places on this hospital's map mentioned in the assistant's reply.
            const replyLower = replyText.toLowerCase();
            const mentioned = places.filter((p) => {
                const name = p.name.trim().toLowerCase();
                return name.length >= 4 && replyLower.includes(name);
            });
            // Also match common Indonesian/English place references (e.g. "pendaftaran", "informasi", "resepsionis", "kasir", "farmasi", "igd").
            if (!mentioned.length) {
                const hintMatchers: [RegExp, RegExp][] = [
                    [/pendaftaran|registrasi|registration/i, /daftar|regist|loket|front|resepsi|reception/i],
                    [/informasi|resepsionis|reception|info desk/i, /informasi|resepsi|reception|lobi|lobby/i],
                    [/farmasi|apotek|obat|pharmacy/i, /farmasi|apotek|pharmacy/i],
                    [/kasir|bayar|pembayaran|cashier/i, /kasir|cashier|billing/i],
                    [/\bigd\b|\bugd\b|darurat|emergency/i, /\bigd\b|\bugd\b|darurat|emergency/i],
                    [/parkir|parking/i, /parkir|parking/i],
                ];
                for (const [replyRe, placeRe] of hintMatchers) {
                    if (!replyRe.test(replyText)) continue;
                    const found = places.find((p) => placeRe.test(p.name) || placeRe.test(p.detail));
                    if (found && !mentioned.some((m) => m.id === found.id)) mentioned.push(found);
                }
            }

            for (const p of mentioned.slice(0, 2)) {
                pushUnique(
                    isId ? `Di mana ${p.name}?` : `Where is ${p.name}?`,
                );
                if (here) pushUnique(t("followDirections", { name: p.name }));
            }

            // 2. Topic-specific follow-ups directly tied to what was discussed.
            if (/kursi roda|wheelchair|difabel|disabilitas|lift/i.test(combined)) {
                if (!mentioned.length) {
                    pushUnique(isId ? "Di mana bagian pendaftaran?" : "Where is registration?");
                }
                pushUnique(isId ? "Apakah ada jalur ramah kursi roda?" : "Is there wheelchair-accessible routing?");
            } else if (/bpjs|asuransi|jaminan|rujukan/i.test(combined)) {
                pushUnique(isId ? "Syarat berkas yang perlu dibawa?" : "What documents should I bring?");
                if (!mentioned.length) {
                    pushUnique(isId ? "Di mana loket pendaftaran?" : "Where is the registration desk?");
                }
            } else if (/besuk|kunjung|visiting/i.test(combined)) {
                pushUnique(isId ? "Berapa orang boleh menjenguk sekaligus?" : "How many visitors are allowed at once?");
            } else if (/rawat inap|tempat tidur|kamar|bed|ward/i.test(combined)) {
                pushUnique(isId ? "Ketersediaan tempat tidur sekarang?" : "Current bed availability?");
                pushUnique(t("followVisiting"));
            } else if (/dokter|praktik|spesialis|doctor/i.test(combined)) {
                pushUnique(t("followQueue"));
            }
        }

        return out.slice(0, 3);
    });

    // Detect if a reply discusses a live queue and has a linked place card so we can offer "Track my queue number".
    function queuePlaceId(m: ChatMessage): string | null {
        const text = plainText(m);
        if (!/antre|queue|nomor|dipanggil|menunggu/i.test(text)) return null;
        const mapPart = m.parts.find((p) => p.type === "card");
        return mapPart?.show.to ?? null;
    }

    // Persistent quick-intent shortcuts shown above the composer once a chat starts.
    const quickIntents = $derived([
        { label: t("quickEmergency"), query: locale.lang === "id" ? "Di mana IGD?" : "Where is the Emergency department?" },
        { label: t("quickQueue"), query: locale.lang === "id" ? "Berapa antrean poli sekarang?" : "How are the clinic queues right now?" },
        { label: t("quickDoctors"), query: locale.lang === "id" ? "Jadwal dokter hari ini" : "Which doctors are practising today?" },
        { label: t("quickToilet"), query: locale.lang === "id" ? "Toilet terdekat di mana?" : "Where is the nearest toilet?" },
        { label: t("quickBpjs"), query: locale.lang === "id" ? "Bagaimana cara daftar BPJS?" : "How does BPJS registration work?" },
    ]);

    // A small sign for each starting question, from what it asks about.
    const ICONS: [RegExp, string][] = [
        [/dokter|doctor|praktik/i, '<path d="M6 3v6a4 4 0 0 0 8 0V3M10 13v2a5 5 0 0 0 10 0v-3"/><circle cx="20" cy="10" r="2"/>'],
        [/jam|hours|besuk|visit|buka|open/i, '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'],
        [/terdekat|nearest|dekat/i, '<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>'],
        [/bpjs|bayar|pay|asuransi|insurance/i, '<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M3 10.5h18M7 14.5h4"/>'],
        [/daftar|regist/i, '<path d="M8 4h8l3 3v13H5V4zM9 11h6M9 15h4"/>'],
        [/darurat|emergency|igd|ugd/i, '<path d="M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5z"/>'],
    ];
    const PIN = '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>';
    const iconOf = (q: string) => ICONS.find(([re]) => re.test(q))?.[1] ?? PIN;
</script>

<section class="chat" aria-label={t("askAbout")}>
    <div class="log-wrap">
        <div class="log" role="log" aria-busy={chat.busy} bind:this={log} onscroll={scrolled}>
            {#if !chat.messages.length}
                <div class="welcome">
                    <img
                        class="mascot"
                        src="/mascot/airma-wave.webp"
                        width="400"
                        height="403"
                        alt=""
                        draggable="false"
                        in:rise={{ y: 14, duration: 560 }}
                    />
                    <h2 in:rise={{ y: 10, duration: 520 }}>{t("greetingAsk")}</h2>
                    <p class="lead" in:rise={{ delay: 120, duration: 480 }}>{t("greetingLead")}</p>
                    {#if suggestions.length}
                        <p class="label" in:rise={{ delay: 180 }}>{t("tryAsking")}</p>
                        <div class="signs">
                            {#each suggestions as s, i}
                                <button in:rise={{ delay: 220 + i * 55, y: 10 }} onclick={() => ask(s)}>
                                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">{@html iconOf(s)}</svg>
                                    <span>{s}</span>
                                    <i aria-hidden="true">→</i>
                                </button>
                            {/each}
                        </div>
                    {/if}
                </div>
            {/if}

            {#each chat.messages as m, i (i)}
                {#if m.role === "user"}
                    <p class="user" in:rise={{ y: 8, duration: 280 }}>{(m.parts[0] as { text: string }).text}</p>
                {:else}
                    {@const isLatest = i === chat.messages.length - 1}
                    {@const isDone = !chat.busy || !isLatest}
                    {@const qPlace = isDone ? queuePlaceId(m) : null}
                    <div class="reply" in:rise={{ y: 6, duration: 300 }}>
                        <div class="reply-head">
                            <span class="who" aria-hidden="true">
                                <Logo size={24} title="" talking={chat.busy && isLatest} />{t("guide")}
                            </span>
                            {#if isDone && plainText(m)}
                                <button
                                    type="button"
                                    class="copy-btn"
                                    aria-label={t("copyReply")}
                                    onclick={() => copyMessage(i, m)}
                                >
                                    {#if copiedAt === i}
                                        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                                            <path d="M5 13l4 4L19 7" />
                                        </svg>
                                        <span>{t("copied")}</span>
                                    {:else}
                                        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                                            <rect x="9" y="9" width="11" height="11" rx="2" />
                                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                        </svg>
                                        <span>{t("copyReply")}</span>
                                    {/if}
                                </button>
                            {/if}
                        </div>

                        {#if (m.status || !m.parts.length) && chat.busy && isLatest}
                            <span
                                class="typing"
                                role="status"
                                aria-label={m.status ? t(looking(m.status)) : t("writingReply")}
                            >
                                <i></i><i></i><i></i>
                                {#if m.status}<small in:rise={{ y: 4 }}>{t(looking(m.status))}</small>{/if}
                            </span>
                        {/if}

                        {#each m.parts as part}
                            {#if part.type === "text"}
                                {#each blocks(part.text) as block}
                                    {#if block.kind === "ul"}
                                        <ul class="reply-list">
                                            {#each block.items as item}
                                                <li>
                                                    {#each item as run}
                                                        {#if run.tel}
                                                            <a class="tel-link" href={`tel:${run.tel}`}>{run.text}</a>
                                                        {:else if run.bold}
                                                            <b>{run.text}</b>
                                                        {:else}
                                                            {run.text}
                                                        {/if}
                                                    {/each}
                                                </li>
                                            {/each}
                                        </ul>
                                    {:else}
                                        <p>
                                            {#each block.runs as run}
                                                {#if run.tel}
                                                    <a class="tel-link" href={`tel:${run.tel}`}>{run.text}</a>
                                                {:else if run.bold}
                                                    <b>{run.text}</b>
                                                {:else}
                                                    {run.text}
                                                {/if}
                                            {/each}
                                        </p>
                                    {/if}
                                {/each}
                            {:else if part.type === "image"}
                                <div class="card" in:rise={{ y: 8 }}><LeafletCard image={part.image} /></div>
                            {:else}
                                <div class="card" in:rise={{ y: 8 }}>
                                    <MapCard
                                        selection={part.show}
                                        {places}
                                        {onshow}
                                        {fromId}
                                        shown={cardShown(part.show.to)}
                                        doctor={part.doctor}
                                    />
                                </div>
                            {/if}
                        {/each}

                        {#if qPlace}
                            <a
                                class="queue-cta"
                                href={`?to=${qPlace}`}
                                data-sveltekit-replacestate
                                data-sveltekit-noscroll
                                onclick={() => onshow?.()}
                                in:rise={{ y: 6 }}
                            >
                                <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
                                </svg>
                                <span>{t("trackMyNumber")}</span>
                            </a>
                        {/if}

                        {#if m.error}
                            <div class="error-box" role="alert">
                                <p class="error">{t("replyFailed")}</p>
                                {#if isLatest}
                                    <button type="button" class="retry-btn" onclick={() => chat.retry(context())}>
                                        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                                            <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" />
                                        </svg>
                                        <span>{t("retry")}</span>
                                    </button>
                                {/if}
                            </div>
                        {/if}
                    </div>
                {/if}
            {/each}

            {#if followUps.length}
                <div class="follow-ups" aria-label={t("tryAsking")} in:rise={{ y: 6, duration: 240 }}>
                    {#each followUps as q}
                        <button type="button" class="follow-chip" onclick={() => ask(q)}>{q}</button>
                    {/each}
                </div>
            {/if}
        </div>

        {#if !stick && chat.messages.length}
            <button type="button" class="jump-latest" onclick={jumpToBottom} in:rise={{ y: 8, duration: 180 }}>
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <path d="M12 5v14m-6-6 6 6 6-6" />
                </svg>
                <span>{t("jumpLatest")}</span>
            </button>
        {/if}
    </div>

    <div class="dock">
        {#if chat.messages.length && !chat.busy && !followUps.length}
            <div class="quick-strip" aria-label={t("tryAsking")}>
                {#each quickIntents as item}
                    <button type="button" class="quick-pill" onclick={() => ask(item.query)}>{item.label}</button>
                {/each}
            </div>
        {/if}

        {#if here !== null || onhere}
            <div class="where">
                <button class="here" onclick={() => onhere?.()}>
                    <span class="pin" class:set={!!here}></span>{here
                        ? t("youAreAt", { name: here })
                        : t("setWhereYouAre")}
                </button>
                {#if here && onclearhere}
                    <button
                        class="forget"
                        aria-label={t("clearStart")}
                        title={t("clearStart")}
                        onclick={() => onclearhere()}
                    >
                        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                            <path d="M6 6l12 12M18 6 6 18" />
                        </svg>
                    </button>
                {/if}
            </div>
        {/if}

        <form
            class="composer"
            class:listening
            onsubmit={(e) => {
                e.preventDefault();
                ask(draft);
            }}
        >
            <textarea
                bind:this={input}
                bind:value={draft}
                rows="1"
                aria-label={t("yourQuestion")}
                placeholder={listening ? t("voiceListening") : t("askQuestion")}
                enterkeyhint="send"
                autocomplete="off"
                maxlength="500"
                onkeydown={(e) => {
                    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
                    e.preventDefault();
                    ask(draft);
                }}
            ></textarea>

            {#if voiceSupported && !chat.busy}
                <button
                    type="button"
                    class="icon"
                    class:mic-active={listening}
                    aria-label={listening ? t("voiceStop") : t("voiceStart")}
                    title={listening ? t("voiceStop") : t("voiceStart")}
                    onclick={toggleVoice}
                >
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                        <rect x="9" y="3" width="6" height="11" rx="3" />
                        <path d="M5 11a7 7 0 0 0 14 0M12 18v3m-3 0h6" />
                    </svg>
                </button>
            {/if}

            {#if chat.messages.length && !chat.busy}
                {#if confirmClear}
                    <button type="button" class="clear-confirm" onclick={requestClear}>
                        {t("confirmClear")}
                    </button>
                {:else}
                    <button
                        type="button"
                        class="icon"
                        aria-label={t("newConversation")}
                        title={t("newConversation")}
                        onclick={requestClear}
                    >
                        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                            <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" />
                        </svg>
                    </button>
                {/if}
            {/if}

            {#if chat.busy}
                <button type="button" class="send" aria-label={t("stop")} onclick={() => chat.stop()}>
                    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                        <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" />
                    </svg>
                </button>
            {:else}
                <button class="send" aria-label={t("send")} disabled={!draft.trim()}>
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                        <path d="M12 19V5m-6 6 6-6 6 6" />
                    </svg>
                </button>
            {/if}
        </form>
        {#if !chat.messages.length}<p class="note">{t("guideNote")}</p>{/if}
    </div>
</section>

<style>
    .chat {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        color: var(--ink);
    }
    .log-wrap {
        position: relative;
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
    }
    .log {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: 8px 4px 20px;
        display: flex;
        flex-direction: column;
        gap: 18px;
        scrollbar-width: thin;
        scrollbar-color: rgba(26, 46, 35, 0.16) transparent;
    }
    .log > :first-child {
        margin-top: auto;
    }

    /* Welcome */
    .welcome {
        display: flex;
        flex-direction: column;
        padding: 12px 0 4px;
    }
    .mascot {
        display: block;
        align-self: flex-start;
        width: auto;
        height: clamp(84px, 15vh, 132px);
        aspect-ratio: 400 / 404;
        object-fit: contain;
        margin: 0 0 10px -6px;
        user-select: none;
        -webkit-user-drag: none;
        transform-origin: 50% 100%;
        animation: sway 3.2s ease-in-out 700ms infinite alternate;
    }
    @keyframes sway {
        from {
            transform: rotate(-2deg);
        }
        to {
            transform: rotate(2deg);
        }
    }
    h2 {
        margin: 0;
        font-family: var(--display, var(--font-serif, Georgia, serif));
        font-size: clamp(24px, min(2.6vw, 3.6vh), 32px);
        line-height: 1.15;
        font-weight: 500;
        font-variation-settings: "opsz" 72;
        letter-spacing: -0.015em;
        color: var(--ink);
        text-wrap: balance;
    }
    .lead {
        margin: 10px 0 0;
        max-width: 36ch;
        font-size: 15px;
        line-height: 1.55;
        color: var(--ink-2);
        text-wrap: pretty;
    }
    .label {
        margin: clamp(16px, 2.8vh, 26px) 0 10px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--muted);
    }
    .signs {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .signs button {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-height: 48px;
        padding: 10px 14px 10px 12px;
        border-radius: 13px;
        background: var(--card, #ffffff);
        box-shadow:
            0 0 0 1px var(--line, #e1e7dd),
            0 1px 2px rgba(26, 46, 35, 0.04);
        text-align: left;
        font-size: 14.5px;
        font-weight: 500;
        color: var(--ink);
        transition:
            transform 180ms cubic-bezier(0.23, 1, 0.32, 1),
            background 180ms,
            color 180ms,
            box-shadow 180ms;
    }
    .signs svg {
        flex-shrink: 0;
        fill: none;
        stroke: var(--forest, #1e4031);
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
        transition: stroke 180ms;
    }
    .signs span {
        flex: 1;
    }
    .signs i {
        font-style: normal;
        font-size: 16px;
        color: var(--muted);
        transition:
            transform 200ms cubic-bezier(0.23, 1, 0.32, 1),
            color 180ms;
    }
    .signs button:active {
        transform: scale(0.985);
    }

    /* Messages */
    .user {
        align-self: flex-end;
        max-width: 84%;
        margin: 6px 0 0;
        padding: 11px 16px;
        border-radius: 20px 20px 6px 20px;
        background: var(--forest, #1e4031);
        color: #f6f3ea;
        font-size: 15px;
        line-height: 1.45;
        overflow-wrap: anywhere;
        box-shadow: 0 8px 20px -12px rgba(30, 64, 49, 0.55);
    }
    .reply {
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-width: 100%;
    }
    .reply-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }
    .who {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--muted);
    }
    .copy-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 8px;
        border-radius: 999px;
        font-size: 11.5px;
        font-weight: 500;
        color: var(--muted);
        transition: background-color 140ms ease, color 140ms ease;
    }
    .copy-btn svg {
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
    }
    .reply p {
        margin: 0;
        font-size: 15.5px;
        line-height: 1.6;
        white-space: pre-line;
        color: var(--ink);
        text-wrap: pretty;
    }
    .reply-list {
        margin: 0;
        padding-left: 18px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 15px;
        line-height: 1.55;
        color: var(--ink);
    }
    .tel-link {
        color: var(--forest, #1e4031);
        font-weight: 600;
        text-decoration: underline;
        text-underline-offset: 2px;
    }
    .queue-cta {
        display: inline-flex;
        align-self: flex-start;
        align-items: center;
        gap: 7px;
        padding: 8px 14px;
        border-radius: 999px;
        background: var(--accent-soft, #e6efe9);
        color: var(--forest, #1e4031);
        font-size: 13px;
        font-weight: 600;
        text-decoration: none;
        transition: background-color 150ms ease;
    }
    .queue-cta svg {
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
    }
    .error-box {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
        padding: 12px 14px;
        border-radius: 12px;
        background: #fdf1ee;
        border: 1px solid rgba(180, 67, 50, 0.22);
    }
    .reply .error {
        color: #a3402a;
        font-size: 13.5px;
        line-height: 1.45;
    }
    .retry-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border-radius: 999px;
        background: #ffffff;
        color: #a3402a;
        border: 1px solid rgba(180, 67, 50, 0.3);
        font-size: 12.5px;
        font-weight: 600;
    }
    .retry-btn svg {
        fill: none;
        stroke: currentColor;
        stroke-width: 2.2;
        stroke-linecap: round;
        stroke-linejoin: round;
    }

    /* Follow-up chips */
    .follow-ups {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding-top: 2px;
    }
    .follow-chip {
        padding: 7px 12px;
        border-radius: 999px;
        background: var(--card, #ffffff);
        box-shadow: 0 0 0 1px var(--line, #e1e7dd);
        color: var(--forest, #1e4031);
        font-size: 12.5px;
        font-weight: 500;
        text-align: left;
        transition: background-color 150ms ease, color 150ms ease, transform 140ms ease;
    }
    .follow-chip:active {
        transform: scale(0.97);
    }

    /* Floating jump-to-latest pill */
    .jump-latest {
        position: absolute;
        bottom: 10px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 4;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 6px 12px;
        border-radius: 999px;
        background: var(--forest, #1e4031);
        color: #f6f3ea;
        font-size: 12px;
        font-weight: 600;
        box-shadow: 0 8px 20px rgba(26, 46, 35, 0.28);
    }
    .jump-latest svg {
        fill: none;
        stroke: currentColor;
        stroke-width: 2.4;
        stroke-linecap: round;
        stroke-linejoin: round;
    }

    .typing {
        display: inline-flex;
        align-self: flex-start;
        gap: 5px;
        padding: 12px 14px;
        border-radius: 14px;
        background: var(--paper-2, #eef2eb);
    }
    .typing small {
        margin-left: 6px;
        font-size: 13px;
        color: var(--ink-2);
    }
    .typing i {
        align-self: center;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--forest-2, #295642);
        animation: typing 1.1s ease-in-out infinite;
    }
    .typing i:nth-child(2) {
        animation-delay: 150ms;
    }
    .typing i:nth-child(3) {
        animation-delay: 300ms;
    }
    @keyframes typing {
        0%,
        60%,
        100% {
            opacity: 0.3;
            transform: translateY(0);
        }
        30% {
            opacity: 1;
            transform: translateY(-3px);
        }
    }

    /* Dock & Quick-Intent Strip */
    .dock {
        display: flex;
        flex-direction: column;
        gap: 7px;
        padding-top: 6px;
    }
    .quick-strip {
        display: flex;
        gap: 6px;
        overflow-x: auto;
        padding: 2px 2px 2px 0;
        scrollbar-width: none;
    }
    .quick-strip::-webkit-scrollbar {
        display: none;
    }
    .quick-pill {
        flex-shrink: 0;
        padding: 5px 11px;
        border-radius: 999px;
        background: var(--paper-2, #eef2eb);
        color: var(--ink-2, #3d5144);
        font-size: 12px;
        font-weight: 500;
        white-space: nowrap;
        transition: background-color 140ms ease, color 140ms ease;
    }
    .where {
        display: flex;
        align-self: flex-start;
        align-items: center;
        gap: 4px;
        max-width: 100%;
        min-width: 0;
    }
    .forget {
        display: grid;
        place-items: center;
        flex-shrink: 0;
        width: 26px;
        height: 26px;
        border-radius: 50%;
        background: #fffdf8cc;
        box-shadow: 0 0 0 1px var(--line, #e1e7dd);
        color: var(--muted);
        backdrop-filter: blur(8px);
    }
    .forget svg {
        fill: none;
        stroke: currentColor;
        stroke-width: 2.4;
        stroke-linecap: round;
    }
    .here {
        display: inline-flex;
        min-width: 0;
        align-items: center;
        gap: 8px;
        max-width: 100%;
        padding: 6px 12px 6px 10px;
        border-radius: 20px;
        background: #fffdf8cc;
        box-shadow: 0 0 0 1px var(--line, #e1e7dd);
        font-size: 12.5px;
        font-weight: 500;
        color: var(--ink-2);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        backdrop-filter: blur(8px);
    }
    .pin {
        flex-shrink: 0;
        width: 9px;
        height: 9px;
        border-radius: 50%;
        border: 2px solid var(--muted);
    }
    .pin.set {
        border: 0;
        background: #2f7fc4;
        box-shadow: 0 0 0 3px #2f7fc433;
    }

    /* Composer */
    .composer {
        display: flex;
        align-items: flex-end;
        gap: 4px;
        padding: 6px 6px 6px 16px;
        border-radius: 22px;
        background: var(--card, #ffffff);
        box-shadow:
            0 0 0 1px var(--line, #e1e7dd),
            0 2px 4px rgba(26, 46, 35, 0.04),
            0 18px 40px -18px rgba(26, 46, 35, 0.3);
        transition: box-shadow 200ms;
    }
    .composer:focus-within,
    .composer.listening {
        box-shadow:
            0 0 0 1.5px var(--forest, #1e4031),
            0 2px 4px rgba(26, 46, 35, 0.04),
            0 18px 40px -18px rgba(30, 64, 49, 0.4);
    }
    textarea {
        flex: 1;
        min-width: 0;
        min-height: 44px;
        max-height: 156px;
        padding: 11px 0;
        border: 0;
        background: none;
        font: inherit;
        font-size: 16px;
        line-height: 22px;
        color: var(--ink);
        resize: none;
        overflow-y: auto;
        scrollbar-width: thin;
        box-shadow: none;
    }
    textarea:focus {
        outline: none;
        box-shadow: none;
    }
    textarea::placeholder {
        color: #8b968a;
    }
    .composer svg {
        fill: none;
        stroke: currentColor;
        stroke-width: 2.1;
        stroke-linecap: round;
        stroke-linejoin: round;
    }
    .icon {
        display: grid;
        place-items: center;
        width: 40px;
        height: 40px;
        flex-shrink: 0;
        border-radius: 50%;
        color: var(--muted);
    }
    .icon.mic-active {
        background: #fdf1ee;
        color: #c44536;
        animation: pulse-mic 1.2s ease-in-out infinite;
    }
    @keyframes pulse-mic {
        0%,
        100% {
            box-shadow: 0 0 0 0 rgba(196, 69, 54, 0.35);
        }
        50% {
            box-shadow: 0 0 0 7px rgba(196, 69, 54, 0);
        }
    }
    .clear-confirm {
        height: 34px;
        margin-bottom: 5px;
        padding: 0 10px;
        border-radius: 999px;
        background: #fdf1ee;
        color: #b44332;
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
        flex-shrink: 0;
    }
    .send {
        display: grid;
        place-items: center;
        width: 44px;
        height: 44px;
        flex-shrink: 0;
        border-radius: 16px;
        background: var(--forest, #1e4031);
        color: #f6f3ea;
        transition:
            transform 160ms cubic-bezier(0.23, 1, 0.32, 1),
            opacity 160ms,
            background 160ms;
    }
    .send svg {
        stroke-width: 2.6;
    }
    .send:disabled {
        opacity: 1;
        background: var(--paper-2, #eef2eb);
        color: #a3ad9f;
    }
    .send:active:not(:disabled) {
        transform: scale(0.92);
    }
    .note {
        margin: 2px 6px 0;
        font-size: 11.5px;
        line-height: 1.45;
        color: var(--muted);
    }
    @media (hover: hover) and (pointer: fine) {
        .signs button:hover,
        .follow-chip:hover {
            background: var(--forest, #1e4031);
            color: #f6f3ea;
            box-shadow: 0 10px 24px -14px rgba(30, 64, 49, 0.6);
        }
        .signs button:hover svg {
            stroke: #cfe0c3;
        }
        .signs button:hover i {
            color: #f6f3ea;
            transform: translateX(4px);
        }
        .quick-pill:hover {
            background: var(--accent-soft, #e6efe9);
            color: var(--forest, #1e4031);
        }
        .copy-btn:hover {
            background: var(--paper-2, #eef2eb);
            color: var(--ink);
        }
        .queue-cta:hover {
            background: #dce8e0;
        }
        .icon:hover {
            background: var(--paper-2, #eef2eb);
            color: var(--ink);
        }
        .send:hover:not(:disabled) {
            background: var(--forest-2, #295642);
        }
        .here:hover,
        .forget:hover {
            background: #fffdf8;
            color: var(--ink);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .mascot,
        .icon.mic-active {
            animation: none;
        }
        .typing i {
            animation: none;
            opacity: 0.6;
        }
        .signs button,
        .signs i,
        .follow-chip {
            transition: none;
        }
    }
</style>
