import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace:workspaces(slug)")
    .eq("user_id", user.id)
    .order("created_at")
    .limit(1)
    .maybeSingle();

  const slug = (membership?.workspace as unknown as { slug: string } | null)?.slug;
  if (slug) {
    // /w/{slug} resolve o primeiro projeto ou mostra o estado vazio
    redirect(`/w/${slug}`);
  }

  // Sem workspace (ex.: owner removeu o usuário): não volta para /login em loop
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-xl font-semibold">Você ainda não participa de nenhum workspace</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Peça um link de convite a um admin do workspace e abra-o com esta conta.
      </p>
    </div>
  );
}
