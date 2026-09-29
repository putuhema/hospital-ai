<script lang="ts">
    import { tick } from "svelte";
    import type { Chat } from "$lib/assistant/chat.svelte";
    import type { ReplyContext } from "$lib/assistant/chat";
    import type { Place } from "$lib/wayfinding/routing";
    import { rise } from "$lib/motion";
    import MapCard from "./MapCard.svelte";
    import { useLocale } from "$lib/i18n/locale.svelte";
    let {
        chat,
        places,
        suggestions,
        title,
        context,
        onclose,
        onshow,
    }: {
        chat: Chat;
        places: Place[];
        /** Questions to start with. */
        suggestions: string[];
        title: string;
        /** Where the visitor is, for "nearest" and routes. */
        context: () => ReplyContext;
        onclose: () => void;
        /** A card was followed to the map. */
        onshow?: () => void;
    } = $props();
    const { t } = useLocale();
    let draft = $state(""),
        log = $state<HTMLElement>(),
        input = $state<HTMLInputElement>();

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
        if (!stick || !log) return;
        tick().then(() => log && (log.scrollTop = log.scrollHeight));
    });
    const scrolled = () => {
        if (log) stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    };
    export const focus = () => input?.focus();
</script>

<section class="chat" aria-label={t("askAbout")}>
    <header>
        <div>
            <h2>{t("askTitle", { title })}</h2>
            <small>{t("askSubtitle")}</small>
        </div>
        {#if chat.messages.length}<button class="icon" aria-label={t("newConversation")} title={t("newConversation")} onclick={() => chat.clear()}>
                <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"
                    ><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg
                >
            </button>{/if}
        <button class="icon" aria-label={t("close")} onclick={onclose}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"
                ><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg
            >
        </button>
    </header>
    <div class="log" role="log" aria-busy={chat.busy} bind:this={log} onscroll={scrolled}>
        {#if !chat.messages.length}<div class="welcome" in:rise>
                <p>{t("welcome")}</p>
                {#if suggestions.length}<div class="suggestions">
                        {#each suggestions as s, i}<button in:rise={{ delay: 60 + i * 40 }} onclick={() => ask(s)}>{s}</button>{/each}
                    </div>{/if}
            </div>{/if}
        {#each chat.messages as m, i (i)}
            {#if m.role === "user"}<p class="user" in:rise={{ y: 6, duration: 240 }}>{(m.parts[0] as { text: string }).text}</p>
            {:else}<div class="reply">
                    {#if !m.parts.length && chat.busy && i === chat.messages.length - 1}<span class="typing" aria-label={t("writingReply")}
                            ><i></i><i></i><i></i></span
                        >{/if}
                    {#each m.parts as part}{#if part.type === "text"}<p>{part.text}</p>{:else}<div class="card" in:rise={{ y: 6 }}>
                                <MapCard selection={part.show} {places} {onshow} />
                            </div>{/if}{/each}
                    {#if m.error}<p class="error">{t("replyFailed")}</p>{/if}
                </div>{/if}
        {/each}
    </div>
    <form
        onsubmit={(e) => {
            e.preventDefault();
            ask(draft);
        }}
    >
        <input
            bind:this={input}
            bind:value={draft}
            aria-label={t("yourQuestion")}
            placeholder={t("askQuestion")}
            enterkeyhint="send"
            autocomplete="off"
            maxlength="500"
        />
        {#if chat.busy}<button type="button" class="send" aria-label={t("stop")} onclick={() => chat.stop()}>
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
            </button>{:else}<button class="send" aria-label={t("send")} disabled={!draft.trim()}>
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
                    ><path d="M12 19V5m-6 6 6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" /></svg
                >
            </button>{/if}
    </form>
</section>

<style>
    .chat {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        color: #2f4336;
    }
    header {
        display: flex;
        align-items: flex-start;
        gap: 4px;
        padding: 16px 12px 12px 20px;
        border-bottom: 1px solid #eef2ea;
    }
    header div {
        flex: 1;
        min-width: 0;
    }
    h2 {
        margin: 0;
        font:
            600 19px/1.25 Georgia,
            serif;
        color: #1f3a2b;
    }
    header small {
        font-size: 12px;
        color: #7b8c70;
    }
    .icon {
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        flex-shrink: 0;
        border-radius: 50%;
        color: #52664a;
    }
    .log {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: 16px 16px 8px;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .welcome p {
        margin: 0 0 14px;
        font-size: 15px;
        line-height: 1.45;
    }
    .suggestions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }
    .suggestions button {
        padding: 9px 14px;
        border: 1px solid #d5dccf;
        border-radius: 18px;
        background: white;
        font-size: 14px;
        font-weight: 500;
        color: #0f6a73;
        transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1);
    }
    .suggestions button:active {
        transform: scale(0.97);
    }
    .user {
        align-self: flex-end;
        max-width: 85%;
        margin: 0;
        padding: 9px 14px;
        border-radius: 18px 18px 4px 18px;
        background: #0f6a73;
        color: white;
        font-size: 15px;
        line-height: 1.4;
        overflow-wrap: anywhere;
    }
    .reply {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-width: 95%;
    }
    .reply p {
        margin: 0;
        font-size: 15px;
        line-height: 1.5;
        white-space: pre-line;
    }
    .reply .error {
        color: #9a3b2e;
        font-size: 14px;
    }
    .typing {
        display: inline-flex;
        gap: 4px;
        padding: 10px 0;
    }
    .typing i {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #9aab8f;
        animation: typing 1s ease-in-out infinite;
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
            opacity: 0.35;
            transform: translateY(0);
        }
        30% {
            opacity: 1;
            transform: translateY(-3px);
        }
    }
    form {
        display: flex;
        gap: 8px;
        padding: 10px 12px calc(env(safe-area-inset-bottom) + 12px);
        border-top: 1px solid #eef2ea;
    }
    input {
        flex: 1;
        min-width: 0;
        height: 44px;
        padding: 0 16px;
        border: 1px solid #d5dccf;
        border-radius: 22px;
        background: #f6f8f3;
        font: inherit;
        font-size: 16px; /* smaller zooms the page on iOS */
        color: #1f3a2b;
    }
    input:focus {
        outline: none;
        border-color: #0f6a73;
        background: white;
    }
    .send {
        display: grid;
        place-items: center;
        width: 44px;
        height: 44px;
        flex-shrink: 0;
        border-radius: 50%;
        background: #0f6a73;
        color: white;
        transition:
            transform 160ms cubic-bezier(0.23, 1, 0.32, 1),
            opacity 150ms;
    }
    .send:disabled {
        opacity: 0.35;
    }
    .send:active:not(:disabled) {
        transform: scale(0.94);
    }
    @media (hover: hover) and (pointer: fine) {
        .icon:hover {
            background: #eef3e8;
        }
        .suggestions button:hover {
            background: #f1f7f7;
        }
        .send:hover:not(:disabled) {
            background: #0d5d65;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .typing i {
            animation: none;
            opacity: 0.6;
        }
    }
</style>
