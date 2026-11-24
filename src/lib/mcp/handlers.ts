import "server-only";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  listProjects,
  getBacklogTasks,
  getTaskByKeyInScope,
  getTaskContext,
  updateTaskStatusWithGuardrail,
  createLinkedTask,
  appendAgentNote,
  getCanvasOverview,
  getProjectBySlug,
  TaskNotFoundError,
  ProjectNotFoundError,
} from "@/lib/services/tasks.service";
import { requireScope, MCPAuthError, MCPScopeError } from "@/lib/mcp/auth";
import type { MCPContext } from "@/types/domain";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Db = SupabaseClient<Database>;

const TASK_STATUSES = ["backlog", "todo", "in_progress", "in_review", "blocked", "done"] as const;
const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const TASK_TYPES = ["epic", "feature", "task", "bug", "tech_debt"] as const;
const EDGE_TYPES = ["blocks", "parent_of", "relates_to", "derived_from"] as const;

// ---------- Schemas Zod das tools ----------

export const listProjectsInput = z.object({});

export const getBacklogTasksInput = z.object({
  project_slug: z.string().min(1).describe("Slug do projeto (ex: 'app')"),
  status: z.array(z.enum(TASK_STATUSES)).optional().describe("Filtrar por status"),
  priority: z.array(z.enum(TASK_PRIORITIES)).optional().describe("Filtrar por prioridade"),
  type: z.array(z.enum(TASK_TYPES)).optional().describe("Filtrar por tipo"),
  limit: z.number().int().min(1).max(200).optional().describe("Limite de resultados (padrão 100)"),
  offset: z.number().int().min(0).optional().describe("Deslocamento para paginação (padrão 0)"),
});

export const getTaskContextInput = z.object({
  task_key: z.string().min(1).describe("Chave da tarefa (ex: 'APP-1')"),
});

export const updateTaskStatusInput = z.object({
  task_key: z.string().min(1).describe("Chave da tarefa (ex: 'APP-1')"),
  status: z.enum(TASK_STATUSES),
  summary: z.string().min(1).max(10_000).describe("Resumo do que foi feito"),
  files_changed: z.array(z.string().max(500)).max(500).optional().describe("Arquivos alterados"),
  commit_or_pr_url: z.string().url().max(2000).optional().describe("Link do commit ou PR"),
});

export const createLinkedTaskInput = z.object({
  project_slug: z.string().min(1).describe("Slug do projeto"),
  title: z.string().min(1).max(300),
  type: z.enum(TASK_TYPES),
  priority: z.enum(TASK_PRIORITIES).optional(),
  spec_markdown: z.string().max(50_000).optional(),
  acceptance_criteria: z.array(z.string().max(1000)).max(50).optional(),
  parent_task_key: z.string().optional().describe("Chave da tarefa pai para conectar no canvas"),
  edge_type: z.enum(EDGE_TYPES).optional(),
});

export const appendAgentNoteInput = z.object({
  task_key: z.string().min(1),
  markdown: z.string().min(1).max(20_000),
  files_changed: z.array(z.string().max(500)).max(500).optional(),
  category: z.enum(["progress", "architecture", "blocker", "test_result"]).optional(),
});

export const getCanvasOverviewInput = z.object({
  project_slug: z.string().min(1),
});

// ---------- Handlers ----------

function getDb(): Db {
  return createAdminClient() as unknown as Db;
}

function toText(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "";
}

export function toToolError(error: unknown): Error {
  if (
    error instanceof TaskNotFoundError ||
    error instanceof ProjectNotFoundError ||
    error instanceof MCPAuthError ||
    error instanceof MCPScopeError
  ) {
    return new Error(error.message);
  }
  const message = errorMessage(error);
  // Regras de negócio levantadas pelo banco (guardrail, validações) são úteis ao agente
  if (/Guardrail|não encontrad|canvas padrão|mesmo projeto/.test(message)) {
    return new Error(message);
  }
  // Não expõe detalhes internos do banco ao agente
  if (message.includes("violates") || message.includes("duplicate")) {
    return new Error("Operação violou uma restrição do banco de dados");
  }
  console.error("mcp tool error:", error);
  return new Error("Erro interno ao executar a tool");
}

/** Verifica escopos, executa e normaliza erros para o agente. */
async function run<T>(context: MCPContext, scopes: string[], fn: (db: Db) => Promise<T>) {
  try {
    for (const scope of scopes) requireScope(context, scope);
    return toText(await fn(getDb()));
  } catch (error) {
    throw toToolError(error);
  }
}

