"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Sparkles, FileCode, Clock, Github, ExternalLink, AlertCircle, CheckCircle, XCircle, Code, Database, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AgentExecutionLogEntry } from "@/types/domain";

interface AgentExecutionLogProps {
  logs: AgentExecutionLogEntry[];
  onApproveAndComplete?: (taskId: string) => void;
  taskId?: string;
  taskStatus?: string;
}

const categoryIcons = {
  progress: Sparkles,
  architecture: Database,
  blocker: AlertCircle,
  test_result: CheckCircle,
};

const categoryLabels = {
  progress: "Progresso",
  architecture: "Arquitetura",
  blocker: "Bloqueador",
  test_result: "Teste",
};

const categoryColors = {
  progress: "bg-chart-1/10 text-chart-1 border-chart-1/20",
  architecture: "bg-primary/10 text-primary border-primary/20",
  blocker: "bg-destructive/10 text-destructive border-destructive/20",
  test_result: "bg-green-500/10 text-green-500 border-green-500/20",
};

export function AgentExecutionLog({
  logs,
  onApproveAndComplete,
  taskId,
  taskStatus,
}: AgentExecutionLogProps) {
  const sortedLogs = React.useMemo(
    () => [...logs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [logs]
  );

  if (sortedLogs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-muted-foreground">
        <Sparkles className="h-12 w-12 mb-4 opacity-50" />
        <p className="text-center">Nenhum log de execução de agente ainda.</p>
        <p className="text-sm text-center mt-1">Logs aparecerão aqui quando agentes externos (Claude Code, etc.) atualizarem a tarefa via MCP.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h3 className="font-medium flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-chart-1" />
          Execução de Agentes (MCP)
        </h3>
        {taskStatus === "in_review" && onApproveAndComplete && taskId && (
          <Button
            variant="default"
            size="sm"
            className="gap-1"
            onClick={() => onApproveAndComplete(taskId)}
          >
            <CheckCircle className="h-4 w-4" />
            Aprovar e Concluir
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {sortedLogs.map((log, index) => {
            const Icon = categoryIcons[log.category || "progress"];
            const categoryLabel = categoryLabels[log.category || "progress"];
            const categoryColor = categoryColors[log.category || "progress"];

            return (
              <div
                key={log.id || index}
                className="border border-border/50 rounded-lg p-4 bg-card hover:bg-muted/30 transition-colors"
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-chart-1/10 flex items-center justify-center">
                      <Sparkles className="h-4 w-4 text-chart-1" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{log.actor}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(log.timestamp).toLocaleString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className={cn("text-xs", categoryColor)}>
                    {categoryLabel}
                  </Badge>
                </div>

                {/* Summary */}
                <div className="prose prose-sm max-w-none text-muted-foreground/90 mb-3">
                  <p className="whitespace-pre-wrap">{log.summary}</p>
                </div>

                {/* Files Changed */}
                {log.files_changed && log.files_changed.length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                      <FileCode className="h-3 w-3" />
                      Arquivos alterados ({log.files_changed.length})
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {log.files_changed.map((file) => (
                        <span
                          key={file}
                          className="px-2 py-1 text-xs bg-muted rounded border border-border font-mono"
                        >
                          {file}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Commit/PR Link */}
                {(log.commit_or_pr_url || log.files_changed?.some((f) => f.includes("commit") || f.includes("pull"))) && (
                  <div className="flex items-center gap-2 pt-3 border-t border-border/50">
                    {log.commit_or_pr_url && (
                      <a
                        href={log.commit_or_pr_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <Github className="h-3 w-3" />
                        Ver Commit/PR
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}