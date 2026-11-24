// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, createUser, asUser, asService } from "./harness";

const OWNER = "00000000-0000-0000-0000-00000000000a";
const MEMBER = "00000000-0000-0000-0000-00000000000b";
const VIEWER = "00000000-0000-0000-0000-00000000000c";
const ADMIN = "00000000-0000-0000-0000-00000000000d";
const OUTSIDER = "00000000-0000-0000-0000-00000000000e";

let db: PGlite;
let workspaceId: string;
let projectId: string;
let canvasId: string;
let outsiderWorkspaceId: string;

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const res = await db.query<T>(sql, params);
  return res.rows[0];
}

beforeAll(async () => {
  db = await createTestDb();
  for (const [id, email] of [
    [OWNER, "owner@test.dev"],
    [MEMBER, "member@test.dev"],
    [VIEWER, "viewer@test.dev"],
    [ADMIN, "admin@test.dev"],
    [OUTSIDER, "outsider@test.dev"],
  ]) {
    await createUser(db, id, email);
  }

  workspaceId = (await one<{ id: string }>("select id from workspaces where created_by = $1", [OWNER])).id;
  outsiderWorkspaceId = (await one<{ id: string }>("select id from workspaces where created_by = $1", [OUTSIDER])).id;
  projectId = (await one<{ id: string }>("select id from projects where workspace_id = $1", [workspaceId])).id;
  canvasId = (await one<{ id: string }>("select id from canvases where project_id = $1", [projectId])).id;

  await db.query(
    `insert into workspace_members (workspace_id, user_id, role) values
       ($1, $2, 'member'), ($1, $3, 'viewer'), ($1, $4, 'admin')`,
    [workspaceId, MEMBER, VIEWER, ADMIN]
  );
}, 60_000);

describe("bootstrap", () => {
  it("cria workspace, projeto APP, canvas padrão e Inbox da IA", async () => {
    const nodes = await db.query("select node_type from canvas_nodes where canvas_id = $1", [canvasId]);
    expect(nodes.rows).toHaveLength(3);
  });
});

describe("tasks", () => {
  it("member comum consegue criar tarefa (task_key gerado como definer)", async () => {
    const row = await asUser(db, MEMBER, () =>
      one<{ task_key: string }>(
        "insert into tasks (project_id, title) values ($1, 'Tarefa do member') returning task_key",
        [projectId]
      )
    );
    expect(row.task_key).toMatch(/^APP-\d+$/);
  });

  it("viewer não consegue criar tarefa", async () => {
    await expect(
      asUser(db, VIEWER, () => db.query("insert into tasks (project_id, title) values ($1, 'x')", [projectId]))
    ).rejects.toThrow(/row-level security/);
  });

  it("outsider não enxerga tarefas de outro workspace", async () => {
    const res = await asUser(db, OUTSIDER, () => db.query("select id from tasks where project_id = $1", [projectId]));
    expect(res.rows).toHaveLength(0);
  });

  it("usuário não pode se passar por agente externo", async () => {
    await expect(
      asUser(db, MEMBER, () =>
        db.query(
          "insert into tasks (project_id, title, last_updated_by_type) values ($1, 'fake', 'external_agent')",
          [projectId]
        )
      )
    ).rejects.toThrow(/agente externo/);
  });

  it("usuário não pode escrever no agent_execution_log", async () => {
    const task = await asUser(db, MEMBER, () =>
      one<{ id: string }>("insert into tasks (project_id, title) values ($1, 'log') returning id", [projectId])
    );
    await expect(
      asUser(db, MEMBER, () =>
        db.query(`update tasks set agent_execution_log = '[{"summary":"forjado"}]' where id = $1`, [task.id])
      )
    ).rejects.toThrow(/agent_execution_log/);
  });

  it("task_key e project_id são imutáveis", async () => {
    const task = await asUser(db, MEMBER, () =>
      one<{ id: string }>("insert into tasks (project_id, title) values ($1, 'imut') returning id", [projectId])
    );
    await expect(
      asUser(db, MEMBER, () => db.query("update tasks set task_key = 'APP-999' where id = $1", [task.id]))
    ).rejects.toThrow(/imutável/);
  });

  it("criação de tarefa gera activity_log pelo banco", async () => {
    const task = await asUser(db, MEMBER, () =>
      one<{ id: string }>("insert into tasks (project_id, title) values ($1, 'auditada') returning id", [projectId])
    );
    const log = await one<{ action: string; actor_user_id: string }>(
      "select action, actor_user_id from activity_logs where task_id = $1",
      [task.id]
    );
    expect(log).toMatchObject({ action: "task.created", actor_user_id: MEMBER });
  });

  it("prefixo de chave é único por workspace", async () => {
    await expect(
      asUser(db, OWNER, () =>
        db.query(
          "insert into projects (workspace_id, name, slug, key_prefix) values ($1, 'Dup', 'dup', 'APP')",
          [workspaceId]
        )
      )
    ).rejects.toThrow(/duplicate key/);
  });
});

