"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
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
import {
  LayoutDashboard,
  ListChecks,
  Settings,
  LogOut,
  ChevronDown,
  Sparkles,
  Plug,
} from "lucide-react";

interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
}

interface ProjectInfo {
  id: string;
  name: string;
  slug: string;
}

interface WorkspaceLayoutProps {
  children: React.ReactNode;
}

export default function WorkspaceLayout({ children }: WorkspaceLayoutProps) {
  const routeParams = useParams<{ workspaceSlug: string }>();
  const workspaceSlug = routeParams?.workspaceSlug;
  const pathname = usePathname();
  const supabase = createClient();

  const [workspace, setWorkspace] = React.useState<WorkspaceInfo | null>(null);
  const [workspaces, setWorkspaces] = React.useState<WorkspaceInfo[]>([]);
  const [projects, setProjects] = React.useState<ProjectInfo[]>([]);
  const [currentUserId, setCurrentUserId] = React.useState<string>("");
  const [currentUserName, setCurrentUserName] = React.useState<string>("");

  React.useEffect(() => {
    if (!workspaceSlug) return;
    let cancelled = false;

    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user && !cancelled) {
        setCurrentUserId(user.id);
        const meta = user.user_metadata as Record<string, unknown> | undefined;
        setCurrentUserName((meta?.name as string) ?? (meta?.email as string)?.split("@")[0] ?? "Você");
      }

      const { data: ws } = await supabase.from("workspaces").select("*").eq("slug", workspaceSlug).maybeSingle();
      if (cancelled) return;
      setWorkspace(ws);

      const { data: members } = await supabase
        .from("workspace_members")
        .select("workspace:workspaces(id, name, slug)")
        .eq("user_id", user?.id ?? "");
      if (!cancelled && members) {
        const list = members
          .map((m) => m.workspace as unknown as WorkspaceInfo)
          .filter(Boolean);
        setWorkspaces(list);
      }

      if (ws) {
        const { data: projectList } = await supabase
          .from("projects")
          .select("id, name, slug")
          .eq("workspace_id", ws.id)
          .order("created_at");
        if (!cancelled) setProjects(projectList ?? []);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [supabase, workspaceSlug]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  const projectSlugFromPath = pathname.includes("/p/")
    ? pathname.split("/p/")[1]?.split("/")[0]
    : undefined;

  const navLink = (href: string, label: string, icon: React.ReactNode, active: boolean) => (
    <Link
      key={href}
      href={href}
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </Link>
  );

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-60 border-r border-border bg-card flex flex-col shrink-0">
        {/* Workspace Switcher */}
        <div className="p-3 border-b border-border">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="w-full justify-between px-2 h-10">
                <span className="flex items-center gap-2 min-w-0">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">
                    {(workspace?.name ?? "W").slice(0, 1).toUpperCase()}
                  </span>
                  <span className="truncate text-sm font-medium">{workspace?.name ?? "Workspace"}</span>
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
              {workspaces.map((ws) => (
                <DropdownMenuItem key={ws.id} onClick={() => (window.location.href = `/w/${ws.slug}`)}>
                  {ws.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => (window.location.href = `/w/${workspaceSlug}/settings/ai`)}>
                <Settings className="h-4 w-4 mr-2" />
                Configurações
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Projetos + navegação */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          <p className="px-3 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Projetos
          </p>
          {projects.map((project) => {
            const base = `/w/${workspaceSlug}/p/${project.slug}`;
            return (
              <div key={project.id} className="space-y-1">
                <p className="px-3 pt-2 text-sm font-medium truncate">{project.name}</p>
                {navLink(
                  `${base}/backlog`,
                  "Backlog",
                  <ListChecks className="h-4 w-4" />,
                  pathname === `${base}/backlog` ||
                    (pathname.includes(`/p/${project.slug}/`) && pathname.endsWith("/backlog"))
                )}
                {projectSlugFromPath === project.slug &&
                  navLink(
                    `${base}/canvas/current`,
                    "Canvas",
                    <LayoutDashboard className="h-4 w-4" />,
                    pathname.includes("/canvas/")
                  )}
              </div>
            );
          })}

          <div className="pt-4">
            <p className="px-3 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Administração
            </p>
            {navLink(
              `/w/${workspaceSlug}/settings/ai`,
              "Chaves de IA",
              <Sparkles className="h-4 w-4" />,
              pathname.endsWith("/settings/ai")
            )}
            {navLink(
              `/w/${workspaceSlug}/settings/mcp`,
              "Agentes MCP",
              <Plug className="h-4 w-4" />,
              pathname.endsWith("/settings/mcp")
            )}
          </div>
        </nav>

        {/* Usuário */}
        <div className="p-3 border-t border-border">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="w-full justify-start gap-2 px-2 h-10">
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="text-xs">
                    {(currentUserName || "U").slice(0, 1).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate text-sm">{currentUserName || "Usuário"}</span>
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
      </aside>

      {/* Conteúdo principal */}
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
