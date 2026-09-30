import { nextReveal, withEvent, type ChatMessage, type Replier, type ReplyContext, type ReplyEvent } from "./chat.ts";

/** A frame: text is revealed at most this often. */
const FRAME_MS = 16;

/** One conversation: the messages, and the reply being written. */
export class Chat {
  messages = $state<ChatMessage[]>([]);
  busy = $state(false);
  #abort: AbortController | null = null;
  #replier: Replier;

  constructor(replier: Replier) {
    this.#replier = replier;
  }

  async send(text: string, context: ReplyContext = {}) {
    const question = text.trim();
    if (!question || this.busy) return;
    this.messages.push({ role: "user", parts: [{ type: "text", text: question }] });
    const history = $state.snapshot(this.messages) as ChatMessage[];
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
  }
}
