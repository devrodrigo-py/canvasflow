import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { displayNameFor } from "@/lib/workspace";

export const runtime = "nodejs";

/**
 * Lista membros com email/nome. Emails vivem em auth.users (inacessível pelo
 * client), então a leitura usa o service role APÓS confirmar via RLS que o
 * solicitante é membro do workspace.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  // RLS: só retorna linhas se o usuário for membro
  const { data: members, error } = await supabase
    .from("workspace_members")
    .select("user_id, role, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at");
  if (error) {
    console.error("members GET:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
  if (!members?.some((m) => m.user_id === user.id)) {
    return NextResponse.json({ error: "Workspace não encontrado" }, { status: 404 });
  }

  const admin = createAdminClient();
  const enriched = await Promise.all(
    members.map(async (m) => {
      const { data } = await admin.auth.admin.getUserById(m.user_id);
      return {
        user_id: m.user_id,
        role: m.role,
        joined_at: m.created_at,
        email: data.user?.email ?? null,
        name: data.user ? displayNameFor(data.user) : "Usuário removido",
      };
    })
  );

  return NextResponse.json({ members: enriched });
}
