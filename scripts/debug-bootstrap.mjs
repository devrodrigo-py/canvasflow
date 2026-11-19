/**
 * Diagnóstico: insere um usuário de teste em auth.users via SQL (postgres direto)
 * para revelar o erro real do trigger de bootstrap. Remove o usuário ao final.
 * Uso: set -a && source .env.local && set +a && node scripts/debug-bootstrap.mjs
 */
import { Client } from "pg";

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await c.connect();
  const userId = crypto.randomUUID();
  try {
    const { rows } = await c.query(
      `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
       values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', 'sql-test@canvasflow.local', crypt('sql-test-1234', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}')
       returning id`,
      [userId]
    );
    console.log("INSERT OK, user id:", rows[0].id);

    const ws = await c.query("select name, slug from workspaces where created_by = $1", [userId]);
    console.log("workspaces criados pelo trigger:", ws.rows);

    const projects = await c.query(
      "select p.name, p.slug, p.key_prefix from projects p join workspaces w on w.id = p.workspace_id where w.created_by = $1",
      [userId]
    );
    console.log("projetos criados pelo trigger:", projects.rows);

    await c.query("delete from auth.users where id = $1", [userId]);
    console.log("usuário de teste removido");
  } catch (e) {
    console.error("ERRO REAL DO POSTGRES:", e.message);
    // Tenta limpar se o insert do usuário passou mas algo depois falhou
    await c.query("delete from auth.users where id = $1", [userId]).catch(() => {});
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main();
