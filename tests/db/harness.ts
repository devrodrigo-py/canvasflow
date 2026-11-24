import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Sobe um Postgres em WASM (PGlite) com stubs mínimos do Supabase
 * (roles, schema auth, auth.uid(), publicação realtime) e aplica todas as
 * migrações de supabase/migrations em ordem. Permite testar RLS, triggers e
 * RPCs no CI sem Docker.
 */
const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb
);

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')
$$;
create function auth.email() returns text language sql stable as $$
  select email from auth.users where id = auth.uid()
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create publication supabase_realtime;
`;

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);

  const dir = path.resolve(__dirname, "../../supabase/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = readFileSync(path.join(dir, file), "utf8")
      // gen_random_uuid é nativo; PGlite não carrega pgcrypto sem import explícito
      .replace(/create extension if not exists "pgcrypto";/i, "");
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`Falha ao aplicar ${file}: ${(error as Error).message}`);
    }
  }
  return db;
}

/** Cria um usuário em auth.users (dispara o bootstrap de workspace). */
export async function createUser(db: PGlite, id: string, email: string) {
  await db.query("reset role");
  await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
}

/** Executa como usuário autenticado (RLS ativo). */
export async function asUser<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  await db.query(`select set_config('request.jwt.claim.role', 'authenticated', false)`);
  await db.query("set role authenticated");
  try {
    return await fn();
  } finally {
    await db.query("reset role");
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
    await db.query(`select set_config('request.jwt.claim.role', '', false)`);
  }
}

/** Executa como service role (bypass de RLS, sem auth.uid()). */
export async function asService<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  await db.query(`select set_config('request.jwt.claim.role', 'service_role', false)`);
  await db.query("set role service_role");
  try {
    return await fn();
  } finally {
    await db.query("reset role");
    await db.query(`select set_config('request.jwt.claim.role', '', false)`);
  }
}
