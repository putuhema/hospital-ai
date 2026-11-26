/**
 * The hospital assistant on GLM from Z.ai, through its OpenAI-compatible API
 * (https://api.z.ai/api/paas/v4). Same tools, prompt and events as the Claude
 * version in assistant.ts; only the model call differs.
 */
import OpenAI from "openai";
import { toolDefinitions } from "../assistant/tools.ts";
import type { ReplyEvent } from "../assistant/chat.ts";
import { history, lookingUp, MAX_ROUNDS, QUIET, runCalls, situation, SORRY, systemPrompt, type ReplyInput } from "./assistant.ts";

export const ZAI_BASE_URL = "https://api.z.ai/api/paas/v4/";
export const ZAI_MODEL = "glm-5";

const tools: OpenAI.Chat.Completions.ChatCompletionFunctionTool[] = toolDefinitions.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.input_schema },
}));

/** Sentences saying the question was noted for the hospital ("Saya sudah mencatat ini …", "I've noted this …"), taken out. */
export function withoutNoteMention(text: string): string {
  return text
    .replace(/[^.!?\n\s][^.!?\n]*\b(men)?catat(nya|kan)?\b[^.!?\n]*[.!?]?/gi, "")
    .replace(/[^.!?\n\s][^.!?\n]*\b(noted|made a note|passed (this|it) on)\b[^.!?\n]*[.!?]?/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n|\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** One reply: an OpenAI-compatible model (Z.ai GLM, OpenAI, OpenRouter, Groq, etc.) calls tools until it can answer. */
export async function* replyZai(
  client: OpenAI,
  model: string,
  { title, faq, ctx, messages, context, signal }: ReplyInput,
  options?: { disableThinking?: boolean },
): AsyncGenerator<ReplyEvent> {
  const disableThinking = options?.disableThinking ?? /^glm/i.test(model);
  const convo: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt(title, faq, ctx) },
    ...history(messages, ctx).map((m) => ({ role: m.role as "user" | "assistant", content: m.content as string })),
    // After the question, so everything before it stays the same between questions and providers reuse prompt caches.
    { role: "system", content: situation(ctx, context) },
  ];
  const shown = new Set<string>();
  let wrote = false;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const stream = await client.chat.completions.create(
      {
        model,
        messages: convo,
        tools,
        tool_choice: "auto",
        stream: true,
        // Z.ai's own option: answer straight away rather than reasoning first; omitted for other OpenAI-compatible APIs.
        ...(disableThinking ? ({ thinking: { type: "disabled" } } as object) : {}),
      },
      { signal },
    );
    let text = "",
      streamed = "",
      finish: string | null = null;
    const calls: { id: string; name: string; args: string }[] = [];
    // Text streams out word by word as it arrives, so the first words show while
    // the model is still writing. In the first round only once a whole sentence
    // is written and more follows: a lone sentence there may just announce a
    // lookup ("Saya cari apoteknya …"), which is dropped. Held back from the
    // first sign of a written-out tool note ("[show_on_map …]") or of "I noted
    // this for the hospital", which are cleaned up once the round is complete.
    const UNSAFE_PREFIX = /\[|catat|noted|made a note|passed (this|it) on/i;

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;
      if (choice.delta?.content) {
        text += choice.delta.content;
        if (!calls.length && !UNSAFE_PREFIX.test(text) && (round > 0 || /[.!?]\s+\S/.test(text))) {
          const pending = text.slice(streamed.length);
          // Hold a tiny tail if the chunk ends mid-bracket or mid-word near "catat"/"noted".
          const safeEnd = pending.lastIndexOf(" ");
          if (safeEnd > 0) {
            const out = pending.slice(0, safeEnd + 1);
            if (!streamed && wrote) yield { type: "text", text: "\n\n" };
            wrote = true;
            streamed += out;
            yield { type: "text", text: out };
          }
        }
      }
      // Tool calls arrive in pieces, by index.
      for (const piece of choice.delta?.tool_calls ?? []) {
        const call = (calls[piece.index] ??= { id: "", name: "", args: "" });
        if (piece.id) call.id = piece.id;
        if (piece.function?.name) call.name += piece.function.name;
        if (piece.function?.arguments) call.args += piece.function.arguments;
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }

    // Z.ai stops with "sensitive" when its content filter declines.
    if ((finish as string) === "sensitive") {
      if (!wrote) yield { type: "text", text: SORRY[context.lang ?? "id"] };
      return;
    }
    // GLM sometimes writes a tool call out as a note ("[show_on_map: place r:…]") instead of making it.
    text = text.replace(/^[ \t]*\[(show_on_map|show_leaflet|shown on the map|shown in the chat)\b[^\]\n]*\][ \t]*$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
    // The note to the hospital is not the visitor's business, though GLM likes to say it made one.
    if (calls.some((c) => c.name === "note_missing_info")) text = withoutNoteMention(text);
    const announcing = calls.some((c) => !QUIET.has(c.name));
    if (streamed) {
      // What was held back, cleaned. (The cleanup trims, so the streamed trailing space may be gone.)
      const shownSoFar = streamed.trimEnd();
      const rest = text.startsWith(streamed)
        ? text.slice(streamed.length)
        : text.startsWith(shownSoFar)
          ? text.slice(shownSoFar.length).replace(/^[ \t]+/, "")
          : "";
      if (rest.trim()) yield { type: "text", text: rest };
    } else if (text.trim() && !announcing) {
      if (wrote) yield { type: "text", text: "\n\n" };
      wrote = true;
      yield { type: "text", text };
    }
    // Done, or a tool call cut off at the token limit, which must not run.
    if (!calls.length || finish === "length") return;

    convo.push({
      role: "assistant",
      content: (!announcing && text) || null,
      tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args } })),
    });
    const parsed = calls.map((c) => {
      try {
        return { id: c.id, name: c.name, input: JSON.parse(c.args || "{}") as unknown };
      } catch {
        return { id: c.id, name: c.name, input: null, bad: c.args };
      }
    });
    // After a lookup, a reply the visitor has already read is the answer: show
    // what it puts on screen and stop, rather than look up more and answer twice.
    if (round > 0 && streamed.trim()) {
      yield* runCalls(
        ctx,
        parsed.filter((c) => !("bad" in c) && QUIET.has(c.name)),
        shown,
      ).cards;
      return;
    }
    const { results, cards } = runCalls(
      ctx,
      parsed.filter((c) => !("bad" in c)),
      shown,
    );
    yield* cards;
    // GLM may write its answer alongside the show_on_map (show_leaflet, note_missing_info) calls; asking again would only repeat it.
    if (text.trim() && calls.every((c) => QUIET.has(c.name))) return;
    yield* lookingUp(calls);
    for (const c of parsed)
      convo.push({
        role: "tool",
        tool_call_id: c.id,
        content:
          "bad" in c
            ? JSON.stringify({ error: "The arguments were not valid JSON.", INVALID_JSON: c.bad })
            : results.find((r) => r.id === c.id)!.content,
      });
  }
}
