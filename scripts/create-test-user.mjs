/**
 * Cria (ou recria) um usuário de teste já confirmado usando a Admin API do Supabase
 * (contorna o rate limit de SMTP do plano free sem escrever direto em auth.users).
 * O trigger bootstrap_user_workspace cria workspace/projeto/canvas automaticamente.
 *
 * Uso: TEST_USER_EMAIL=... TEST_USER_PASSWORD=... pnpm user:create-test
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.TEST_USER_EMAIL;
const password = process.env.TEST_USER_PASSWORD;

if (!url || !serviceKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias");
  process.exit(1);
}
if (!email || !password || password.length < 8) {
  console.error("Defina TEST_USER_EMAIL e TEST_USER_PASSWORD (mínimo 8 caracteres)");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  // Remove usuário anterior com o mesmo email (workspaces criados por ele caem em cascata via FK)
  const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;
  const existing = list.users.find((u) => u.email === email);
  if (existing) {
    await admin.from("workspaces").delete().eq("created_by", existing.id);
    const { error } = await admin.auth.admin.deleteUser(existing.id);
    if (error) throw error;
    console.log("Usuário anterior removido");
  }

  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  console.log("Usuário de teste criado:", data.user.email, data.user.id);
}

main().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
