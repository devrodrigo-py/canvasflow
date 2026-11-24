import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createClient } from "@/lib/supabase/server";
import { sha256, generateToken } from "@/lib/crypto";
import { mcpTokenRequestSchema } from "@/lib/ai/schemas";

export const runtime = "nodejs";

type Db = SupabaseClient<Database>;

async function requireAdminOf(db: Db, workspaceId: string, userId: string) {
  const { data: member, error } = await db
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(member && (member.role === "owner" || member.role === "admin"));
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
      return NextResponse.json({ error: "Apenas owners/admins podem ver tokens" }, { status: 403 });
    }

    const { data, error } = await db
      .from("agent_tokens")
      .select(
        "id, name, actor_label, token_prefix, scopes, allow_direct_done, project_id, last_used_at, revoked_at, expires_at, created_at"
      )
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    return NextResponse.json({ tokens: data ?? [] });
  } catch (error) {
    console.error("mcp-tokens GET:", error);
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
    const parsed = mcpTokenRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload inválido", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const workspaceId = request.nextUrl.searchParams.get("workspace_id") ?? body.workspace_id;
    if (!workspaceId || typeof workspaceId !== "string") {
      return NextResponse.json({ error: "workspace_id é obrigatório" }, { status: 400 });
    }

    const db = supabase as unknown as Db;
    if (!(await requireAdminOf(db, workspaceId, user.id))) {
      return NextResponse.json({ error: "Apenas owners/admins podem criar tokens" }, { status: 403 });
    }

    const {
      name,
      actor_label: actorLabel,
      project_id: projectId,
      scopes,
      allow_direct_done: allowDirectDone,
      expires_in_days: expiresInDays,
    } = parsed.data;

    // O projeto restrito precisa pertencer ao mesmo workspace do token
    if (projectId) {
      const { data: project } = await db
        .from("projects")
        .select("id")
        .eq("id", projectId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (!project) {
        return NextResponse.json({ error: "Projeto não pertence a este workspace" }, { status: 400 });
      }
    }

    // Token exibido uma única vez; apenas o hash é persistido
    const token = generateToken();
    const { data, error } = await db
      .from("agent_tokens")
      .insert({
        workspace_id: workspaceId,
        project_id: projectId ?? null,
        name,
        actor_label: actorLabel,
        token_hash: sha256(token),
        token_prefix: token.slice(0, 12),
        scopes,
        allow_direct_done: allowDirectDone,
        expires_at: expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000).toISOString() : null,
        created_by: user.id,
      })
      .select("id")
      .single();
    if (error) throw error;

    return NextResponse.json({
      id: data.id,
      // Exibido uma única vez
      token,
      message: "Token criado. Copie agora — ele não será exibido novamente.",
    });
  } catch (error) {
    console.error("mcp-tokens POST:", error);
    return NextResponse.json({ error: "Erro interno ao criar token" }, { status: 500 });
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
    const parsed = z
      .object({
        workspace_id: z.string().uuid(),
        token_id: z.string().uuid(),
      })
      .safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload inválido", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const db = supabase as unknown as Db;
    const { workspace_id: workspaceId, token_id: tokenId } = parsed.data;
    if (!(await requireAdminOf(db, workspaceId, user.id))) {
      return NextResponse.json({ error: "Apenas owners/admins podem revogar tokens" }, { status: 403 });
    }

    const { error } = await db
      .from("agent_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", tokenId)
      .eq("workspace_id", workspaceId)
      .is("revoked_at", null);
    if (error) throw error;

    return NextResponse.json({ message: "Token revogado." });
  } catch (error) {
    console.error("mcp-tokens DELETE:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
