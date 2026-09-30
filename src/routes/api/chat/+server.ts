import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { createHash } from "node:crypto";
import { json } from "@sveltejs/kit";
import { dev } from "$app/environment";
import { ConvexHttpClient } from "convex/browser";
import { env } from "$env/dynamic/private";
import { PUBLIC_CONVEX_URL } from "$env/static/public";
import { api } from "../../../convex/_generated/api";
import { normalize } from "$lib/wayfinding/search";
import { hospitalFor } from "$lib/server/hospital-cache";
import { messageText, type ChatMessage, type ReplyContext, type ReplyEvent } from "$lib/assistant/chat";
import { hospitalNow, reply, type ReplyInput } from "$lib/server/assistant";
import { replyZai, ZAI_BASE_URL, ZAI_MODEL } from "$lib/server/assistant-zai";

/** Limits on what a visitor's browser may send: a long conversation, not a document. */
const MAX_MESSAGES = 30,
  MAX_TEXT = 2000;

function valid(messages: unknown): messages is ChatMessage[] {
  return (
    Array.isArray(messages) &&
    messages.length > 0 &&
    messages.length <= MAX_MESSAGES &&
    messages.every(
      (m) =>
        (m?.role === "user" || m?.role === "assistant") &&
        Array.isArray(m.parts) &&
        m.parts.every(
          (p: { type?: string; text?: unknown; show?: { to?: unknown } }) =>
            (p?.type === "text" && typeof p.text === "string" && p.text.length <= MAX_TEXT) ||
            (p?.type === "card" && typeof p.show?.to === "string"),
        ),
    ) &&
    messages.at(-1).role === "user"
  );
}

/**
 * The model that answers, from the environment: GLM on Z.ai with
 * `ZAI_API_KEY`, else Claude with `ANTHROPIC_API_KEY`. `ASSISTANT_MODEL`
 * picks another model of that provider. Null when neither key is set.
 */
function assistant(): { model: string; run: (input: ReplyInput) => AsyncGenerator<ReplyEvent> } | null {
  if (env.ZAI_API_KEY) {
    const client = new OpenAI({ apiKey: env.ZAI_API_KEY, baseURL: env.ZAI_BASE_URL || ZAI_BASE_URL }),
      model = env.ASSISTANT_MODEL || ZAI_MODEL;
    return { model, run: (input) => replyZai(client, model, input) };
  }
  if (env.ANTHROPIC_API_KEY) {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }),
      model = env.ASSISTANT_MODEL || "claude-opus-5-5";
    return { model, run: (input) => reply(client, input, model) };
  }
  return null;
}

const encoder = new TextEncoder();
const line = (event: object) => encoder.encode(JSON.stringify(event) + "\n");
const NDJSON = { "content-type": "application/x-ndjson", "cache-control": "no-store" };

/**
 * The assistant's replies, streamed as one JSON event per line. Without an
 * API key it answers 503, and the app falls back to its built-in replies.
 */
export async function POST({ request, getClientAddress }) {
  const answer = assistant();
  if (!answer) return json({ error: "The assistant is not set up." }, { status: 503 });
  const body = await request.json().catch(() => null);
  if (!body || !valid(body.messages)) return json({ error: "Invalid conversation." }, { status: 400 });
  const context: ReplyContext = {
    ...(typeof body.context?.from === "string" && { from: body.context.from }),
    lang: body.context?.lang === "en" ? "en" : "id",
  };
  const slug = typeof body.slug === "string" ? body.slug : undefined;
  const convex = new ConvexHttpClient(PUBLIC_CONVEX_URL),
    secret = env.CHAT_LIMIT_SECRET;
  if (!secret && !dev) {
    // Never answer without limits in production.
    console.error("CHAT_LIMIT_SECRET is not set: the assistant stays off.");
    return json({ error: "The assistant is not set up." }, { status: 503 });
  }

  // The hospital as saved in the database, never what the browser sends; parsed once per version.
  const hospital = await hospitalFor(convex, slug);
  if (!hospital) return json({ error: "No such hospital." }, { status: 404 });

  // A conversation's first question, asked recently by someone else in the same spot, is answered
  // from the cache: instantly, and without counting against the limits or the model bill.
  const messages = body.messages as ChatMessage[];
  const cacheKey =
    secret && messages.length === 1
      ? createHash("sha256")
          .update(
            JSON.stringify([hospital.slug, hospital.revision, answer.model, context.lang, context.from ?? "", normalize(messageText(messages[0]))]),
          )
          .digest("hex")
      : null;
  if (secret && cacheKey) {
    const kept = await convex.query(api.answers.get, { secret, key: cacheKey });
    if (kept) return new Response(kept.map((e) => JSON.stringify(e) + "\n").join(""), { headers: NDJSON });
  }

  // Each question counts against the visitor's limits and the hospital's daily one (lib/assistant/limits.ts).
  if (secret) {
    // Anonymous: only a keyed hash of the address is stored.
    const visitor = createHash("sha256").update(`${secret}:${getClientAddress()}`).digest("hex").slice(0, 32);
    const limit = await convex.mutation(api.limits.take, { secret, visitor });
    if (!limit.ok)
      return json(
        { error: limit.everyone ? "The assistant is busy today." : "Too many questions.", retryAfter: Math.ceil(limit.retryAfterMs / 1000) },
        { status: 429, headers: { "retry-after": String(Math.ceil(limit.retryAfterMs / 1000)) } },
      );
  }

  const ctx = { ...hospital.map, now: hospitalNow(env.HOSPITAL_TIME_ZONE) };
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort());
  const stream = new ReadableStream({
    async start(controller) {
      const sent: ReplyEvent[] = [];
      try {
        for await (const event of answer.run({ title: hospital.title, faq: hospital.faq, ctx, messages, context, signal: abort.signal })) {
          controller.enqueue(line(event));
          if (event.type !== "status") sent.push(event);
        }
        // Kept for the next visitor who asks the same, when it is a whole answer.
        if (secret && cacheKey && sent.some((e) => e.type === "text" && e.text.trim()))
          await convex.mutation(api.answers.put, { secret, key: cacheKey, events: merged(sent) }).catch((err) => console.error("Could not keep the answer:", err));
      } catch (err) {
        if (!abort.signal.aborted) {
          console.error("Assistant reply failed:", err);
          controller.enqueue(line({ type: "error" }));
        }
      } finally {
        controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, { headers: NDJSON });
}

/** Text events joined into runs, so a kept answer is a few events, not one per word. */
function merged(events: ReplyEvent[]): ReplyEvent[] {
  const out: ReplyEvent[] = [];
  for (const e of events) {
    const last = out.at(-1);
    if (e.type === "text" && last?.type === "text") out[out.length - 1] = { type: "text", text: last.text + e.text };
    else out.push(e);
  }
  return out;
}
