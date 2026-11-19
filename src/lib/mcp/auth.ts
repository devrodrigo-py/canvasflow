import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { sha256 } from "@/lib/crypto";
import type { MCPContext } from "@/types/domain";

export class MCPAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MCPAuthError";
  }
}

/**
 * Valida o header `Authorization: Bearer cf_pat_...`, resolve o contexto do token
 * (workspace, projeto restrito, escopos e guardrail allow_direct_done) e atualiza last_used_at.
 */
export async function authenticateMCPRequest(request: Request): Promise<MCPContext> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    throw new MCPAuthError("Header Authorization com Bearer token é obrigatório");
  }

  const token = authHeader.slice(7).trim();
  if (!token.startsWith("cf_pat_")) {
    throw new MCPAuthError("Formato de token inválido (esperado cf_pat_...)");
  }

  const admin = createAdminClient();
  const tokenHash = sha256(token);

  const { data: tokenRow, error } = await admin
    .from("agent_tokens")
    .select("*")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .maybeSingle();

  if (error) throw new MCPAuthError("Falha ao validar token");
  if (!tokenRow) {
    throw new MCPAuthError("Token inválido ou revogado");
  }

  // Fire-and-forget: atualiza last_used_at sem bloquear a resposta
  void admin
    .from("agent_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", tokenRow.id);

  return {
    workspaceId: tokenRow.workspace_id,
    projectId: tokenRow.project_id ?? null,
    actorLabel: tokenRow.actor_label,
    scopes: tokenRow.scopes ?? [],
    allowDirectDone: tokenRow.allow_direct_done,
  };
}

export function requireScope(context: MCPContext, scope: string): void {
  if (!context.scopes.includes(scope)) {
    throw new Error(`Token não possui o escopo necessário: ${scope}`);
  }
}