describe("activity_logs e comments", () => {
  it("não aceita log em workspace alheio", async () => {
    await expect(
      asUser(db, OUTSIDER, () =>
        db.query(
          `insert into activity_logs (workspace_id, actor_type, actor_user_id, actor_label, action)
           values ($1, 'human', $2, 'x', 'spoof')`,
          [workspaceId, OUTSIDER]
        )
      )
    ).rejects.toThrow(/row-level security/);
  });

  it("não aceita log com autor forjado", async () => {
    await expect(
      asUser(db, MEMBER, () =>
        db.query(
          `insert into activity_logs (workspace_id, actor_type, actor_user_id, actor_label, action)
           values ($1, 'external_agent', null, 'Claude', 'spoof')`,
          [workspaceId]
        )
      )
    ).rejects.toThrow(/row-level security/);
  });

  it("comentário exige author_user_id do próprio usuário", async () => {
    await expect(
      asUser(db, MEMBER, () =>
        db.query(
          `insert into comments (workspace_id, author_user_id, author_label, body_markdown)
           values ($1, $2, 'Owner', 'forjado')`,
          [workspaceId, OWNER]
        )
      )
    ).rejects.toThrow(/row-level security/);
  });

  it("viewer não apaga nem o próprio comentário", async () => {
    // Comentário escrito quando o autor ainda tinha escrita (inserido pelo servidor)
    const c = await one<{ id: string }>(
      `insert into comments (workspace_id, author_user_id, author_label, body_markdown)
       values ($1, $2, 'Viewer', 'antigo') returning id`,
      [workspaceId, VIEWER]
    );
    await asUser(db, VIEWER, () => db.query("delete from comments where id = $1", [c.id]));
    const still = await db.query("select 1 from comments where id = $1", [c.id]);
    expect(still.rows).toHaveLength(1);
  });

  it("auditoria usa a identidade autenticada, não o rótulo enviado pelo cliente", async () => {
    const task = await asUser(db, MEMBER, () =>
      one<{ id: string }>(
        "insert into tasks (project_id, title, last_updated_by_label) values ($1, 'atribuição', 'Owner') returning id",
        [projectId]
      )
    );
    await asUser(db, MEMBER, () =>
      db.query("update tasks set status = 'todo', last_updated_by_label = 'Owner' where id = $1", [task.id])
    );
    const logs = await db.query<{ actor_label: string; actor_user_id: string }>(
      "select actor_label, actor_user_id from activity_logs where task_id = $1",
      [task.id]
    );
    expect(logs.rows.length).toBeGreaterThanOrEqual(2);
    for (const log of logs.rows) {
      expect(log.actor_label).toBe("member");
      expect(log.actor_user_id).toBe(MEMBER);
    }
  });

  it("outro membro pode resolver, mas não editar texto alheio", async () => {
    const c = await asUser(db, OWNER, () =>
      one<{ id: string }>(
        `insert into comments (workspace_id, author_user_id, author_label, body_markdown)
         values ($1, $2, 'Owner', 'original') returning id`,
        [workspaceId, OWNER]
      )
    );
    await asUser(db, MEMBER, () => db.query("update comments set resolved = true where id = $1", [c.id]));
    await expect(
      asUser(db, MEMBER, () => db.query("update comments set body_markdown = 'hack' where id = $1", [c.id]))
    ).rejects.toThrow(/autor/);
  });
});

