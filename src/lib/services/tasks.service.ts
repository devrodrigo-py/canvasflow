import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  Task,
  TaskStatus,
  TaskPriority,
  TaskType,
  CanvasEdgeType,
  AgentExecutionLogEntry,
  Comment,
} from "@/types/domain";

type DbClient = SupabaseClient<Database>;

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

export class InsufficientScopeError extends Error {
  constructor(scope: string) {
    super(`Token is missing required scope: ${scope}`);
    this.name = "InsufficientScopeError";
  }
}

function rowToTask(row: Database["public"]["Tables"]["tasks"]["Row"]): Task {
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

export function toTask(row: Database["public"]["Tables"]["tasks"]["Row"]): Task {
  return rowToTask(row);
}

export async function getProjectBySlug(
  db: DbClient,
  workspaceId: string,
  projectSlug: string,
  projectIdConstraint: string | null
) {
  let query = db
    .from("projects")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("slug", projectSlug)
    .limit(1);

  if (projectIdConstraint) {
    query = query.eq("id", projectIdConstraint);
  }

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
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export async function listProjects(
  db: DbClient,
  workspaceId: string,
  projectIdConstraint: string | null
) {
  let query = db.from("projects").select("*").eq("workspace_id", workspaceId).order("created_at");
  if (projectIdConstraint) {
    query = query.eq("id", projectIdConstraint);
  }
  const { data, error } = await query;
  if (error) throw error;

  const projects = await Promise.all(
    (data ?? []).map(async (project) => ({
      id: project.id,
      slug: project.slug,
      name: project.name,
      key_prefix: project.key_prefix,
      default_canvas_id: await getDefaultCanvasId(db, project.id),
    }))
  );

  return projects;
}

export interface BacklogFilters {
  status?: TaskStatus[];
  priority?: TaskPriority[];
  type?: TaskType[];
  limit?: number;
}

export async function getBacklogTasks(
  db: DbClient,
  projectId: string,
  filters: BacklogFilters
): Promise<
  Array<{
    task_key: string;
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    type: TaskType;
    parent_task_key: string | null;
  }>
> {
  let query = db
    .from("tasks")
    .select("task_key, title, status, priority, type, parent_task_id, parent_task:tasks!parent_task_id(task_key)")
    .eq("project_id", projectId)
    .order("task_key", { ascending: true });

  if (filters.status?.length) query = query.in("status", filters.status);
  if (filters.priority?.length) query = query.in("priority", filters.priority);
  if (filters.type?.length) query = query.in("type", filters.type);

  query = query.limit(Math.min(filters.limit ?? 100, 200));

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row) => {
    const parent = row.parent_task as unknown as { task_key: string } | null;
    return {
      task_key: row.task_key,
      title: row.title,
      status: row.status,
      priority: row.priority,
      type: row.type,
      parent_task_key: parent?.task_key ?? null,
    };
  });
}

export async function getTaskByKey(db: DbClient, projectId: string, taskKey: string): Promise<Task> {
  const { data, error } = await db
    .from("tasks")
    .select("*")
    .eq("project_id", projectId)
    .eq("task_key", taskKey)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new TaskNotFoundError(taskKey);
  return rowToTask(data);
}

export async function getTaskById(db: DbClient, taskId: string): Promise<Task | null> {
  const { data, error } = await db.from("tasks").select("*").eq("id", taskId).maybeSingle();
  if (error) throw error;
  return data ? rowToTask(data) : null;
}

