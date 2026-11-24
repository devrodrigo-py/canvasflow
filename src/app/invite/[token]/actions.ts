"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { sha256 } from "@/lib/crypto";

/**
 * Aceita o convite. Roda como Server Action (POST com verificação de origem do
 * Next), então um site externo não consegue fazer o usuário entrar num
 * workspace apenas induzindo uma navegação GET.
 */
export async function acceptInviteAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(token)) {
    redirect("/");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);

  const { data, error } = await supabase.rpc("accept_workspace_invite", { p_token_hash: sha256(token) });
  const slug = (data as { workspace_slug?: string } | null)?.workspace_slug;
  if (error || !slug) {
    redirect(`/invite/${token}?error=${encodeURIComponent(error?.message ?? "Convite inválido ou expirado.")}`);
  }
  redirect(`/w/${slug}`);
}
