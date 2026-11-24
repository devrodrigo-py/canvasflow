import "server-only";

import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createClient } from "@/lib/supabase/server";
import { AIKeyNotFoundError, WorkspaceAccessError } from "@/lib/ai/provider";
import { rateLimit } from "@/lib/rate-limit";

export type Db = SupabaseClient<Database>;

/** 20 chamadas de IA por usuário por minuto (protege a chave BYOK do time). */
const AI_LIMIT = 20;
const AI_WINDOW_MS = 60_000;

export type AuthedRequest =
  | { ok: true; supabase: Db; user: User }
  | { ok: false; response: NextResponse };

export async function requireAIUser(): Promise<AuthedRequest> {
  const supabase = (await createClient()) as unknown as Db;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) };
  }

  const limit = rateLimit(`ai:${user.id}`, AI_LIMIT, AI_WINDOW_MS);
  if (!limit.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Muitas requisições de IA. Aguarde alguns segundos." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
      ),
    };
  }
  return { ok: true, supabase, user };
}

/** Converte erros conhecidos em respostas amigáveis; o resto vira 500 logado. */
export function aiErrorResponse(error: unknown, label: string, fallbackMessage: string) {
  if (error instanceof AIKeyNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof WorkspaceAccessError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  const message = error instanceof Error ? error.message : "";
  const lower = message.toLowerCase();
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError" || lower.includes("timeout"))) {
    return NextResponse.json(
      { error: "A IA demorou demais para responder. Tente novamente em alguns instantes." },
      { status: 504 }
    );
  }
  if (message.includes("429") || lower.includes("rate limit")) {
    return NextResponse.json(
      { error: "O provedor de IA limitou as requisições da chave do workspace. Tente mais tarde." },
      { status: 429 }
    );
  }
  if (message.includes("503") || lower.includes("overloaded") || lower.includes("high demand")) {
    return NextResponse.json(
      { error: "O modelo de IA está com alta demanda agora. Tente novamente em alguns instantes." },
      { status: 503 }
    );
  }
  console.error(`${label}:`, error);
  return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}
