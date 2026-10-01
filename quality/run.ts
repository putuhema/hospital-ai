/**
 * The assistant's quality check: asks GLM-5 the visitor questions in
 * questions.ts against the hospital as saved in the database, checks each
 * reply and writes a report to quality/results/. It calls the real model, so
 * it costs a little each run: run it on demand, after a prompt or model change.
 *
 *   pnpm quality              every question
 *   pnpm quality emergency    only questions whose id contains "emergency"
 *   pnpm quality --model=glm-4.5-air    another Z.ai model, to compare (GLM-5 by default)
 *
 * Needs ZAI_API_KEY and PUBLIC_CONVEX_URL in .env.local.
 */
import OpenAI from "openai";
import { mkdirSync, writeFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../src/convex/_generated/api.js";
import { parseLayout } from "../src/lib/model/layout.ts";
import { assistantContext, type AssistantContext } from "../src/lib/assistant/tools.ts";
import { localizeRooms } from "../src/lib/i18n/places.ts";
import { withEvent, messageText, type ChatMessage, type ReplyEvent } from "../src/lib/assistant/chat.ts";
import { replyZai, ZAI_BASE_URL, ZAI_MODEL } from "../src/lib/server/assistant-zai.ts";
import { cases, MONDAY, type Case } from "./questions.ts";

/** Questions asked at once; Z.ai limits how many run together. */
const PARALLEL = 3;
const TIMEOUT = 120_000;

const { ZAI_API_KEY, PUBLIC_CONVEX_URL } = process.env;
if (!ZAI_API_KEY || !PUBLIC_CONVEX_URL) {
  console.error("Set ZAI_API_KEY and PUBLIC_CONVEX_URL in .env.local.");
  process.exit(1);
}

// The hospital as visitors get it, with rooms named in each language (as hospital-cache.ts does).
const convex = new ConvexHttpClient(PUBLIC_CONVEX_URL);
const saved = await convex.query(api.hospital.get, {});
if (!saved) {
  console.error("No hospital is saved yet.");
  process.exit(1);
}
const layout = parseLayout(saved.layout);
const mapIn = (lang: "id" | "en", now: Date): AssistantContext =>
  assistantContext({ ...layout, pieces: localizeRooms(layout.pieces, lang) }, now);
const places = mapIn("id", new Date()).places;

/** Tokens Z.ai reports, when it does. */
const usage = { input: 0, output: 0 };
const client = new OpenAI({ apiKey: ZAI_API_KEY, baseURL: ZAI_BASE_URL });
/** The client, counting tokens and noting each tool the model calls (with its input) in `calls`. */
function watched(calls: string[]) {
  return {
    chat: {
      completions: {
        async create(...args: Parameters<typeof client.chat.completions.create>) {
          const stream = (await client.chat.completions.create(...args)) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
          return (async function* () {
            const round: { name: string; args: string }[] = [];
            for await (const chunk of stream) {
              if (chunk.usage) {
                usage.input += chunk.usage.prompt_tokens;
                usage.output += chunk.usage.completion_tokens;
              }
              for (const piece of chunk.choices[0]?.delta?.tool_calls ?? []) {
                const call = (round[piece.index] ??= { name: "", args: "" });
                call.name += piece.function?.name ?? "";
                call.args += piece.function?.arguments ?? "";
              }
              yield chunk;
            }
            calls.push(...round.map((c) => `${c.name} ${c.args}`));
          })();
        },
      },
    },
  } as unknown as OpenAI;
}

type Result = { c: Case; reply: string; shown: string[]; route: boolean; calls: string[]; problems: string[]; seconds: number };

const idsOf = (names: string[]) => places.filter((p) => names.includes(p.name)).map((p) => p.id);
const nameOf = (id: string) => places.find((p) => p.id === id)?.name ?? id;

/** Indonesian or English, by the everyday words the reply uses. */
function language(text: string): "id" | "en" {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const count = (list: string[]) => words.filter((w) => list.includes(w)).length;
  const id = count(["yang", "di", "dan", "ada", "tidak", "untuk", "anda", "bisa", "dengan", "ini", "ke", "dari", "silakan", "jam", "buka", "maaf", "saat", "hari"]),
    en = count(["the", "is", "and", "you", "to", "of", "are", "can", "please", "open", "at", "it", "for", "your", "sorry", "there", "today"]);
  return en > id ? "en" : "id";
}

async function ask(c: Case): Promise<Result> {
  const lang = c.lang ?? "id",
    started = Date.now();
  const ctx = mapIn(lang, new Date(c.at ?? MONDAY));
  const from = c.from && idsOf([c.from])[0];
  if (c.from && !from) throw Error(`${c.id}: no place called "${c.from}"`);
  const messages: ChatMessage[] = [],
    calls: string[] = [];
  let last: ChatMessage = { role: "assistant", parts: [] };
  for (const question of [c.ask].flat()) {
    messages.push({ role: "user", parts: [{ type: "text", text: question }] });
    last = { role: "assistant", parts: [] };
    const events: AsyncGenerator<ReplyEvent> = replyZai(watched(calls), model, {
      title: layout.title,
      faq: layout.faq,
      ctx,
      messages: [...messages],
      context: { lang, ...(from && { from }) },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    for await (const event of events) last = withEvent(last, event);
    messages.push(last);
  }
  const reply = messageText({ ...last, parts: last.parts.filter((p) => p.type === "text") }).trim();
  const cards = last.parts.flatMap((p) => (p.type === "card" ? [p.show] : []));
  const shown = cards.map((s) => s.to);
  const problems: string[] = [];

  // What every reply must do.
  if (!reply) problems.push("no text in the reply");
  // The chat shows **bold** and drops headings (format.ts); a table would show as raw text.
  if (/^\s*\|.*\|\s*$/m.test(reply)) problems.push("writes a table");
  if (/\b[bra]:\d{6,}|\?(to|from)=/.test(reply)) problems.push("writes a place id or link");
  // A promise to do it later; an offer asked as a question ("Mau saya carikan …?") is fine.
  if (/(mari|biar) saya (cari|cek|periksa)|saya (cari|cek|periksa)(kan)? (dulu|sebentar)|\b(let me|I'll|I will) (check|look|find|search|show)/i.test(reply))
    problems.push("promises a lookup it doesn't do");
  if (reply.length > (c.max ?? 450)) problems.push(`long reply (${reply.length} characters)`);
  if (reply && language(reply) !== lang) problems.push(`replies in ${language(reply) === "en" ? "English" : "Indonesian"}`);

  // What this question asks for.
  for (const re of c.say ?? []) if (!re.test(reply)) problems.push(`doesn't say ${re}`);
  for (const re of c.avoid ?? []) if (re.test(reply)) problems.push(`says ${re}: "${reply.match(re)![0]}"`);
  for (const names of c.show ?? []) {
    const ids = idsOf(names);
    if (!ids.length) throw Error(`${c.id}: no place called ${names.join(" or ")}`);
    if (!shown.some((id) => ids.includes(id))) problems.push(`doesn't show ${names.join(" or ")} on the map`);
  }
  const route = cards.some((s) => s.kind === "route");
  if (c.route && !route) problems.push("shows no route");
  return { c, reply, shown, route, calls, problems, seconds: (Date.now() - started) / 1000 };
}

const args = process.argv.slice(2),
  model = args.find((a) => a.startsWith("--model="))?.slice(8) || ZAI_MODEL,
  filter = args.find((a) => !a.startsWith("--"));
const chosen = filter ? cases.filter((c) => c.id.includes(filter)) : cases;
if (!chosen.length) {
  console.error(`No question id contains "${filter}".`);
  process.exit(1);
}
console.log(`Asking ${model} ${chosen.length} questions about ${layout.title} (revision ${saved.revision})…\n`);

const results: Result[] = [];
const queue = [...chosen];
await Promise.all(
  Array.from({ length: PARALLEL }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      let result: Result;
      try {
        result = await ask(c);
      } catch (err) {
        if (String(err).includes(`${c.id}:`)) throw err; // a mistake in questions.ts
        result = { c, reply: "", shown: [], route: false, calls: [], problems: [`failed: ${(err as Error).message}`], seconds: 0 };
      }
      results.push(result);
      console.log(`${result.problems.length ? "✗" : "✓"} ${c.id}${result.problems.length ? ` — ${result.problems.join("; ")}` : ""}`);
    }
  }),
);

results.sort((a, b) => chosen.indexOf(a.c) - chosen.indexOf(b.c));
const passed = results.filter((r) => !r.problems.length).length;
const slowest = Math.max(...results.map((r) => r.seconds));
const average = results.reduce((s, r) => s + r.seconds, 0) / results.length;
const tokens = usage.input ? `${usage.input.toLocaleString("en")} tokens in, ${usage.output.toLocaleString("en")} out` : "not reported";

const stamp = new Date().toISOString().slice(0, 16).replace(":", "-");
const report = [
  `# Assistant quality check — ${stamp.replace("T", " ")}`,
  "",
  `${model} · ${layout.title}, revision ${saved.revision} · **${passed} of ${results.length} passed**`,
  `Reply time: ${average.toFixed(1)} s average, ${slowest.toFixed(1)} s slowest · Tokens: ${tokens}`,
  "",
  ...results.map((r) => {
    const asked = [r.c.ask].flat().map((q) => `> ${q}`).join("\n>\n");
    const map = r.shown.length ? `${r.route ? "Route to" : "Map shows"}: ${r.shown.map(nameOf).join(", ")}` : "Map shows nothing";
    return [
      `## ${r.problems.length ? "✗" : "✓"} ${r.c.id}`,
      `*${r.c.why}* · ${r.c.lang ?? "id"}${r.c.at ? ` · ${r.c.at.replace("T", " ").slice(0, 16)}` : ""}${r.c.from ? ` · at ${r.c.from}` : ""} · ${r.seconds.toFixed(1)} s`,
      "",
      asked,
      "",
      r.reply || "(no reply)",
      "",
      map,
      "",
      `Tools: ${r.calls.length ? r.calls.map((c) => `\`${c}\``).join(", ") : "none"}`,
      ...(r.problems.length ? ["", ...r.problems.map((p) => `- **${p}**`)] : []),
      "",
    ].join("\n");
  }),
].join("\n");
mkdirSync("quality/results", { recursive: true });
const file = `quality/results/${stamp}-${model}${filter ? `-${filter}` : ""}.md`;
writeFileSync(file, report);

console.log(`\n${passed} of ${results.length} passed · ${average.toFixed(1)} s average reply · tokens ${tokens}`);
console.log(`Report: ${file}`);
