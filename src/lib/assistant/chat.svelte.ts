import { nextReveal, withEvent, type ChatMessage, type Replier, type ReplyContext, type ReplyEvent } from "./chat.ts";

/** A frame: text is revealed at most this often. */
const FRAME_MS = 16;
/** Messages sent with a question: the recent conversation, within what the server takes. */
const CONTEXT = 20;
/** Messages kept for the browser session. */
const KEPT = 60;

/** One conversation: the messages, and the reply being written. */
export class Chat {
  messages = $state<ChatMessage[]>([]);
  busy = $state(false);
  #abort: AbortController | null = null;
  #replier: Replier;
  #key: string | null;

  /** With `key`, the conversation is kept in the browser session, so a reload doesn't lose it. */
  constructor(replier: Replier, key: string | null = null) {
    this.#replier = replier;
    this.#key = key;
  }

  /** Bring back the conversation kept for this session; call once the page is in the browser. */
  restore() {
    if (!this.#key || this.messages.length) return;
    try {
      const kept = JSON.parse(sessionStorage.getItem(this.#key) ?? "null");
      if (Array.isArray(kept)) this.messages = kept;
    } catch {}
  }

  #keep() {
    if (!this.#key) return;
    try {
      const done = ($state.snapshot(this.messages) as ChatMessage[])
        .filter((m) => m.parts.length || m.error)
        .map(({ status: _, ...m }) => m)
        .slice(-KEPT);
      if (done.length) sessionStorage.setItem(this.#key, JSON.stringify(done));
      else sessionStorage.removeItem(this.#key);
    } catch {}
  }

  async send(text: string, context: ReplyContext = {}) {
    const question = text.trim();
    if (!question || this.busy) return;
    this.messages.push({ role: "user", parts: [{ type: "text", text: question }] });
    // The recent conversation, starting with a question.
    const history = ($state.snapshot(this.messages) as ChatMessage[]).slice(-CONTEXT);
    while (history[0]?.role === "assistant") history.shift();
    this.messages.push({ role: "assistant", parts: [] });
    const at = this.messages.length - 1,
      abort = (this.#abort = new AbortController());
    this.busy = true;

    // Events are read as they arrive and shown at a readable pace (see `nextReveal`).
    const queue: ReplyEvent[] = [];
    let finished = false,
      failed = false,
      wake = () => {};
    const woken = () => new Promise<void>((resolve) => (wake = resolve));
    const reading = (async () => {
      try {
        for await (const event of this.#replier(history, context, abort.signal)) {
          if (abort.signal.aborted) break;
          queue.push(event);
          wake();
        }
      } catch {
        failed = !abort.signal.aborted;
      } finally {
        finished = true;
        wake();
      }
    })();
    const show = (event: ReplyEvent) => (this.messages[at] = withEvent(this.messages[at], event));

    while (!abort.signal.aborted) {
      const event = nextReveal(queue);
      if (!event) {
        if (finished) break;
        await woken();
        continue;
      }
      show(event);
      if (event.type === "text" && queue.some((e) => e.type === "text"))
        await new Promise((resolve) => setTimeout(resolve, FRAME_MS));
    }
    // Stopped: what has arrived stays, shown at once.
    for (let event = nextReveal(queue); event; event = nextReveal(queue)) show(event);
    await reading;
    if (failed) this.messages[at] = { ...this.messages[at], error: "failed" };
    if (this.messages[at].status) this.messages[at] = withEvent(this.messages[at], { type: "text", text: "" });
    if (this.#abort === abort) {
      this.#abort = null;
      this.busy = false;
    }
    this.#keep();
  }

  /** Stop the reply being written; what has arrived stays. */
  stop() {
    this.#abort?.abort();
    this.#abort = null;
    this.busy = false;
  }

  clear() {
    this.stop();
    this.messages = [];
    this.#keep();
  }
}
