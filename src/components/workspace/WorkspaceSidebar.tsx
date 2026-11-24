"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PromptDialog } from "@/components/ui/prompt-dialog";
import { CreateProjectDialog } from "@/components/workspace/CreateProjectDialog";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import {
  LayoutDashboard,
  ListChecks,
  Settings,
  LogOut,
  ChevronDown,
  Sparkles,
  Plug,
  Users,
  Plus,
} from "lucide-react";
import type { ProjectSummary, WorkspaceSummary } from "@/lib/workspace";

interface WorkspaceSidebarProps {
  workspaces: WorkspaceSummary[];
  projects: ProjectSummary[];
}

export function WorkspaceSidebar({ workspaces, projects }: WorkspaceSidebarProps) {
  const { workspace, user, role, canWrite, isAdmin } = useWorkspace();
  const pathname = usePathname();
  const router = useRouter();
  const [isCreatingProject, setIsCreatingProject] = React.useState(false);
  const [canvasDialogProject, setCanvasDialogProject] = React.useState<ProjectSummary | null>(null);

  const base = `/w/${workspace.slug}`;
  const projectSlugFromPath = pathname.includes("/p/") ? pathname.split("/p/")[1]?.split("/")[0] : undefined;

  const handleSignOut = async () => {
    await createClient().auth.signOut();
    window.location.href = "/login";
  };

  const handleCreateCanvas = async (name: string) => {
    if (!canvasDialogProject) return;
    const { data, error } = await createClient()
      .from("canvases")
      .insert({ project_id: canvasDialogProject.id, name })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    router.push(`${base}/p/${canvasDialogProject.slug}/canvas/${data.id}`);
    router.refresh();
  };

  const navLink = (href: string, label: string, icon: React.ReactNode, active: boolean) => (
    <Link
      key={href}
      href={href}
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors",
        active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </Link>
  );

  return (
    <aside className="w-60 border-r border-border bg-card flex flex-col shrink-0">
      <div className="p-3 border-b border-border">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="w-full justify-between px-2 h-10">
              <span className="flex items-center gap-2 min-w-0">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">
                  {workspace.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="truncate text-sm font-medium">{workspace.name}</span>
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
            {workspaces.map((ws) => (
              <DropdownMenuItem key={ws.id} onClick={() => router.push(`/w/${ws.slug}`)}>
                {ws.name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push(`${base}/settings/members`)}>
              <Settings className="h-4 w-4 mr-2" />
              Configurações
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-1">
        <div className="flex items-center justify-between px-3 pb-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Projetos</p>
          {canWrite && (
            <button
              type="button"
              onClick={() => setIsCreatingProject(true)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Novo projeto"
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>

        {projects.length === 0 && (
          <p className="px-3 py-2 text-sm text-muted-foreground">Nenhum projeto ainda.</p>
        )}

        {projects.map((project) => {
          const projectBase = `${base}/p/${project.slug}`;
          const isCurrent = projectSlugFromPath === project.slug;
          return (
            <div key={project.id} className="space-y-1">
              <p className="px-3 pt-2 text-sm font-medium truncate">
                {project.name} <span className="text-xs text-muted-foreground">{project.key_prefix}</span>
              </p>
              {navLink(
                `${projectBase}/backlog`,
                "Backlog",
                <ListChecks className="h-4 w-4" />,
                pathname === `${projectBase}/backlog`
              )}
              {project.canvases.map((canvas) =>
                navLink(
                  `${projectBase}/canvas/${canvas.id}`,
                  canvas.name,
                  <LayoutDashboard className="h-4 w-4" />,
                  pathname === `${projectBase}/canvas/${canvas.id}` ||
                    (isCurrent && canvas.is_default && pathname === `${projectBase}/canvas/current`)
                )
              )}
              {canWrite && isCurrent && (
                <button
                  type="button"
                  onClick={() => setCanvasDialogProject(project)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Plus className="h-3 w-3" /> Novo canvas
                </button>
              )}
            </div>
          );
        })}

        <div className="pt-4">
          <p className="px-3 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Administração
          </p>
          {navLink(`${base}/settings/members`, "Membros", <Users className="h-4 w-4" />, pathname.endsWith("/settings/members"))}
          {isAdmin &&
            navLink(`${base}/settings/ai`, "Chaves de IA", <Sparkles className="h-4 w-4" />, pathname.endsWith("/settings/ai"))}
          {isAdmin &&
            navLink(`${base}/settings/mcp`, "Agentes MCP", <Plug className="h-4 w-4" />, pathname.endsWith("/settings/mcp"))}
        </div>
      </nav>

      <div className="p-3 border-t border-border">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="w-full justify-start gap-2 px-2 h-10">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="text-xs">{user.name.slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 text-left">
                <span className="block truncate text-sm">{user.name}</span>
                <span className="block text-xs text-muted-foreground">{role}</span>
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onClick={handleSignOut}>
              <LogOut className="h-4 w-4 mr-2" />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <CreateProjectDialog open={isCreatingProject} onOpenChange={setIsCreatingProject} />
      <PromptDialog
        open={canvasDialogProject !== null}
        onOpenChange={(open) => !open && setCanvasDialogProject(null)}
        title="Novo canvas"
        label="Nome do canvas"
        placeholder="Ex.: Discovery Q3"
        maxLength={100}
        onSubmit={handleCreateCanvas}
      />
    </aside>
  );
}
