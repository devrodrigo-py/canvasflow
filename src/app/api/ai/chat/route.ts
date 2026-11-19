import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceModel, AIKeyNotFoundError } from "@/lib/ai/provider";
import { chatActionsSchema, chatRequestSchema } from "@/lib/ai/schemas";
import { createTask, logActivity } from "@/lib/services/tasks.service";
import { createNode } from "@/lib/services/canvas.service";

export const runtime = "nodejs";
export const maxDuration = 120;

type Db = SupabaseClient<Database>;

const STICKY_COLORS = ["#fef9c3", "#dcfce7", "#dbeafe", "#fce7f3", "#e0e7ff"];

interface CreatedItem {
  type: string;
  label: string;
}

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
    const parsed = chatRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload inválido", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { canvas_id: canvasId, messages, suggested_origin: suggestedOrigin } = parsed.data;

    const { data: canvas, error: canvasError } = await supabase
      .from("canvases")
      .select("id, project_id, projects(workspace_id, key_prefix)")
      .eq("id", canvasId)
      .maybeSingle();
    if (canvasError || !canvas) {
      return NextResponse.json({ error: "Canvas não encontrado" }, { status: 404 });
    }

    const project = canvas.projects as unknown as {
      workspace_id: string;
      key_prefix: string;
    };
    const projectId = canvas.project_id;
    const workspaceId = project.workspace_id;
    const keyPrefix = project.key_prefix;

    // Contexto atual do canvas para a IA decidir onde/qué criar
    const { data: existingNodes } = await supabase
      .from("canvas_nodes")
      .select("node_type, data")
      .eq("canvas_id", canvasId);
    const nodes = existingNodes ?? [];
    const contextSummary = [
      `Projeto com prefixo de chave "${keyPrefix}".`,
      `Canvas atual: ${nodes.length} nós, sendo:`,
      `  - ${nodes.filter((n) => n.node_type === "task_card").length} cards de tarefa`,
      `  - ${nodes.filter((n) => n.node_type === "sticky_note").length} post-its`,
      `  - ${nodes.filter((n) => n.node_type === "frame").length} frames (títulos: ${nodes
        .filter((n) => n.node_type === "frame")
        .map((n) => (n.data as Record<string, unknown>)?.title)
        .filter(Boolean)
        .join(", ") || "nenhum"})`,
    ].join("\n");

    const { model } = await getWorkspaceModel(supabase as unknown as Db, workspaceId);

    const { object } = await generateObject({
      model,
      schema: chatActionsSchema,
      abortSignal: AbortSignal.timeout(90_000),
      messages: [
        {
          role: "system" as const,
          content: `Você é o assistente do CanvasFlow AI, uma ferramenta colaborativa de canvas espacial + backlog.
O usuário fala em português (ou na língua que usar) e pede para você criar elementos no canvas e no backlog.
Responda SEMPRE na língua do usuário.

Estado atual do canvas:
${contextSummary}

Você pode executar ações de criação:
- create_sticky: post-it livre para brainstorming (texto curto, uma ideia por post-it)
- create_task: tarefa oficial do backlog (com task_type, priority, status, spec e critérios de aceite). O card aparece no canvas automaticamente.
- create_frame: agrupador visual (ex: "Sprint 1", "Discovery")

Diretrizes:
- Quando pedirem um backlog ou quebra de épico, crie várias create_task coerentes (3-8), com specs objetivas e critérios de aceite verificáveis.
- Quando pedirem brainstorming, crie create_sticky — uma ideia por post-it.
- Crie frames quando fizer sentido agrupar (ex: fases, sprints, temas).
- Se for apenas uma pergunta, retorne actions vazio.
- Não invente elementos que o usuário não pediu.`,
        },
        ...messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ],
    });

    // Executa as ações
    const created: CreatedItem[] = [];
    let stickyIndex = 0;
    let taskIndex = 0;
    let frameIndex = 0;

    for (const action of object.actions) {
      if (action.type === "create_sticky") {
        // Grid de post-its a partir da origem sugerida (3 por linha)
        const col = stickyIndex % 3;
        const row = Math.floor(stickyIndex / 3);
        const position = {
          x: suggestedOrigin.x + col * 240,
          y: suggestedOrigin.y + row * 200,
        };
        await createNode(supabase as unknown as Db, {
          canvasId,
          nodeType: "sticky_note",
          position,
          data: { color: action.color || STICKY_COLORS[stickyIndex % STICKY_COLORS.length], text: action.text },
        });
        created.push({ type: "sticky", label: action.text.slice(0, 60) });
        stickyIndex++;
      } else if (action.type === "create_task") {
        const task = await createTask(supabase as unknown as Db, {
          projectId,
          title: action.title,
          type: action.task_type,
          priority: action.priority,
          status: action.status,
          specMarkdown: action.spec_markdown,
          acceptanceCriteria: action.acceptance_criteria.map((text, i) => ({
            id: `${Date.now()}-${i}`,
            text,
            completed: false,
          })),
          actorType: "internal_ai",
          actorLabel: "IA Interna (chat)",
        });

        // Card projetado no canvas com posicionamento em coluna à direita da origem
        const position = {
          x: suggestedOrigin.x + 600,
          y: suggestedOrigin.y + taskIndex * 190,
        };
        await createNode(supabase as unknown as Db, {
          canvasId,
          nodeType: "task_card",
          position,
          taskId: task.id,
          data: { title: task.title },
        });
        created.push({ type: "task", label: `${task.task_key} — ${task.title}` });
        taskIndex++;
      } else if (action.type === "create_frame") {
        const position = {
          x: suggestedOrigin.x + 1200,
          y: suggestedOrigin.y + frameIndex * 680,
        };
        await createNode(supabase as unknown as Db, {
          canvasId,
          nodeType: "frame",
          position,
          width: 800,
          height: 600,
          data: { title: action.title, description: action.description },
        });
        created.push({ type: "frame", label: action.title });
        frameIndex++;
      }
    }

    if (created.length > 0) {
      await logActivity(supabase as unknown as Db, {
        workspaceId,
        projectId,
        taskId: null,
        actorType: "internal_ai",
        actorUserId: user.id,
        actorLabel: "IA Interna (chat)",
        action: "ai.chat_actions",
        payload: { canvas_id: canvasId, created_count: created.length },
      });
    }

    return NextResponse.json({
      reply: object.reply,
      created,
    });
  } catch (error) {
    if (error instanceof AIKeyNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    // Erros de provedor (503, rate limit etc.) com mensagem amigável
    const message = error instanceof Error ? error.message : "";
    if (error instanceof Error && (error.name === "AbortError" || message.includes("aborted") || message.includes("timeout"))) {
      return NextResponse.json(
        { error: "A IA demorou demais para responder. Tente novamente em alguns instantes." },
        { status: 504 }
      );
    }
    if (message.includes("503") || message.toLowerCase().includes("overloaded") || message.toLowerCase().includes("high demand")) {
      return NextResponse.json(
        { error: "O modelo de IA está com alta demanda agora. Tente novamente em alguns instantes." },
        { status: 503 }
      );
    }
    console.error("ai/chat:", error);
    return NextResponse.json({ error: "Erro interno no chat de IA" }, { status: 500 });
  }
}