export function handleListProjects(context: MCPContext) {
  return run(context, ["tasks:read"], async (db) => ({
    projects: await listProjects(db, context.workspaceId, context.projectId),
  }));
}

export function handleGetBacklogTasks(context: MCPContext, input: z.infer<typeof getBacklogTasksInput>) {
  return run(context, ["tasks:read"], async (db) => {
    const project = await getProjectBySlug(db, context.workspaceId, input.project_slug, context.projectId);
    const page = await getBacklogTasks(db, project.id, {
      status: input.status,
      priority: input.priority,
      type: input.type,
      limit: input.limit,
      offset: input.offset,
    });
    return {
      project: project.slug,
      total: page.total,
      offset: page.offset,
      count: page.tasks.length,
      has_more: page.offset + page.tasks.length < page.total,
      tasks: page.tasks,
    };
  });
}

export function handleGetTaskContext(context: MCPContext, input: z.infer<typeof getTaskContextInput>) {
  return run(context, ["tasks:read"], async (db) => {
    const task = await getTaskByKeyInScope(db, context.workspaceId, context.projectId, input.task_key);
    const result = await getTaskContext(db, task);
    const summarize = (t: { task_key: string; title: string; status: string }) => ({
      task_key: t.task_key,
      title: t.title,
      status: t.status,
    });
    return {
      task: {
        task_key: task.task_key,
        title: task.title,
        status: task.status,
        priority: task.priority,
        type: task.type,
        spec_markdown: task.spec_markdown,
        acceptance_criteria: task.acceptance_criteria,
        agent_execution_log: task.agent_execution_log,
      },
      connected_tasks: {
        parent: result.connected_tasks.parent ? summarize(result.connected_tasks.parent) : null,
        children: result.connected_tasks.children.map(summarize),
        blocks: result.connected_tasks.blocks.map(summarize),
        blocked_by: result.connected_tasks.blocked_by.map(summarize),
        related: result.connected_tasks.related.map(summarize),
      },
      open_comments: result.comments.map((c) => ({
        author: c.author_label,
        body: c.body_markdown,
        created_at: c.created_at,
      })),
    };
  });
}

export function handleUpdateTaskStatus(context: MCPContext, input: z.infer<typeof updateTaskStatusInput>) {
  return run(context, ["tasks:write"], async (db) => {
    const task = await getTaskByKeyInScope(db, context.workspaceId, context.projectId, input.task_key);
    return updateTaskStatusWithGuardrail(db, {
      task,
      status: input.status,
      summary: input.summary,
      filesChanged: input.files_changed,
      commitOrPrUrl: input.commit_or_pr_url,
      actorLabel: context.actorLabel,
      allowDirectDone: context.allowDirectDone,
    });
  });
}

export function handleCreateLinkedTask(context: MCPContext, input: z.infer<typeof createLinkedTaskInput>) {
  return run(context, ["tasks:write", "canvas:write"], async (db) => {
    const project = await getProjectBySlug(db, context.workspaceId, input.project_slug, context.projectId);
    const result = await createLinkedTask(db, {
      projectId: project.id,
      title: input.title,
      type: input.type,
      priority: input.priority,
      specMarkdown: input.spec_markdown,
      acceptanceCriteria: input.acceptance_criteria,
      parentTaskKey: input.parent_task_key,
      edgeType: input.edge_type,
      actorLabel: context.actorLabel,
    });
    return {
      task_key: result.task_key,
      canvas_node_id: result.canvas_node_id,
      message: `Tarefa ${result.task_key} criada e projetada no canvas com auto-layout.`,
    };
  });
}

export function handleAppendAgentNote(context: MCPContext, input: z.infer<typeof appendAgentNoteInput>) {
  return run(context, ["tasks:write"], async (db) => {
    const task = await getTaskByKeyInScope(db, context.workspaceId, context.projectId, input.task_key);
    const result = await appendAgentNote(db, {
      task,
      markdown: input.markdown,
      filesChanged: input.files_changed,
      category: input.category,
      actorLabel: context.actorLabel,
    });
    return {
      ...result,
      message: `Nota registrada no agent_execution_log de ${result.task_key} (spec humana preservada).`,
    };
  });
}

export function handleGetCanvasOverview(context: MCPContext, input: z.infer<typeof getCanvasOverviewInput>) {
  return run(context, ["tasks:read"], async (db) => {
    const project = await getProjectBySlug(db, context.workspaceId, input.project_slug, context.projectId);
    return getCanvasOverview(db, project.id);
  });
}
