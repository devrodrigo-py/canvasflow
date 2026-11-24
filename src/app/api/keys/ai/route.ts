import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createClient } from "@/lib/supabase/server";
import { encrypt, createKeyPreview } from "@/lib/crypto";
import { rateLimit } from "@/lib/rate-limit";
import { AI_PROVIDERS, NVIDIA_BASE_URL } from "@/lib/ai/providers-meta";

export const runtime = "nodejs";

type Db = SupabaseClient<Database>;

const aiKeyRequestSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  api_key: z.string().min(10),
  default_model: z.string().min(1).max(200),
});

const deleteSchema = z.object({
  workspace_id: z.string().uuid(),
  provider: z.enum(AI_PROVIDERS),
});

const testSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  api_key: z.string().min(10),
});

async function requireAdminOf(db: Db, workspaceId: string, userId: string) {
  const { data: member, error } = await db
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    return false;
  }
  return true;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const workspaceId = request.nextUrl.searchParams.get("workspace_id");
    if (!workspaceId) {
      return NextResponse.json({ error: "workspace_id é obrigatório" }, { status: 400 });
    }

    const db = supabase as unknown as Db;
    if (!(await requireAdminOf(db, workspaceId, user.id))) {
      return NextResponse.json({ error: "Apenas owners/admins podem ver chaves" }, { status: 403 });
    }

    // Nunca retorna encrypted_api_key / iv / auth_tag para o cliente
    const { data, error } = await db
      .from("ai_provider_keys")
      .select("id, provider, default_model, key_preview, is_active, created_at")
      .eq("workspace_id", workspaceId);
    if (error) throw error;

    return NextResponse.json({ keys: data ?? [] });
  } catch (error) {
    console.error("keys/ai GET:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const body = await request.json().catch(() => null);
    const parsed = aiKeyRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload inválido", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // workspace_id vem separado do corpo de chave
    const workspaceId = request.nextUrl.searchParams.get("workspace_id") ?? body.workspace_id;
    if (!workspaceId || typeof workspaceId !== "string") {
      return NextResponse.json({ error: "workspace_id é obrigatório" }, { status: 400 });
    }

    const db = supabase as unknown as Db;
    if (!(await requireAdminOf(db, workspaceId, user.id))) {
      return NextResponse.json({ error: "Apenas owners/admins podem cadastrar chaves" }, { status: 403 });
    }

    const { provider, api_key: apiKey, default_model: defaultModel } = parsed.data;
    const encrypted = encrypt(apiKey);

    // Apenas uma chave ativa por workspace (índice único parcial): desativa as demais
    const { error: deactivateError } = await db
      .from("ai_provider_keys")
      .update({ is_active: false })
      .eq("workspace_id", workspaceId)
      .neq("provider", provider);
    if (deactivateError) throw deactivateError;

    // Upsert por (workspace_id, provider) — a constraint unique cobre isso
    const { error } = await db.from("ai_provider_keys").upsert(
      {
        workspace_id: workspaceId,
        provider,
        default_model: defaultModel,
        encrypted_api_key: encrypted.encrypted,
        key_iv: encrypted.iv,
        key_auth_tag: encrypted.authTag,
        key_version: encrypted.version,
        key_preview: createKeyPreview(apiKey),
        is_active: true,
        created_by: user.id,
      },
      { onConflict: "workspace_id,provider" }
    );
    if (error) throw error;

    return NextResponse.json({ message: `Chave ${provider} configurada e criptografada (AES-256-GCM).` });
  } catch (error) {
    console.error("keys/ai POST:", error);
    return NextResponse.json({ error: "Erro interno ao salvar chave" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const body = await request.json().catch(() => null);
    const parsed = z
      .object({
        workspace_id: z.string().uuid(),
        provider: z.enum(AI_PROVIDERS),
        is_active: z.boolean(),
        default_model: z.string().min(1).optional(),
      })
      .safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload inválido", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const db = supabase as unknown as Db;
    const { workspace_id: workspaceId, provider, is_active: isActive, default_model: defaultModel } = parsed.data;
    if (!(await requireAdminOf(db, workspaceId, user.id))) {
      return NextResponse.json({ error: "Apenas owners/admins podem alterar chaves" }, { status: 403 });
    }

    if (isActive) {
      const { error: deactivateError } = await db
        .from("ai_provider_keys")
        .update({ is_active: false })
        .eq("workspace_id", workspaceId)
        .neq("provider", provider);
      if (deactivateError) throw deactivateError;
    }

    const update: { is_active: boolean; default_model?: string } = { is_active: isActive };
    if (defaultModel) update.default_model = defaultModel;

    const { error } = await db
      .from("ai_provider_keys")
      .update(update)
      .eq("workspace_id", workspaceId)
      .eq("provider", provider);
    if (error) throw error;

    return NextResponse.json({ message: "Chave atualizada." });
  } catch (error) {
    console.error("keys/ai PATCH:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const body = await request.json().catch(() => null);
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload inválido", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const db = supabase as unknown as Db;
    const { workspace_id: workspaceId, provider } = parsed.data;
    if (!(await requireAdminOf(db, workspaceId, user.id))) {
      return NextResponse.json({ error: "Apenas owners/admins podem remover chaves" }, { status: 403 });
    }

    const { error } = await db
      .from("ai_provider_keys")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("provider", provider);
    if (error) throw error;

    return NextResponse.json({ message: "Chave removida." });
  } catch (error) {
    console.error("keys/ai DELETE:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

/**
 * Testa a chave sem persistir (validate & return ok/error).
 */
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

    const limit = rateLimit(`key-test:${user.id}`, 10, 60_000);
    if (!limit.ok) {
      return NextResponse.json(
        { error: "Muitos testes de chave. Aguarde um minuto." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = testSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
    }

    // Teste leve: uma chamada mínima via fetch aos endpoints públicos de cada provider
    const { provider, api_key: apiKey } = parsed.data;
    let ok = false;
    let detail = "";

    try {
      if (provider === "anthropic") {
        const res = await fetch("https://api.anthropic.com/v1/models", {
          signal: AbortSignal.timeout(10_000),
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
        });
        ok = res.ok;
        detail = ok ? "Conectado" : `HTTP ${res.status}`;
      } else if (provider === "openai") {
        const res = await fetch("https://api.openai.com/v1/models", {
          signal: AbortSignal.timeout(10_000),
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        ok = res.ok;
        detail = ok ? "Conectado" : `HTTP ${res.status}`;
      } else if (provider === "nvidia") {
        const res = await fetch(`${NVIDIA_BASE_URL}/models`, {
          signal: AbortSignal.timeout(10_000),
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        ok = res.ok;
        detail = ok ? "Conectado" : `HTTP ${res.status}`;
      } else {
        // Google: valida chamando a listagem de modelos generativelanguage
        // Header em vez de query string: a chave não vaza em logs de URL
        const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
          signal: AbortSignal.timeout(10_000),
          headers: { "x-goog-api-key": apiKey },
        });
        ok = res.ok;
        detail = ok ? "Conectado" : `HTTP ${res.status}`;
      }
    } catch {
      detail = "Falha de rede ao contatar o provedor";
    }

    return NextResponse.json({ ok, detail });
  } catch (error) {
    console.error("keys/ai PUT:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
