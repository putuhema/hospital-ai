import { withEvent, type ChatMessage, type Replier, type ReplyContext } from "./chat.ts";

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
    try {
      for await (const event of this.#replier(history, context, abort.signal)) {
        if (abort.signal.aborted) break;
        this.messages[at] = withEvent(this.messages[at], event);
      }
    } catch {
      this.messages[at] = { ...this.messages[at], error: "failed" };
    } finally {
      if (this.#abort === abort) {
        this.#abort = null;
        this.busy = false;
      }
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