export async function getTaskContext(db: DbClient, projectId: string, taskKey: string) {
  const task = await getTaskByKey(db, projectId, taskKey);

  // Tarefas conectadas via arestas do canvas (blocks / blocked_by / children)
  const { data: node, error: nodeError } = await db
    .from("canvas_nodes")
    .select("id")
    .eq("task_id", task.id)
    .limit(1)
    .maybeSingle();
  if (nodeError) throw nodeError;

  const blocks: Task[] = [];
  const blocked_by: Task[] = [];
  const children: Task[] = [];

  if (node) {
    const { data: edges, error: edgesError } = await db
      .from("canvas_edges")
      .select(
        "edge_type, source:canvas_nodes!canvas_edges_source_node_id_fkey(id, task:tasks(id, task_key, title, status, priority, type)), target:canvas_nodes!canvas_edges_target_node_id_fkey(id, task:tasks(id, task_key, title, status, priority, type))"
      )
      .or(`source_node_id.eq.${node.id},target_node_id.eq.${node.id}`);
    if (edgesError) throw edgesError;

    for (const edge of edges ?? []) {
      const sourceTask = edge.source?.task;
      const targetTask = edge.target?.task;
      if (!sourceTask || !targetTask) continue;

      if (edge.edge_type === "blocks") {
        if (edge.source.id === node.id) blocks.push(rowToTask(targetTask as never));
        else blocked_by.push(rowToTask(sourceTask as never));
      } else if (edge.edge_type === "parent_of") {
        if (edge.source.id === node.id) children.push(rowToTask(targetTask as never));
        else children.push(rowToTask(sourceTask as never));
      }
    }
  }

  // Filhos também via parent_task_id (relação lógica além do canvas)
  const { data: logicalChildren, error: childrenError } = await db
    .from("tasks")
    .select("*")
    .eq("parent_task_id", task.id);
  if (childrenError) throw childrenError;
  for (const child of logicalChildren ?? []) {
    if (!children.some((c) => c.id === child.id)) children.push(rowToTask(child));
  }

  // Comentários abertos
  const { data: comments, error: commentsError } = await db
    .from("comments")
    .select("*")
    .eq("task_id", task.id)
    .eq("resolved", false)
    .order("created_at", { ascending: true });
  if (commentsError) throw commentsError;

  return {
    task,
    connected_tasks: { blocks, blocked_by, children },
    comments: (comments ?? []) as Comment[],
  };
}

export async function logActivity(
  db: DbClient,
  params: {
    workspaceId: string;
    projectId: string | null;
    taskId: string | null;
    actorType: "human" | "internal_ai" | "external_agent";
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
    payload: (params.payload ?? {}) as Database["public"]["Tables"]["activity_logs"]["Insert"]["payload"],
  });
  if (error) throw error;
}

export interface UpdateTaskStatusResult {
  task_key: string;
  previous_status: TaskStatus;
  new_status: TaskStatus;
  guardrail_applied: boolean;
  message: string;
}

/**
 * Atualiza o status de uma tarefa aplicando o guardrail human-in-the-loop:
 * se o agente externo tentar mover para `done` sem `allowDirectDone`, redireciona para `in_review`.
 */
export async function updateTaskStatusWithGuardrail(
  db: DbClient,
  params: {
    projectId: string;
    workspaceId: string;
    taskKey: string;
    status: TaskStatus;
    summary: string;
    filesChanged?: string[];
    commitOrPrUrl?: string;
    actorLabel: string;
    allowDirectDone: boolean;
  }
): Promise<UpdateTaskStatusResult> {
  const task = await getTaskByKey(db, params.projectId, params.taskKey);

  let finalStatus: TaskStatus = params.status;
  let guardrailApplied = false;
  let message = `Status atualizado para ${finalStatus}.`;

  if (params.status === "done" && !params.allowDirectDone) {
    finalStatus = "in_review";
    guardrailApplied = true;
    message =
      `Guardrail human-in-the-loop aplicado: status solicitado "done" foi redirecionado para "in_review". ` +
      `Aprovação humana é necessária para concluir a tarefa ${task.task_key}.`;
  }

  const now = new Date().toISOString();
  const logEntry: AgentExecutionLogEntry = {
    id: crypto.randomUUID(),
    timestamp: now,
    actor: params.actorLabel,
    actor_type: "external_agent",
    summary: params.summary,
    files_changed: params.filesChanged,
    category: "progress",
    commit_or_pr_url: params.commitOrPrUrl,
  };

  const { error } = await db
    .from("tasks")
    .update({
      status: finalStatus,
      agent_execution_log: [
        ...task.agent_execution_log,
        logEntry,
      ] as unknown as Database["public"]["Tables"]["tasks"]["Update"]["agent_execution_log"],
      last_updated_by_type: "external_agent",
      last_updated_by_label: params.actorLabel,
    })
    .eq("id", task.id);
  if (error) throw error;

  await logActivity(db, {
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    taskId: task.id,
    actorType: "external_agent",
    actorUserId: null,
    actorLabel: params.actorLabel,
    action: "task.status_changed",
    payload: {
      from: task.status,
      to: finalStatus,
      requested_status: params.status,
      guardrail_applied: guardrailApplied,
      summary: params.summary,
      commit_or_pr_url: params.commitOrPrUrl,
    },
  });

  return {
    task_key: task.task_key,
    previous_status: task.status,
    new_status: finalStatus,
    guardrail_applied: guardrailApplied,
    message,
  };
}

