import { NextRequest, NextResponse } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateMCPRequest, getAllowedMcpHosts, MCPAuthError, MCPRateLimitError } from "@/lib/mcp/auth";
import { createMCPServer } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonRpcError(code: number, message: string, status: number, headers?: Record<string, string>) {
  return NextResponse.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status, headers });
}

/**
 * Endpoint MCP Streamable HTTP (stateless).
 * - POST: JSON-RPC (initialize, tools/list, tools/call, notifications)
 * - GET:  405 (sem stream dedicado no modo stateless)
 * - DELETE: no-op (sem sessões)
 */
export async function POST(request: NextRequest) {
  try {
    const context = await authenticateMCPRequest(request);

    const allowedHosts = getAllowedMcpHosts();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      // Proteção contra DNS rebinding só faz sentido com uma lista fixa de hosts
      ...(allowedHosts ? { allowedHosts, enableDnsRebindingProtection: true } : {}),
    });

    const server = createMCPServer(context);
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch (error) {
    if (error instanceof MCPAuthError) {
      return jsonRpcError(-32001, error.message, 401, { "WWW-Authenticate": 'Bearer realm="canvasflow-mcp"' });
    }
    if (error instanceof MCPRateLimitError) {
      return jsonRpcError(-32002, error.message, 429, { "Retry-After": String(error.retryAfterSeconds) });
    }
    console.error("mcp POST:", error);
    return jsonRpcError(-32603, "Erro interno no servidor MCP", 500);
  }
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed: use POST com JSON-RPC" }, { status: 405 });
}

export async function DELETE() {
  return new NextResponse(null, { status: 204 });
}
