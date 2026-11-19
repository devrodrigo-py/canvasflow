import "server-only";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { LanguageModel } from "ai";
import { decrypt } from "@/lib/crypto";
import { getWorkspaceBySlug } from "@/lib/services/tasks.service";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { AIProvider } from "@/types/domain";

type DbClient = SupabaseClient<Database>;

export class AIKeyNotFoundError extends Error {
  constructor() {
    super(
      "Nenhuma chave de IA configurada para este workspace. Configure em Settings > Chaves de IA (BYOK)."
    );
    this.name = "AIKeyNotFoundError";
  }
}

interface WorkspaceAIConfig {
  provider: AIProvider;
  model: LanguageModel;
  defaultModel: string;
}

const DEFAULT_MODELS: Record<AIProvider, string> = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4o",
  // Google descontinuou 2.5-flash para contas novas; o recomendado é 3.8
  google: "gemini-3.8-flash",
};

/**
 * Resolve a chave BYOK ativa do workspace, descriptografa no servidor
 * e instancia o provider correspondente do Vercel AI SDK.
 */
export async function getWorkspaceModel(
  db: DbClient,
  workspaceId: string
): Promise<WorkspaceAIConfig> {
  const { data: keyRow, error } = await db
    .from("ai_provider_keys")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  if (!keyRow) throw new AIKeyNotFoundError();

  const apiKey = decrypt(keyRow.encrypted_api_key, keyRow.key_iv, keyRow.key_auth_tag);
  const defaultModel = keyRow.default_model || DEFAULT_MODELS[keyRow.provider];

  let model: LanguageModel;
  switch (keyRow.provider) {
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey });
      model = anthropic(defaultModel);
      break;
    }
    case "openai": {
      const openai = createOpenAI({ apiKey });
      model = openai(defaultModel);
      break;
    }
    case "google": {
      const google = createGoogleGenerativeAI({ apiKey });
      model = google(defaultModel);
      break;
    }
    default:
      throw new Error(`Provider não suportado: ${keyRow.provider}`);
  }

  return { provider: keyRow.provider, model, defaultModel };
}

/**
 * Resolve o workspaceId a partir dos params de rota (/w/[workspaceSlug]/...).
 */
export async function resolveWorkspaceId(
  db: DbClient,
  workspaceSlug: string
): Promise<string> {
  const workspace = await getWorkspaceBySlug(db, workspaceSlug);
  if (!workspace) throw new Error("Workspace não encontrado");
  return workspace.id;
}
