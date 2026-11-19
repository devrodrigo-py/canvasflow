import "server-only";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  listProjects,
  getBacklogTasks,
  getTaskContext,
  updateTaskStatusWithGuardrail,
  createLinkedTask,
  appendAgentNote,
  getCanvasOverview,
  getProjectBySlug,
  TaskNotFoundError,
  ProjectNotFoundError,
} from "@/lib/services/tasks.service";
import { requireScope, MCPAuthError } from "@/lib/mcp/auth";
import type { MCPContext } from "@/types/domain";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Db = SupabaseClient<Database>;

// ---------- Schemas Zod das tools ----------

export const listProjectsInput = z.object({});

export const getBacklogTasksInput = z.object({
  project_slug: z.string().min(1).describe("Slug do projeto (ex: 'app')"),
  status: z
    .array(z.enum(["backlog", "todo", "in_progress", "in_review", "blocked", "done"]))
    .optional()
    .describe("Filtrar por status"),
  priority: z
    .array(z.enum(["low", "medium", "high", "urgent"]))
    .optional()
    .describe("Filtrar por prioridade"),
  type: z
    .array(z.enum(["epic", "feature", "task", "bug", "tech_debt"]))
    .optional()
    .describe("Filtrar por tipo"),
  limit: z.number().int().min(1).max(200).optional().describe("Limite de resultados (padrão 100)"),
});

export const getTaskContextInput = z.object({
  task_key: z.string().min(1).describe("Chave da tarefa (ex: 'APP-1')"),
});

export const updateTaskStatusInput = z.object({
  task_key: z.string().min(1).describe("Chave da tarefa (ex: 'APP-1')"),
  status: z.enum(["backlog", "todo", "in_progress", "in_review", "blocked", "done"]),
  summary: z.string().min(1).describe("Resumo do que foi feito"),
  files_changed: z.array(z.string()).optional().describe("Arquivos alterados"),
  commit_or_pr_url: z.string().optional().describe("Link do commit ou PR"),
});

export const createLinkedTaskInput = z.object({
  project_slug: z.string().min(1).describe("Slug do projeto"),
  title: z.string().min(1).max(300),
  type: z.enum(["epic", "feature", "task", "bug", "tech_debt"]),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  spec_markdown: z.string().optional(),
  acceptance_criteria: z.array(z.string()).optional(),
  parent_task_key: z.string().optional().describe("Chave da tarefa pai para conectar no canvas"),
  edge_type: z.enum(["blocks", "parent_of", "relates_to", "derived_from"]).optional(),
});

export const appendAgentNoteInput = z.object({
  task_key: z.string().min(1),
  markdown: z.string().min(1),
  files_changed: z.array(z.string()).optional(),
  category: z.enum(["progress", "architecture", "blocker", "test_result"]).optional(),
});

export const getCanvasOverviewInput = z.object({
  project_slug: z.string().min(1),
});

// ---------- Handlers ----------

function getDb(): Db {
  return createAdminClient() as unknown as Db;
}

function toToolError(error: unknown): Error {
  if (error instanceof TaskNotFoundError || error instanceof ProjectNotFoundError) {
    return new Error(error.message);
  }
  if (error instanceof MCPAuthError) {
    return new Error(error.message);
  }
  if (error instanceof Error) {
    // Não expõe detalhes internos do banco ao agente
    if (error.message.includes("violates") || error.message.includes("duplicate")) {
      return new Error("Operação violou uma restrição do banco de dados");
    }
    return error;
  }
  return new Error("Erro interno");
}

export async function handleListProjects(context: MCPContext) {
  requireScope(context, "tasks:read");
  try {
    const db = getDb();
    const projects = await listProjects(db, context.workspaceId, context.projectId);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ projects }, null, 2),
        },
      ],
    };
  } catch (error) {
    throw toToolError(error);
  }
}

export async function handleGetBacklogTasks(context: MCPContext, input: z.infer<typeof getBacklogTasksInput>) {
  requireScope(context, "tasks:read");
  try {
    const db = getDb();
    const project = await getProjectBySlug(db, context.workspaceId, input.project_slug, context.projectId);
    const tasks = await getBacklogTasks(db, project.id, {
      status: input.status,
      priority: input.priority,
      type: input.type,
      limit: input.limit,
    });
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ project: project.slug, count: tasks.length, tasks }, null, 2),
        },
      ],
    };
  } catch (error) {
    throw toToolError(error);
  }
}

