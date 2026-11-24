"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import type { DropResult } from "@hello-pangea/dnd";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PromptDialog } from "@/components/ui/prompt-dialog";
import { Notice, useNotice } from "@/components/ui/notice";
import { BacklogTableView } from "@/components/backlog/BacklogTableView";
import { BacklogKanbanView } from "@/components/backlog/BacklogKanbanView";
import { BacklogFilters } from "@/components/backlog/BacklogFilters";
import { TaskDrawer } from "@/components/task/TaskDrawer";
import { useTaskDrawer } from "@/components/task/useTaskDrawer";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { createClient } from "@/lib/supabase/client";
import { compareTaskKeys } from "@/lib/utils";
import type { Task, TaskStatus, TaskPriority, TaskType } from "@/types/domain";
import { Kanban, LayoutDashboard, Loader2, Plus } from "lucide-react";

const PAGE_SIZE = 100;
const STATUS_ORDER: TaskStatus[] = ["backlog", "todo", "in_progress", "in_review", "blocked", "done"];
const SORTABLE_COLUMNS = new Set(["task_key", "title", "status", "priority", "type", "updated_at", "created_at"]);

interface Filters {
  search: string;
  status: TaskStatus[];
  priority: TaskPriority[];
  type: TaskType[];
  assignee: string;
  awaitingAIReview: boolean;
}

const EMPTY_FILTERS: Filters = { search: "", status: [], priority: [], type: [], assignee: "", awaitingAIReview: false };

/** Mesmo critério do servidor, aplicado a eventos realtime. */
function matchesFilters(task: Task, f: Filters): boolean {
  const q = f.search.trim().toLowerCase();
  if (q && !task.title.toLowerCase().includes(q) && !task.task_key.toLowerCase().includes(q)) return false;
  if (f.status.length && !f.status.includes(task.status)) return false;
  if (f.priority.length && !f.priority.includes(task.priority)) return false;
  if (f.type.length && !f.type.includes(task.type)) return false;
  if (f.assignee && task.assignee_id !== f.assignee) return false;
  if (f.awaitingAIReview && !(task.status === "in_review" && task.last_updated_by_type === "external_agent")) {
    return false;
  }
  return true;
}

