import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceModel, AIKeyNotFoundError } from "@/lib/ai/provider";
import { clusterNotesSchema, clusterNotesRequestSchema } from "@/lib/ai/schemas";
import { logActivity } from "@/lib/services/tasks.service";
import { createNode } from "@/lib/services/canvas.service";

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
    const parsed = clusterNotesRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload inválido", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { canvas_id: canvasId, sticky_note_ids: stickyNoteIds } = parsed.data;

    const { data: canvas, error: canvasError } = await supabase
      .from("canvases")
      .select("id, project_id, projects(workspace_id)")
      .eq("id", canvasId)
      .maybeSingle();
    if (canvasError || !canvas) {
      return NextResponse.json({ error: "Canvas não encontrado" }, { status: 404 });
    }

    const project = canvas.projects as unknown as { workspace_id: string };
    const workspaceId = project.workspace_id;

    // Carrega os post-its selecionados
    const { data: nodes, error: nodesError } = await supabase
      .from("canvas_nodes")
      .select("*")
      .eq("canvas_id", canvasId)
      .eq("node_type", "sticky_note")
      .in("id", stickyNoteIds);
    if (nodesError) throw nodesError;

    const notes = nodes ?? [];
    if (notes.length !== stickyNoteIds.length) {
      return NextResponse.json(
        { error: "Alguns post-its não foram encontrados neste canvas" },
        { status: 404 }
      );
    }

    const notesContext = notes
      .map((n) => `- id=${n.id} :: ${((n.data as Record<string, unknown>)?.text as string) ?? "(vazio)"}`)
      .join("\n");

    const { model } = await getWorkspaceModel(supabase as unknown as Db, workspaceId);

    const { object } = await generateObject({
      model,
      schema: clusterNotesSchema,
      prompt: `Você é facilitador de workshops de produto. Agrupe os post-its abaixo em grupos temáticos coerentes (1 a 8 grupos). Cada post-it pertence a exatamente um grupo e todos os post-its informados devem ser alocados.

Post-its:
${notesContext}`,
    });

    // Efeito: cria um FrameNode por tema e move os post-its para dentro via auto-layout
    const framesCreated: Array<{ id: string; title: string }> = [];
    let offsetY = 0;
    for (const group of object.groups) {
      const frame = await createNode(supabase as unknown as Db, {
        canvasId,
        nodeType: "frame",
        position: { x: 0, y: offsetY },
        width: 800,
        height: Math.max(240, group.note_ids.length * 150 + 80),
        data: { title: group.title, description: group.description, isAIInbox: false, aiGenerated: true },
      });
      framesCreated.push({ id: frame.id, title: group.title });
      offsetY += (frame.height ?? 300) + 60;

      // Post-its do grupo: dentro do frame e com needs_auto_layout para o efeito reativo posicioná-los
      for (const noteId of group.note_ids) {
        await supabase
          .from("canvas_nodes")
          .update({ parent_frame_id: frame.id, needs_auto_layout: true })
          .eq("id", noteId)
          .eq("canvas_id", canvasId);
      }
    }

    await logActivity(supabase as unknown as Db, {
      workspaceId,
      projectId: canvas.project_id,
      taskId: null,
      actorType: "internal_ai",
      actorUserId: user.id,
      actorLabel: "IA Interna",
      action: "ai.notes_clustered",
      payload: { canvas_id: canvasId, groups: object.groups.map((g) => g.title) },
    });

    return NextResponse.json({
      groups: object.groups,
      frames: framesCreated,
      message: `${object.groups.length} frames criados e ${stickyNoteIds.length} post-its organizados.`,
    });
  } catch (error) {
    if (error instanceof AIKeyNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("cluster-notes:", error);
    return NextResponse.json({ error: "Erro interno ao agrupar post-its" }, { status: 500 });
  }
}
