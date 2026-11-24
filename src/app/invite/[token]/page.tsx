import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { sha256 } from "@/lib/crypto";

/**
 * Aceite de convite: /invite/{token}. O middleware garante login antes.
 * Apenas o hash do token trafega para o banco.
 */
export default async function AcceptInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);

  const { data, error } = await supabase.rpc("accept_workspace_invite", { p_token_hash: sha256(token) });
  const slug = (data as { workspace_slug?: string } | null)?.workspace_slug;

  if (!error && slug) {
    redirect(`/w/${slug}`);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-xl font-semibold">Não foi possível aceitar o convite</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        {error?.message ?? "Convite inválido ou expirado."} Peça um novo link a um admin do workspace.
      </p>
      <Link href="/" className="text-sm text-primary hover:underline">
        Ir para meus workspaces
      </Link>
    </div>
  );
}
