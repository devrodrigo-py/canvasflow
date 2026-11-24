/**
 * Avalia modelos de um provedor OpenAI-compatível (ex.: NVIDIA) contra os
 * schemas REAIS das rotas de IA do app, medindo se o generateObject devolve
 * JSON válido. Lê a chave do ambiente; nunca imprime a chave.
 *
 * Uso:
 *   node --env-file=.env.local scripts/eval-ai-provider.mjs [modelo1,modelo2] [tool,json]
 */
import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import {
  decomposeEpicSchema,
  clusterNotesSchema,
  draftSpecSchema,
  summarizeCanvasSchema,
  chatActionsSchema,
} from "../src/lib/ai/schemas.ts";

const apiKey = process.env.NVIDIA_API_KEY;
if (!apiKey) {
  console.error("NVIDIA_API_KEY não definida no ambiente");
  process.exit(1);
}

const BASE_URL = "https://integrate.api.nvidia.com/v1";
const models = (process.argv[2] ?? "nvidia/nemotron-3-ultra-550b-a55b,nvidia/nemotron-3.5-super-vl-120b-a12b,nvidia/nemotron-3.5-lightning-30b-a3b").split(",");
const modes = (process.argv[3] ?? "tool,json").split(",");

const CASES = [
  {
    name: "decompose-epic",
    schema: decomposeEpicSchema,
    prompt:
      "Quebre o épico abaixo em 3 a 8 subtarefas com depends_on_index.\n- [sticky_note] Login social: permitir login com Google e GitHub, vincular contas existentes por email.",
  },
  {
    name: "cluster-notes",
    schema: clusterNotesSchema,
    prompt:
      "Agrupe os post-its em grupos temáticos (cada id em exatamente um grupo):\n- id=a1 :: checkout lento\n- id=a2 :: erro 500 no pagamento\n- id=a3 :: dark mode\n- id=a4 :: fonte pequena no mobile\n- id=a5 :: timeout no gateway",
  },
  {
    name: "draft-spec",
    schema: draftSpecSchema,
    prompt:
      'Escreva a spec da tarefa "Exportar backlog para CSV" com seções ## Contexto, ## Escopo Técnico e ## Edge Cases, e critérios de aceite verificáveis.',
  },
  {
    name: "summarize-canvas",
    schema: summarizeCanvasSchema,
    prompt:
      'Diagnostique o projeto. Hoje é 2026-11-24.\nBacklog:\n- APP-1 [task|high|blocked] "API de pagamentos" (atualizada em 2026-10-01)\n- APP-2 [task|medium|in_progress] "Tela de checkout" (atualizada em 2026-11-20)\n- APP-3 [bug|urgent|todo] "Erro 500 no pagamento" (atualizada em 2026-11-22)\nDependências:\n- APP-1 --blocks--> APP-2\n- APP-2 --blocks--> APP-1',
  },
  {
    name: "chat",
    schema: chatActionsSchema,
    prompt: "Crie um brainstorming com 4 post-its sobre melhorias de onboarding e um frame chamado Discovery.",
  },
];

const provider = createOpenAI({ apiKey, baseURL: BASE_URL, compatibility: "compatible", name: "nvidia" });

async function runCase(modelId, mode, testCase) {
  const started = Date.now();
  try {
    const model = provider(modelId, mode === "json" ? { structuredOutputs: true } : {});
    await generateObject({
      model,
      schema: testCase.schema,
      mode,
      prompt: testCase.prompt,
      abortSignal: AbortSignal.timeout(90_000),
      maxRetries: 1,
    });
    return { ok: true, ms: Date.now() - started };
  } catch (error) {
    const msg = String(error?.message ?? error).replace(/\s+/g, " ").slice(0, 110);
    return { ok: false, ms: Date.now() - started, error: msg };
  }
}

const results = [];
for (const modelId of models) {
  for (const mode of modes) {
    // Sequencial por modelo/modo: respeita o rate limit do plano gratuito
    for (const testCase of CASES) {
      const r = await runCase(modelId, mode, testCase);
      results.push({ modelId, mode, case: testCase.name, ...r });
      console.log(
        `${r.ok ? "OK  " : "FAIL"} ${modelId} [${mode}] ${testCase.name} ${(r.ms / 1000).toFixed(1)}s${r.ok ? "" : " — " + r.error}`
      );
    }
  }
}

console.log("\nResumo (sucessos / casos, latência média dos sucessos):");
for (const modelId of models) {
  for (const mode of modes) {
    const rows = results.filter((r) => r.modelId === modelId && r.mode === mode);
    const ok = rows.filter((r) => r.ok);
    const avg = ok.length ? ok.reduce((s, r) => s + r.ms, 0) / ok.length / 1000 : 0;
    console.log(`  ${modelId} [${mode}]: ${ok.length}/${rows.length}${ok.length ? ` · ${avg.toFixed(1)}s` : ""}`);
  }
}
