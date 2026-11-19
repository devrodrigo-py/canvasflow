/**
 * Diagnóstico do signup via API: lista usuários existentes e tenta signup real.
 * Uso: set -a && source .env.local && set +a && node scripts/debug-signup.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const pg = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await pg.connect();

  const existing = await pg.query("select id, email, created_at from auth.users order by created_at");
  console.log("Usuários em auth.users:");
  for (const u of existing.rows) console.log(" -", u.email, u.id, u.created_at);

  const email = `smoke-${Date.now()}@canvasflow.local`;
  console.log("\nTentando signup:", email);
  const { data, error } = await sb.auth.signUp({
    email,
    password: "smoke-test-1234",
    options: { emailRedirectTo: "http://localhost:3000/auth/callback" },
  });
  console.log("signup:", error ? "ERRO: " + error.message : data.session ? "OK com sessão" : "OK sem sessão (confirmação ativa)");

  const after = await pg.query("select id, email from auth.users where email = $1", [email]);
  console.log("Usuário persistido no banco?", after.rows.length > 0 ? "SIM" : "NÃO");

  if (after.rows.length > 0) {
    const userId = after.rows[0].id;
    const ws = await pg.query("select name, slug from workspaces where created_by = $1", [userId]);
    console.log("Bootstrap executou?", ws.rows.length > 0 ? `SIM (${ws.rows.length} workspace)` : "NÃO");
  }

  await pg.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
