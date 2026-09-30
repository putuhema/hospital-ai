/**
 * The hospital assistant on GLM from Z.ai, through its OpenAI-compatible API
 * (https://api.z.ai/api/paas/v4). Same tools, prompt and events as the Claude
 * version in assistant.ts; only the model call differs.
 */
import OpenAI from "openai";
import { toolDefinitions } from "../assistant/tools.ts";
import type { ReplyEvent } from "../assistant/chat.ts";
import { history, lookingUp, MAX_ROUNDS, runCalls, situation, SORRY, systemPrompt, type ReplyInput } from "./assistant.ts";

export const ZAI_BASE_URL = "https://api.z.ai/api/paas/v4/";
export const ZAI_MODEL = "glm-5";

const tools: OpenAI.Chat.Completions.ChatCompletionFunctionTool[] = toolDefinitions.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.input_schema },
}));

/** One reply: GLM calls the tools until it can answer, and the text and cards stream out as they come. */
export async function* replyZai(
  client: OpenAI,
  model: string,
  { title, faq, ctx, messages, context, signal }: ReplyInput,
): AsyncGenerator<ReplyEvent> {
  const convo: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt(title, faq, ctx) },
    ...history(messages, ctx).map((m) => ({ role: m.role as "user" | "assistant", content: m.content as string })),
    // After the question, so everything before it stays the same between questions and Z.ai reuses it from its cache.
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
        // Z.ai's own option: answer straight away rather than reasoning first, as a chat should.
        ...({ thinking: { type: "disabled" } } as object),
      },
      { signal },
    );
    let text = "",
      finish: string | null = null,
      started = false;
    const calls: { id: string; name: string; args: string }[] = [];
    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;
      if (choice.delta?.content) {
        // Text from a later round starts a new paragraph.
        if (!started && wrote) yield { type: "text", text: "\n\n" };
        started = wrote = true;
        text += choice.delta.content;
        yield { type: "text", text: choice.delta.content };
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
    // Done, or a tool call cut off at the token limit, which must not run.
    if (!calls.length || finish === "length") return;

    convo.push({
      role: "assistant",
      content: text || null,
      tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args } })),
    });
    const parsed = calls.map((c) => {
      try {
        return { id: c.id, name: c.name, input: JSON.parse(c.args || "{}") as unknown };
      } catch {
        return { id: c.id, name: c.name, input: null, bad: c.args };
      }
    });
    const { results, cards } = runCalls(
      ctx,
      parsed.filter((c) => !("bad" in c)),
      shown,
    );
    yield* cards;
    // GLM may write its answer alongside the show_on_map calls; asking again would only repeat it.
    if (text.trim() && calls.every((c) => c.name === "show_on_map")) return;
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
