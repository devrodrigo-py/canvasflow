import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getFirstWorkspaceForUser } from "@/lib/services/tasks.service";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const workspace = await getFirstWorkspaceForUser(
    supabase as unknown as SupabaseClient<Database>,
    user.id
  );

  if (!workspace) {
    // Bootstrap via trigger no banco cobre novos usuários; aqui apenas fallback
    redirect("/login");
  }

  // Redireciona para o primeiro projeto do workspace (canvas padrão)
  const { data: project } = await supabase
    .from("projects")
    .select("slug")
    .eq("workspace_id", workspace.id)
    .order("created_at")
    .limit(1)
    .maybeSingle();

  if (project) {
    redirect(`/w/${workspace.slug}/p/${project.slug}/backlog`);
  }

  redirect(`/w/${workspace.slug}`);
}
