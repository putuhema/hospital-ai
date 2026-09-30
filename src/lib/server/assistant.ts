/**
 * The hospital assistant on Claude. It answers from the same tools the app
 * uses (tools.ts) and from the hospital's questions & answers, and streams
 * back the events the chat shows: text as it is written, and a card for each
 * place or route it shows on the map.
 */
import Anthropic from "@anthropic-ai/sdk";
import { answered, topicOf, topics, type FaqEntry } from "../model/faq.ts";
import { placeTypes, runTool, toolDefinitions, type AssistantContext, type MapSelection } from "../assistant/tools.ts";
import { messageText, type ChatMessage, type ReplyContext, type ReplyEvent } from "../assistant/chat.ts";
import { typeName } from "../i18n/places.ts";

const MODEL = "claude-opus-5-5";
/** Tool rounds in one reply; a question needs two or three. */
export const MAX_ROUNDS = 8;

/** Streamed with every tool, so inputs arrive as written; each is checked before it runs (see `runTool`). */
const tools: Anthropic.Beta.BetaTool[] = toolDefinitions.map((t) => ({ ...t, eager_input_streaming: true }));

/** What doesn't change between questions, so it is cached: who the assistant is and what the hospital wrote. */
export function systemPrompt(title: string, faq: FaqEntry[], ctx: AssistantContext): string {
  const info = answered(faq)
    .map((e) => `[${topics.find((t) => t.id === topicOf(e))!.name.id}] T: ${e.question}\nJ: ${e.answer}`)
    .join("\n\n");
  return `You are the guide (Pemandu arah) of ${title}, answering visitors in the hospital's wayfinding app. The app shows a 3D map of the hospital beside the chat; visitors are usually on their phones, often worried or in a hurry.

Language: reply in the visitor's language: Indonesian, or English if they write in English. If they write in a regional language, reply in Indonesian.

Facts come only from your tools and from the hospital information below. Never guess a place, opening hours, a phone number, a doctor, a fee or a rule. When you can't find something, say so plainly and suggest the information desk (bagian informasi).

Showing the way: whenever you mention a place the visitor wants to go to, call show_on_map, with from_place_id when you know where they are; the app shows it as a card with a button. Don't write ids or links in your reply. For doctors, use get_doctor_schedule; when you show their clinic, pass doctor_name so the card shows their schedule.

Call the tools you need first, then write your reply once. Keep it short and plain: one to three sentences, no Markdown (no asterisks, headings or tables). A few doctors or places may go on separate lines starting with "- ".

Health: don't diagnose or give medical advice. For an emergency (chest pain, heavy bleeding, fainting, trouble breathing, an accident), tell them to go to the emergency department (IGD) straight away and show it on the map.

Lines in [square brackets] in earlier replies record what the app showed; don't write them yourself.

Kinds of place on this map: ${placeTypes(ctx).join(", ") || "none yet"}.

Hospital information (questions and answers written by the hospital):
${info || "None yet."}`;
}

/** Where the visitor is and the time at the hospital, sent with each question. */
export function situation(ctx: AssistantContext, context: ReplyContext): string {
  const at = context.from && ctx.places.find((p) => p.id === context.from);
  const when = ctx.now.toLocaleString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return [
    `Now at the hospital: ${when}.`,
    at
      ? `The visitor is at ${at.name}${at.building && at.building !== at.name ? `, ${at.building}` : ""} (place id ${at.id}).`
      : "The visitor hasn't said where they are.",
    `The app is in ${context.lang === "en" ? "English" : "Indonesian"}.`,
  ].join(" ");
}

/** The conversation so far, as the API takes it; a card becomes a note of what was shown. */
export function history(messages: ChatMessage[], ctx: AssistantContext): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of messages) {
    let text = messageText(m).trim();
    if (m.role === "assistant")
      for (const part of m.parts)
        if (part.type === "card") {
          const p = ctx.places.find((x) => x.id === part.show.to);
          if (p) text += `\n[shown on the map: ${p.name}, ${typeName(p.detail, "en")}, place id ${p.id}]`;
        }
    if (text) out.push({ role: m.role, content: text });
  }
  // The API starts with the visitor.
  while (out[0]?.role === "assistant") out.shift();
  return out;
}

/**
 * Run the tools the model called. Each result goes back to the model as JSON
 * (problems as `{ error }`); each place shown on the map becomes a card, once per reply.
 */
