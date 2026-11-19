import { describe, it, expect, vi, beforeEach } from "vitest";

// O admin client é substituído por um mock chainable configurável por teste
const { dbMock } = vi.hoisted(() => ({ dbMock: { from: vi.fn() } }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => dbMock),
}));

import { authenticateMCPRequest, requireScope, MCPAuthError } from "@/lib/mcp/auth";
import { updateTaskStatusWithGuardrail } from "@/lib/services/tasks.service";
import { handleUpdateTaskStatus } from "@/lib/mcp/handlers";
import { sha256 } from "@/lib/crypto";
import type { MCPContext } from "@/types/domain";

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

interface TableConfig {
  data?: unknown;
  error?: unknown;
}

/**
 * Cria um mock chainable do PostgREST: métodos encadeáveis retornam o próprio
 * builder e os terminais (maybeSingle/single/then) resolvem o resultado configurado.
 */
function makeDb(config: Record<string, TableConfig>) {
  const calls: RecordedCall[] = [];

  const db = {
    from: vi.fn((table: string) => {
      const builder: Record<string, unknown> = {};
      const cfg = config[table] ?? {};
      const result = { data: cfg.data ?? null, error: cfg.error ?? null };

      for (const method of [
        "select",
        "insert",
        "update",
        "delete",
        "eq",
        "in",
        "is",
        "or",
        "order",
        "limit",
        "contains",
        "upsert",
      ]) {
        builder[method] = vi.fn((...args: unknown[]) => {
          calls.push({ table, method, args });
          return builder;
        });
      }

      builder.maybeSingle = vi.fn(() => {
        calls.push({ table, method: "maybeSingle", args: [] });
        return Promise.resolve(result);
      });
      builder.single = vi.fn(() => Promise.resolve(result));
      builder.then = (
        resolve: (value: unknown) => unknown,
        reject: (value: unknown) => unknown
      ) => Promise.resolve(result).then(resolve, reject);

      return builder;
    }),
  };

  return { db, calls };
}

function makeContext(overrides: Partial<MCPContext> = {}): MCPContext {
  return {
    workspaceId: "ws-1",
    projectId: null,
    actorLabel: "Claude Agent",
    scopes: ["tasks:read", "tasks:write", "canvas:write"],
    allowDirectDone: false,
    ...overrides,
  };
}

const taskRow = {
  id: "task-1",
  project_id: "proj-1",
  task_key: "APP-1",
  title: "Implementar login",
  status: "in_progress",
  priority: "high",
  type: "task",
  sprint: null,
  estimate_points: 5,
  assignee_id: null,
  parent_task_id: null,
  spec_json: { type: "doc", content: [] },
  spec_markdown: "## Contexto",
  acceptance_criteria: [{ id: "c1", text: "Login funciona", completed: false }],
  agent_execution_log: [],
  last_updated_by_type: "human",
  last_updated_by_label: null,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

const projectRow = {
  id: "proj-1",
  workspace_id: "ws-1",
  name: "Projeto Exemplo",
  slug: "app",
  key_prefix: "APP",
  task_counter: 1,
  description: null,
  created_at: "2024-01-01T00:00:00Z",
};

describe("MCP Auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejeita requisição sem header Authorization", async () => {
    const request = new Request("http://localhost:3000/api/mcp");
    await expect(authenticateMCPRequest(request)).rejects.toThrow(MCPAuthError);
  });

  it("rejeita token sem o prefixo cf_pat_", async () => {
    const request = new Request("http://localhost:3000/api/mcp", {
      headers: { Authorization: "Bearer not_a_valid_token" },
    });
    await expect(authenticateMCPRequest(request)).rejects.toThrow(/Formato de token inválido/);
  });

  it("rejeita token inexistente ou revogado", async () => {
    const { db } = makeDb({ agent_tokens: { data: null } });
    dbMock.from = db.from;

    const request = new Request("http://localhost:3000/api/mcp", {
      headers: { Authorization: "Bearer cf_pat_ffffffff" },
    });
    await expect(authenticateMCPRequest(request)).rejects.toThrow(/inválido ou revogado/);
  });

  it("autentica token válido e retorna o contexto completo", async () => {
    const token = "cf_pat_abc123";
    const tokenRow = {
      id: "tok-1",
      workspace_id: "ws-1",
      project_id: "proj-1",
      name: "Claude Code - MacBook",
      actor_label: "Claude Agent",
      token_hash: sha256(token),
      token_prefix: "cf_pat_abc1",
      scopes: ["tasks:read", "tasks:write", "canvas:write"],
      allow_direct_done: false,
      revoked_at: null,
    };
    const { db } = makeDb({ agent_tokens: { data: tokenRow } });
    dbMock.from = db.from;

    const request = new Request("http://localhost:3000/api/mcp", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const context = await authenticateMCPRequest(request);
    expect(context).toEqual({
      workspaceId: "ws-1",
      projectId: "proj-1",
      actorLabel: "Claude Agent",
      scopes: ["tasks:read", "tasks:write", "canvas:write"],
      allowDirectDone: false,
    });
  });
});