export interface CreateLinkedTaskInput {
  projectId: string;
  workspaceId: string;
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
 * Cria uma tarefa + projeta um TaskCardNode no canvas padrão com needs_auto_layout = true
 * e conecta ao nó pai (se fornecido) via canvas_edges.
 */
export async function createLinkedTask(
  db: DbClient,
  input: CreateLinkedTaskInput
): Promise<{ task_key: string; canvas_node_id: string; task_id: string }> {
  const { data: task, error: taskError } = await db
    .from("tasks")
    .insert({
      project_id: input.projectId,
      title: input.title,
      type: input.type,
      priority: input.priority ?? "medium",
      spec_markdown: input.specMarkdown ?? "",
      acceptance_criteria: (input.acceptanceCriteria ?? []).map((text, i) => ({
        id: `${Date.now()}-${i}`,
        text,
        completed: false,
      })),
      last_updated_by_type: "external_agent",
      last_updated_by_label: input.actorLabel,
    })
    .select("*")
    .single();
  if (taskError) throw taskError;

  let parentTask: Task | null = null;
  if (input.parentTaskKey) {
    parentTask = await getTaskByKey(db, input.projectId, input.parentTaskKey);

    // Herda parent_task_id lógico quando o edge é de hierarquia
    if (input.edgeType === "parent_of" && !task.parent_task_id) {
      await db.from("tasks").update({ parent_task_id: parentTask.id }).eq("id", task.id);
    }
  }

  const canvasId = await getDefaultCanvasId(db, input.projectId);
  if (!canvasId) {
    throw new Error(`No default canvas found for project ${input.projectId}`);
  }

  const { data: node, error: nodeError } = await db
    .from("canvas_nodes")
    .insert({
      canvas_id: canvasId,
      node_type: "task_card",
      task_id: task.id,
      needs_auto_layout: true,
      data: {
        title: task.title,
      },
    })
    .select("id")
    .single();
  if (nodeError) throw nodeError;

  if (parentTask) {
    const { data: parentNode, error: parentLookupError } = await db
      .from("canvas_nodes")
      .select("id")
      .eq("task_id", parentTask.id)
      .eq("canvas_id", canvasId)
      .limit(1)
      .maybeSingle();
    if (parentLookupError) throw parentLookupError;

    if (parentNode) {
      const edgeType = input.edgeType ?? "parent_of";
      const { error: edgeError } = await db.from("canvas_edges").insert({
        canvas_id: canvasId,
        source_node_id: parentNode.id,
        target_node_id: node.id,
        edge_type: edgeType,
      });
      // Ignora conflito de duplicidade para manter a operação idempotente
      if (edgeError && edgeError.code !== "23505") throw edgeError;
    }
  }

  await logActivity(db, {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    taskId: task.id,
    actorType: "external_agent",
    actorUserId: null,
    actorLabel: input.actorLabel,
    action: "task.created",
    payload: {
      title: input.title,
      type: input.type,
      parent_task_key: input.parentTaskKey,
      canvas_node_id: node.id,
    },
  });

  return { task_key: task.task_key, canvas_node_id: node.id, task_id: task.id };
}

export async function appendAgentNote(
  db: DbClient,
  params: {
    projectId: string;
    workspaceId: string;
    taskKey: string;
    markdown: string;
    filesChanged?: string[];
    category?: "progress" | "architecture" | "blocker" | "test_result";
    actorLabel: string;
  }
): Promise<{ task_key: string; log_entries: number }> {
  const task = await getTaskByKey(db, params.projectId, params.taskKey);

  const logEntry: AgentExecutionLogEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    actor: params.actorLabel,
    actor_type: "external_agent",
    summary: params.markdown,
    files_changed: params.filesChanged,
    category: params.category ?? "progress",
  };

  const { error } = await db
    .from("tasks")
    .update({
      agent_execution_log: [
        ...task.agent_execution_log,
        logEntry,
      ] as unknown as Database["public"]["Tables"]["tasks"]["Update"]["agent_execution_log"],
      last_updated_by_type: "external_agent",
      last_updated_by_label: params.actorLabel,
    })
    .eq("id", task.id);
  if (error) throw error;

