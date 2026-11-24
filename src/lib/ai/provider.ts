import "server-only";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { decrypt } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AIProvider } from "@/types/domain";
import { AI_PROVIDERS, NVIDIA_BASE_URL, PROVIDER_META } from "@/lib/ai/providers-meta";

export class AIKeyNotFoundError extends Error {
  constructor() {
    super("Nenhuma chave de IA ativa para este workspace. Um admin pode configurar em Settings > Chaves de IA (BYOK).");
    this.name = "AIKeyNotFoundError";
  }
}

export class WorkspaceAccessError extends Error {
  constructor() {
    super("Você não tem permissão de escrita neste workspace");
    this.name = "WorkspaceAccessError";
  }
}

interface WorkspaceAIConfig {
  provider: AIProvider;
  model: LanguageModel;
  defaultModel: string;
}

/**
 * Modelos NVIDIA usam o modo "tool" do generateObject (structuredOutputs desligado).
 * Na avaliação (scripts/eval-ai-provider.mjs) o modo tool teve mais acertos que
 * json_schema na maioria dos Nemotron e não estourou timeout.
 */
const NVIDIA_MODEL_SETTINGS = { structuredOutputs: false };

/** Modelo padrão de cada provedor = primeiro da lista em PROVIDER_META. */
export const DEFAULT_MODELS = Object.fromEntries(
  AI_PROVIDERS.map((p) => [p, PROVIDER_META[p].models[0]])
) as Record<AIProvider, string>;

/**
 * Resolve a chave BYOK ativa do workspace e instancia o provider.
 *
 * O RLS de ai_provider_keys é restrito a owner/admin (correto: membros não
 * devem ver nem a chave cifrada). Por isso a leitura usa o service role,
 * mas SOMENTE depois de confirmar que o usuário é writer do workspace.
 */
export async function getWorkspaceModel(workspaceId: string, userId: string): Promise<WorkspaceAIConfig> {
  const admin = createAdminClient();

  const { data: member, error: memberError } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (memberError) throw memberError;
  if (!member || member.role === "viewer") throw new WorkspaceAccessError();

  const { data: keyRow, error } = await admin
    .from("ai_provider_keys")
    .select("provider, default_model, encrypted_api_key, key_iv, key_auth_tag, key_version")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!keyRow) throw new AIKeyNotFoundError();

  const apiKey = decrypt(keyRow.encrypted_api_key, keyRow.key_iv, keyRow.key_auth_tag, keyRow.key_version);
  const defaultModel = keyRow.default_model || DEFAULT_MODELS[keyRow.provider];

  let model: LanguageModel;
  switch (keyRow.provider) {
    case "anthropic":
      model = createAnthropic({ apiKey })(defaultModel);
      break;
    case "openai":
      model = createOpenAI({ apiKey })(defaultModel);
      break;
    case "google":
      model = createGoogleGenerativeAI({ apiKey })(defaultModel);
      break;
    case "nvidia":
      // API OpenAI-compatível; "compatible" evita parâmetros exclusivos da OpenAI
      model = createOpenAI({ apiKey, baseURL: NVIDIA_BASE_URL, compatibility: "compatible", name: "nvidia" })(
        defaultModel,
        NVIDIA_MODEL_SETTINGS
      );
      break;
    default:
      throw new Error(`Provider não suportado: ${keyRow.provider}`);
  }

  return { provider: keyRow.provider, model, defaultModel };
}
