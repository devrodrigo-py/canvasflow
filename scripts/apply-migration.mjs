/**
 * Aplica uma migração SQL num banco Postgres via DATABASE_URL (Supavisor session pooler).
 * Uso: node scripts/apply-migration.mjs supabase/migrations/0001_initial_schema.sql
 * A DATABASE_URL vem do ambiente — nunca hardcoded aqui.
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";

const sqlPath = process.argv[2];
if (!sqlPath) {
  console.error("Uso: node scripts/apply-migration.mjs <caminho-do-arquivo.sql>");
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL não definida no ambiente");
  process.exit(1);
}

const sql = readFileSync(sqlPath, "utf8");

const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  console.log("Conectado. Aplicando migração:", sqlPath);

  try {
    await client.query(sql);
    console.log("✓ Migração aplicada com sucesso");
  } catch (error) {
    // Migrações idempotentes: se os objetos já existem, reporta sem tratar como falha catastrófica
    console.error("✗ Erro ao aplicar migração:", error.message);
    process.exitCode = 1;
  } finally {
    // Verificação: lista as tabelas criadas
    try {
      const { rows } = await client.query(
        "select table_name from information_schema.tables where table_schema = 'public' order by table_name"
      );
      console.log("\nTabelas no schema public:");
      for (const row of rows) console.log(" -", row.table_name);

      const { rows: enumRows } = await client.query(
        "select typname from pg_type where typtype = 'e' and typnamespace = (select oid from pg_namespace where nspname = 'public') order by typname"
      );
      console.log("\nEnums:");
      for (const row of enumRows) console.log(" -", row.typname);
    } catch {
      // Se a verificação falhar, não altera o exit code
    }
    await client.end();
  }
}

main();
