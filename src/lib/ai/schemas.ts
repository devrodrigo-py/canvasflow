import { z } from "zod";

// ---------- Decompor épico / ideias em tarefas ----------

export const decomposeEpicSchema = z.object({
  subtasks: z
    .array(
      z.object({
        title: z.string().min(3).max(200).describe("Título curto e acionável da subtarefa"),
        type: z.enum(["epic", "feature", "task", "bug", "tech_debt"]).describe("Tipo da tarefa"),
        priority: z.enum(["low", "medium", "high", "urgent"]).describe("Prioridade sugerida"),
        spec_markdown: z.string().describe("Especificação em markdown (Contexto, Escopo, Edge Cases)"),
        acceptance_criteria: z.array(z.string()).min(1).max(8).describe("Critérios de aceite verificáveis"),
        depends_on_index: z
          .array(z.number().int().min(0))
          .describe("Índices (0-based) das subtarefas das que esta depende"),
      })
    )
    .min(3)
    .max(8)
    .describe("Entre 3 e 8 subtarefas que juntos implementam a ideia/épico"),
});

export type DecomposeEpicStructured = z.infer<typeof decomposeEpicSchema>;

// ---------- Agrupar post-its em frames temáticos ----------

export const clusterNotesSchema = z.object({
  groups: z
    .array(
      z.object({
        title: z.string().min(2).max(80).describe("Título curto do tema do grupo"),
        description: z.string().max(300).describe("Descrição de uma linha do tema"),
        note_ids: z.array(z.string()).min(1).describe("IDs dos post-its pertencentes ao grupo"),
      })
    )
    .min(1)
    .max(12),
});

export type ClusterNotesStructured = z.infer<typeof clusterNotesSchema>;

// ---------- Redigir especificação ----------

export const draftSpecSchema = z.object({
  spec_markdown: z
    .string()
    .min(50)
    .describe(
      "Especificação estruturada em markdown com seções: ## Contexto, ## Escopo Técnico, ## Edge Cases"
    ),
  acceptance_criteria: z
    .array(z.string())
    .min(2)
    .max(10)
    .describe("Checklist de critérios de aceite verificáveis"),
});

export type DraftSpecStructured = z.infer<typeof draftSpecSchema>;

// ---------- Diagnóstico do quadro ----------

export const summarizeCanvasSchema = z.object({
  executive_summary: z.string().describe("Resumo executivo do estado do projeto em 2-4 frases"),
  bottlenecks: z.array(z.string()).describe("Gargalos detectados"),
  stale_blocked_tasks: z.array(
    z.object({
      task_key: z.string(),
      title: z.string(),
      days_blocked: z.number().int().min(0),
      recommendation: z.string(),
    })
  ),
  circular_dependencies: z.array(
    z.object({
      task_key_a: z.string(),
      task_key_b: z.string(),
    })
  ),
  prioritization_suggestions: z.array(z.string()).describe("Sugestões de priorização"),
});

export type SummarizeCanvasStructured = z.infer<typeof summarizeCanvasSchema>;

// ---------- Chat conversacional com ações ----------

export const chatActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_sticky"),
    text: z.string().min(1).max(2000).describe("Texto do post-it"),
    color: z
      .enum(["#fef9c3", "#dcfce7", "#dbeafe", "#fce7f3", "#e0e7ff", "#f3f4f6"])
      .describe("Cor de fundo do post-it"),
  }),
  z.object({
    type: z.literal("create_task"),
    title: z.string().min(3).max(300),
    task_type: z.enum(["epic", "feature", "task", "bug", "tech_debt"]).describe("Tipo da tarefa"),
    priority: z.enum(["low", "medium", "high", "urgent"]),
    status: z
      .enum(["backlog", "todo", "in_progress", "in_review", "blocked", "done"])
      .describe("Status inicial no backlog"),
    spec_markdown: z.string().describe("Especificação curta em markdown"),
    acceptance_criteria: z.array(z.string()).max(8).describe("Critérios de aceite"),
  }),
  z.object({
    type: z.literal("create_frame"),
    title: z.string().min(2).max(120),
    description: z.string().max(300).describe("Descrição curta do frame"),
  }),
]);

export const chatActionsSchema = z.object({
  reply: z.string().describe("Resposta conversacional ao usuário, na língua dele, resumindo o que foi feito/oferecido"),
  actions: z
    .array(chatActionSchema)
    .max(12)
    .describe("Ações de criação a executar no canvas/backlog. Vazio se o pedido for apenas uma pergunta."),
});

export type ChatActionsStructured = z.infer<typeof chatActionsSchema>;

export const chatRequestSchema = z.object({
  canvas_id: z.string().uuid(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      })
    )
    .min(1)
    .max(20),
  // Origem sugerida em coordenadas do canvas (centro da viewport) para posicionar criados
  suggested_origin: z.object({ x: z.number(), y: z.number() }),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

// ---------- Validação de payloads das rotas ----------

export const decomposeEpicRequestSchema = z.object({
  canvas_id: z.string().uuid(),
  source_nodes: z
    .array(
      z.object({
        id: z.string(),
        type: z.enum(["task_card", "sticky_note", "frame", "doc_block"]),
        title: z.string().optional(),
        content: z.string().optional(),
      })
    )
    .min(1),
});

export const clusterNotesRequestSchema = z.object({
  canvas_id: z.string().uuid(),
  sticky_note_ids: z.array(z.string()).min(2),
});

export const draftSpecRequestSchema = z.object({
  task_id: z.string().uuid().optional(),
  task_title: z.string().min(1).optional(),
}).refine((data) => data.task_id || data.task_title, {
  message: "Informe task_id ou task_title",
});

export const summarizeCanvasRequestSchema = z.object({
  project_id: z.string().uuid(),
});

// ---------- Config de chaves BYOK ----------

export const mcpTokenRequestSchema = z.object({
  name: z.string().min(1).max(100),
  actor_label: z.string().min(1).max(100).default("Claude Agent"),
  project_id: z.string().uuid().nullable().optional(),
  scopes: z
    .array(z.enum(["tasks:read", "tasks:write", "canvas:write"]))
    .default(["tasks:read", "tasks:write", "canvas:write"]),
  allow_direct_done: z.boolean().default(false),
  /** Validade em dias; null = sem expiração (desencorajado). */
  expires_in_days: z.union([z.literal(30), z.literal(90), z.literal(365), z.null()]).default(90),
});
