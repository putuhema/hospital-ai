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
import { replyZai } from "$lib/server/assistant-zai";
import { resolveLlmConfig } from "$lib/server/llm-config";
import type { Lang } from "$lib/i18n/lang";
import { fresh } from "$lib/model/live";
import type { AssistantContext } from "$lib/assistant/tools";

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
          (p: { type?: string; text?: unknown; show?: { to?: unknown }; image?: { id?: unknown } }) =>
            (p?.type === "text" && typeof p.text === "string" && p.text.length <= MAX_TEXT) ||
            (p?.type === "card" && typeof p.show?.to === "string") ||
            // Only its id is read back (lib/server/assistant.ts `history`), never what the browser says it shows.
            (p?.type === "image" && typeof p.image?.id === "string"),
        ),
    ) &&
    messages.at(-1).role === "user"
  );
}

// Reuse SDK & Convex HTTP clients across requests for TCP/TLS keep-alive and lower TTFW.
let cachedOpenAI: { key: string; baseURL?: string; client: OpenAI } | null = null;
let cachedAnthropic: { key: string; baseURL?: string; client: Anthropic } | null = null;
let cachedConvex: ConvexHttpClient | null = null;
const getConvex = () => (cachedConvex ??= new ConvexHttpClient(PUBLIC_CONVEX_URL));

/**
 * The model that answers, resolved from unified `LLM_*` env vars (any
 * OpenAI-compatible provider or Anthropic) with legacy `ZAI_API_KEY` /
 * `ANTHROPIC_API_KEY` fallback. Null when no provider is configured.
 */