describe("Guardrail human-in-the-loop (updateTaskStatusWithGuardrail)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redireciona 'done' para 'in_review' quando allow_direct_done = false", async () => {
    const { db, calls } = makeDb({ tasks: { data: taskRow }, activity_logs: {} });
    dbMock.from = db.from;

    const result = await updateTaskStatusWithGuardrail(db as never, {
      projectId: "proj-1",
      workspaceId: "ws-1",
      taskKey: "APP-1",
      status: "done",
      summary: "Implementado e testado",
      filesChanged: ["src/login.ts"],
      commitOrPrUrl: "https://github.com/org/repo/pull/42",
      actorLabel: "Claude Agent",
      allowDirectDone: false,
    });

    expect(result.guardrail_applied).toBe(true);
    expect(result.new_status).toBe("in_review");
    expect(result.previous_status).toBe("in_progress");
    expect(result.message).toMatch(/Aprovação humana é necessária/);

    // A atualização persistiu in_review + entrada no agent_execution_log
    const updateCall = calls.find((c) => c.table === "tasks" && c.method === "update");
    expect(updateCall).toBeDefined();
    const payload = updateCall!.args[0] as { status: string; agent_execution_log: unknown[] };
    expect(payload.status).toBe("in_review");
    expect(payload.agent_execution_log).toHaveLength(1);

    // Auditoria registrada
    expect(calls.some((c) => c.table === "activity_logs" && c.method === "insert")).toBe(true);
  });

  it("permite 'done' direto quando allow_direct_done = true", async () => {
    const { db, calls } = makeDb({ tasks: { data: taskRow }, activity_logs: {} });
    dbMock.from = db.from;

    const result = await updateTaskStatusWithGuardrail(db as never, {
      projectId: "proj-1",
      workspaceId: "ws-1",
      taskKey: "APP-1",
      status: "done",
      summary: "Implementado e aprovado previamente",
      actorLabel: "Claude Agent",
      allowDirectDone: true,
    });

    expect(result.guardrail_applied).toBe(false);
    expect(result.new_status).toBe("done");

    const updateCall = calls.find((c) => c.table === "tasks" && c.method === "update");
    const payload = updateCall!.args[0] as { status: string };
    expect(payload.status).toBe("done");
  });

  it("não aplica guardrail para status diferentes de 'done'", async () => {
    const { db } = makeDb({ tasks: { data: taskRow }, activity_logs: {} });
    dbMock.from = db.from;

    const result = await updateTaskStatusWithGuardrail(db as never, {
      projectId: "proj-1",
      workspaceId: "ws-1",
      taskKey: "APP-1",
      status: "in_review",
      summary: "PR aberta para revisão",
      actorLabel: "Claude Agent",
      allowDirectDone: false,
    });

    expect(result.guardrail_applied).toBe(false);
    expect(result.new_status).toBe("in_review");
  });
});

describe("Escopos e isolamento multi-tenant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requireScope lança erro quando o escopo está ausente", () => {
    const context = makeContext({ scopes: ["tasks:read"] });
    expect(() => requireScope(context, "tasks:write")).toThrow(/tasks:write/);
    expect(() => requireScope(context, "tasks:read")).not.toThrow();
  });

  it("handleUpdateTaskStatus exige escopo tasks:write", async () => {
    const context = makeContext({ scopes: ["tasks:read"] });
    await expect(
      handleUpdateTaskStatus(context, {
        task_key: "APP-1",
        status: "in_review",
        summary: "teste",
      })
    ).rejects.toThrow(/tasks:write/);
  });

  it("token restrito a um projeto não encontra tarefa de outro projeto", async () => {
    // O token tem projectId = "proj-other": listProjects filtra por esse id e
    // nenhum projeto acessível contém a tarefa. O handler normaliza o erro para
    // Error com a mensagem original (contrato das tools MCP).
    const { db } = makeDb({ projects: { data: [] }, tasks: { data: null }, activity_logs: {} });
    dbMock.from = db.from;

    const context = makeContext({ projectId: "proj-other" });

    await expect(
      handleUpdateTaskStatus(context, {
        task_key: "APP-1",
        status: "in_review",
        summary: "teste de isolamento",
      })
    ).rejects.toThrow(/Task "APP-1" not found/);
  });

  it("consultas são sempre filtradas pelo workspace do token", async () => {
    const { db, calls } = makeDb({
      projects: { data: [projectRow] },
      tasks: { data: taskRow },
      canvases: {},
      activity_logs: {},
    });
    dbMock.from = db.from;

    const context = makeContext({ workspaceId: "ws-1" });

    await handleUpdateTaskStatus(context, {
      task_key: "APP-1",
      status: "in_progress",
      summary: "Trabalhando na tarefa",
    });

    // Nenhuma consulta a projects usa um workspace_id diferente do token
    const projectWorkspaceFilters = calls
      .filter((c) => c.table === "projects" && c.method === "eq" && c.args[0] === "workspace_id")
      .map((c) => c.args[1]);
    expect(projectWorkspaceFilters.length).toBeGreaterThan(0);
    for (const workspaceId of projectWorkspaceFilters) {
      expect(workspaceId).toBe("ws-1");
    }
  });
});
