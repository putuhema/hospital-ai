/**
 * Replies from the assistant on the server (Claude, see routes/api/chat),
 * streamed one event per line. When the server has no assistant set up it
 * answers 503, and replies come from `fallback` (the built-in canned ones);
 * over the question limit (429), that question is answered by `fallback` too,
 * as is a question asked without a connection.
 */
import type { Replier, ReplyEvent } from "./chat.ts";

export function serverReplier(
  body: () => { slug?: string },
  fallback: Replier,
  url = "/api/chat",
): Replier {
  let available = true;
  return async function* (messages, context, signal) {
    if (available) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages, context, ...body() }),
        signal,
      }).catch((err) => {
        // Offline: the built-in replies answer from the map on the phone.
        if (signal.aborted) throw err;
        return null;
      });
      if (res?.status === 503) available = false;
      else if (res && res.status !== 429) {
        if (!res.ok || !res.body) throw Error(`The assistant answered ${res.status}`);
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += value;
          const lines = buffer.split("\n");
          buffer = lines.pop()!;
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line) as ReplyEvent | { type: "error" };
            if (event.type === "error") throw Error("The assistant could not answer");
            yield event;
          }
        }
        return;
      }
    }
    yield* fallback(messages, context, signal);
  };
}