export function runCalls(
  ctx: AssistantContext,
  calls: { id: string; name: string; input: unknown }[],
  shown: Set<string>,
): { results: { id: string; content: string; failed: boolean }[]; cards: ReplyEvent[] } {
  const results: { id: string; content: string; failed: boolean }[] = [],
    cards: ReplyEvent[] = [];
  for (const call of calls) {
    const result = runTool(ctx, call.name, call.input);
    const failed = "error" in result;
    results.push({ id: call.id, content: JSON.stringify(result), failed });
    if (call.name !== "show_on_map" || failed) continue;
    const show = (result as { show: MapSelection }).show,
      doctor = (call.input as { doctor_name?: unknown }).doctor_name;
    if (shown.has(show.link)) continue;
    shown.add(show.link);
    cards.push({ type: "card", show, ...(typeof doctor === "string" && doctor && { doctor }) });
  }
  return { results, cards };
}

/** While the model reads what the tools found: what it looked up, for the chat to say ("Melihat jadwal dokter…"). */
export function* lookingUp(calls: { name: string }[]): Generator<ReplyEvent> {
  const tool = calls.findLast((c) => c.name !== "show_on_map") ?? calls.at(-1);
  if (tool) yield { type: "status", tool: tool.name };
}

export const SORRY = {
  id: "Maaf, saya tidak bisa membantu dengan itu. Silakan tanya ke bagian informasi.",
  en: "Sorry, I can't help with that. Please ask at the information desk.",
};

/** What a reply needs, whichever model writes it. */
export type ReplyInput = {
  title: string;
  faq: FaqEntry[];
  ctx: AssistantContext;
  messages: ChatMessage[];
  context: ReplyContext;
  signal: AbortSignal;
};

/** One reply: Claude calls the tools until it can answer, and the text and cards stream out as they come. */
export async function* reply(
  client: Anthropic,
  { title, faq, ctx, messages, context, signal }: ReplyInput,
  model = MODEL,
): AsyncGenerator<ReplyEvent> {
  const convo: Anthropic.Beta.BetaMessageParam[] = [
    ...history(messages, ctx),
    // After the question, so the cached prefix (tools, system prompt, earlier turns) stays the same.
    { role: "system", content: situation(ctx, context) },
  ];
  const system = systemPrompt(title, faq, ctx);
  const shown = new Set<string>();
  let wrote = false,
    retries = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const stream = client.beta.messages.stream(
      {
        model,
        max_tokens: 64000,
        // Everyday questions: quick answers matter more than long deliberation.
        output_config: { effort: "low" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        tools,
        messages: convo,
      },
      { signal },
    );
    let message: Anthropic.Beta.BetaMessage;
    try {
      let started = false;
      for await (const event of stream)
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          // Text from a later round starts a new paragraph.
          if (!started && wrote) yield { type: "text", text: "\n\n" };
          started = wrote = true;
          yield { type: "text", text: event.delta.text };
        }
      message = await stream.finalMessage();
      retries = 0;
    } catch (err) {
      // Only a tool input that couldn't be read at all is retried; API errors and cancelling go up.
      if (err instanceof Anthropic.APIError || signal.aborted || retries++ >= 2) throw err;
      continue;
    }

    if (message.stop_reason === "refusal") {
      if (!wrote) yield { type: "text", text: SORRY[context.lang ?? "id"] };
      return;
    }
    const calls = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (message.stop_reason === "pause_turn") {
      convo.push({ role: "assistant", content: message.content });
      continue;
    }
    // A tool input cut off at the token limit can look complete; never run it.
    if (!calls.length || message.stop_reason === "max_tokens") return;

    convo.push({ role: "assistant", content: message.content });
    const { results, cards } = runCalls(ctx, calls, shown);
    yield* cards;
    yield* lookingUp(calls);
    convo.push({
      role: "user",
      content: results.map((r) => ({
        type: "tool_result" as const,
        tool_use_id: r.id,
        content: r.content,
        ...(r.failed && { is_error: true }),
      })),
    });
  }
}

/** The time at the hospital, as a date whose local fields read it (the tools read hours and minutes). */
export function hospitalNow(timeZone?: string): Date {
  if (!timeZone) return new Date();
  return new Date(new Date().toLocaleString("en-US", { timeZone }));
}
