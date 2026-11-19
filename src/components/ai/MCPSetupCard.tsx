"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Copy, Check } from "lucide-react";

interface MCPSetupCardProps {
  url: string;
  token: string;
}

export function MCPSetupCard({ url, token }: MCPSetupCardProps) {
  const [copied, setCopied] = React.useState(false);

  const snippet = JSON.stringify(
    {
      mcpServers: {
        canvasflow: {
          type: "http",
          url,
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      },
    },
    null,
    2
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard indisponível (permissão/contexto inseguro)
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conectar no Claude Code / Claude Desktop</CardTitle>
        <CardDescription>
          Cole o snippet abaixo no <code className="font-mono text-xs">.mcp.json</code> do seu
          repositório ou nas configurações MCP do Claude Desktop. O token é exibido apenas uma vez.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <pre className="overflow-x-auto rounded-md bg-muted p-4 text-xs font-mono leading-relaxed">
            {snippet}
          </pre>
          <Button
            variant="outline"
            size="sm"
            className="absolute top-2 right-2 gap-1"
            onClick={handleCopy}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copiado" : "Copiar"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          No Claude Code, você pode também executar:{" "}
          <code className="font-mono bg-muted px-1 py-0.5 rounded">
            claude mcp add --transport http canvasflow {url} --header "Authorization: Bearer {token}"
          </code>
        </p>
      </CardContent>
    </Card>
  );
}