  await logActivity(db, {
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    taskId: task.id,
    actorType: "external_agent",
    actorUserId: null,
    actorLabel: params.actorLabel,
    action: "agent.note_appended",
    payload: { category: logEntry.category, files_changed: params.filesChanged },
  });

  return { task_key: task.task_key, log_entries: task.agent_execution_log.length + 1 };
}

export interface CanvasOverviewResult {
  frames: Array<{ id: string; title: string; node_count: number }>;
  status_counts: Record<TaskStatus, number>;
  active_blockers: Array<{ task_key: string; title: string; blocked_by: string[] }>;
  unpromoted_sticky_notes: number;
  total_nodes: number;
}

export async function getCanvasOverview(
  db: DbClient,
  projectId: string
): Promise<CanvasOverviewResult> {
  const canvasId = await getDefaultCanvasId(db, projectId);
  if (!canvasId) throw new Error(`No default canvas found for project ${projectId}`);

  const { data: nodes, error: nodesError } = await db
    .from("canvas_nodes")
    .select("id, node_type, task_id, data, parent_frame_id")
    .eq("canvas_id", canvasId);
  if (nodesError) throw nodesError;

  const allNodes = nodes ?? [];
  const frameNodes = allNodes.filter((n) => n.node_type === "frame");

  const frames = frameNodes.map((frame) => ({
    id: frame.id,
    title: (frame.data as Record<string, unknown>)?.title as string | undefined ?? "Frame",
    node_count: allNodes.filter((n) => n.parent_frame_id === frame.id && n.id !== frame.id).length,
  }));

  const taskIds = allNodes
    .filter((n) => n.node_type === "task_card" && n.task_id)
    .map((n) => n.task_id as string);

  const statusCounts: Record<TaskStatus, number> = {
    backlog: 0,
    todo: 0,
    in_progress: 0,
    in_review: 0,
    blocked: 0,
    done: 0,
  };

  const active_blockers: Array<{ task_key: string; title: string; blocked_by: string[] }> = [];

  if (taskIds.length > 0) {
    const { data: tasks, error: tasksError } = await db
      .from("tasks")
      .select("id, status, task_key, title")
      .in("id", taskIds);
    if (tasksError) throw tasksError;

    for (const t of tasks ?? []) {
      statusCounts[t.status] = (statusCounts[t.status] ?? 0) + 1;
    }

    // Bloqueadores ativos: tarefas com status blocked + quem as bloqueia
    const blockedTasks = (tasks ?? []).filter((t) => t.status === "blocked");
    const nodeByTaskId = new Map(
      allNodes.filter((n) => n.task_id).map((n) => [n.task_id as string, n.id])
    );

    const { data: edges, error: edgesError } = await db
      .from("canvas_edges")
      .select("source_node_id, target_node_id")
      .eq("canvas_id", canvasId)
      .eq("edge_type", "blocks");
    if (edgesError) throw edgesError;

    const blockedByByKey = new Map<string, string[]>();
    const nodeIdToTaskKey = new Map<string, string>();
    for (const t of tasks ?? []) {
      const nodeId = nodeByTaskId.get(t.id);
      if (nodeId) nodeIdToTaskKey.set(nodeId, t.task_key);
    }

    for (const t of blockedTasks) {
      const targetNodeId = nodeByTaskId.get(t.id);
      if (!targetNodeId) continue;
      const blockers = (edges ?? [])
        .filter((e) => e.target_node_id === targetNodeId)
        .map((e) => nodeIdToTaskKey.get(e.source_node_id))
        .filter((k): k is string => Boolean(k));
      blockedByByKey.set(t.task_key, blockers);
    }

    for (const t of blockedTasks) {
      active_blockers.push({
        task_key: t.task_key,
        title: t.title,
        blocked_by: blockedByByKey.get(t.task_key) ?? [],
      });
    }
  }

  return {
    frames,
    status_counts: statusCounts,
    active_blockers,
    unpromoted_sticky_notes: allNodes.filter((n) => n.node_type === "sticky_note").length,
    total_nodes: allNodes.length,
  };
}

