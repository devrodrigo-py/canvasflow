/**
 * Fonte única dos provedores BYOK suportados (usada no cliente e no servidor).
 * Para adicionar um provedor: inclua aqui, no enum ai_provider (migração) e
 * em getWorkspaceModel (src/lib/ai/provider.ts).
 */
export const AI_PROVIDERS = ["anthropic", "openai", "google", "nvidia"] as const;
export type AIProviderId = (typeof AI_PROVIDERS)[number];

export interface ProviderMeta {
  label: string;
  /** Primeiro item = modelo padrão sugerido. */
  models: string[];
  keyPlaceholder: string;
  docsUrl: string;
}

export const PROVIDER_META: Record<AIProviderId, ProviderMeta> = {
  anthropic: {
    label: "Anthropic (Claude)",
    models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
    keyPlaceholder: "sk-ant-...",
    docsUrl: "https://console.anthropic.com/settings/keys",
  },
  openai: {
    label: "OpenAI",
    models: ["gpt-5", "gpt-5-mini"],
    keyPlaceholder: "sk-...",
    docsUrl: "https://platform.openai.com/api-keys",
  },
  google: {
    label: "Google (Gemini)",
    models: ["gemini-3.8-flash", "gemini-3-flash-preview", "gemini-3.5-flash", "gemini-2.5-flash"],
    keyPlaceholder: "AIza...",
    docsUrl: "https://aistudio.google.com/apikey",
  },
  nvidia: {
    label: "NVIDIA Nemotron (build.nvidia.com)",
    // Só modelos Nemotron de chat (embedding e safety não geram texto). Ordem definida
    // por scripts/eval-ai-provider.mjs (5 schemas do app, modo tool, nov/2026):
    // Lightning 5/5 em ~3,6s; Bolt 5/5 em ~3,7s; Ultra 5/5 em ~23s (lento para as rotas
    // de 60s); Nano reasoning 5/5 em ~16s; Super VL 4/5.
    models: [
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-3.5-bolt-e4b",
      "nvidia/nemotron-3-ultra-550b-a55b",
      "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
      "nvidia/nemotron-3.5-super-vl-120b-a12b",
    ],
    keyPlaceholder: "nvapi-...",
    docsUrl: "https://build.nvidia.com",
  },
};

export const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
