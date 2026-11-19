import "server-only";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  listProjectsInput,
  getBacklogTasksInput,
  getTaskContextInput,
  updateTaskStatusInput,
  createLinkedTaskInput,
  appendAgentNoteInput,
  getCanvasOverviewInput,
  handleListProjects,
  handleGetBacklogTasks,
  handleGetTaskContext,
  handleUpdateTaskStatus,
  handleCreateLinkedTask,
  handleAppendAgentNote,
  handleGetCanvasOverview,
} from "@/lib/mcp/handlers";
import type { MCPContext } from "@/types/domain";

export const MCP_SERVER_NAME = "canvasflow";
export const MCP_SERVER_VERSION = "1.0.0";

/**
 * Cria a instância do servidor MCP com as 7 tools obrigatórias registradas.
 * Cada requisição HTTP recebe uma instância nova (modo stateless).
 */
export function createMCPServer(context: MCPContext): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    {
      instructions:
        "Servidor MCP do CanvasFlow AI. Use as tools para ler o backlog, obter contexto de tarefas, " +
        "atualizar status (com guardrail human-in-the-loop para done), criar tarefas conectadas no canvas, " +
        "registrar logs de execução e obter uma visão geral do quadro. Nenhuma tool aceita coordenadas (x, y): " +
        "o posicionamento no canvas é sempre calculado automaticamente.",
    }
  );

  server.registerTool(
    "list_projects",
    {
      description:
        "Lista os projetos acessíveis pelo token atual, com id, slug, name, key_prefix e default_canvas_id.",
      inputSchema: listProjectsInput.shape,
    },
    async () => handleListProjects(context)
  );

  server.registerTool(
    "get_backlog_tasks",
    {
      description:
        "Retorna lista paginada de tarefas do backlog com task_key, title, status, priority, type e parent_task_key.",
      inputSchema: getBacklogTasksInput.shape,
    },
    async (args) => handleGetBacklogTasks(context, getBacklogTasksInput.parse(args))
  );

  server.registerTool(
    "get_task_context",
    {
      description:
        "Retorna o contexto completo de uma tarefa: spec_markdown, acceptance_criteria, agent_execution_log, " +
        "comentários abertos e tarefas conectadas no canvas (blocks, blocked_by, children).",
      inputSchema: getTaskContextInput.shape,
    },
    async (args) => handleGetTaskContext(context, getTaskContextInput.parse(args))
  );

  server.registerTool(
    "update_task_status",
    {
      description:
        "Atualiza o status de uma tarefa registrando a execução no agent_execution_log. " +
        "IMPORTANTE: por padrão (human-in-the-loop) o status 'done' é redirecionado para 'in_review' e requer aprovação humana.",
      inputSchema: updateTaskStatusInput.shape,
    },
    async (args) => handleUpdateTaskStatus(context, updateTaskStatusInput.parse(args))
  );

  server.registerTool(
    "create_linked_task",
    {
      description:
        "Cria uma nova tarefa (ex: bug ou débito técnico encontrado durante a execução), projeta um card no canvas " +
        "padrão com posicionamento automático e conecta ao nó pai quando informado. Retorna a task_key criada.",
      inputSchema: createLinkedTaskInput.shape,
    },
    async (args) => handleCreateLinkedTask(context, createLinkedTaskInput.parse(args))
  );

  server.registerTool(
    "append_agent_note",
    {
      description:
        "Adiciona uma nota técnica (progresso, arquitetura, bloqueio ou resultado de teste) ao log de execução " +
        "da tarefa sem alterar seu status. A spec humana nunca é sobrescrita.",
      inputSchema: appendAgentNoteInput.shape,
    },
    async (args) => handleAppendAgentNote(context, appendAgentNoteInput.parse(args))
  );

  server.registerTool(
    "get_canvas_overview",
    {
      description:
        "Resumo estruturado do quadro: frames (ex: Inbox da IA), contagem de cards por status, bloqueadores " +
        "ativos e post-its ainda não promovidos.",
      inputSchema: getCanvasOverviewInput.shape,
    },
    async (args) => handleGetCanvasOverview(context, getCanvasOverviewInput.parse(args))
  );

  return server;
}
