import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { getWorkspaceModel } from "@/lib/ai/provider";
import { summarizeCanvasSchema, summarizeCanvasRequestSchema } from "@/lib/ai/schemas";
import { logActivity, getProjectById } from "@/lib/services/tasks.service";
import { requireAIUser, aiErrorResponse } from "@/lib/ai/route-helpers";

export const runtime = "nodejs";
export const maxDuration = 60;

interface TaskLite {
  task_key: string;
  title: string;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAIUser();
    if (!auth.ok) return auth.response;
    const { supabase, user } = auth;

    const parsed = summarizeCanvasRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Payload inválido", details: parsed.error.flatten() }, { status: 400 });
    }
    const { project_id: projectId } = parsed.data;

    // RLS: só encontra o projeto se o usuário for membro
    const project = await getProjectById(supabase, projectId);
    if (!project) return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 });
    const workspaceId = project.workspace_id;

    const [{ data: tasks, error: tasksError }, { data: deps, error: depsError }] = await Promise.all([
      supabase
        .from("tasks")
        .select("status, task_key, title, type, priority, updated_at, parent:tasks!parent_task_id(task_key)")
        .eq("project_id", projectId)
        .order("created_at")
        .limit(500),
      supabase
        .from("task_dependencies")
        .select(
          "dependency_type, source:tasks!task_dependencies_source_task_id_fkey(task_key, title), target:tasks!task_dependencies_target_task_id_fkey(task_key, title)"
        )
        .eq("project_id", projectId),
    ]);
    if (tasksError) throw tasksError;
    if (depsError) throw depsError;

    const backlogLines = (tasks ?? [])
      .map((t) => {
        // Relação many-to-one: o PostgREST devolve objeto, não array
        const parent = t.parent as unknown as { task_key: string } | null;
        return `- ${t.task_key} [${t.type}|${t.priority}|${t.status}] "${t.title}" (atualizada em ${t.updated_at})${
          parent ? ` — filha de ${parent.task_key}` : ""
        }`;
      })
      .join("\n");

    const dependencyLines = (deps ?? [])
      .map((d) => {
        const src = (d.source as unknown as TaskLite | null)?.task_key ?? "?";
        const tgt = (d.target as unknown as TaskLite | null)?.task_key ?? "?";
        return `- ${src} --${d.dependency_type}--> ${tgt}`;
      })
      .join("\n");

    const { model } = await getWorkspaceModel(workspaceId, user.id);

    const { object } = await generateObject({
      model,
      schema: summarizeCanvasSchema,
      abortSignal: AbortSignal.timeout(55_000),
      prompt: `Você é um consultor de delivery de software. Analise o estado do projeto abaixo e produza um diagnóstico.
Hoje é ${new Date().toISOString().slice(0, 10)}.

Backlog:
${backlogLines || "(sem tarefas)"}

Dependências:
${dependencyLines || "(nenhuma)"}

Aponte: gargalos, tarefas bloqueadas há mais tempo (calcule dias a partir de updated_at e status), dependências circulares (ciclos em blocks) e sugestões de priorização concretas.`,
    });

    await logActivity(supabase, {
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
    return aiErrorResponse(error, "summarize-canvas", "Erro interno ao diagnosticar o quadro");
  }
}
