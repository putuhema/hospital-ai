import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { createHash } from "node:crypto";
import { json } from "@sveltejs/kit";
import { dev } from "$app/environment";
import { ConvexHttpClient } from "convex/browser";
import { env } from "$env/dynamic/private";
import { PUBLIC_CONVEX_URL } from "$env/static/public";
import { api } from "../../../convex/_generated/api";
import { parseLayout } from "$lib/model/layout";
import { assistantContext } from "$lib/assistant/tools";
import type { ChatMessage, ReplyContext, ReplyEvent } from "$lib/assistant/chat";
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
function assistant(): ((input: ReplyInput) => AsyncGenerator<ReplyEvent>) | null {
  if (env.ZAI_API_KEY) {
    const client = new OpenAI({ apiKey: env.ZAI_API_KEY, baseURL: env.ZAI_BASE_URL || ZAI_BASE_URL });
    return (input) => replyZai(client, env.ASSISTANT_MODEL || ZAI_MODEL, input);
  }
  if (env.ANTHROPIC_API_KEY) {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    return (input) => reply(client, input, env.ASSISTANT_MODEL || undefined);
  }
  return null;
}

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
  const convex = new ConvexHttpClient(PUBLIC_CONVEX_URL);

  // Each question counts against the visitor's limits and the hospital's daily one (lib/assistant/limits.ts).
  const secret = env.CHAT_LIMIT_SECRET;
  if (secret) {
    // Anonymous: only a keyed hash of the address is stored.
    const visitor = createHash("sha256").update(`${secret}:${getClientAddress()}`).digest("hex").slice(0, 32);
    const limit = await convex.mutation(api.limits.take, { secret, visitor });
    if (!limit.ok)
      return json(
        { error: limit.everyone ? "The assistant is busy today." : "Too many questions.", retryAfter: Math.ceil(limit.retryAfterMs / 1000) },
        { status: 429, headers: { "retry-after": String(Math.ceil(limit.retryAfterMs / 1000)) } },
      );
  } else if (!dev) {
    // Never answer without limits in production.
    console.error("CHAT_LIMIT_SECRET is not set: the assistant stays off.");
    return json({ error: "The assistant is not set up." }, { status: 503 });
  }

  // The hospital as saved in the database, never what the browser sends.
  const hospital = await convex.query(api.hospital.get, slug ? { slug } : {});
  if (!hospital) return json({ error: "No such hospital." }, { status: 404 });
  const layout = parseLayout(hospital.layout);
  const ctx = assistantContext(layout, hospitalNow(env.HOSPITAL_TIME_ZONE));

  const encoder = new TextEncoder(),
    abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort());
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        for await (const event of answer({
          title: layout.title,
          faq: layout.faq,
          ctx,
          messages: body.messages,
          context,
          signal: abort.signal,
        }))
          send(event);
      } catch (err) {
        if (!abort.signal.aborted) {
          console.error("Assistant reply failed:", err);
          send({ type: "error" });
        }
      } finally {
        controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}
