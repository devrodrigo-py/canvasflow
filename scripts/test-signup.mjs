/**
 * Testa signup (com domínio de email real) + bootstrap + confirmação de email
 * via banco + login. Valida o ciclo completo de auth no projeto hospedado.
 * Uso: set -a && source .env.local && set +a && node scripts/test-signup.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";

const pg = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await pg.connect();

  // Limpeza de usuários de teste anteriores
  const leftovers = await pg.query("select id, email from auth.users where email like 'canvasflow-smoke%'");
  for (const u of leftovers.rows) {
    await pg.query("delete from workspaces where created_by = $1", [u.id]);
    await pg.query("delete from auth.users where id = $1", [u.id]);
    console.log("removido usuário antigo:", u.email);
  }

  const email = `canvasflow-smoke.${Date.now()}@gmail.com`;
  const password = "smoke-test-1234";

  // 1. Signup via API (mesmo caminho do app)
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  console.log("\n1. signup:", email);
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) {
    console.error("   ERRO:", error.message);
    process.exitCode = 1;
    await pg.end();
    return;
  }
  console.log("   OK — usuário criado", data.session ? "(com sessão)" : "(sem sessão — confirmação ativa, como esperado)");

  const userId = data.user?.id;

  // 2. Bootstrap executou?
  const ws = await pg.query("select name, slug from workspaces where created_by = $1", [userId]);
  const proj = await pg.query(
    "select p.name, p.key_prefix from projects p join workspaces w on w.id = p.workspace_id where w.created_by = $1",
    [userId]
  );
  const nodes = await pg.query(
    "select count(*)::int as total, count(*) filter (where node_type = 'frame') as frames from canvas_nodes cn join canvases c on c.id = cn.canvas_id join projects p on p.id = c.project_id join workspaces w on w.id = p.workspace_id where w.created_by = $1",
    [userId]
  );
  console.log("2. bootstrap:", {
    workspaces: ws.rows.map((r) => `${r.name} (${r.slug})`),
    projetos: proj.rows.map((r) => `${r.name} [${r.key_prefix}]`),
    nos_canvas: `${nodes.rows[0].total} (frames: ${nodes.rows[0].frames})`,
  });

  // 3. Confirma email via banco (equivalente a clicar no link)
  await pg.query("update auth.users set email_confirmed_at = now(), updated_at = now() where id = $1", [userId]);
  console.log("3. email confirmado via banco");

  // 4. Login
  const { data: login, error: loginError } = await sb.auth.signInWithPassword({ email, password });
  console.log("4. login:", loginError ? "ERRO: " + loginError.message : "OK — sessão obtida");

  console.log("\nE-mail de teste criado:", email, "| senha:", password);
  await pg.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
