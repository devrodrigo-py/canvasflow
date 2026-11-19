import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceModel, AIKeyNotFoundError } from "@/lib/ai/provider";
import { decomposeEpicSchema, decomposeEpicRequestSchema } from "@/lib/ai/schemas";
import { createTask, logActivity } from "@/lib/services/tasks.service";
import { createNode, createEdge } from "@/lib/services/canvas.service";

export const runtime = "nodejs";
export const maxDuration = 60;

type Db = SupabaseClient<Database>;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const parsed = decomposeEpicRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload inválido", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { canvas_id: canvasId, source_nodes: sourceNodes } = parsed.data;

    // Canvas → projeto → workspace
    const { data: canvas, error: canvasError } = await supabase
      .from("canvases")
      .select("id, project_id, projects(workspace_id, slug, name)")
      .eq("id", canvasId)
      .maybeSingle();
    if (canvasError || !canvas) {
      return NextResponse.json({ error: "Canvas não encontrado" }, { status: 404 });
    }

    const project = canvas.projects as unknown as {
      workspace_id: string;
      slug: string;
      name: string;
    };
    const projectId = canvas.project_id;
    const workspaceId = project.workspace_id;

    // Contexto: título/texto dos nós selecionados
    const sourceContext = sourceNodes
      .map((n) => `- [${n.type}] ${n.title ?? "(sem título)"}: ${n.content ?? ""}`.trim())
      .join("\n");

    const { model } = await getWorkspaceModel(supabase as unknown as Db, workspaceId);

    const { object } = await generateObject({
      model,
      schema: decomposeEpicSchema,
      prompt: `Você é um engenheiro de produto sênior. Quebre a ideia/épico abaixo em 3 a 8 subtarefas acionáveis, ordenadas da fundação para o detalhe.
Marque dependências com depends_on_index (índices 0-based de outras subtarefas desta lista).

Ideia / Épico:
${sourceContext}

Diretrizes:
- Cada subtarefa deve ser implementável por 1 pessoa em 1-3 dias.
- spec_markdown deve ter seções "## Contexto", "## Escopo Técnico" e "## Edge Cases".
- acceptance_criteria devem ser verificáveis objetivamente.`,
    });

    // Efeito: cria tarefas + nós com needs_auto_layout + arestas parent_of / blocks
    const createdKeys: string[] = [];
    const taskIds: string[] = [];
    const nodeIds: string[] = [];

    for (const subtask of object.subtasks) {
      const task = await createTask(supabase as unknown as Db, {
        projectId,
        title: subtask.title,
        type: subtask.type,
        priority: subtask.priority,
        specMarkdown: subtask.spec_markdown,
        acceptanceCriteria: subtask.acceptance_criteria.map((text, i) => ({
          id: `${Date.now()}-${i}`,
          text,
          completed: false,
        })),
        actorType: "internal_ai",
        actorLabel: "IA Interna",
      });
      createdKeys.push(task.task_key);
      taskIds.push(task.id);

      const node = await createNode(supabase as unknown as Db, {
        canvasId,
        nodeType: "task_card",
        position: { x: 0, y: 0 }, // needs_auto_layout posiciona de fato
        taskId: task.id,
        data: { title: task.title },
      });
      nodeIds.push(node.id);
    }

    // Arestas: primeiro nó fonte → primeira subtarefa (derived_from), parent_of e blocks das dependências
    const sourceNodeId = sourceNodes[0]?.id;
    if (sourceNodeId) {
      await createEdge(supabase as unknown as Db, {
        canvasId,
        sourceNodeId,
        targetNodeId: nodeIds[0],
        edgeType: "derived_from",
        label: "IA: decomposição",
      });
    }

    for (let i = 0; i < object.subtasks.length; i++) {
      const subtask = object.subtasks[i];
      if (sourceNodeId) {
        await createEdge(supabase as never, {
          canvasId,
          sourceNodeId,
          targetNodeId: nodeIds[i],
          edgeType: "parent_of",
        });
      }
      for (const depIndex of subtask.depends_on_index) {
        if (depIndex >= 0 && depIndex < nodeIds.length && depIndex !== i) {
          await createEdge(supabase as unknown as Db, {
            canvasId,
            sourceNodeId: nodeIds[depIndex],
            targetNodeId: nodeIds[i],
            edgeType: "blocks",
          });
        }
      }
    }

    await logActivity(supabase as unknown as Db, {
      workspaceId,
      projectId,
      taskId: null,
      actorType: "internal_ai",
      actorUserId: user.id,
      actorLabel: "IA Interna",
      action: "ai.epic_decomposed",
      payload: { canvas_id: canvasId, created: createdKeys },
    });

    return NextResponse.json({
      created_task_keys: createdKeys,
      subtasks: object.subtasks,
      message: `${createdKeys.length} tarefas criadas e projetadas no canvas.`,
    });
  } catch (error) {
    if (error instanceof AIKeyNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("decompose-epic:", error);
    return NextResponse.json({ error: "Erro interno ao decompor épico" }, { status: 500 });
  }
}
