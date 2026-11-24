import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type {
  Task,
  TaskStatus,
  TaskPriority,
  TaskType,
  CanvasEdgeType,
  AgentExecutionLogEntry,
  Comment,
  ActorType,
} from "@/types/domain";

type DbClient = SupabaseClient<Database>;
type TaskRow = Database["public"]["Tables"]["tasks"]["Row"];

export class TaskNotFoundError extends Error {
  constructor(taskKey: string) {
    super(`Task "${taskKey}" not found`);
    this.name = "TaskNotFoundError";
  }
}

export class ProjectNotFoundError extends Error {
  constructor(slug: string) {
    super(`Project "${slug}" not found`);
    this.name = "ProjectNotFoundError";
  }
}

export function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    project_id: row.project_id,
    task_key: row.task_key,
    title: row.title,
    status: row.status,
    priority: row.priority,
    type: row.type,
    sprint: row.sprint,
    estimate_points: row.estimate_points,
    assignee_id: row.assignee_id,
    parent_task_id: row.parent_task_id,
    spec_json: row.spec_json as unknown as Task["spec_json"],
    spec_markdown: row.spec_markdown,
    acceptance_criteria: row.acceptance_criteria as unknown as Task["acceptance_criteria"],
    agent_execution_log: row.agent_execution_log as unknown as AgentExecutionLogEntry[],
    last_updated_by_type: row.last_updated_by_type,
    last_updated_by_label: row.last_updated_by_label,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Projetos
// ---------------------------------------------------------------------------

export async function getProjectBySlug(
  db: DbClient,
  workspaceId: string,
  projectSlug: string,
  projectIdConstraint: string | null
) {
  let query = db.from("projects").select("*").eq("workspace_id", workspaceId).eq("slug", projectSlug);
  if (projectIdConstraint) query = query.eq("id", projectIdConstraint);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw new ProjectNotFoundError(projectSlug);
  return data;
}

