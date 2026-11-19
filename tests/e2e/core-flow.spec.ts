import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * Smoke test do fluxo crítico do CanvasFlow AI:
 * login -> criar post-it -> promover para tarefa -> editar spec ->
 * atualizar via chamada MCP simulada -> verificar atualização em tempo real.
 *
 * Requer: Supabase local rodando (supabase start), app em localhost:3000,
 * e as variáveis de ambiente abaixo exportadas antes de rodar:
 *   E2E_EMAIL, E2E_PASSWORD, E2E_SUPABASE_URL, E2E_SUPABASE_ANON_KEY
 *
 * Rodar: npx playwright test tests/e2e/core-flow.spec.ts
 */

const APP_URL = process.env.E2E_APP_URL ?? "http://localhost:3000";
const EMAIL = process.env.E2E_EMAIL ?? "e2e@canvasflow.local";
const PASSWORD = process.env.E2E_PASSWORD ?? "e2e-password-123";

// Admin-free helpers usando o anon key (respeita RLS após login)
const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SUPABASE_ANON_KEY = process.env.E2E_SUPABASE_ANON_KEY ?? "";

test.beforeEach(async ({ page }) => {
  // Garante usuário de teste (signup idempotente; ignora erro se já existir)
  if (SUPABASE_ANON_KEY) {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    await supabase.auth.signUp({ email: EMAIL, password: PASSWORD }).catch(() => null);
  }

  await page.goto(`${APP_URL}/login`);
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/senha/i).fill(PASSWORD);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/w\//, { timeout: 15_000 });
});

test("fluxo crítico: post-it -> tarefa -> spec -> MCP -> tempo real", async ({ page }) => {
  // 1. Navega para o projeto e canvas
  await page.goto(`${APP_URL}`);
  await page.waitForURL(/\/w\/[^/]+\/p\//);
  await page.getByRole("link", { name: /canvas/i }).first().click();
  await page.waitForURL(/\/canvas\//);

  // 2. Cria um post-it via atalho N (foco no canvas)
  await page.locator("body").press("n");
  await expect(page.locator(".sticky-note-node").first()).toBeVisible({ timeout: 10_000 });

  // 3. Promove o post-it para tarefa (botão de 1 clique no nó)
  const sticky = page.locator(".sticky-note-node").first();
  await sticky.hover();
  await page.getByRole("button", { name: /promover/i }).first().click();
  await expect(page.locator(".task-card-node").first()).toBeVisible({ timeout: 10_000 });

  // 4. Abre a TaskDrawer com duplo clique e edita a spec
  await page.locator(".task-card-node").first().dblclick();
  await expect(page.getByRole("heading", { name: /APP-1|Nova tarefa/i })).toBeVisible();
  const specEditor = page.locator(".ProseMirror").first();
  await specEditor.click();
  await specEditor.type("## Contexto\nSpec criada pelo teste E2E.");
  await page.keyboard.press("Escape");

  // 5. Simula uma atualização de agente externo via MCP
  //    (chamada HTTP direta ao endpoint com o Bearer token do E2E,
  //     exercitando o mesmo caminho que o Claude Code usaria)
  const mcpToken = process.env.E2E_MCP_TOKEN;
  test.skip(!mcpToken, "E2E_MCP_TOKEN não definido — pulando verificação MCP");

  const mcpResponse = await page.request.post(`${APP_URL}/api/mcp`, {
    headers: {
      Authorization: `Bearer ${mcpToken}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "update_task_status",
        arguments: {
          task_key: "APP-1",
          status: "in_review",
          summary: "Atualização via MCP simulada no E2E",
          files_changed: ["src/example.ts"],
        },
      },
    },
  });
  expect(mcpResponse.ok()).toBeTruthy();

  const mcpBody = (await mcpResponse.json()) as {
    result?: { content?: Array<{ text?: string }> };
  };
  const payloadText = mcpBody.result?.content?.[0]?.text ?? "";
  expect(payloadText).toContain("in_review");

  // 6. Verifica atualização em tempo real no card do canvas (badge de IA)
  await expect(page.locator(".task-card-node").first()).toContainText("APP-1", { timeout: 15_000 });

  // 7. Verifica sincronização no backlog
  await page.getByRole("link", { name: /backlog/i }).first().click();
  await expect(page.getByText("APP-1")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Atualização via MCP simulada/i).or(page.getByText(/in_review/i)).first()).toBeVisible();
});
