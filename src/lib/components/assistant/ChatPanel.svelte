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
    import AirmaRive from "./AirmaRive.svelte";
    import { REST, moodOf, visemeOfChunk, type Mouth } from "$lib/assistant/mascot";
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
        onfeedback,
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
        /** Visitor rated an assistant reply as helpful or unhelpful. */
        onfeedback?: (vote: "helpful" | "unhelpful", question: string) => void;
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
        votes = $state<Record<number, "helpful" | "unhelpful">>({});
    let confirmClear = $state(false),
        voiceSupported = $state(false),
        listening = $state(false);

    // 0ms Emergency red-flag detection so urgent patients never wait for an LLM round-trip.
    const EMERGENCY_RE =
        /\b(nyeri dada|sakit dada|sesak napas|sesak nafas|susah napas|pingsan|tidak sadar|pendarahan|perdarahan|kejang|stroke|serangan jantung|kecelakaan|gawat darurat|chest pain|shortness of breath|can'?t breathe|fainted|unconscious|bleeding|seizure|heart attack)\b/i;

    let emergencyPlace = $derived(
        places.find((p) => /\bigd\b|\bugd\b|emergency|gawat darurat/i.test(`${p.name} ${p.detail}`)) ?? null,
    );
    let emergencyPhone = $derived(emergencyPlace?.info?.phone?.trim() || "118");
    const isEmergencyQuestion = (text: string) => EMERGENCY_RE.test(text);

    function editUserMessage(index: number) {
        const text = chat.rewindTo(index);
        if (!text) return;
        draft = text;
        votes = {};
        tick().then(() => input?.focus());
    }

    function rateReply(index: number, vote: "helpful" | "unhelpful") {
        if (votes[index] === vote) return;
        votes = { ...votes, [index]: vote };
        const prev = chat.messages[index - 1];
        const q = prev?.role === "user" ? plainText(prev) : "chat";
        onfeedback?.(vote, q);
    }

    /** Perplexity-style source provenance badges for a completed assistant reply. */
    function sourcesOf(m: ChatMessage): Key[] {
        const out: Key[] = [];
        const text = plainText(m);
        if (m.parts.some((p) => p.type === "card")) out.push("sourceMap");
        if (m.parts.some((p) => p.type === "image")) out.push("sourceLeaflet");
        if (m.parts.some((p) => p.type === "card" && p.doctor) || /\bdr\.?\s|sp\.[a-z]|jadwal dokter|praktik/i.test(text))
            out.push("sourceDoctors");
        if (/antre|menunggu|dilayani|tempat tidur|bed tersedia|queue|waiting/i.test(text)) out.push("sourceLive");
        if (!out.length && text) out.push("sourceInfo");
        return out.slice(0, 3);
    }

    // AIRMA's face: her mood follows the chat, her mouth follows the reply as it is written.
    const latest = $derived(chat.messages.at(-1));
    const latestReply = $derived(latest?.role === "assistant" ? latest : undefined);
    const replyText = $derived(latestReply ? plainText(latestReply) : "");
    let justAnswered = $state(false);
    const mood = $derived(
        moodOf({
            busy: chat.busy,
            speaking: !!replyText,
            lookingUp: !!latestReply?.status,
            failed:
                !!latestReply?.error ||
                (!!latestReply && votes[chat.messages.length - 1] === "unhelpful"),
            justAnswered,
            hearing: listening || !!draft.trim(),
        }),
    );

    const fresh = $derived(!chat.messages.length);

    // She is one canvas, laid over one of two empty spots in the conversation:
    // the middle of an empty chat, or the head of the latest reply. She sits in
    // the scrolling log, so she scrolls with it; moving to a new spot glides.
    let replySlot = $state<HTMLElement>(),
        heroSlot = $state<HTMLElement>(),
        spot = $state<{ x: number; y: number; size: number } | null>(null),
        glide = $state(false),
        glideTimer: ReturnType<typeof setTimeout> | null = null;
    function place() {
        const slot = fresh ? heroSlot : replySlot;
        if (!log || !slot) return;
        const c = log.getBoundingClientRect(),
            r = slot.getBoundingClientRect();
        if (!r.width) return;
        const next = {
            x: Math.round(r.left - c.left + log.scrollLeft),
            y: Math.round(r.top - c.top + log.scrollTop),
            size: Math.round(r.width),
        };
        if (!spot || next.x !== spot.x || next.y !== spot.y || next.size !== spot.size) spot = next;
    }
    // A new spot: glide there (but not to the first, which she takes in place).
    $effect(() => {
        const slot = fresh ? heroSlot : replySlot;
        if (!slot) return;
        tick().then(() => {
            if (spot) {
                glide = true;
                if (glideTimer) clearTimeout(glideTimer);
                glideTimer = setTimeout(() => (glide = false), 620);
            }
            place();
        });
    });
    // The conversation around her moves (a card loads, the panel resizes): follow it at once.
    $effect(() => {
        if (!log) return;
        const observer = new ResizeObserver(() => place());
        observer.observe(log);
        const mutations = new MutationObserver(() => requestAnimationFrame(place));
        mutations.observe(log, { childList: true, subtree: true, characterData: true });
        return () => {
            observer.disconnect();
            mutations.disconnect();
        };
    });

    // A moment of "success" when a reply finishes well, then back to neutral.
    let wasBusy = false,
        answeredTimer: ReturnType<typeof setTimeout> | null = null;
    $effect(() => {
        const busy = chat.busy;
        if (busy) justAnswered = false;
        else if (wasBusy && latestReply && !latestReply.error && replyText) {
            justAnswered = true;
            if (answeredTimer) clearTimeout(answeredTimer);
            answeredTimer = setTimeout(() => (justAnswered = false), 2400);
        }
        wasBusy = busy;
    });

    /** One mouth shape this often, a few letters at a time. */
    const BEAT_MS = 85,
        BEAT_CHARS = 3,
        /** Letters her mouth may fall behind the text before she skips ahead. */
        MAX_LAG = 48;
    let mouth = $state<Mouth>(REST),
        said = 0,
        saidIn = -1,
        quiet = 0,
        beat: ReturnType<typeof setInterval> | null = null;
    const stopBeat = () => {
        if (beat) clearInterval(beat);
        beat = null;
        mouth = REST;
    };
    $effect(() => {
        const text = replyText,
            at = chat.messages.length - 1,
            busy = chat.busy;
        // A new reply starts from its first letter; one already written is not read aloud.
        if (at !== saidIn) {
            saidIn = at;
            said = busy ? 0 : text.length;
        }
        if (!busy || text.length <= said || beat) return;
        quiet = 0;
        beat = setInterval(() => {
            const now = replyText;
            if (said >= now.length) {
                mouth = REST;
                if (!chat.busy || ++quiet > 4) stopBeat();
                return;
            }
            quiet = 0;
            said = Math.max(said, now.length - MAX_LAG);
            mouth = visemeOfChunk(now.slice(said, said + BEAT_CHARS));
            said += BEAT_CHARS;
        }, BEAT_MS);
    });

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
            if (answeredTimer) clearTimeout(answeredTimer);
            if (glideTimer) clearTimeout(glideTimer);
            stopBeat();
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
            {#if fresh}
                <div class="intro">
                    <div class="hero-slot" bind:this={heroSlot}></div>
                    <h2 in:rise={{ y: 10, duration: 520 }}>{t("greetingAsk")}</h2>
                    <p class="lead" in:rise={{ delay: 80, y: 8, duration: 480 }}>{t("greetingLead")}</p>
                    {#if suggestions.length}
                        <div class="signs" aria-label={t("tryAsking")}>
                            {#each suggestions as s, i}
                                <button in:rise={{ delay: 120 + i * 55, y: 8 }} onclick={() => ask(s)}>
                                    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">{@html iconOf(s)}</svg>
                                    <span>{s}</span>
                                </button>
                            {/each}
                        </div>
                    {/if}
                </div>
            {/if}

            {#each chat.messages as m, i (i)}
                {#if m.role === "user"}
                    {@const qText = (m.parts[0] as { text: string }).text}
                    {@const isLastUser = !chat.busy && (i === chat.messages.length - 1 || i === chat.messages.length - 2)}
                    <div class="user-row" in:rise={{ y: 8, duration: 280 }}>
                        {#if isLastUser}
                            <button
                                type="button"
                                class="edit-q"
                                aria-label={t("editQuestion")}
                                title={t("editQuestion")}
                                onclick={() => editUserMessage(i)}
                            >
                                <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                                    <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                                </svg>
                            </button>
                        {/if}
                        <p class="user">{qText}</p>
                    </div>
                    {#if isEmergencyQuestion(qText)}
                        <div class="emergency-card" role="alert" in:rise={{ y: 6, duration: 200 }}>
                            <div class="em-head">
                                <span class="em-badge">IGD</span>
                                <b>{t("emergencyTitle")}</b>
                            </div>
                            <p>{t("emergencyBody")}</p>
                            <div class="em-actions">
                                <a class="em-btn primary" href={`tel:${emergencyPhone.replace(/[^\d+]/g, "")}`}>
                                    {t("callEmergency", { phone: emergencyPhone })}
                                </a>
                                {#if emergencyPlace}
                                    <a
                                        class="em-btn"
                                        href={fromId && fromId !== emergencyPlace.id
                                            ? `?from=${fromId}&to=${emergencyPlace.id}`
                                            : `?to=${emergencyPlace.id}`}
                                        data-sveltekit-replacestate
                                        data-sveltekit-noscroll
                                        onclick={() => onshow?.()}
                                    >
                                        {t("goToEmergency")} →
                                    </a>
                                {/if}
                            </div>
                        </div>
                    {/if}
                {:else}
                    {@const isLatest = i === chat.messages.length - 1}
                    {@const isDone = !chat.busy || !isLatest}
                    {@const qPlace = isDone ? queuePlaceId(m) : null}
                    {@const srcs = isDone && !m.error ? sourcesOf(m) : []}
                    <div class="reply" in:rise={{ y: 6, duration: 300 }}>
                        <div class="reply-head">
                            <span class="who" aria-hidden="true">
                                {#if isLatest}
                                    <span class="reply-slot" bind:this={replySlot}></span>
                                {:else}
                                    <Logo size={24} title="" />
                                {/if}{t("guide")}
                            </span>
                            {#if isDone && plainText(m)}
                                <div class="reply-tools">
                                    <button
                                        type="button"
                                        class="copy-btn"
                                        class:voted={votes[i] === "helpful"}
                                        aria-label={t("helpful")}
                                        title={t("helpful")}
                                        onclick={() => rateReply(i, "helpful")}
                                    >
                                        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                                            <path d="M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
                                        </svg>
                                    </button>
                                    <button
                                        type="button"
                                        class="copy-btn"
                                        class:voted-down={votes[i] === "unhelpful"}
                                        aria-label={t("notHelpful")}
                                        title={t("notHelpful")}
                                        onclick={() => rateReply(i, "unhelpful")}
                                    >
                                        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                                            <path d="M17 14V2M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
                                        </svg>
                                    </button>
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
                                </div>
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

                        {#if srcs.length}
                            <div class="sources" aria-label="Sources">
                                {#each srcs as src}
                                    <span class="source-pill" class:live={src === "sourceLive"}>
                                        {#if src === "sourceLive"}<i></i>{/if}{t(src)}
                                    </span>
                                {/each}
                            </div>
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

            <div
                class="buddy"
                class:glide
                class:placed={!!spot}
                style:transform={spot ? `translate(${spot.x}px, ${spot.y}px)` : undefined}
                style:width={spot ? `${spot.size}px` : undefined}
                style:height={spot ? `${spot.size}px` : undefined}
            >
                <AirmaRive {mood} {mouth} label={t("guide")} />
            </div>
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
        scrollbar-width: none;
    }
    .log::-webkit-scrollbar {
        display: none;
    }
    .log > :first-child {
        margin-top: auto;
    }

    /* The empty chat: AIRMA in the middle, what she can help with below her. */
    .intro {
        display: flex;
        flex-direction: column;
        align-items: center;
        margin-block: auto;
        padding: 8px 2px;
        text-align: center;
    }
    .hero-slot {
        width: clamp(150px, 28vh, 220px);
        aspect-ratio: 1;
        margin-bottom: 8px;
    }
    .intro h2 {
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
        margin: 8px 0 0;
        max-width: 36ch;
        font-size: 15px;
        line-height: 1.55;
        color: var(--ink-2);
        text-wrap: pretty;
    }
    .signs {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 6px;
        margin-top: clamp(16px, 2.6vh, 24px);
    }
    .signs button {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        min-height: 38px;
        padding: 7px 14px 7px 11px;
        border-radius: 999px;
        background: var(--card, #ffffff);
        box-shadow: 0 0 0 1px var(--line, #e1e7dd);
        font-size: 13.5px;
        font-weight: 500;
        color: var(--ink);
        transition:
            transform 180ms cubic-bezier(0.23, 1, 0.32, 1),
            background 180ms,
            box-shadow 180ms;
    }
    .signs svg {
        flex-shrink: 0;
        fill: none;
        stroke: var(--forest, #1e4031);
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
    }
    .signs button:active {
        transform: scale(0.97);
    }

    /* Once the conversation starts, AIRMA is the latest reply's face. */
    .log {
        position: relative;
    }
    .reply-slot {
        display: block;
        flex-shrink: 0;
        width: 44px;
        height: 44px;
        margin: -10px -2px -10px -8px;
    }
    .buddy {
        position: absolute;
        top: 0;
        left: 0;
        z-index: 2;
        pointer-events: none;
        opacity: 0;
        will-change: transform;
    }
    .buddy.placed {
        opacity: 1;
    }
    .buddy.glide {
        transition:
            transform 560ms cubic-bezier(0.32, 0.72, 0, 1),
            width 560ms cubic-bezier(0.32, 0.72, 0, 1),
            height 560ms cubic-bezier(0.32, 0.72, 0, 1),
            opacity 200ms ease-out;
    }

    /* Messages */
    .user-row {
        align-self: flex-end;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        max-width: 90%;
        margin-top: 6px;
    }
    .edit-q {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        flex-shrink: 0;
        color: var(--muted);
        opacity: 0.72;
        transition: background-color 140ms ease, color 140ms ease, opacity 140ms ease;
    }
    .edit-q:hover {
        opacity: 1;
        background: var(--paper-2, #eef2eb);
        color: var(--ink);
    }
    .edit-q svg {
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
    }
    .user {
        margin: 0;
        padding: 11px 16px;
        border-radius: 20px 20px 6px 20px;
        background: var(--forest, #1e4031);
        color: #f6f3ea;
        font-size: 15px;
        line-height: 1.45;
        overflow-wrap: anywhere;
    }

    /* 0ms Emergency red-flag card */
    .emergency-card {
        padding: 13px 15px;
        border-radius: 14px;
        background: #fdf1ee;
        border: 1.5px solid rgba(196, 69, 54, 0.35);
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .em-head {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #962c20;
        font-size: 14px;
    }
    .em-badge {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        padding: 2px 7px;
        border-radius: 999px;
        background: #c44536;
        color: #ffffff;
    }
    .emergency-card p {
        margin: 0;
        font-size: 13px;
        line-height: 1.45;
        color: #7a261c;
    }
    .em-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 2px;
    }
    .em-btn {
        display: inline-flex;
        align-items: center;
        padding: 7px 13px;
        border-radius: 999px;
        font-size: 12.5px;
        font-weight: 600;
        text-decoration: none;
        background: #ffffff;
        color: #962c20;
        border: 1px solid rgba(196, 69, 54, 0.32);
    }
    .em-btn.primary {
        background: #c44536;
        color: #ffffff;
        border-color: #c44536;
    }

    .reply-tools {
        display: inline-flex;
        align-items: center;
        gap: 2px;
    }
    .copy-btn.voted {
        color: #2a7d4f;
        background: #e6f4ec;
    }
    .copy-btn.voted-down {
        color: #b44332;
        background: #fdf1ee;
    }
    .sources {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
    }
    .source-pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 3px 8px;
        border-radius: 999px;
        background: var(--paper-2, #eef2eb);
        color: var(--muted, #66786b);
        font-size: 11px;
        font-weight: 500;
    }
    .source-pill.live {
        background: #e6f4ec;
        color: #1e613c;
        font-weight: 600;
    }
    .source-pill.live i {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #2a7d4f;
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
        position: relative;
        z-index: 1;
        display: flex;
        align-items: flex-end;
        gap: 4px;
        padding: 6px 6px 6px 16px;
        border-radius: 22px;
        background: var(--card, #ffffff);
        box-shadow: 0 0 0 1px var(--line, #e1e7dd);
        transition: box-shadow 200ms;
    }
    .composer:focus-within,
    .composer.listening {
        box-shadow: 0 0 0 1.5px var(--forest, #1e4031);
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
    .signs button:hover,
    .follow-chip:hover {
        background: var(--forest, #1e4031);
        color: #f6f3ea;
        box-shadow: 0 0 0 1px var(--forest, #1e4031);
    }
    .signs button:hover svg {
        stroke: #cfe0c3;
    }
    .quick-pill:hover {
        background: var(--accent-soft, #e6efe9);
        color: var(--forest, #1e4031);
    }
    .copy-btn:hover {
        background: var(--paper-2, #eef2eb);
        color: var(--ink);
    }
    .copy-btn.voted:hover {
        background: #d7eee0;
        color: #1e613c;
    }
    .copy-btn.voted-down:hover {
        background: #f9e2dc;
        color: #962c20;
    }
    .queue-cta:hover {
        background: #dce8e0;
    }
    .icon:hover {
        background: var(--paper-2, #eef2eb);
        color: var(--ink);
    }
    .icon.mic-active:hover {
        background: #f9e2dc;
        color: #b44332;
    }
    .clear-confirm:hover {
        background: #f9e2dc;
        color: #962c20;
    }
    .retry-btn:hover {
        background: #f9e2dc;
        color: #8c3422;
    }
    .jump-latest:hover {
        background: var(--forest-2, #295642);
        color: #f6f3ea;
    }
    .send:hover:not(:disabled) {
        background: var(--forest-2, #295642);
        color: #f6f3ea;
    }
    .here:hover,
    .forget:hover {
        background: #fffdf8;
        color: var(--ink);
    }
    @media (prefers-reduced-motion: reduce) {
        .icon.mic-active {
            animation: none;
        }
        .typing i {
            animation: none;
            opacity: 0.6;
        }
        .signs button,
        .buddy.glide,
        .follow-chip {
            transition: none;
        }
    }
</style>