export async function handleGetTaskContext(context: MCPContext, input: z.infer<typeof getTaskContextInput>) {
  requireScope(context, "tasks:read");
  try {
    const db = getDb();
    // A tarefa é resolvida dentro do escopo do token: procura nos projetos acessíveis
    const projects = await listProjects(db, context.workspaceId, context.projectId);
    let result: Awaited<ReturnType<typeof getTaskContext>> | null = null;
    let lastError: unknown = null;

    for (const project of projects) {
      try {
        result = await getTaskContext(db, project.id, input.task_key);
        break;
      } catch (err) {
        if (!(err instanceof TaskNotFoundError)) lastError = err;
      }
    }

    if (!result) {
      if (lastError) throw lastError;
      throw new TaskNotFoundError(input.task_key);
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              task: {
                task_key: result.task.task_key,
                title: result.task.title,
                status: result.task.status,
                priority: result.task.priority,
                type: result.task.type,
                spec_markdown: result.task.spec_markdown,
                acceptance_criteria: result.task.acceptance_criteria,
                agent_execution_log: result.task.agent_execution_log,
              },
              connected_tasks: {
                blocks: result.connected_tasks.blocks.map((t) => ({ task_key: t.task_key, title: t.title, status: t.status })),
                blocked_by: result.connected_tasks.blocked_by.map((t) => ({ task_key: t.task_key, title: t.title, status: t.status })),
                children: result.connected_tasks.children.map((t) => ({ task_key: t.task_key, title: t.title, status: t.status })),
              },
              open_comments: result.comments.map((c) => ({
                author: c.author_label,
                body: c.body_markdown,
                created_at: c.created_at,
              })),
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    throw toToolError(error);
  }
}

export async function handleUpdateTaskStatus(context: MCPContext, input: z.infer<typeof updateTaskStatusInput>) {
  requireScope(context, "tasks:write");
  try {
    const db = getDb();
    const project = await resolveProjectForTask(db, context, input.task_key);

    const result = await updateTaskStatusWithGuardrail(db, {
      projectId: project.id,
      workspaceId: context.workspaceId,
      taskKey: input.task_key,
      status: input.status,
      summary: input.summary,
      filesChanged: input.files_changed,
      commitOrPrUrl: input.commit_or_pr_url,
      actorLabel: context.actorLabel,
      allowDirectDone: context.allowDirectDone,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              task_key: result.task_key,
              previous_status: result.previous_status,
              new_status: result.new_status,
              guardrail_applied: result.guardrail_applied,
              message: result.message,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    throw toToolError(error);
  }
}

export async function handleCreateLinkedTask(context: MCPContext, input: z.infer<typeof createLinkedTaskInput>) {
  requireScope(context, "tasks:write");
  requireScope(context, "canvas:write");
  try {
    const db = getDb();
    const project = await getProjectBySlug(db, context.workspaceId, input.project_slug, context.projectId);

    const result = await createLinkedTask(db, {
      projectId: project.id,
      workspaceId: context.workspaceId,
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
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              task_key: result.task_key,
              canvas_node_id: result.canvas_node_id,
              message: `Tarefa ${result.task_key} criada e projetada no canvas com auto-layout.`,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    throw toToolError(error);
  }
}

export async function handleAppendAgentNote(context: MCPContext, input: z.infer<typeof appendAgentNoteInput>) {
  requireScope(context, "tasks:write");
  try {
    const db = getDb();
    const project = await resolveProjectForTask(db, context, input.task_key);

    const result = await appendAgentNote(db, {
      projectId: project.id,
      workspaceId: context.workspaceId,
      taskKey: input.task_key,
      markdown: input.markdown,
      filesChanged: input.files_changed,
      category: input.category,
      actorLabel: context.actorLabel,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              task_key: result.task_key,
              log_entries: result.log_entries,
              message: `Nota registrada no agent_execution_log de ${result.task_key} (spec humana preservada).`,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    throw toToolError(error);
  }
}

export async function handleGetCanvasOverview(context: MCPContext, input: z.infer<typeof getCanvasOverviewInput>) {
  requireScope(context, "tasks:read");
  try {
    const db = getDb();
    const project = await getProjectBySlug(db, context.workspaceId, input.project_slug, context.projectId);
    const overview = await getCanvasOverview(db, project.id);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(overview, null, 2),
        },
      ],
    };
  } catch (error) {
    throw toToolError(error);
  }
}

async function resolveProjectForTask(db: Db, context: MCPContext, taskKey: string) {
  const projects = await listProjects(db, context.workspaceId, context.projectId);
  for (const project of projects) {
    const { data, error } = await db
      .from("tasks")
      .select("id")
      .eq("project_id", project.id)
      .eq("task_key", taskKey)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      const full = await getProjectBySlug(db, context.workspaceId, project.slug, context.projectId);
      return full;
    }
  }
  throw new TaskNotFoundError(taskKey);
}
