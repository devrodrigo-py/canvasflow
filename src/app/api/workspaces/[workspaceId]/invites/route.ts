import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { generateInviteToken, sha256 } from "@/lib/crypto";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const inviteSchema = z.object({
  email: z.string().email().max(320).nullable().optional(),
  role: z.enum(["admin", "member", "viewer"]).default("member"),
  expires_in_days: z.number().int().min(1).max(30).default(7),
});

/**
 * Cria um link de convite de uso único. O token aparece uma única vez na
 * resposta; o banco guarda apenas o SHA-256. RLS garante que só owner/admin insere.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const limit = rateLimit(`invite:${user.id}`, 20, 60 * 60_000);
  if (!limit.ok) {
    return NextResponse.json({ error: "Limite de convites por hora atingido" }, { status: 429 });
  }

  const parsed = inviteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido", details: parsed.error.flatten() }, { status: 400 });
  }

  const token = generateInviteToken();
  const { error } = await supabase.from("workspace_invites").insert({
    workspace_id: workspaceId,
    email: parsed.data.email?.toLowerCase() ?? null,
    role: parsed.data.role,
    token_hash: sha256(token),
    created_by: user.id,
    expires_at: new Date(Date.now() + parsed.data.expires_in_days * 86_400_000).toISOString(),
  });

  if (error) {
    // 42501 = RLS: não é owner/admin deste workspace
    if (error.code === "42501") {
      return NextResponse.json({ error: "Apenas owners/admins podem convidar" }, { status: 403 });
    }
    console.error("invites POST:", error);
    return NextResponse.json({ error: "Erro interno ao criar convite" }, { status: 500 });
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin;
  return NextResponse.json({
    invite_url: `${origin}/invite/${token}`,
    message: "Convite criado. Copie o link agora — ele não será exibido novamente.",
  });
}