export default function BacklogPage() {
  const params = useParams<{ workspaceSlug: string; projectSlug: string }>();
  const router = useRouter();
  const { workspace, canWrite, user } = useWorkspace();
  const supabase = React.useMemo(() => createClient(), []);
  const { notice, notify, clear } = useNotice();
  const notifyError = React.useCallback((m: string) => notify(m, "error"), [notify]);

  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [defaultCanvasId, setDefaultCanvasId] = React.useState<string | null>(null);
  const [notFound, setNotFound] = React.useState(false);
  const [tasks, setTasks] = React.useState<Task[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [assignees, setAssignees] = React.useState<Array<{ id: string; name: string }>>([]);

  const [view, setView] = React.useState<"table" | "kanban">("table");
  const [sortBy, setSortBy] = React.useState("task_key");
  const [sortOrder, setSortOrder] = React.useState<"asc" | "desc">("asc");
  const [selectedTaskIds, setSelectedTaskIds] = React.useState<string[]>([]);
  const [filters, setFilters] = React.useState<Filters>(EMPTY_FILTERS);
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [newTaskStatus, setNewTaskStatus] = React.useState<TaskStatus | null>(null);

  const tasksRef = React.useRef<Task[]>([]);
  tasksRef.current = tasks;
  const filtersRef = React.useRef(filters);
  filtersRef.current = filters;

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filters.search), 300);
    return () => clearTimeout(t);
  }, [filters.search]);

  // Projeto (escopado ao workspace) + canvas padrão + nomes dos membros
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: project } = await supabase
        .from("projects")
        .select("id, canvases(id, is_default)")
        .eq("workspace_id", workspace.id)
        .eq("slug", params.projectSlug)
        .maybeSingle();
      if (cancelled) return;
      if (!project) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setProjectId(project.id);
      const canvases = (project.canvases as unknown as Array<{ id: string; is_default: boolean }>) ?? [];
      setDefaultCanvasId(canvases.find((c) => c.is_default)?.id ?? canvases[0]?.id ?? null);

      const res = await fetch(`/api/workspaces/${workspace.id}/members`);
      const body = await res.json().catch(() => null);
      if (!cancelled && res.ok) {
        setAssignees(
          (body.members as Array<{ user_id: string; name: string }>).map((m) => ({ id: m.user_id, name: m.name }))
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, workspace.id, params.projectSlug]);

  // Consulta paginada com filtros e ordenação no servidor
  const fetchPage = React.useCallback(
    async (offset: number) => {
      if (!projectId) return { rows: [] as Task[], count: 0 };
      let query = supabase.from("tasks").select("*", { count: "exact" }).eq("project_id", projectId);

      const q = debouncedSearch.trim().replace(/[%,()]/g, " ");
      if (q) query = query.or(`title.ilike.%${q}%,task_key.ilike.%${q}%`);
      if (filters.status.length) query = query.in("status", filters.status);
      if (filters.priority.length) query = query.in("priority", filters.priority);
      if (filters.type.length) query = query.in("type", filters.type);
      if (filters.assignee) query = query.eq("assignee_id", filters.assignee);
      if (filters.awaitingAIReview) {
        query = query.eq("status", "in_review").eq("last_updated_by_type", "external_agent");
      }

      // task_key é texto ("APP-10" < "APP-2"); created_at segue a ordem numérica
      const column = sortBy === "task_key" || !SORTABLE_COLUMNS.has(sortBy) ? "created_at" : sortBy;
      query = query.order(column, { ascending: sortOrder === "asc" }).range(offset, offset + PAGE_SIZE - 1);

      const { data, error, count } = await query;
      if (error) {
        notifyError(`Falha ao carregar tarefas: ${error.message}`);
        return { rows: [] as Task[], count: 0 };
      }
      return { rows: (data as unknown as Task[]) ?? [], count: count ?? 0 };
    },
    [supabase, projectId, debouncedSearch, filters.status, filters.priority, filters.type, filters.assignee, filters.awaitingAIReview, sortBy, sortOrder, notifyError]
  );

  React.useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    void fetchPage(0).then(({ rows, count }) => {
      if (cancelled) return;
      setTasks(rows);
      setTotal(count);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, fetchPage]);

  const loadMore = async () => {
    setLoadingMore(true);
    const { rows, count } = await fetchPage(tasks.length);
    setTasks((prev) => [...prev, ...rows.filter((r) => !prev.some((p) => p.id === r.id))]);
    setTotal(count);
    setLoadingMore(false);
  };

  // Realtime: alterações do canvas, do MCP e de outros usuários
  React.useEffect(() => {
    if (!projectId) return;
    const channel = supabase
      .channel(`backlog-${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks", filter: `project_id=eq.${projectId}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const id = (payload.old as { id: string }).id;
            setTasks((prev) => prev.filter((t) => t.id !== id));
            return;
          }
          const incoming = payload.new as unknown as Task;
          const visible = matchesFilters(incoming, filtersRef.current);
          setTasks((prev) => {
            const exists = prev.some((t) => t.id === incoming.id);
            if (!visible) return exists ? prev.filter((t) => t.id !== incoming.id) : prev;
            return exists ? prev.map((t) => (t.id === incoming.id ? { ...t, ...incoming } : t)) : [...prev, incoming];
          });
          if (payload.eventType === "INSERT" && visible) setTotal((n) => n + 1);
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, projectId]);

  const patchTask = React.useCallback((taskId: string, updates: Partial<Task>) => {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...updates } : t)));
  }, []);
  const getTask = React.useCallback((taskId: string) => tasksRef.current.find((t) => t.id === taskId), []);
  const drawer = useTaskDrawer({ supabase, getTask, patchTask, onError: notifyError });

  const handleSort = (field: string) => {
    if (sortBy === field) setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    else {
      setSortBy(field);
      setSortOrder("asc");
    }
  };

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return;
    const newStatus = result.destination.droppableId as TaskStatus;
    const task = getTask(result.draggableId);
    if (!task || task.status === newStatus) return;
    await drawer.updateTask(task.id, { status: newStatus }).catch(() => undefined);
  };

  const handleCreateTask = async (title: string) => {
    if (!projectId) return;
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        project_id: projectId,
        title,
        status: newTaskStatus ?? "backlog",
        type: "task",
        last_updated_by_type: "human",
        last_updated_by_label: user.name,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    setTasks((prev) => (prev.some((t) => t.id === data.id) ? prev : [...prev, data as unknown as Task]));
  };

  const handleViewOnCanvas = (task: Task) => {
    const canvas = defaultCanvasId ?? "current";
    router.push(`/w/${params.workspaceSlug}/p/${params.projectSlug}/canvas/${canvas}?focus=${encodeURIComponent(task.task_key)}`);
  };

  const sortedTasks = React.useMemo(() => {
    if (sortBy !== "task_key") return tasks;
    const dir = sortOrder === "asc" ? 1 : -1;
    return [...tasks].sort((a, b) => dir * compareTaskKeys(a.task_key, b.task_key));
  }, [tasks, sortBy, sortOrder]);

  const visibleTasks = React.useMemo(() => sortedTasks.filter((t) => matchesFilters(t, filters)), [sortedTasks, filters]);

  if (notFound) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Projeto não encontrado.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border bg-card p-4">
        <div>
          <h1 className="text-xl font-semibold">Backlog</h1>
          <p className="text-sm text-muted-foreground">
            {loading ? "Carregando..." : `${visibleTasks.length} de ${total} tarefas`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {defaultCanvasId && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => router.push(`/w/${params.workspaceSlug}/p/${params.projectSlug}/canvas/${defaultCanvasId}`)}
            >
              <LayoutDashboard className="h-4 w-4" />
              Abrir canvas
            </Button>
          )}
          {canWrite && (
            <Button size="sm" className="gap-1" onClick={() => setNewTaskStatus("backlog")}>
              <Plus className="h-4 w-4" />
              Nova Tarefa
            </Button>
          )}
        </div>
      </div>

      <BacklogFilters
        filters={filters}
        onFiltersChange={(partial) => setFilters((prev) => ({ ...prev, ...partial }))}
        assignees={assignees}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <Tabs
          value={view}
          onValueChange={(value) => setView(value === "kanban" ? "kanban" : "table")}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="border-b border-border bg-card p-2">
            <TabsTrigger value="table" className="gap-1">
              Lista
            </TabsTrigger>
            <TabsTrigger value="kanban" className="gap-1">
              <Kanban className="h-4 w-4" />
              Kanban
            </TabsTrigger>
          </TabsList>

          {loading ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <TabsContent value="table" className="min-h-0 flex-1">
                <BacklogTableView
                  tasks={visibleTasks}
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                  onViewOnCanvas={handleViewOnCanvas}
                  onOpenDrawer={(id) => void drawer.open(id)}
                  selectedTaskIds={selectedTaskIds}
                  onSelectTask={(id, selected) =>
                    setSelectedTaskIds((prev) => (selected ? [...prev, id] : prev.filter((x) => x !== id)))
                  }
                  onSelectAll={(selected) => setSelectedTaskIds(selected ? visibleTasks.map((t) => t.id) : [])}
                />
              </TabsContent>
              <TabsContent value="kanban" className="min-h-0 flex-1">
                <BacklogKanbanView
                  tasks={[...visibleTasks].sort(
                    (a, b) =>
                      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
                      compareTaskKeys(a.task_key, b.task_key)
                  )}
                  onDragEnd={handleDragEnd}
                  onViewOnCanvas={handleViewOnCanvas}
                  onOpenDrawer={(id) => void drawer.open(id)}
                  onAddTask={(status) => canWrite && setNewTaskStatus(status)}
                />
              </TabsContent>
            </>
          )}
        </Tabs>

        {!loading && tasks.length < total && (
          <div className="flex justify-center border-t border-border p-2">
            <Button variant="ghost" size="sm" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Carregar mais ({total - tasks.length} restantes)
            </Button>
          </div>
        )}
      </div>

      <TaskDrawer {...drawer.drawerProps} />
      <PromptDialog
        open={newTaskStatus !== null}
        onOpenChange={(open) => !open && setNewTaskStatus(null)}
        title="Nova tarefa"
        description="A tarefa entra no backlog; use 'Ver no canvas' para projetá-la no quadro."
        label="Título"
        placeholder="Ex.: Corrigir timeout no checkout"
        onSubmit={handleCreateTask}
      />
      <Notice notice={notice} onClose={clear} />
    </div>
  );
}