describe("workspace_members", () => {
  it("admin não consegue rebaixar o owner", async () => {
    await asUser(db, ADMIN, () =>
      db.query("update workspace_members set role = 'member' where workspace_id = $1 and user_id = $2", [
        workspaceId,
        OWNER,
      ])
    );
    const row = await one<{ role: string }>(
      "select role from workspace_members where workspace_id = $1 and user_id = $2",
      [workspaceId, OWNER]
    );
    expect(row.role).toBe("owner");
  });

  it("admin não consegue se promover a owner", async () => {
    await expect(
      asUser(db, ADMIN, () =>
        db.query("update workspace_members set role = 'owner' where workspace_id = $1 and user_id = $2", [
          workspaceId,
          ADMIN,
        ])
      )
    ).rejects.toThrow(/row-level security/);
  });

  it("último owner não pode sair", async () => {
    await expect(
      asUser(db, OWNER, () =>
        db.query("delete from workspace_members where workspace_id = $1 and user_id = $2", [workspaceId, OWNER])
      )
    ).rejects.toThrow(/pelo menos um owner/);
  });
});

describe("dependências como fonte da verdade", () => {
  it("aresta entre cards cria dependência; apagar card preserva; recriar card reprojeta a aresta", async () => {
    const a = await asUser(db, MEMBER, () =>
      one<{ r: { task: { id: string }; node: { id: string } } }>(
        "select create_task_with_node($1, 'A', 0, 0) as r",
        [canvasId]
      ).then((r) => r.r)
    );
    const b = await asUser(db, MEMBER, () =>
      one<{ r: { task: { id: string }; node: { id: string } } }>(
        "select create_task_with_node($1, 'B', 300, 0) as r",
        [canvasId]
      ).then((r) => r.r)
    );

    await asUser(db, MEMBER, () =>
      db.query(
        "insert into canvas_edges (canvas_id, source_node_id, target_node_id, edge_type) values ($1, $2, $3, 'blocks')",
        [canvasId, a.node.id, b.node.id]
      )
    );
    const dep = await db.query(
      "select 1 from task_dependencies where source_task_id = $1 and target_task_id = $2 and dependency_type = 'blocks'",
      [a.task.id, b.task.id]
    );
    expect(dep.rows).toHaveLength(1);

    // Apagar o card B (cascata na aresta) NÃO apaga a dependência
    await asUser(db, MEMBER, () => db.query("delete from canvas_nodes where id = $1", [b.node.id]));
    const stillThere = await db.query("select 1 from task_dependencies where target_task_id = $1", [b.task.id]);
    expect(stillThere.rows).toHaveLength(1);

    // Re-adicionar o card B recria a aresta automaticamente
    const newNode = await asUser(db, MEMBER, () =>
      one<{ id: string }>(
        "insert into canvas_nodes (canvas_id, node_type, task_id) values ($1, 'task_card', $2) returning id",
        [canvasId, b.task.id]
      )
    );
    const edge = await db.query("select 1 from canvas_edges where source_node_id = $1 and target_node_id = $2", [
      a.node.id,
      newNode.id,
    ]);
    expect(edge.rows).toHaveLength(1);

    // Remover a aresta explicitamente remove a dependência
    await asUser(db, MEMBER, () =>
      db.query("delete from canvas_edges where source_node_id = $1 and target_node_id = $2", [a.node.id, newNode.id])
    );
    const gone = await db.query("select 1 from task_dependencies where target_task_id = $1", [b.task.id]);
    expect(gone.rows).toHaveLength(0);
  });

  it("aresta não pode ligar nós de canvases diferentes", async () => {
    const foreignCanvas = await one<{ id: string }>(
      "select c.id from canvases c join projects p on p.id = c.project_id where p.workspace_id = $1",
      [outsiderWorkspaceId]
    );
    const foreignNode = await one<{ id: string }>("select id from canvas_nodes where canvas_id = $1 limit 1", [
      foreignCanvas.id,
    ]);
    const ownNode = await one<{ id: string }>("select id from canvas_nodes where canvas_id = $1 limit 1", [canvasId]);
    await expect(
      asUser(db, MEMBER, () =>
        db.query(
          "insert into canvas_edges (canvas_id, source_node_id, target_node_id) values ($1, $2, $3)",
          [canvasId, ownNode.id, foreignNode.id]
        )
      )
    ).rejects.toThrow(/mesmo canvas/);
  });
});

