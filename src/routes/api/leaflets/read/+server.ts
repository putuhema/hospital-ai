import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { json, type RequestHandler } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { signedIn } from "$lib/server/editor";
import { ZAI_BASE_URL } from "$lib/server/assistant-zai";
import { isLeafletUrl, MAX_LEAFLET_TEXT, MAX_LEAFLET_TITLE } from "$lib/model/leaflets";

/**
 * Reads an uploaded leaflet for the editor: a title and everything it says,
 * written out as text, which the admin checks before the assistant answers
 * from it. Uses Claude with `ANTHROPIC_API_KEY`, else a GLM vision model on
 * Z.ai (`ZAI_VISION_MODEL`, default glm-4.6v). Admins only.
 */

const PROMPT = `This image is a leaflet, brochure, poster or notice from a hospital in Indonesia. Write out what it says, for a hospital assistant that answers visitors' questions from it.

Reply with JSON only, no other text: {"title": "...", "text": "..."}
- title: a short name for the leaflet in Indonesian, e.g. "Alur pendaftaran pasien BPJS" (at most 80 characters).
- text: everything the leaflet says, in its own language and words: headings, steps in order (numbered), times, prices, requirements, phone numbers and addresses exactly as printed. Plain text, one item per line, no Markdown. Describe a diagram or flow in words. Leave out decoration and logos. If something can't be read, leave it out rather than guess.`;

/** The first JSON object in a model's reply. */
function parsed(reply: string): { title: string; text: string } | null {
  const match = reply.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const { title, text } = JSON.parse(match[0]) as { title?: unknown; text?: unknown };
    if (typeof text !== "string") return null;
    return {
      title: (typeof title === "string" ? title : "").trim().slice(0, MAX_LEAFLET_TITLE),
      text: text.trim().slice(0, MAX_LEAFLET_TEXT),
    };
  } catch {
    return null;
  }
}

async function readWithClaude(url: string) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 4000,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "url", url } },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  });
  return message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

async function readWithGlm(url: string) {
  const client = new OpenAI({ apiKey: env.ZAI_API_KEY, baseURL: env.ZAI_BASE_URL || ZAI_BASE_URL });
  const completion = await client.chat.completions.create({
    model: env.ZAI_VISION_MODEL || "glm-4.6v",
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url } },
          { type: "text", text: PROMPT },
        ],
      },
    ],
    ...({ thinking: { type: "disabled" } } as object),
  });
  return completion.choices[0]?.message.content ?? "";
}

export const POST: RequestHandler = async (event) => {
  if (!(await signedIn(event))?.editor) return json({ error: "Only admins can read leaflets." }, { status: 403 });
  const { url } = ((await event.request.json().catch(() => null)) ?? {}) as { url?: unknown };
  if (typeof url !== "string" || !isLeafletUrl(url)) return json({ error: "Not a leaflet image." }, { status: 400 });
  const read = env.ANTHROPIC_API_KEY ? readWithClaude : env.ZAI_API_KEY ? readWithGlm : null;
  if (!read) return json({ error: "Reading leaflets needs ANTHROPIC_API_KEY or ZAI_API_KEY." }, { status: 503 });
  try {
    const result = parsed(await read(url));
    if (!result) return json({ error: "The leaflet couldn't be read. Write its text by hand." }, { status: 422 });
    return json(result);
  } catch (err) {
    console.error("Reading a leaflet failed:", err);
    return json({ error: "The leaflet couldn't be read just now. Try again, or write its text by hand." }, { status: 502 });
  }
};
