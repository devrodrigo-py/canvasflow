import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { getWorkspaceModel } from "@/lib/ai/provider";
import { draftSpecSchema, draftSpecRequestSchema } from "@/lib/ai/schemas";
import { getTaskById, getProjectById, getTaskContext, logActivity } from "@/lib/services/tasks.service";
import { requireAIUser, aiErrorResponse } from "@/lib/ai/route-helpers";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAIUser();
    if (!auth.ok) return auth.response;
    const { supabase, user } = auth;

    const parsed = draftSpecRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Payload inválido", details: parsed.error.flatten() }, { status: 400 });
    }
    const taskId = parsed.data.task_id;
    if (!taskId) {
      return NextResponse.json(
        { error: "Para redigir uma spec, abra a tarefa e use Gerar/Refinar Spec com IA." },
        { status: 400 }
      );
    }

    const task = await getTaskById(supabase, taskId);
    if (!task) return NextResponse.json({ error: "Tarefa não encontrada" }, { status: 404 });
    const project = await getProjectById(supabase, task.project_id);
    if (!project) return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 });

    const context = await getTaskContext(supabase, task);
    const c = context.connected_tasks;
    const connectedLines = [
      c.parent ? `- filha de: ${c.parent.task_key} — ${c.parent.title} (${c.parent.type})` : null,
      ...c.children.map((t) => `- pai de: ${t.task_key} — ${t.title} (${t.type})`),
      ...c.blocks.map((t) => `- bloqueia: ${t.task_key} — ${t.title} (${t.type})`),
      ...c.blocked_by.map((t) => `- bloqueada por: ${t.task_key} — ${t.title} (${t.type})`),
      ...c.related.map((t) => `- relacionada: ${t.task_key} — ${t.title} (${t.type})`),
    ].filter(Boolean);

    const { model } = await getWorkspaceModel(project.workspace_id, user.id);

    const { object } = await generateObject({
      model,
      schema: draftSpecSchema,
      abortSignal: AbortSignal.timeout(55_000),
      prompt: `Você é um tech lead escrevendo uma especificação técnica completa para a tarefa abaixo.

Título: ${task.title}

${task.spec_markdown ? `Spec existente (refine, não descarte decisões já tomadas):\n${task.spec_markdown}\n` : ""}
${connectedLines.length ? `Tarefas conectadas:\n${connectedLines.join("\n")}\n` : ""}
Escreva spec_markdown em Markdown com as seções "## Contexto", "## Escopo Técnico" e "## Edge Cases", usando listas e blocos de código quando útil.
Os acceptance_criteria devem formar um checklist objetivo e verificável.`,
    });

    await logActivity(supabase, {
      workspaceId: project.workspace_id,
      projectId: project.id,
      taskId: task.id,
      actorType: "internal_ai",
      actorUserId: user.id,
      actorLabel: "IA Interna",
      action: "ai.spec_drafted",
      payload: { task_key: task.task_key },
    });

    return NextResponse.json({
      spec_markdown: object.spec_markdown,
      acceptance_criteria: object.acceptance_criteria,
    });
  } catch (error) {
    return aiErrorResponse(error, "draft-spec", "Erro interno ao redigir spec");
  }
}
