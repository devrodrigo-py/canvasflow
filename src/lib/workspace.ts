import "server-only";

import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { WorkspaceRole } from "@/types/domain";

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  key_prefix: string;
  canvases: Array<{ id: string; name: string; is_default: boolean }>;
}

export interface WorkspaceContextData {
  user: { id: string; email: string | null; name: string };
  workspace: WorkspaceSummary;
  role: WorkspaceRole;
  workspaces: WorkspaceSummary[];
  projects: ProjectSummary[];
}

export function displayNameFor(user: { email?: string | null; user_metadata?: Record<string, unknown> }) {
  const meta = user.user_metadata ?? {};
  return (
    (meta.name as string | undefined) ??
    (meta.full_name as string | undefined) ??
    user.email?.split("@")[0] ??
    "Usuário"
  );
}

/**
 * Carrega (uma vez por request) o workspace do slug, o papel do usuário,
 * os workspaces acessíveis e os projetos com seus canvases.
 * Não-membros recebem 404 (o RLS esconde o workspace).
 */
export const getWorkspaceContext = cache(async (slug: string): Promise<WorkspaceContextData> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/w/${slug}`)}`);

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name, slug")
    .eq("slug", slug)
    .maybeSingle();
  if (!workspace) notFound();

  const [{ data: membership }, { data: memberships }, { data: projects }] = await Promise.all([
    supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspace.id)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase.from("workspace_members").select("workspace:workspaces(id, name, slug)").eq("user_id", user.id),
    supabase
      .from("projects")
      .select("id, name, slug, key_prefix, canvases(id, name, is_default)")
      .eq("workspace_id", workspace.id)
      .order("created_at"),
  ]);
  if (!membership) notFound();

  return {
    user: { id: user.id, email: user.email ?? null, name: displayNameFor(user) },
    workspace,
    role: membership.role,
    workspaces: (memberships ?? [])
      .map((m) => m.workspace as unknown as WorkspaceSummary | null)
      .filter((w): w is WorkspaceSummary => Boolean(w)),
    projects: (projects ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      key_prefix: p.key_prefix,
      canvases: ((p.canvases as unknown as ProjectSummary["canvases"]) ?? []).sort(
        (a, b) => Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name)
      ),
    })),
  };
});
