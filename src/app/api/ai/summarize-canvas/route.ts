import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceModel, AIKeyNotFoundError } from "@/lib/ai/provider";
import { summarizeCanvasSchema, summarizeCanvasRequestSchema } from "@/lib/ai/schemas";
import { logActivity, getProjectById } from "@/lib/services/tasks.service";

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
    const parsed = summarizeCanvasRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload inválido", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { project_id: projectId } = parsed.data;

    const project = await getProjectById(supabase as unknown as Db, projectId);
    if (!project) {
      return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 });
    }
    const workspaceId = project.workspace_id;

    // Estado do backlog
    const { data: tasks, error: tasksError } = await supabase
      .from("tasks")
      .select("status, task_key, title, type, priority, updated_at, parent:tasks!parent_task_id(task_key)")
      .eq("project_id", projectId);
    if (tasksError) throw tasksError;

    const backlogLines = (tasks ?? [])
      .map((t) => {
        const row = t as unknown as {
          status: string;
          task_key: string;
          title: string;
          type: string;
          priority: string;
          updated_at: string;
          parent: Array<{ task_key: string }> | null;
        };
        const parent = row.parent?.[0] ?? null;
        return `- ${row.task_key} [${row.type}|${row.priority}|${row.status}] "${row.title}" (atualizada em ${row.updated_at})${parent ? ` — filha de ${parent.task_key}` : ""}`;
      })
      .join("\n");

    // Dependências do canvas (blocks)
    const { data: canvas } = await supabase
      .from("canvases")
      .select("id")
      .eq("project_id", projectId)
      .eq("is_default", true)
      .maybeSingle();

    let dependencyLines = "";
    if (canvas) {
      const { data: edges } = await supabase
        .from("canvas_edges")
        .select("edge_type, source:canvas_nodes!canvas_edges_source_node_id_fkey(task:tasks(task_key, title)), target:canvas_nodes!canvas_edges_target_node_id_fkey(task:tasks(task_key, title))")
        .eq("canvas_id", canvas.id);

      dependencyLines = (edges ?? [])
        .map((e) => {
          const edgeRow = e as unknown as {
            edge_type: string;
            source: { task: Array<{ task_key: string }> } | null;
            target: { task: Array<{ task_key: string }> } | null;
          };
          const src = edgeRow.source?.task?.[0]?.task_key ?? "?";
          const tgt = edgeRow.target?.task?.[0]?.task_key ?? "?";
          return `- ${src} --${edgeRow.edge_type}--> ${tgt}`;
        })
        .join("\n");
    }

    const { model } = await getWorkspaceModel(supabase as unknown as Db, workspaceId);

    const { object } = await generateObject({
      model,
      schema: summarizeCanvasSchema,
      prompt: `Você é um consultor de delivery de software. Analise o estado do projeto abaixo e produza um diagnóstico.

Backlog:
${backlogLines || "(sem tarefas)"}

Dependências no canvas:
${dependencyLines || "(nenhuma)"}

Aponte: gargalos, tarefas bloqueadas há mais tempo (calcule dias a partir de updated_at e status), dependências circulares (ciclos em blocks) e sugestões de priorização concretas.`,
    });

    await logActivity(supabase as unknown as Db, {
      workspaceId,
      projectId,
      taskId: null,
      actorType: "internal_ai",
      actorUserId: user.id,
      actorLabel: "IA Interna",
      action: "ai.canvas_summarized",
      payload: { project_id: projectId },
    });

    return NextResponse.json(object);
  } catch (error) {
    if (error instanceof AIKeyNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("summarize-canvas:", error);
    return NextResponse.json({ error: "Erro interno ao diagnosticar o quadro" }, { status: 500 });
  }
}