describe("RPCs de cliente", () => {
  it("promote_sticky_to_task converte o post-it atomicamente", async () => {
    const sticky = await asUser(db, MEMBER, () =>
      one<{ id: string }>(
        `insert into canvas_nodes (canvas_id, node_type, data)
         values ($1, 'sticky_note', '{"text": "Login social\\nDetalhes"}') returning id`,
        [canvasId]
      )
    );
    const res = await asUser(db, MEMBER, () =>
      one<{ r: { task: { title: string; task_key: string }; node: { node_type: string } } }>(
        "select promote_sticky_to_task($1, 'Member') as r",
        [sticky.id]
      )
    );
    expect(res.r.task.title).toBe("Login social");
    expect(res.r.node.node_type).toBe("task_card");
  });

  it("viewer não consegue promover post-it", async () => {
    const sticky = await asUser(db, MEMBER, () =>
      one<{ id: string }>(
        `insert into canvas_nodes (canvas_id, node_type, data) values ($1, 'sticky_note', '{"text":"x"}') returning id`,
        [canvasId]
      )
    );
    await expect(
      asUser(db, VIEWER, () => db.query("select promote_sticky_to_task($1)", [sticky.id]))
    ).rejects.toThrow();
  });
});

describe("RPCs de agente (guardrail no banco)", () => {
  it("authenticated não pode chamar RPCs de agente", async () => {
    const task = await one<{ id: string }>("select id from tasks where project_id = $1 limit 1", [projectId]);
    await expect(
      asUser(db, MEMBER, () =>
        db.query(`select agent_update_task_status($1, 'done', '{}'::jsonb, 'x', true)`, [task.id])
      )
    ).rejects.toThrow(/permission denied/);
  });

  it("done vira in_review sem allow_direct_done e o log é anexado atomicamente", async () => {
    const task = await asUser(db, MEMBER, () =>
      one<{ id: string }>("insert into tasks (project_id, title) values ($1, 'agente') returning id", [projectId])
    );
    const res = await asService(db, () =>
      one<{ r: { new_status: string; guardrail_applied: boolean } }>(
        `select agent_update_task_status($1, 'done', '{"summary":"feito"}'::jsonb, 'Claude', false) as r`,
        [task.id]
      )
    );
    expect(res.r).toMatchObject({ new_status: "in_review", guardrail_applied: true });

    await asService(db, () =>
      db.query(`select agent_append_note($1, '{"summary":"nota"}'::jsonb, 'Claude')`, [task.id])
    );
    const row = await one<{ n: number }>("select jsonb_array_length(agent_execution_log) as n from tasks where id = $1", [
      task.id,
    ]);
    expect(row.n).toBe(2);

    const log = await one<{ payload: { guardrail_applied: boolean } }>(
      "select payload from activity_logs where task_id = $1 and action = 'task.status_changed'",
      [task.id]
    );
    expect(log.payload.guardrail_applied).toBe(true);
  });

  it("mesmo com service role, agente não conclui direto sem a flag", async () => {
    const task = await asUser(db, MEMBER, () =>
      one<{ id: string }>("insert into tasks (project_id, title) values ($1, 'bypass') returning id", [projectId])
    );
    await expect(
      asService(db, () =>
        db.query(
          "update tasks set status = 'done', last_updated_by_type = 'external_agent' where id = $1",
          [task.id]
        )
      )
    ).rejects.toThrow(/Guardrail/);
  });

  it("humano aprova tarefa em review movida por agente", async () => {
    const task = await asUser(db, MEMBER, () =>
      one<{ id: string }>("insert into tasks (project_id, title) values ($1, 'aprovar') returning id", [projectId])
    );
    await asService(db, () =>
      db.query(`select agent_update_task_status($1, 'done', '{}'::jsonb, 'Claude', false)`, [task.id])
    );
    await asUser(db, MEMBER, () => db.query("update tasks set status = 'done' where id = $1", [task.id]));
    const row = await one<{ status: string; last_updated_by_type: string }>(
      "select status, last_updated_by_type from tasks where id = $1",
      [task.id]
    );
    expect(row).toMatchObject({ status: "done", last_updated_by_type: "human" });
  });

  it("agent_create_linked_task valida o pai antes de escrever (sem órfãos)", async () => {
    const before = await one<{ n: number }>("select count(*)::int as n from tasks where project_id = $1", [projectId]);
    await expect(
      asService(db, () =>
        db.query(`select agent_create_linked_task($1, 'Bug', 'bug', 'Claude', 'high', '', '[]', 'APP-9999', null)`, [
          projectId,
        ])
      )
    ).rejects.toThrow(/não encontrada/);
    const after = await one<{ n: number }>("select count(*)::int as n from tasks where project_id = $1", [projectId]);
    expect(after.n).toBe(before.n);
  });

  it("agent_create_linked_task cria tarefa, card, dependência e aresta", async () => {
    const parent = await asUser(db, MEMBER, () =>
      one<{ r: { task: { task_key: string }; node: { id: string } } }>(
        "select create_task_with_node($1, 'Pai', 0, 500) as r",
        [canvasId]
      )
    );
    const res = await asService(db, () =>
      one<{ r: { task_id: string; canvas_node_id: string } }>(
        `select agent_create_linked_task($1, 'Filha', 'task', 'Claude', 'medium', '', '[]', $2, 'parent_of') as r`,
        [projectId, parent.r.task.task_key]
      )
    );
    const edge = await db.query("select 1 from canvas_edges where source_node_id = $1 and target_node_id = $2", [
      parent.r.node.id,
      res.r.canvas_node_id,
    ]);
    expect(edge.rows).toHaveLength(1);
    const child = await one<{ parent_task_id: string | null; needs: boolean }>(
      `select t.parent_task_id, n.needs_auto_layout as needs
       from tasks t join canvas_nodes n on n.task_id = t.id where t.id = $1`,
      [res.r.task_id]
    );
    expect(child.parent_task_id).not.toBeNull();
    expect(child.needs).toBe(true);
  });
});

