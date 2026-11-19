import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceModel, AIKeyNotFoundError } from "@/lib/ai/provider";
import { draftSpecSchema, draftSpecRequestSchema } from "@/lib/ai/schemas";
import { getTaskById, getProjectById, logActivity } from "@/lib/services/tasks.service";

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
    const parsed = draftSpecRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload inválido", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { task_id: taskId, task_title: taskTitle } = parsed.data;

    let title = taskTitle ?? "";
    let connectedContext = "";
    let workspaceId = "";
    let projectId = "";
    let existingSpec = "";

    if (taskId) {
      const task = await getTaskById(supabase as unknown as Db, taskId);
      if (!task) {
        return NextResponse.json({ error: "Tarefa não encontrada" }, { status: 404 });
      }
      const project = await getProjectById(supabase as unknown as Db, task.project_id);
      if (!project) {
        return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 });
      }
      title = task.title;
      existingSpec = task.spec_markdown;
      workspaceId = project.workspace_id;
      projectId = project.id;

      // Contexto das tarefas conectadas via canvas
      const { data: node } = await supabase
        .from("canvas_nodes")
        .select("id")
        .eq("task_id", task.id)
        .limit(1)
        .maybeSingle();

      if (node) {
        const { data: edges } = await supabase
          .from("canvas_edges")
          .select(
            "edge_type, source:canvas_nodes!canvas_edges_source_node_id_fkey(id, task:tasks(title, task_key, type)), target:canvas_nodes!canvas_edges_target_node_id_fkey(id, task:tasks(title, task_key, type))"
          )
          .or(`source_node_id.eq.${node.id},target_node_id.eq.${node.id}`);

        const lines: string[] = [];
        for (const edge of edges ?? []) {
          const edgeRow = edge as unknown as {
            edge_type: string;
            source: { id: string; task: Array<{ title: string; task_key: string; type: string }> } | null;
            target: { id: string; task: Array<{ title: string; task_key: string; type: string }> } | null;
          };
          const sourceTask = edgeRow.source?.task?.[0];
          const targetTask = edgeRow.target?.task?.[0];
          const otherTask = edgeRow.source?.id === node.id ? targetTask : sourceTask;
          if (otherTask) {
            lines.push(`- ${edgeRow.edge_type}: ${otherTask.task_key} — ${otherTask.title} (${otherTask.type})`);
          }
        }
        connectedContext = lines.join("\n");
      }
    } else if (taskTitle) {
      title = taskTitle;
      return NextResponse.json(
        { error: "Para redigir uma spec, abra a tarefa no canvas e use Gerar/Refinar Spec com IA." },
        { status: 400 }
      );
    }

    const { model } = await getWorkspaceModel(supabase as unknown as Db, workspaceId);

    const { object } = await generateObject({
      model,
      schema: draftSpecSchema,
      prompt: `Você é um tech lead escrevendo uma especificação técnica completa para a tarefa abaixo.

Título: ${title}

${existingSpec ? `Spec existente (refine, não descarte decisões já tomadas):\n${existingSpec}\n` : ""}
${connectedContext ? `Tarefas conectadas no canvas:\n${connectedContext}\n` : ""}
Estruture spec_markdown com as seções "## Contexto", "## Escopo Técnico" e "## Edge Cases", usando listas e blocos de código quando útil.
Os acceptance_criteria devem formar um checklist objetivo e verificável.`,
    });

    await logActivity(supabase as unknown as Db, {
      workspaceId,
      projectId: projectId || null,
      taskId: taskId ?? null,
      actorType: "internal_ai",
      actorUserId: user.id,
      actorLabel: "IA Interna",
      action: "ai.spec_drafted",
      payload: { task_id: taskId, title },
    });

    return NextResponse.json({
      spec_markdown: object.spec_markdown,
      acceptance_criteria: object.acceptance_criteria,
    });
  } catch (error) {
    if (error instanceof AIKeyNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("draft-spec:", error);
    return NextResponse.json({ error: "Erro interno ao redigir spec" }, { status: 500 });
  }
}