function assistant(): { model: string; run: (input: ReplyInput) => AsyncGenerator<ReplyEvent> } | null {
  const cfg = resolveLlmConfig(env);
  if (!cfg) return null;
  if (cfg.kind === "openai") {
    if (!cachedOpenAI || cachedOpenAI.key !== cfg.apiKey || cachedOpenAI.baseURL !== cfg.baseURL) {
      cachedOpenAI = {
        key: cfg.apiKey,
        baseURL: cfg.baseURL,
        client: new OpenAI({ apiKey: cfg.apiKey, ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}) }),
      };
    }
    const client = cachedOpenAI.client;
    return {
      model: `${cfg.provider}:${cfg.model}`,
      run: (input) => replyZai(client, cfg.model, input, { disableThinking: cfg.disableThinking }),
    };
  }
  if (!cachedAnthropic || cachedAnthropic.key !== cfg.apiKey || cachedAnthropic.baseURL !== cfg.baseURL) {
    cachedAnthropic = {
      key: cfg.apiKey,
      baseURL: cfg.baseURL,
      client: new Anthropic({ apiKey: cfg.apiKey, ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}) }),
    };
  }
  const client = cachedAnthropic.client;
  return { model: `anthropic:${cfg.model}`, run: (input) => reply(client, input, cfg.model) };
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
  const walking = body.context?.walking;
  const context: ReplyContext & { lang: Lang } = {
    ...(typeof body.context?.from === "string" && { from: body.context.from }),
    lang: body.context?.lang === "en" ? "en" : "id",
    // On the way along a route: where to, which step, how far is left.
    ...(walking &&
      typeof walking.to === "string" &&
      [walking.step, walking.total, walking.metersLeft].every((n) => Number.isFinite(n) && n >= 0 && n < 1e5) && {
        walking: {
          to: walking.to,
          step: walking.step,
          total: walking.total,
          metersLeft: walking.metersLeft,
          ...(typeof walking.next === "string" && walking.next.length <= 200 && { next: walking.next }),
        },
      }),
  };
  const slug = typeof body.slug === "string" ? body.slug : undefined;
  const convex = getConvex(),
    secret = env.CHAT_LIMIT_SECRET;
  if (!secret && !dev) {
    // Never answer without limits in production.
    console.error("CHAT_LIMIT_SECRET is not set: the assistant stays off.");
    return json({ error: "The assistant is not set up." }, { status: 503 });
  }

  // The hospital as saved in the database, never what the browser sends; parsed once per version.
  const hospital = await hospitalFor(convex, context.lang, slug);
  if (!hospital) return json({ error: "No such hospital." }, { status: 404 });

  // A conversation's first question — or a short follow-up anchored on the previous card — is answered
  // from the cache: instantly, and without counting against the limits or the model bill.
  const messages = body.messages as ChatMessage[];
  const latestText = messageText(messages.at(-1)!);
  const prevAssistant = messages.length >= 3 ? messages[messages.length - 2] : null;
  const prevCard =
    prevAssistant?.role === "assistant"
      ? prevAssistant.parts.findLast((p) => p.type === "card")
      : undefined;
  const isCacheableFollowUp =
    messages.length >= 3 &&
    messages.length <= 7 &&
    !!prevCard &&
    latestText.trim().length <= 64;

  // Record anonymous top-asked question for Hospital Hub analytics (never blocks chat).
  void convex
    .mutation(api.analytics.record, { slug: hospital.slug, kind: "chat", label: latestText })
    .catch(() => {});

  // Instant (<50ms) fast-path for exact matches to saved hospital FAQ questions (Indonesian).
  // Skips the LLM completely when the hospital already wrote the verbatim official answer.
  if (messages.length === 1 && !context.walking && context.lang === "id") {
    const normQ = normalize(latestText);
    const exactFaq = hospital.faq.find((e) => e.answer.trim() && normalize(e.question) === normQ);
    if (exactFaq) {
      return new Response(JSON.stringify({ type: "text", text: exactFaq.answer.trim() }) + "\n", { headers: NDJSON });
    }
  }

  // Asked on the way, an answer depends on where along it they are: never cached.
  const cacheKey =
    secret && !context.walking && (messages.length === 1 || isCacheableFollowUp)
      ? createHash("sha256")
          .update(
            JSON.stringify([
              hospital.slug,
              hospital.revision,
              hospital.schedules,
              hospital.leaflets,
              answer.model,
              context.lang,
              context.from ?? "",
              isCacheableFollowUp && prevCard ? `follow:${prevCard.show.kind}:${prevCard.show.to}` : "first",
              normalize(latestText),
            ]),
          )
          .digest("hex")
      : null;
  if (secret && cacheKey) {
    const kept = await convex.query(api.answers.get, { secret, key: cacheKey });
    if (kept) {
      // Still counted for the editor when the kept answer was one the assistant couldn't give.
      if (kept.missing) await noteGap(convex, secret, hospital.slug, kept.missing, messages);
      return new Response(kept.events.map((e) => JSON.stringify(e) + "\n").join(""), { headers: NDJSON });
    }
  }

  // Run rate-limit check and live SIMRS fetch in parallel to shave a full network round-trip before the LLM starts.
  const visitorHash = secret
    ? createHash("sha256").update(`${secret}:${getClientAddress()}`).digest("hex").slice(0, 32)
    : null;
  const [limit, liveRaw] = await Promise.all([
    secret && visitorHash ? convex.mutation(api.limits.take, { secret, visitor: visitorHash }) : Promise.resolve(null),
    convex.query(api.live.get, { slug: hospital.slug }).catch(() => null),
  ]);
  if (limit && !limit.ok)
    return json(
      { error: limit.everyone ? "The assistant is busy today." : "Too many questions.", retryAfter: Math.ceil(limit.retryAfterMs / 1000) },
      { status: 429, headers: { "retry-after": String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );

  // Today's queue and the beds from SIMRS, when the bridge at the hospital has reported lately.
  const live = fresh(liveRaw, Date.now());
  const ctx: AssistantContext = { ...hospital.map, now: hospitalNow(env.HOSPITAL_TIME_ZONE), live };
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
        // (An answer from the live figures is only true now.)
        if (secret && ctx.missing) await noteGap(convex, secret, hospital.slug, ctx.missing, messages);
        if (secret && cacheKey && !ctx.liveUsed && sent.some((e) => e.type === "text" && e.text.trim()))
          await convex
            .mutation(api.answers.put, { secret, key: cacheKey, events: merged(sent), ...(ctx.missing && { missing: ctx.missing }) })
            .catch((err) => console.error("Could not keep the answer:", err));
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

/**
 * The question the assistant couldn't answer, kept for the editor (lib/assistant/gaps.ts). Awaited, as a
 * serverless function may stop once it responds, but a failure never spoils the reply.
 */
function noteGap(convex: ConvexHttpClient, secret: string, slug: string, missing: { topic: string; subject: string }, messages: ChatMessage[]) {
  const question = messageText(messages.at(-1)!);
  return convex.mutation(api.gaps.note, { secret, slug, ...missing, question }).catch((err) => console.error("Could not note the question:", err));
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
