import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { acceptInviteAction } from "./actions";

/**
 * /invite/{token}: o GET apenas pede confirmação. A entrada no workspace só
 * acontece quando o próprio usuário envia o formulário (Server Action/POST).
 */
export default async function AcceptInvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="text-xl font-semibold">Não foi possível aceitar o convite</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          {error.slice(0, 200)} Peça um novo link a um admin do workspace.
        </p>
        <Link href="/" className="text-sm text-primary hover:underline">
          Ir para meus workspaces
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/50 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Convite para um workspace</CardTitle>
          <CardDescription>
            Você está entrando como <strong>{user.email}</strong>. Aceite apenas convites que você esperava receber.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={acceptInviteAction} className="flex flex-col gap-2">
            <input type="hidden" name="token" value={token} />
            <Button type="submit">Aceitar convite</Button>
            <Button asChild variant="ghost">
              <Link href="/">Agora não</Link>
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