export async function getProjectById(db: DbClient, projectId: string) {
  const { data, error } = await db.from("projects").select("*").eq("id", projectId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getDefaultCanvasId(db: DbClient, projectId: string): Promise<string | null> {
  const { data, error } = await db
    .from("canvases")
    .select("id")
    .eq("project_id", projectId)
    .eq("is_default", true)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

/** Projetos acessíveis + canvas padrão numa única query (sem N+1). */
export async function listProjects(db: DbClient, workspaceId: string, projectIdConstraint: string | null) {
  let query = db
    .from("projects")
    .select("id, slug, name, key_prefix, canvases(id, is_default)")
    .eq("workspace_id", workspaceId)
    .order("created_at");
  if (projectIdConstraint) query = query.eq("id", projectIdConstraint);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((project) => {
    const canvases = (project.canvases as unknown as Array<{ id: string; is_default: boolean }>) ?? [];
    return {
      id: project.id,
      slug: project.slug,
      name: project.name,
      key_prefix: project.key_prefix,
      default_canvas_id: canvases.find((c) => c.is_default)?.id ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Tarefas
// ---------------------------------------------------------------------------

export interface BacklogFilters {
  status?: TaskStatus[];
  priority?: TaskPriority[];
  type?: TaskType[];
  limit?: number;
  offset?: number;
}

export async function getBacklogTasks(db: DbClient, projectId: string, filters: BacklogFilters) {
  const limit = Math.min(filters.limit ?? 100, 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  // created_at segue a ordem do contador (APP-2 antes de APP-10), ao contrário de ordenar o texto
  let query = db
    .from("tasks")
    .select("task_key, title, status, priority, type, parent_task:tasks!parent_task_id(task_key)", { count: "exact" })
    .eq("project_id", projectId)
    .order("created_at", { ascending: true })
    .range(offset, offset + limit - 1);

  if (filters.status?.length) query = query.in("status", filters.status);
  if (filters.priority?.length) query = query.in("priority", filters.priority);
  if (filters.type?.length) query = query.in("type", filters.type);

  const { data, error, count } = await query;
  if (error) throw error;

  const tasks = (data ?? []).map((row) => {
    const parent = row.parent_task as unknown as { task_key: string } | null;
    return {
      task_key: row.task_key,
      title: row.title,
      status: row.status as TaskStatus,
      priority: row.priority as TaskPriority,
      type: row.type as TaskType,
      parent_task_key: parent?.task_key ?? null,
    };
  });

  return { tasks, total: count ?? tasks.length, offset, limit };
}

/**
 * Resolve uma task_key dentro do escopo do token (workspace + projeto opcional)
 * numa única query. task_key é única por workspace (prefixo único por workspace).
 */
export async function getTaskByKeyInScope(
  db: DbClient,
  workspaceId: string,
  projectIdConstraint: string | null,
  taskKey: string
): Promise<Task> {
  let query = db
    .from("tasks")
    .select("*, project:projects!inner(workspace_id)")
    .eq("task_key", taskKey)
    .eq("project.workspace_id", workspaceId);
  if (projectIdConstraint) query = query.eq("project_id", projectIdConstraint);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw new TaskNotFoundError(taskKey);
  const { project: _project, ...row } = data as TaskRow & { project: unknown };
  return rowToTask(row);
}

export async function getTaskById(db: DbClient, taskId: string): Promise<Task | null> {
  const { data, error } = await db.from("tasks").select("*").eq("id", taskId).maybeSingle();
  if (error) throw error;
  return data ? rowToTask(data) : null;
}

type TaskSummary = Pick<Task, "id" | "task_key" | "title" | "status" | "priority" | "type">;

export interface TaskContext {
  task: Task;
  connected_tasks: {
    parent: TaskSummary | null;
    children: TaskSummary[];
    blocks: TaskSummary[];
    blocked_by: TaskSummary[];
    related: TaskSummary[];
  };
  comments: Comment[];
}

const SUMMARY_COLUMNS = "id, task_key, title, status, priority, type";

/** Contexto completo a partir de task_dependencies (fonte da verdade), não do canvas. */
export async function getTaskContext(db: DbClient, task: Task): Promise<TaskContext> {
  const [outgoing, incoming, logicalChildren, parent, comments] = await Promise.all([
    db
      .from("task_dependencies")
      .select(`dependency_type, target:tasks!task_dependencies_target_task_id_fkey(${SUMMARY_COLUMNS})`)
      .eq("source_task_id", task.id),
    db
      .from("task_dependencies")
      .select(`dependency_type, source:tasks!task_dependencies_source_task_id_fkey(${SUMMARY_COLUMNS})`)
      .eq("target_task_id", task.id),
    db.from("tasks").select(SUMMARY_COLUMNS).eq("parent_task_id", task.id),
    task.parent_task_id
      ? db.from("tasks").select(SUMMARY_COLUMNS).eq("id", task.parent_task_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db.from("comments").select("*").eq("task_id", task.id).eq("resolved", false).order("created_at"),
  ]);

  for (const res of [outgoing, incoming, logicalChildren, parent, comments]) {
    if (res.error) throw res.error;
  }

  const blocks: TaskSummary[] = [];
  const blockedBy: TaskSummary[] = [];
  const children: TaskSummary[] = [];
  const related: TaskSummary[] = [];
  let parentTask = (parent.data as TaskSummary | null) ?? null;

  for (const dep of outgoing.data ?? []) {
    const target = dep.target as unknown as TaskSummary | null;
    if (!target) continue;
    if (dep.dependency_type === "blocks") blocks.push(target);
    else if (dep.dependency_type === "parent_of") children.push(target);
    else related.push(target);
  }
  for (const dep of incoming.data ?? []) {
    const source = dep.source as unknown as TaskSummary | null;
    if (!source) continue;
    if (dep.dependency_type === "blocks") blockedBy.push(source);
    // Quem aponta parent_of para esta tarefa é o PAI, não um filho
    else if (dep.dependency_type === "parent_of") parentTask = parentTask ?? source;
    else related.push(source);
  }
  for (const child of (logicalChildren.data as TaskSummary[] | null) ?? []) {
    if (!children.some((c) => c.id === child.id)) children.push(child);
  }

  return {
    task,
    connected_tasks: {
      parent: parentTask,
      children,
      blocks,
      blocked_by: blockedBy,
      related: related.filter((t, i, arr) => arr.findIndex((x) => x.id === t.id) === i),
    },
    comments: (comments.data ?? []) as Comment[],
  };
}

export async function logActivity(
  db: DbClient,
  params: {
    workspaceId: string;
    projectId: string | null;
    taskId: string | null;
    actorType: ActorType;
    actorUserId: string | null;
    actorLabel: string;
    action: string;
    payload?: Record<string, unknown>;
  }
) {
  const { error } = await db.from("activity_logs").insert({
    workspace_id: params.workspaceId,
    project_id: params.projectId,
    task_id: params.taskId,
    actor_type: params.actorType,
    actor_user_id: params.actorUserId,
    actor_label: params.actorLabel,
    action: params.action,
    payload: (params.payload ?? {}) as Json,
  });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Escritas de agentes externos (RPCs atômicas; guardrail aplicado no banco)
// ---------------------------------------------------------------------------

export interface UpdateTaskStatusResult {
  task_key: string;
  previous_status: TaskStatus;
  new_status: TaskStatus;
  guardrail_applied: boolean;
  message: string;
}

export async function updateTaskStatusWithGuardrail(
  db: DbClient,
  params: {
    task: Task;
    status: TaskStatus;
    summary: string;
    filesChanged?: string[];
    commitOrPrUrl?: string;
    actorLabel: string;
    allowDirectDone: boolean;
  }
): Promise<UpdateTaskStatusResult> {
  const entry: AgentExecutionLogEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    actor: params.actorLabel,
    actor_type: "external_agent",
    summary: params.summary,
    files_changed: params.filesChanged,
    category: "progress",
    commit_or_pr_url: params.commitOrPrUrl,
  };

  const { data, error } = await db.rpc("agent_update_task_status", {
    p_task_id: params.task.id,
    p_status: params.status,
    p_entry: entry as unknown as Json,
    p_actor_label: params.actorLabel,
    p_allow_direct_done: params.allowDirectDone,
  });
  if (error) throw error;

  const result = data as unknown as Omit<UpdateTaskStatusResult, "message">;
  const message = result.guardrail_applied
    ? `Guardrail human-in-the-loop aplicado: status solicitado "done" foi redirecionado para "in_review". ` +
      `Aprovação humana é necessária para concluir a tarefa ${result.task_key}.`
    : `Status atualizado para ${result.new_status}.`;

  return { ...result, message };
}

export interface CreateLinkedTaskInput {
  projectId: string;
  title: string;
  type: TaskType;
  priority?: TaskPriority;
  specMarkdown?: string;
  acceptanceCriteria?: string[];
  parentTaskKey?: string;
  edgeType?: CanvasEdgeType;
  actorLabel: string;
}

/**
 * Cria tarefa + card (needs_auto_layout) + dependência com o pai numa única
 * transação. O pai e o canvas são validados antes de qualquer escrita.
 */
export async function createLinkedTask(
  db: DbClient,
  input: CreateLinkedTaskInput
): Promise<{ task_key: string; canvas_node_id: string; task_id: string }> {
  const { data, error } = await db.rpc("agent_create_linked_task", {
    p_project_id: input.projectId,
    p_title: input.title,
    p_type: input.type,
    p_actor_label: input.actorLabel,
    p_priority: input.priority ?? "medium",
    p_spec_markdown: input.specMarkdown ?? "",
    p_acceptance_criteria: (input.acceptanceCriteria ?? []).map((text) => ({
      id: crypto.randomUUID(),
      text,
      completed: false,
    })) as unknown as Json,
    p_parent_task_key: input.parentTaskKey ?? null,
    p_edge_type: input.parentTaskKey ? (input.edgeType ?? "parent_of") : null,
  });
  if (error) {
    if (error.message.includes("não encontrada") && input.parentTaskKey) {
      throw new TaskNotFoundError(input.parentTaskKey);
    }
    throw error;
  }
  return data as unknown as { task_key: string; canvas_node_id: string; task_id: string };
}

export async function appendAgentNote(
  db: DbClient,
  params: {
    task: Task;
    markdown: string;
    filesChanged?: string[];
    category?: "progress" | "architecture" | "blocker" | "test_result";
    actorLabel: string;
  }
): Promise<{ task_key: string; log_entries: number }> {
  const entry: AgentExecutionLogEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    actor: params.actorLabel,
    actor_type: "external_agent",
    summary: params.markdown,
    files_changed: params.filesChanged,
    category: params.category ?? "progress",
  };

  const { data, error } = await db.rpc("agent_append_note", {
    p_task_id: params.task.id,
    p_entry: entry as unknown as Json,
    p_actor_label: params.actorLabel,
  });
  if (error) throw error;
  return data as unknown as { task_key: string; log_entries: number };
}

// ---------------------------------------------------------------------------
// Visão geral do quadro
// ---------------------------------------------------------------------------

export interface CanvasOverviewResult {
  frames: Array<{ id: string; title: string; node_count: number }>;
  status_counts: Record<TaskStatus, number>;
  active_blockers: Array<{ task_key: string; title: string; blocked_by: string[] }>;
  unpromoted_sticky_notes: number;
  total_nodes: number;
}

export async function getCanvasOverview(db: DbClient, projectId: string): Promise<CanvasOverviewResult> {
  const canvasId = await getDefaultCanvasId(db, projectId);
  if (!canvasId) throw new Error(`No default canvas found for project ${projectId}`);

  const [nodesRes, tasksRes, depsRes] = await Promise.all([
    db.from("canvas_nodes").select("id, node_type, task_id, data, parent_frame_id").eq("canvas_id", canvasId),
    db.from("tasks").select("id, status, task_key, title").eq("project_id", projectId),
    db
      .from("task_dependencies")
      .select("source_task_id, target_task_id")
      .eq("project_id", projectId)
      .eq("dependency_type", "blocks"),
  ]);
  if (nodesRes.error) throw nodesRes.error;
  if (tasksRes.error) throw tasksRes.error;
  if (depsRes.error) throw depsRes.error;

  const allNodes = nodesRes.data ?? [];
  const frames = allNodes
    .filter((n) => n.node_type === "frame")
    .map((frame) => ({
      id: frame.id,
      title: ((frame.data as Record<string, unknown>)?.title as string | undefined) ?? "Frame",
      node_count: allNodes.filter((n) => n.parent_frame_id === frame.id).length,
    }));

  const statusCounts: Record<TaskStatus, number> = {
    backlog: 0,
    todo: 0,
    in_progress: 0,
    in_review: 0,
    blocked: 0,
    done: 0,
  };
  const tasks = tasksRes.data ?? [];
  const keyById = new Map(tasks.map((t) => [t.id, t.task_key]));
  for (const t of tasks) statusCounts[t.status] += 1;

  const deps = depsRes.data ?? [];
  const activeBlockers = tasks
    .filter((t) => t.status === "blocked")
    .map((t) => ({
      task_key: t.task_key,
      title: t.title,
      blocked_by: deps
        .filter((d) => d.target_task_id === t.id)
        .map((d) => keyById.get(d.source_task_id))
        .filter((k): k is string => Boolean(k)),
    }));

  return {
    frames,
    status_counts: statusCounts,
    active_blockers: activeBlockers,
    unpromoted_sticky_notes: allNodes.filter((n) => n.node_type === "sticky_note").length,
    total_nodes: allNodes.length,
  };
}

// ---------------------------------------------------------------------------
// Escritas da IA interna (com o client do usuário: RLS se aplica)
// ---------------------------------------------------------------------------

export interface CreateTaskWithNodeInput {
  canvasId: string;
  title: string;
  position: { x: number; y: number };
  type?: TaskType;
  priority?: TaskPriority;
  status?: TaskStatus;
  specMarkdown?: string;
  acceptanceCriteria?: string[];
  actorType?: Exclude<ActorType, "external_agent">;
  actorLabel?: string;
  needsAutoLayout?: boolean;
}

/** Tarefa + card no canvas numa única transação (sem tarefas órfãs). */
export async function createTaskWithNode(
  db: DbClient,
  input: CreateTaskWithNodeInput
): Promise<{ task: Task; nodeId: string }> {
  const { data, error } = await db.rpc("create_task_with_node", {
    p_canvas_id: input.canvasId,
    p_title: input.title,
    p_position_x: input.position.x,
    p_position_y: input.position.y,
    p_type: input.type ?? "task",
    p_priority: input.priority ?? "medium",
    p_status: input.status ?? "backlog",
    p_spec_markdown: input.specMarkdown ?? "",
    p_acceptance_criteria: (input.acceptanceCriteria ?? []).map((text) => ({
      id: crypto.randomUUID(),
      text,
      completed: false,
    })) as unknown as Json,
    p_actor_type: input.actorType ?? "human",
    p_actor_label: input.actorLabel ?? null,
    p_needs_auto_layout: input.needsAutoLayout ?? false,
  });
  if (error) throw error;
  const result = data as unknown as { task: TaskRow; node: { id: string } };
  return { task: rowToTask(result.task), nodeId: result.node.id };
}