describe("convites", () => {
  it("aceitar convite adiciona o membro e o link é de uso único", async () => {
    const NEWBIE = "00000000-0000-0000-0000-0000000000f1";
    await createUser(db, NEWBIE, "newbie@test.dev");
    await asUser(db, ADMIN, () =>
      db.query(
        `insert into workspace_invites (workspace_id, email, role, token_hash, created_by)
         values ($1, 'NEWBIE@test.dev', 'member', 'hash-1', $2)`,
        [workspaceId, ADMIN]
      )
    );
    const res = await asUser(db, NEWBIE, () =>
      one<{ r: { workspace_id: string } }>("select accept_workspace_invite('hash-1') as r")
    );
    expect(res.r.workspace_id).toBe(workspaceId);
    await expect(
      asUser(db, OUTSIDER, () => db.query("select accept_workspace_invite('hash-1')"))
    ).rejects.toThrow(/inválido/);
  });

  it("convite com email exige o mesmo email", async () => {
    await asUser(db, ADMIN, () =>
      db.query(
        `insert into workspace_invites (workspace_id, email, token_hash, created_by)
         values ($1, 'someone@else.dev', 'hash-2', $2)`,
        [workspaceId, ADMIN]
      )
    );
    await expect(
      asUser(db, OUTSIDER, () => db.query("select accept_workspace_invite('hash-2')"))
    ).rejects.toThrow(/outro email/);
  });
});
