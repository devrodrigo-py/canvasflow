import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { getWorkspaceModel } from "@/lib/ai/provider";
import { decomposeEpicSchema, decomposeEpicRequestSchema } from "@/lib/ai/schemas";
import { createTaskWithNode, logActivity } from "@/lib/services/tasks.service";
import { createEdge } from "@/lib/services/canvas.service";
import { requireAIUser, aiErrorResponse } from "@/lib/ai/route-helpers";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAIUser();
    if (!auth.ok) return auth.response;
    const { supabase, user } = auth;

    const parsed = decomposeEpicRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Payload inválido", details: parsed.error.flatten() }, { status: 400 });
    }
    const { canvas_id: canvasId, source_nodes: sourceNodes } = parsed.data;

    const { data: canvas } = await supabase
      .from("canvases")
      .select("id, project_id, projects(workspace_id)")
      .eq("id", canvasId)
      .maybeSingle();
    if (!canvas) return NextResponse.json({ error: "Canvas não encontrado" }, { status: 404 });
    const workspaceId = (canvas.projects as unknown as { workspace_id: string }).workspace_id;

    // Os nós de origem precisam existir neste canvas (não confia em ids do cliente)
    const sourceIds = sourceNodes.map((n) => n.id).filter(Boolean);
    const { data: validSources } = await supabase
      .from("canvas_nodes")
      .select("id")
      .eq("canvas_id", canvasId)
      .in("id", sourceIds.length ? sourceIds : ["00000000-0000-0000-0000-000000000000"]);
    const sourceNodeId = validSources?.[0]?.id ?? null;

    const sourceContext = sourceNodes
      .map((n) => `- [${n.type}] ${n.title ?? "(sem título)"}: ${n.content ?? ""}`.trim())
      .join("\n");

    const { model } = await getWorkspaceModel(workspaceId, user.id);

    const { object } = await generateObject({
      model,
      schema: decomposeEpicSchema,
      abortSignal: AbortSignal.timeout(55_000),
      prompt: `Você é um engenheiro de produto sênior. Quebre a ideia/épico abaixo em 3 a 8 subtarefas acionáveis, ordenadas da fundação para o detalhe.
Marque dependências com depends_on_index (índices 0-based de outras subtarefas desta lista).

Ideia / Épico:
${sourceContext}

Diretrizes:
- Cada subtarefa deve ser implementável por 1 pessoa em 1-3 dias.
- spec_markdown deve ter seções "## Contexto", "## Escopo Técnico" e "## Edge Cases".
- acceptance_criteria devem ser verificáveis objetivamente.`,
    });

    // Cada subtarefa: tarefa + card numa transação; o auto-layout posiciona os cards
    const created: Array<{ key: string; nodeId: string }> = [];
    for (const subtask of object.subtasks) {
      const { task, nodeId } = await createTaskWithNode(supabase, {
        canvasId,
        title: subtask.title,
        position: { x: 0, y: 0 },
        type: subtask.type,
        priority: subtask.priority,
        specMarkdown: subtask.spec_markdown,
        acceptanceCriteria: subtask.acceptance_criteria,
        actorType: "internal_ai",
        actorLabel: "IA Interna",
        needsAutoLayout: true,
      });
      created.push({ key: task.task_key, nodeId });
    }

    // Arestas: origem → subtarefas (parent_of) e dependências entre subtarefas (blocks).
    // Entre dois task cards o banco registra a dependência em task_dependencies.
    for (let i = 0; i < object.subtasks.length; i++) {
      if (sourceNodeId) {
        await createEdge(supabase, {
          canvasId,
          sourceNodeId,
          targetNodeId: created[i].nodeId,
          edgeType: "parent_of",
          label: i === 0 ? "IA: decomposição" : undefined,
        });
      }
      for (const depIndex of new Set(object.subtasks[i].depends_on_index)) {
        if (depIndex >= 0 && depIndex < created.length && depIndex !== i) {
          await createEdge(supabase, {
            canvasId,
            sourceNodeId: created[depIndex].nodeId,
            targetNodeId: created[i].nodeId,
            edgeType: "blocks",
          });
        }
      }
    }

    const createdKeys = created.map((c) => c.key);
    await logActivity(supabase, {
      workspaceId,
      projectId: canvas.project_id,
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
    return aiErrorResponse(error, "decompose-epic", "Erro interno ao decompor épico");
  }
}
