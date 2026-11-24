import { getWorkspaceContext } from "@/lib/workspace";
import { WorkspaceProvider } from "@/components/workspace/WorkspaceContext";
import { WorkspaceSidebar } from "@/components/workspace/WorkspaceSidebar";

/**
 * Server Component: workspace, papel e projetos chegam prontos no primeiro
 * render (sem flash de sidebar vazia). Não-membros recebem 404.
 */
export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const ctx = await getWorkspaceContext(workspaceSlug);

  return (
    <WorkspaceProvider value={{ user: ctx.user, workspace: ctx.workspace, role: ctx.role }}>
      <div className="flex h-screen overflow-hidden">
        <WorkspaceSidebar workspaces={ctx.workspaces} projects={ctx.projects} />
        <main className="flex-1 overflow-hidden">{children}</main>
      </div>
    </WorkspaceProvider>
  );
}
