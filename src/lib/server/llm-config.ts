import { ZAI_BASE_URL, ZAI_MODEL } from "./assistant-zai.ts";

export type LlmConfig =
  | {
      kind: "openai";
      provider: string;
      apiKey: string;
      baseURL?: string;
      model: string;
      /** Only Z.ai GLM models accept `thinking: { type: "disabled" }`; other OpenAI-compatible APIs reject unknown fields. */
      disableThinking: boolean;
    }
  | {
      kind: "anthropic";
      provider: "anthropic";
      apiKey: string;
      baseURL?: string;
      model: string;
    };

type EnvLike = Record<string, string | undefined>;

const trim = (s?: string) => s?.trim() || undefined;

const isZai = (provider: string, baseURL?: string, model?: string) =>
  provider === "zai" ||
  provider === "z.ai" ||
  provider === "glm" ||
  !!(baseURL && /z\.ai|bigmodel\.cn/i.test(baseURL)) ||
  !!(model && /^glm/i.test(model));

/**
 * Resolve the LLM provider from unified `LLM_*` env vars first, then fall back
 * to legacy `ZAI_API_KEY` / `ANTHROPIC_API_KEY` / `ASSISTANT_MODEL`.
 *
 * Works with any OpenAI-compatible endpoint (OpenAI, OpenRouter, Groq,
 * DeepSeek, Together, Gemini OpenAI-compat, Z.ai, Ollama, vLLM, etc.) as well
 * as Anthropic Claude.
 */
export function resolveLlmConfig(env: EnvLike): LlmConfig | null {
  const provider = (trim(env.LLM_PROVIDER) ?? "").toLowerCase();
  const apiKey = trim(env.LLM_API_KEY);
  const baseURL = trim(env.LLM_BASE_URL);
  const model = trim(env.LLM_MODEL) ?? trim(env.ASSISTANT_MODEL);

  // 1. Unified LLM_* configuration
  if (apiKey || baseURL || provider) {
    if (provider === "anthropic" || provider === "claude") {
      const key = apiKey ?? trim(env.ANTHROPIC_API_KEY);
      if (!key) return null;
      return {
        kind: "anthropic",
        provider: "anthropic",
        apiKey: key,
        baseURL,
        model: model || "claude-sonnet-4-5",
      };
    }

    const zai = isZai(provider, baseURL, model);
    const key = apiKey ?? (zai ? trim(env.ZAI_API_KEY) : undefined) ?? (baseURL ? "local" : undefined);
    if (!key) return null;

    return {
      kind: "openai",
      provider: provider || (zai ? "zai" : "openai-compatible"),
      apiKey: key,
      baseURL: baseURL ?? (zai ? ZAI_BASE_URL : undefined),
      model: model || (zai ? ZAI_MODEL : "gpt-4o-mini"),
      disableThinking: zai,
    };
  }

  // 2. Legacy Z.ai fallback
  const zaiKey = trim(env.ZAI_API_KEY);
  if (zaiKey) {
    const zaiBase = trim(env.ZAI_BASE_URL) || ZAI_BASE_URL;
    return {
      kind: "openai",
      provider: "zai",
      apiKey: zaiKey,
      baseURL: zaiBase,
      model: model || ZAI_MODEL,
      disableThinking: true,
    };
  }

  // 3. Legacy Anthropic fallback
  const anthropicKey = trim(env.ANTHROPIC_API_KEY);
  if (anthropicKey) {
    return {
      kind: "anthropic",
      provider: "anthropic",
      apiKey: anthropicKey,
      model: model || "claude-opus-5-5",
    };
  }

  return null;
}