export interface CreateTaskInput {
  projectId: string;
  title: string;
  type: TaskType;
  priority?: TaskPriority;
  status?: TaskStatus;
  sprint?: string;
  estimatePoints?: number;
  assigneeId?: string;
  parentTaskId?: string;
  specMarkdown?: string;
  acceptanceCriteria?: Array<{ id: string; text: string; completed: boolean }>;
  actorType?: "human" | "internal_ai" | "external_agent";
  actorLabel?: string;
}

export async function createTask(db: DbClient, input: CreateTaskInput): Promise<Task> {
  const { data, error } = await db
    .from("tasks")
    .insert({
      project_id: input.projectId,
      title: input.title,
      type: input.type,
      priority: input.priority ?? "medium",
      status: input.status ?? "backlog",
      sprint: input.sprint,
      estimate_points: input.estimatePoints,
      assignee_id: input.assigneeId,
      parent_task_id: input.parentTaskId,
      spec_markdown: input.specMarkdown ?? "",
      acceptance_criteria: input.acceptanceCriteria ?? [],
      last_updated_by_type: input.actorType ?? "human",
      last_updated_by_label: input.actorLabel,
    })
    .select("*")
    .single();
  if (error) throw error;
  return rowToTask(data);
}

export async function updateTask(
  db: DbClient,
  params: {
    taskId: string;
    workspaceId: string;
    updates: Partial<{
      title: string;
      status: TaskStatus;
      priority: TaskPriority;
      type: TaskType;
      sprint: string;
      estimate_points: number;
      assignee_id: string | null;
      parent_task_id: string | null;
      spec_json: unknown;
      spec_markdown: string;
      acceptance_criteria: Array<{ id: string; text: string; completed: boolean }>;
    }>;
    actorType?: "human" | "internal_ai" | "external_agent";
    actorLabel?: string;
    actorUserId?: string | null;
  }
): Promise<Task> {
  const { data: current, error: fetchError } = await db
    .from("tasks")
    .select("*")
    .eq("id", params.taskId)
    .single();
  if (fetchError) throw fetchError;

  const { data, error } = await db
    .from("tasks")
    .update({
      title: params.updates.title,
      status: params.updates.status,
      priority: params.updates.priority,
      type: params.updates.type,
      sprint: params.updates.sprint,
      estimate_points: params.updates.estimate_points,
      assignee_id: params.updates.assignee_id,
      parent_task_id: params.updates.parent_task_id,
      spec_json: params.updates.spec_json as Database["public"]["Tables"]["tasks"]["Update"]["spec_json"],
      spec_markdown: params.updates.spec_markdown,
      acceptance_criteria:
        params.updates.acceptance_criteria as Database["public"]["Tables"]["tasks"]["Update"]["acceptance_criteria"],
      last_updated_by_type: params.actorType ?? "human",
      last_updated_by_label: params.actorLabel ?? null,
    })
    .eq("id", params.taskId)
    .select("*")
    .single();
  if (error) throw error;

  await logActivity(db, {
    workspaceId: params.workspaceId,
    projectId: data.project_id,
    taskId: data.id,
    actorType: params.actorType ?? "human",
    actorUserId: params.actorUserId ?? null,
    actorLabel: params.actorLabel ?? "Você",
    action: "task.updated",
    payload: { updates: Object.keys(params.updates) },
  });

  return rowToTask(data);
}

export async function getWorkspaceBySlug(db: DbClient, slug: string) {
  const { data, error } = await db.from("workspaces").select("*").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getFirstWorkspaceForUser(db: DbClient, userId: string) {
  const { data, error } = await db
    .from("workspace_members")
    .select("workspace:workspaces(*)")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const workspace = data?.workspace;
  return Array.isArray(workspace) ? (workspace[0] ?? null) : (workspace ?? null);
}

export async function addComment(
  db: DbClient,
  params: {
    workspaceId: string;
    taskId: string;
    authorUserId: string;
    authorLabel: string;
    body: string;
    actorType?: "human" | "internal_ai" | "external_agent";
  }
): Promise<Comment> {
  const { data, error } = await db
    .from("comments")
    .insert({
      workspace_id: params.workspaceId,
      task_id: params.taskId,
      actor_type: params.actorType ?? "human",
      author_user_id: params.authorUserId,
      author_label: params.authorLabel,
      body_markdown: params.body,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Comment;
}
