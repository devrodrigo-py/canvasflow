import { describe, it, expect, vi, beforeEach } from "vitest";

// O admin client é substituído por um mock chainable configurável por teste
const { dbMock } = vi.hoisted(() => ({ dbMock: { from: vi.fn(), rpc: vi.fn() } }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => dbMock),
}));

import { authenticateMCPRequest, requireScope, MCPAuthError, MCPRateLimitError, getAllowedMcpHosts } from "@/lib/mcp/auth";
import { updateTaskStatusWithGuardrail } from "@/lib/services/tasks.service";
import { handleUpdateTaskStatus, handleGetTaskContext, toToolError } from "@/lib/mcp/handlers";
import { sha256 } from "@/lib/crypto";
import { resetRateLimits } from "@/lib/rate-limit";
import type { MCPContext, Task } from "@/types/domain";

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

/** Mock chainable do PostgREST: encadeáveis retornam o builder; terminais resolvem o resultado. */
function makeDb(config: Record<string, { data?: unknown; error?: unknown }>, rpcResult?: { data?: unknown; error?: unknown }) {
  const calls: RecordedCall[] = [];
  const db = {
    from: vi.fn((table: string) => {
      const builder: Record<string, unknown> = {};
      const cfg = config[table] ?? {};
      const result = { data: cfg.data ?? null, error: cfg.error ?? null };
      for (const method of ["select", "insert", "update", "delete", "eq", "in", "is", "or", "order", "limit", "range"]) {
        builder[method] = vi.fn((...args: unknown[]) => {
          calls.push({ table, method, args });
          return builder;
        });
      }
      builder.maybeSingle = vi.fn(() => Promise.resolve(result));
      builder.single = vi.fn(() => Promise.resolve(result));
      builder.then = (resolve: (v: unknown) => unknown, reject: (v: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject);
      return builder;
    }),
    rpc: vi.fn((name: string, args: unknown) => {
      calls.push({ table: `rpc:${name}`, method: "rpc", args: [args] });
      return Promise.resolve({ data: rpcResult?.data ?? null, error: rpcResult?.error ?? null });
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

const VALID_TOKEN = `cf_pat_${"a".repeat(64)}`;

const tokenRow = {
  id: "tok-1",
  workspace_id: "ws-1",
  project_id: "proj-1",
  actor_label: "Claude Agent",
  scopes: ["tasks:read", "tasks:write", "canvas:write"],
  allow_direct_done: false,
  expires_at: null as string | null,
};

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
  acceptance_criteria: [],
  agent_execution_log: [],
  last_updated_by_type: "human",
  last_updated_by_label: null,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

function bearer(token: string) {
  return new Request("http://localhost:3000/api/mcp", { headers: { Authorization: `Bearer ${token}` } });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
});

describe("MCP Auth", () => {
  it("rejeita requisição sem header Authorization", async () => {
    await expect(authenticateMCPRequest(new Request("http://localhost:3000/api/mcp"))).rejects.toThrow(MCPAuthError);
  });

  it("rejeita token fora do formato cf_pat_<64 hex>", async () => {
    await expect(authenticateMCPRequest(bearer("cf_pat_curto"))).rejects.toThrow(/Formato de token inválido/);
  });

  it("rejeita token inexistente ou revogado", async () => {
    const { db } = makeDb({ agent_tokens: { data: null } });
    dbMock.from = db.from;
    await expect(authenticateMCPRequest(bearer(VALID_TOKEN))).rejects.toThrow(/inválido ou revogado/);
  });

  it("rejeita token expirado", async () => {
    const { db } = makeDb({ agent_tokens: { data: { ...tokenRow, expires_at: "2000-01-01T00:00:00Z" } } });
    dbMock.from = db.from;
    await expect(authenticateMCPRequest(bearer(VALID_TOKEN))).rejects.toThrow(/expirado/);
  });

  it("busca pelo hash SHA-256 e retorna o contexto", async () => {
    const { db, calls } = makeDb({ agent_tokens: { data: tokenRow } });
    dbMock.from = db.from;

    const context = await authenticateMCPRequest(bearer(VALID_TOKEN));
    expect(context).toEqual({
      workspaceId: "ws-1",
      projectId: "proj-1",
      actorLabel: "Claude Agent",
      scopes: ["tasks:read", "tasks:write", "canvas:write"],
      allowDirectDone: false,
    });
    const hashFilter = calls.find((c) => c.method === "eq" && c.args[0] === "token_hash");
    expect(hashFilter?.args[1]).toBe(sha256(VALID_TOKEN));
  });

  it("aplica rate limit por token", async () => {
    const { db } = makeDb({ agent_tokens: { data: tokenRow } });
    dbMock.from = db.from;
    for (let i = 0; i < 120; i++) await authenticateMCPRequest(bearer(VALID_TOKEN));
    await expect(authenticateMCPRequest(bearer(VALID_TOKEN))).rejects.toThrow(MCPRateLimitError);
  });

  it("deriva allowedHosts de NEXT_PUBLIC_APP_URL e MCP_ALLOWED_HOSTS", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.canvasflow.dev");
    vi.stubEnv("MCP_ALLOWED_HOSTS", "localhost:3000, mcp.canvasflow.dev");
    expect(getAllowedMcpHosts()).toEqual(["app.canvasflow.dev", "localhost:3000", "mcp.canvasflow.dev"]);
    vi.unstubAllEnvs();
  });
});

describe("updateTaskStatusWithGuardrail (delegado à RPC do banco)", () => {
  it("envia allow_direct_done e a entrada de log para a RPC atômica", async () => {
    const { db, calls } = makeDb(
      {},
      { data: { task_key: "APP-1", previous_status: "in_progress", new_status: "in_review", guardrail_applied: true } }
    );

    const result = await updateTaskStatusWithGuardrail(db as never, {
      task: taskRow as unknown as Task,
      status: "done",
      summary: "Implementado",
      commitOrPrUrl: "https://github.com/org/repo/pull/42",
      actorLabel: "Claude Agent",
      allowDirectDone: false,
    });

    const rpc = calls.find((c) => c.table === "rpc:agent_update_task_status");
    const args = rpc!.args[0] as Record<string, unknown>;
    expect(args).toMatchObject({ p_task_id: "task-1", p_status: "done", p_allow_direct_done: false });
    expect((args.p_entry as Record<string, unknown>).summary).toBe("Implementado");
    expect(result.new_status).toBe("in_review");
    expect(result.message).toMatch(/Aprovação humana é necessária/);
  });

  it("não escreve diretamente na tabela tasks (sem read-modify-write)", async () => {
    const { db, calls } = makeDb({}, { data: { task_key: "APP-1", previous_status: "todo", new_status: "in_progress", guardrail_applied: false } });
    await updateTaskStatusWithGuardrail(db as never, {
      task: taskRow as unknown as Task,
      status: "in_progress",
      summary: "começando",
      actorLabel: "Claude Agent",
      allowDirectDone: false,
    });
    expect(calls.some((c) => c.table === "tasks" && c.method === "update")).toBe(false);
  });
});

describe("Escopos, isolamento e erros", () => {
  it("requireScope lança erro quando o escopo está ausente", () => {
    const context = makeContext({ scopes: ["tasks:read"] });
    expect(() => requireScope(context, "tasks:write")).toThrow(/tasks:write/);
    expect(() => requireScope(context, "tasks:read")).not.toThrow();
  });

  it("handleUpdateTaskStatus exige escopo tasks:write", async () => {
    await expect(
      handleUpdateTaskStatus(makeContext({ scopes: ["tasks:read"] }), {
        task_key: "APP-1",
        status: "in_review",
        summary: "teste",
      })
    ).rejects.toThrow(/tasks:write/);
  });

  it("resolve task_key numa única query filtrada pelo workspace (e projeto) do token", async () => {
    const { db, calls } = makeDb({ tasks: { data: null } });
    dbMock.from = db.from;

    await expect(
      handleGetTaskContext(makeContext({ workspaceId: "ws-1", projectId: "proj-9" }), { task_key: "APP-1" })
    ).rejects.toThrow(/Task "APP-1" not found/);

    const filters = calls.filter((c) => c.table === "tasks" && c.method === "eq");
    expect(filters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ args: ["project.workspace_id", "ws-1"] }),
        expect.objectContaining({ args: ["project_id", "proj-9"] }),
        expect.objectContaining({ args: ["task_key", "APP-1"] }),
      ])
    );
  });

  it("toToolError repassa mensagens de regra de negócio e esconde detalhes internos", () => {
    expect(toToolError(new Error("Guardrail: agentes externos não podem concluir")).message).toMatch(/Guardrail/);
    expect(toToolError({ message: 'duplicate key value violates unique constraint "x"' }).message).toBe(
      "Operação violou uma restrição do banco de dados"
    );
    expect(toToolError(new Error("connection refused at 10.0.0.1")).message).toBe("Erro interno ao executar a tool");
  });
});
