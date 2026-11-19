/**
 * Cria usuário de teste confirmado direto no banco (contorna rate limit de SMTP
 * do plano free). Login via API depois funciona normalmente.
 * Uso: set -a && source .env.local && set +a && node scripts/create-test-user.mjs
 */
import { Client } from "pg";

const pg = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const EMAIL = "canvasflow-smoke@gmail.com";
const PASSWORD = "smoke-test-1234";

async function main() {
  await pg.connect();

  // Remove versões antigas (ordem: workspaces → auth.users)
  const old = await pg.query("select id from auth.users where email = $1", [EMAIL]);
  for (const u of old.rows) {
    await pg.query("delete from workspaces where created_by = $1", [u.id]);
    await pg.query("delete from auth.users where id = $1", [u.id]);
    console.log("removido usuário antigo");
  }

  // Insere confirmado (o trigger de bootstrap cria workspace/projeto/canvas)
  const { rows } = await pg.query(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, confirmation_sent_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
     values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1::text, crypt($2::text, gen_salt('bf')), now(), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}')
     returning id`,
    [EMAIL, PASSWORD]
  );
  const userId = rows[0].id;

  // identidades (obrigatório para login funcionar; 'email' é coluna gerada — omitir)
  await pg.query(
    `insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, 'email', 'email', jsonb_build_object('sub', $1::uuid::text, 'email', $2::text, 'email_verified', true), now(), now(), now())`,
    [userId, EMAIL]
  );

  // Verifica bootstrap
  const ws = await pg.query("select name, slug from workspaces where created_by = $1", [userId]);
  const proj = await pg.query(
    "select p.name, p.key_prefix from projects p join workspaces w on w.id = p.workspace_id where w.created_by = $1",
    [userId]
  );
  const canvas = await pg.query(
    "select c.id, c.name from canvases c join projects p on p.id = c.project_id join workspaces w on w.id = p.workspace_id where w.created_by = $1",
    [userId]
  );
  const nodes = await pg.query(
    "select count(*)::int as total from canvas_nodes cn join canvases c on c.id = cn.canvas_id join projects p on p.id = c.project_id join workspaces w on w.id = p.workspace_id where w.created_by = $1",
    [userId]
  );

  console.log("Usuário criado e confirmado:", EMAIL, "| senha:", PASSWORD);
  console.log("  workspace:", ws.rows.map((r) => `${r.name} (${r.slug})`));
  console.log("  projeto:", proj.rows.map((r) => `${r.name} [${r.key_prefix}]`));
  console.log("  canvas:", canvas.rows.map((r) => `${r.name} — id ${r.id}`));
  console.log("  nós de canvas:", nodes.rows[0].total);

  await pg.end();
}

main().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
