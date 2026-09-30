<script lang="ts">
    import { tick } from "svelte";
    import type { Chat } from "$lib/assistant/chat.svelte";
    import type { ReplyContext } from "$lib/assistant/chat";
    import type { Place } from "$lib/wayfinding/routing";
    import { rise } from "$lib/motion";
    import type { Key } from "$lib/i18n/messages";
    import { runs } from "$lib/assistant/format";
    import MapCard from "./MapCard.svelte";
    import Logo from "$lib/components/shared/Logo.svelte";
    import { useLocale } from "$lib/i18n/locale.svelte";
    let {
        chat,
        places,
        suggestions,
        title,
        context,
        shown = null,
        here = null,
        onshow,
        onhere,
        onclearhere,
    }: {
        chat: Chat;
        places: Place[];
        /** Questions to start with. */
        suggestions: string[];
        title: string;
        /** Where the visitor is, for "nearest" and routes. */
        context: () => ReplyContext;
        /** The place on the map now, so its card says so. */
        shown?: string | null;
        /** Where the visitor said they are, if they did. */
        here?: string | null;
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
        find_nearest: "lookingNearest",
        get_directions: "lookingRoute",
        show_on_map: "lookingMap",
    };
    const looking = (tool: string): Key => LOOKING[tool] ?? "writingReply";
    let draft = $state(""),
        log = $state<HTMLElement>(),
        input = $state<HTMLTextAreaElement>();
    // The box grows with the question, up to a few lines, then scrolls.
    $effect(() => {
        void draft;
        if (!input) return;
        input.style.height = "auto";
        input.style.height = `${input.scrollHeight}px`;
    });

    function ask(text: string) {
        if (!text.trim() || chat.busy) return;
        draft = "";
        stick = true;
        chat.send(text, context());
    }
    // Follow the reply as it is written, unless the visitor scrolled up to read.
    let stick = true;
    $effect(() => {
        const last = chat.messages.at(-1);
        void last?.parts.length;
        void (last?.parts.at(-1) as { text?: string } | undefined)?.text;
        // The welcome reads from its top; a conversation from its latest reply.
        if (!last || !stick || !log) return;
        tick().then(() => log && (log.scrollTop = log.scrollHeight));
    });
    const scrolled = () => {
        if (log) stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    };
    export const focus = () => input?.focus();

    const cardShown = (to: string) => shown === to;

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
    // "Selasa, 30 September", as a front desk would greet you.
    let today = $derived(
        new Date().toLocaleDateString(locale.lang === "id" ? "id-ID" : "en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long",
        }),
    );
</script>

