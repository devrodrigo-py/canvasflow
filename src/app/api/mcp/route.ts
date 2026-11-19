import { NextRequest, NextResponse } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateMCPRequest, MCPAuthError } from "@/lib/mcp/auth";
import { createMCPServer } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Endpoint MCP Streamable HTTP.
 * - POST: JSON-RPC (initialize, tools/list, tools/call, notifications, delete session)
 * - GET:  Stream dedicado (não suportado no modo stateless — responde 405 conforme spec)
 * - DELETE: encerramento de sessão (no-op no modo stateless)
 */
export async function POST(request: NextRequest) {
  try {
    // Autenticação antes de qualquer processamento MCP
    const context = await authenticateMCPRequest(request);

    // Instância nova por requisição (stateless) — sem sessões persistidas entre requests
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      allowedHosts: [request.nextUrl.host],
    });

    const server = createMCPServer(context);
    await server.connect(transport);

    // O transport consome o Request e devolve um Response padrão
    return await transport.handleRequest(request);
  } catch (error) {
    if (error instanceof MCPAuthError) {
      return NextResponse.json(
        {
          jsonrpc: "2.0",
          error: { code: -32001, message: error.message },
          id: null,
        },
        {
          status: 401,
          headers: { "WWW-Authenticate": 'Bearer realm="canvasflow-mcp"' },
        }
      );
    }
    console.error("mcp POST:", error);
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        error: { code: -32603, message: "Erro interno no servidor MCP" },
        id: null,
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  // Modo stateless: sem stream de servidor dedicado
  return NextResponse.json(
    { error: "Method not allowed: use POST com JSON-RPC" },
    { status: 405 }
  );
}

export async function DELETE() {
  // Sem sessões persistidas no modo stateless
  return new NextResponse(null, { status: 204 });
}
