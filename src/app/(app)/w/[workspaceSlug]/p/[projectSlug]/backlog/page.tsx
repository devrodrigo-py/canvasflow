"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BacklogTableView } from "@/components/backlog/BacklogTableView";
import { BacklogKanbanView } from "@/components/backlog/BacklogKanbanView";
import { BacklogFilters } from "@/components/backlog/BacklogFilters";
import { TaskDrawer } from "@/components/task/TaskDrawer";
import { createClient } from "@/lib/supabase/client";
import { Task, TaskStatus, TaskPriority, TaskType, Comment, ActivityLog } from "@/types/domain";
import { Filter, Kanban, Plus, ChevronLeft, Loader2 } from "lucide-react";
import type { DropResult } from "@hello-pangea/dnd";

interface BacklogPageProps {
  params: Promise<{
    workspaceSlug: string;
    projectSlug: string;
  }>;
}

const statusOrder: TaskStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "done",
];

interface Filters {
  search: string;
  status: TaskStatus[];
  priority: TaskPriority[];
  type: TaskType[];
  assignee: string;
  awaitingAIReview: boolean;
}

export default function BacklogPage({ params }: BacklogPageProps) {
  const [workspaceSlug, setWorkspaceSlug] = React.useState<string>("");
  const [projectSlug, setProjectSlug] = React.useState<string>("");
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [tasks, setTasks] = React.useState<Task[]>([]);
  const [assignees, setAssignees] = React.useState<Array<{ id: string; name: string }>>([]);
  const [currentUserId, setCurrentUserId] = React.useState<string>("");

  const [view, setView] = React.useState<"table" | "kanban">("table");
  const [sortBy, setSortBy] = React.useState("updated_at");
  const [sortOrder, setSortOrder] = React.useState<"asc" | "desc">("desc");
  const [selectedTaskIds, setSelectedTaskIds] = React.useState<string[]>([]);
  const [filters, setFilters] = React.useState<Filters>({
    search: "",
    status: [],
    priority: [],
    type: [],
    assignee: "",
    awaitingAIReview: false,
  });

  // TaskDrawer state
  const [drawerTask, setDrawerTask] = React.useState<Task | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = React.useState(false);
  const [drawerComments, setDrawerComments] = React.useState<Comment[]>([]);
  const [drawerActivities, setDrawerActivities] = React.useState<ActivityLog[]>([]);

  const supabase = createClient();

  // Resolver params + dados iniciais
  React.useEffect(() => {
    params.then(({ workspaceSlug: ws, projectSlug: p }) => {
      setWorkspaceSlug(ws);
      setProjectSlug(p);
    });
  }, [params]);

  React.useEffect(() => {
    if (!projectSlug) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (user && !cancelled) setCurrentUserId(user.id);

      // Resolver workspace → projeto → tasks
      const { data: workspace } = await supabase
        .from("workspaces")
        .select("id")
        .eq("slug", workspaceSlug)
        .maybeSingle();

      const workspaceQuery = supabase.from("projects").select("id, workspace_id").eq("slug", projectSlug).limit(1);
      const { data: project } = workspace
        ? await workspaceQuery.eq("workspace_id", workspace.id).maybeSingle()
        : await workspaceQuery.maybeSingle();

      if (cancelled) return;
      if (!project) {
        setLoading(false);
        return;
      }

      setProjectId(project.id);
      setWorkspaceId(project.workspace_id);

      const { data: tasksData } = await supabase
        .from("tasks")
        .select("*")
        .eq("project_id", project.id)
        .order("task_key", { ascending: true });

      if (!cancelled) setTasks((tasksData as unknown as Task[]) ?? []);

      const { data: membersData } = await supabase
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", project.workspace_id);

      if (!cancelled) {
        // auth.users não é exposto via PostgREST; rotulamos pelos ids
        setAssignees(
          (membersData ?? []).map((m) => ({
            id: m.user_id,
            name: `Usuário ${m.user_id.slice(0, 8)}`,
          }))
        );
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [supabase, workspaceSlug, projectSlug]);

  // Realtime: sincroniza alterações feitas no canvas / MCP / outros usuários
  React.useEffect(() => {
    if (!projectId) return;

    const channel = supabase
      .channel(`backlog-${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks", filter: `project_id=eq.${projectId}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setTasks((prev) => {
              if (prev.some((t) => t.id === payload.new.id)) return prev;
              return [...prev, payload.new as unknown as Task];
            });
          } else if (payload.eventType === "UPDATE") {
            setTasks((prev) =>
              prev.map((t) => (t.id === payload.new.id ? { ...t, ...(payload.new as object) } as Task : t))
            );
            setDrawerTask((current) =>
              current && current.id === payload.new.id
                ? { ...current, ...(payload.new as object) } as Task
                : current
            );
          } else if (payload.eventType === "DELETE") {
            setTasks((prev) => prev.filter((t) => t.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, projectId]);

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("asc");
    }
  };

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination || !projectId || !workspaceId) return;
    const taskId = result.draggableId;
    const newStatus = result.destination.droppableId as TaskStatus;
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === newStatus) return;

    // Atualização otimista
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)));

    const { error } = await supabase
      .from("tasks")
      .update({ status: newStatus, last_updated_by_type: "human", last_updated_by_label: null })
      .eq("id", taskId);
    if (error) {
      console.error("Falha ao atualizar status:", error);
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: task.status } : t)));
      return;
    }

    await supabase.from("activity_logs").insert({
      workspace_id: workspaceId,
      project_id: projectId,
      task_id: taskId,
      actor_type: "human",
      actor_user_id: currentUserId,
      actor_label: "Você",
      action: "task.status_changed",
      payload: { from: task.status, to: newStatus },
    });
  };

  const handleSelectTask = (taskId: string, selected: boolean) => {
    setSelectedTaskIds((prev) =>
      selected ? [...prev, taskId] : prev.filter((id) => id !== taskId)
    );
  };

  const handleSelectAll = (selected: boolean) => {
    setSelectedTaskIds(selected ? tasks.map((t) => t.id) : []);
  };

  const handleFiltersChange = (newFilters: Partial<Filters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
  };

  const handleViewOnCanvas = (task: Task) => {
    const canvasUrl = `/w/${workspaceSlug}/p/${projectSlug}/canvas/focus=${task.task_key}`;
    // O canvas padrão do projeto é o alvo; o parâmetro ?focus foca o card
    supabase
      .from("canvases")
      .select("id")
      .eq("project_id", task.project_id)
      .eq("is_default", true)
      .maybeSingle()
      .then(({ data: canvas }) => {
        const canvasId = canvas?.id ?? "default";
        window.location.href = `/w/${workspaceSlug}/p/${projectSlug}/canvas/${canvasId}?focus=${task.task_key}`;
      });
    void canvasUrl;
  };

  const handleOpenDrawer = async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    setDrawerTask(task);
    setIsDrawerOpen(true);

    const [{ data: comments }, { data: activities }] = await Promise.all([
      supabase.from("comments").select("*").eq("task_id", taskId).order("created_at", { ascending: true }),
      supabase
        .from("activity_logs")
        .select("*")
        .eq("task_id", taskId)
        .order("created_at", { ascending: true })
        .limit(100),
    ]);
    setDrawerComments((comments as unknown as Comment[]) ?? []);
    setDrawerActivities((activities as unknown as ActivityLog[]) ?? []);
  };

  const handleAddTask = async (status: TaskStatus) => {
    if (!projectId || !workspaceId) return;
    const title = window.prompt("Título da nova tarefa:");
    if (!title?.trim()) return;

    const { data, error } = await supabase
      .from("tasks")
      .insert({
        project_id: projectId,
        title: title.trim(),
        status,
        type: "task",
        last_updated_by_type: "human",
        last_updated_by_label: "Você",
      })
      .select("*")
      .single();
    if (error) {
      console.error("Falha ao criar tarefa:", error);
      return;
    }
    setTasks((prev) => [...prev, data as unknown as Task]);
  };

  const handleUpdateTask = async (taskId: string, updates: Partial<Task>) => {
    const { error } = await supabase
      .from("tasks")
      .update({
        ...(updates.title !== undefined ? { title: updates.title } : {}),
        ...(updates.status !== undefined ? { status: updates.status } : {}),
        ...(updates.priority !== undefined ? { priority: updates.priority } : {}),
        ...(updates.type !== undefined ? { type: updates.type } : {}),
        ...(updates.sprint !== undefined ? { sprint: updates.sprint } : {}),
        ...(updates.estimate_points !== undefined ? { estimate_points: updates.estimate_points } : {}),
        ...(updates.assignee_id !== undefined ? { assignee_id: updates.assignee_id } : {}),
        ...(updates.spec_markdown !== undefined ? { spec_markdown: updates.spec_markdown } : {}),
        ...(updates.spec_json !== undefined ? { spec_json: updates.spec_json } : {}),
        ...(updates.acceptance_criteria !== undefined ? { acceptance_criteria: updates.acceptance_criteria } : {}),
        last_updated_by_type: "human",
        last_updated_by_label: null,
      })
      .eq("id", taskId);
    if (error) throw error;
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...updates } : t)));
    setDrawerTask((current) => (current && current.id === taskId ? { ...current, ...updates } : current));
  };

  const handleAddComment = async (taskId: string, body: string) => {
    if (!workspaceId) return;
    const { data, error } = await supabase
      .from("comments")
      .insert({
        workspace_id: workspaceId,
        task_id: taskId,
        actor_type: "human",
        author_user_id: currentUserId,
        author_label: "Você",
        body_markdown: body,
      })
      .select("*")
      .single();
    if (error) throw error;
    setDrawerComments((prev) => [...prev, data as Comment]);
  };

  const handleUpdateComment = async (commentId: string, body: string) => {
    const { error } = await supabase.from("comments").update({ body_markdown: body }).eq("id", commentId);
    if (error) throw error;
    setDrawerComments((prev) => prev.map((c) => (c.id === commentId ? { ...c, body_markdown: body } : c)));
  };

  const handleDeleteComment = async (commentId: string) => {
    const { error } = await supabase.from("comments").delete().eq("id", commentId);
    if (error) throw error;
    setDrawerComments((prev) => prev.filter((c) => c.id !== commentId));
  };

  const handleResolveComment = async (commentId: string, resolved: boolean) => {
    const { error } = await supabase.from("comments").update({ resolved }).eq("id", commentId);
    if (error) throw error;
    setDrawerComments((prev) => prev.map((c) => (c.id === commentId ? { ...c, resolved } : c)));
  };

  const handleApproveAndComplete = async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    await handleUpdateTask(taskId, { status: "done", last_updated_by_type: "human" });
    if (workspaceId) {
      await supabase.from("activity_logs").insert({
        workspace_id: workspaceId,
        project_id: projectId,
        task_id: taskId,
        actor_type: "human",
        actor_user_id: currentUserId,
        actor_label: "Você",
        action: "task.approved",
        payload: { from: task?.status ?? "in_review", to: "done" },
      });
    }
  };

  const handleGenerateSpec = async (_taskId: string) => {
    // A geração de spec com IA (Fase 5) chama /api/ai/draft-spec; placeholder para wiring na Fase 5.
    console.warn("draft-spec ainda não conectado (Fase 5)");
  };

  const filteredTasks = React.useMemo(() => {
    return tasks
      .filter((task) => {
        if (
          filters.search &&
          !task.title.toLowerCase().includes(filters.search.toLowerCase()) &&
          !task.task_key.toLowerCase().includes(filters.search.toLowerCase())
        ) {
          return false;
        }
        if (filters.status.length > 0 && !filters.status.includes(task.status)) return false;
        if (filters.priority.length > 0 && !filters.priority.includes(task.priority)) return false;
        if (filters.type.length > 0 && !filters.type.includes(task.type)) return false;
        if (filters.assignee && task.assignee_id !== filters.assignee) return false;
        if (
          filters.awaitingAIReview &&
          !(task.status === "in_review" && task.last_updated_by_type === "external_agent")
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const aVal = (a as unknown as Record<string, unknown>)[sortBy];
        const bVal = (b as unknown as Record<string, unknown>)[sortBy];
        if (aVal === bVal) return 0;
        if (aVal === null || aVal === undefined) return sortOrder === "asc" ? -1 : 1;
        if (bVal === null || bVal === undefined) return sortOrder === "asc" ? 1 : -1;
        if (aVal < bVal) return sortOrder === "asc" ? -1 : 1;
        return sortOrder === "asc" ? 1 : -1;
      });
  }, [tasks, filters, sortBy, sortOrder]);

  const tasksByStatus = React.useMemo(() => {
    const grouped: Record<TaskStatus, Task[]> = {
      backlog: [],
      todo: [],
      in_progress: [],
      in_review: [],
      blocked: [],
      done: [],
    };
    filteredTasks.forEach((task) => {
      grouped[task.status].push(task);
    });
    statusOrder.forEach((status) => {
      grouped[status].sort((a, b) => a.task_key.localeCompare(b.task_key));
    });
    return grouped;
  }, [filteredTasks]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!projectId) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <p className="text-muted-foreground">Projeto não encontrado.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border bg-card">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={() => {
              const canvasUrl = `/w/${workspaceSlug}/p/${projectSlug}`;
              window.location.href = canvasUrl;
            }}
            aria-label="Voltar"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">Backlog</h1>
            <p className="text-sm text-muted-foreground">{tasks.length} tarefas</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1" onClick={() => setView(view === "table" ? "kanban" : "table")}>
            <Filter className="h-4 w-4" />
            Alternar visão
          </Button>
          <Button size="sm" className="gap-1" onClick={() => handleAddTask("backlog")}>
            <Plus className="h-4 w-4" />
            Nova Tarefa
          </Button>
        </div>
      </div>

      {/* Filters */}
      <BacklogFilters filters={filters} onFiltersChange={handleFiltersChange} assignees={assignees} />

      {/* View Switcher & Table/Kanban */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <Tabs
          value={view}
          onValueChange={(value) => setView(value === "kanban" ? "kanban" : "table")}
          className="flex-1 flex flex-col min-h-0"
        >
          <TabsList className="p-2 border-b border-border bg-card">
            <TabsTrigger value="table" className="gap-1">
              Lista
            </TabsTrigger>
            <TabsTrigger value="kanban" className="gap-1">
              <Kanban className="h-4 w-4" />
              Kanban
            </TabsTrigger>
          </TabsList>

          <TabsContent value="table" className="flex-1 min-h-0">
            <BacklogTableView
              tasks={filteredTasks}
              sortBy={sortBy}
              sortOrder={sortOrder}
              onSort={handleSort}
              onViewOnCanvas={handleViewOnCanvas}
              onOpenDrawer={handleOpenDrawer}
              selectedTaskIds={selectedTaskIds}
              onSelectTask={handleSelectTask}
              onSelectAll={handleSelectAll}
            />
          </TabsContent>

          <TabsContent value="kanban" className="flex-1 min-h-0">
            <BacklogKanbanView
              tasks={filteredTasks}
              onDragEnd={handleDragEnd}
              onViewOnCanvas={handleViewOnCanvas}
              onOpenDrawer={handleOpenDrawer}
              onAddTask={handleAddTask}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* TaskDrawer */}
      <TaskDrawer
        task={drawerTask}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        onUpdateTask={handleUpdateTask}
        onAddComment={handleAddComment}
        onUpdateComment={handleUpdateComment}
        onDeleteComment={handleDeleteComment}
        onResolveComment={handleResolveComment}
        onApproveAndComplete={handleApproveAndComplete}
        onGenerateSpec={handleGenerateSpec}
        currentUserId={currentUserId}
        comments={drawerComments}
        activities={drawerActivities}
      />
    </div>
  );
}