<section class="chat" aria-label={t("askAbout")}>
    <div class="log" role="log" aria-busy={chat.busy} bind:this={log} onscroll={scrolled}>
        {#if !chat.messages.length}<div class="welcome">
                <p class="eyebrow" in:rise={{ y: 6 }}><span class="dot"></span>{today}</p>
                <h2 in:rise={{ delay: 40, y: 10, duration: 520 }}>
                    {t("greetingTitle", { title })}
                    <em>{t("greetingAsk")}</em>
                </h2>
                <p class="lead" in:rise={{ delay: 120, duration: 480 }}>{t("greetingLead")}</p>
                {#if suggestions.length}<p class="label" in:rise={{ delay: 180 }}>{t("tryAsking")}</p>
                    <div class="signs">
                        {#each suggestions as s, i}<button in:rise={{ delay: 220 + i * 55, y: 10 }} onclick={() => ask(s)}>
                                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">{@html iconOf(s)}</svg>
                                <span>{s}</span>
                                <i aria-hidden="true">→</i>
                            </button>{/each}
                    </div>{/if}
            </div>{/if}
        {#each chat.messages as m, i (i)}
            {#if m.role === "user"}<p class="user" in:rise={{ y: 8, duration: 280 }}>{(m.parts[0] as { text: string }).text}</p>
            {:else}<div class="reply" in:rise={{ y: 6, duration: 300 }}>
                    <span class="who" aria-hidden="true"><Logo size={15} title="" />{t("guide")}</span>
                    {#if (m.status || !m.parts.length) && chat.busy && i === chat.messages.length - 1}<span
                            class="typing"
                            role="status"
                            aria-label={m.status ? t(looking(m.status)) : t("writingReply")}
                            ><i></i><i></i><i></i>{#if m.status}<small in:rise={{ y: 4 }}>{t(looking(m.status))}</small>{/if}</span
                        >{/if}
                    {#each m.parts as part}{#if part.type === "text"}<p>{#each runs(part.text) as run}{#if run.bold}<b>{run.text}</b>{:else}{run.text}{/if}{/each}</p>{:else}<div class="card" in:rise={{ y: 8 }}>
                                <MapCard
                                    selection={part.show}
                                    {places}
                                    {onshow}
                                    shown={cardShown(part.show.to)}
                                    doctor={part.doctor}
                                />
                            </div>{/if}{/each}
                    {#if m.error}<p class="error">{t("replyFailed")}</p>{/if}
                </div>{/if}
        {/each}
    </div>
    <div class="dock">
        {#if here !== null || onhere}<div class="where">
                <button class="here" onclick={() => onhere?.()}>
                    <span class="pin" class:set={!!here}></span>{here ? t("youAreAt", { name: here }) : t("setWhereYouAre")}
                </button>{#if here && onclearhere}<button
                        class="forget"
                        aria-label={t("clearStart")}
                        title={t("clearStart")}
                        onclick={() => onclearhere()}
                        ><svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"
                            ><path d="M6 6l12 12M18 6 6 18" /></svg
                        ></button
                    >{/if}
            </div>{/if}
        <form
            class="composer"
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
                placeholder={t("askQuestion")}
                enterkeyhint="send"
                autocomplete="off"
                maxlength="500"
                onkeydown={(e) => {
                    // Enter sends; Shift+Enter starts a new line; Enter that confirms a word (IME) does neither.
                    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
                    e.preventDefault();
                    ask(draft);
                }}
            ></textarea>
            {#if chat.messages.length && !chat.busy}<button
                    type="button"
                    class="icon"
                    aria-label={t("newConversation")}
                    title={t("newConversation")}
                    onclick={() => chat.clear()}
                >
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
                        ><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" /></svg
                    >
                </button>{/if}
            {#if chat.busy}<button type="button" class="send" aria-label={t("stop")} onclick={() => chat.stop()}>
                    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"
                        ><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" /></svg
                    >
                </button>{:else}<button class="send" aria-label={t("send")} disabled={!draft.trim()}>
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>
                </button>{/if}
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
        scrollbar-color: #1d2b2222 transparent;
    }
    /* Like any chat, the conversation sits on the composer and grows upwards. */
    .log > :first-child {
        margin-top: auto;
    }

    /* Welcome */
    .welcome {
        display: flex;
        flex-direction: column;
        padding: 12px 0 4px;
    }
    .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin: 0 0 14px;
        font-size: 11.5px;
        font-weight: 600;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--forest);
    }
    .dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--signal);
        box-shadow: 0 0 0 4px #e0663d22;
    }
    h2 {
        margin: 0;
        font-family: var(--display);
        /* Smaller on narrow or short screens, so the welcome fits above the composer. */
        font-size: clamp(26px, min(3.1vw, 4.3vh), 40px);
        line-height: 1.06;
        font-weight: 480;
        font-variation-settings: "opsz" 96;
        letter-spacing: -0.022em;
        color: var(--ink);
        text-wrap: balance;
    }
    h2 em {
        display: block;
        margin-top: 4px;
        font-style: italic;
        font-weight: 400;
        color: var(--forest-2);
    }
    .lead {
        margin: 14px 0 0;
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
    /* Starting questions as direction signs. */
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
        background: var(--card);
        box-shadow:
            0 0 0 1px var(--line),
            0 1px 2px #1d2b2208;
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
        stroke: var(--forest);
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
        background: var(--forest);
        color: #f6f3ea;
        font-size: 15px;
        line-height: 1.45;
        overflow-wrap: anywhere;
        box-shadow: 0 8px 20px -12px #24473a99;
    }
    .reply {
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-width: 100%;
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
    .reply p {
        margin: 0;
        font-size: 15.5px;
        line-height: 1.6;
        white-space: pre-line;
        color: var(--ink);
        text-wrap: pretty;
    }
    .reply .error {
        color: #a3402a;
        font-size: 14px;
    }
    .typing {
        display: inline-flex;
        align-self: flex-start;
        gap: 5px;
        padding: 12px 14px;
        border-radius: 14px;
        background: var(--paper-2);
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
        background: var(--forest-2);
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

    /* Composer */
    .dock {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding-top: 6px;
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
        box-shadow: 0 0 0 1px var(--line);
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
        box-shadow: 0 0 0 1px var(--line);
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
    .composer {
        display: flex;
        /* The buttons stay at the bottom as the question grows. */
        align-items: flex-end;
        gap: 4px;
        padding: 6px 6px 6px 18px;
        border-radius: 22px;
        background: var(--card);
        box-shadow:
            0 0 0 1px var(--line),
            0 2px 4px #1d2b220a,
            0 18px 40px -18px #1d2b2255;
        transition: box-shadow 200ms;
    }
    .composer:focus-within {
        box-shadow:
            0 0 0 1.5px var(--forest),
            0 2px 4px #1d2b220a,
            0 18px 40px -18px #24473a66;
    }
    textarea {
        flex: 1;
        min-width: 0;
        /* One line is as tall as the buttons; at most about six lines, then it scrolls. */
        min-height: 44px;
        max-height: 156px;
        padding: 11px 0;
        border: 0;
        background: none;
        font: inherit;
        font-size: 16px; /* smaller zooms the page on iOS */
        line-height: 22px;
        color: var(--ink);
        resize: none;
        overflow-y: auto;
        scrollbar-width: thin;
    }
    textarea:focus {
        outline: none;
    }
    textarea::placeholder {
        color: #8b968a;
    }
    .composer svg {
        fill: none;
        stroke: currentColor;
        stroke-width: 2.2;
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
    .send {
        display: grid;
        place-items: center;
        width: 44px;
        height: 44px;
        flex-shrink: 0;
        border-radius: 16px;
        background: var(--forest);
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
        background: var(--paper-2);
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
        .signs button:hover {
            background: var(--forest);
            color: #f6f3ea;
            box-shadow: 0 10px 24px -14px #24473aaa;
        }
        .signs button:hover svg {
            stroke: #cfe0c3;
        }
        .signs button:hover i {
            color: #f6f3ea;
            transform: translateX(4px);
        }
        .icon:hover {
            background: var(--paper-2);
            color: var(--ink);
        }
        .send:hover:not(:disabled) {
            background: var(--forest-2);
        }
        .here:hover,
        .forget:hover {
            background: #fffdf8;
            color: var(--ink);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .typing i {
            animation: none;
            opacity: 0.6;
        }
        .signs button,
        .signs i {
            transition: none;
        }
    }
</style>
