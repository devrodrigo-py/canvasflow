"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ActivityLog } from "@/types/domain";
import {
  Plus,
  Edit2,
  Trash2,
  ArrowRightLeft,
  Flag,
  User,
  Bot,
  Sparkles,
  Clock,
  GitBranch,
  FileText,
  MessageSquare,
  LayoutDashboard,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

interface TaskActivityFeedProps {
  activities: ActivityLog[];
  currentUserId: string;
}

const actionIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  "task.created": Plus,
  "task.updated": Edit2,
  "task.deleted": Trash2,
  "task.status_changed": ArrowRightLeft,
  "task.priority_changed": Flag,
  "task.assignee_changed": User,
  "node.promoted": GitBranch,
  "node.created": Plus,
  "node.updated": Edit2,
  "node.deleted": Trash2,
  "edge.created": ArrowRightLeft,
  "edge.deleted": Trash2,
  "comment.created": MessageSquare,
  "comment.updated": Edit2,
  "comment.deleted": Trash2,
  "comment.resolved": MessageSquare,
  "agent.note_appended": FileText,
  "agent.status_changed": Bot,
};

const actionLabels: Record<string, string> = {
  "task.created": "Tarefa criada",
  "task.updated": "Tarefa atualizada",
  "task.deleted": "Tarefa excluída",
  "task.status_changed": "Status alterado",
  "task.priority_changed": "Prioridade alterada",
  "task.assignee_changed": "Responsável alterado",
  "node.promoted": "Post-it promovido a tarefa",
  "node.created": "Nó criado",
  "node.updated": "Nó atualizado",
  "node.deleted": "Nó excluído",
  "edge.created": "Conexão criada",
  "edge.deleted": "Conexão removida",
  "comment.created": "Comentário adicionado",
  "comment.updated": "Comentário editado",
  "comment.deleted": "Comentário excluído",
  "comment.resolved": "Comentário resolvido",
  "agent.note_appended": "Log de agente adicionado",
  "agent.status_changed": "Status alterado por agente",
};

const actorIcons = {
  human: User,
  internal_ai: Sparkles,
  external_agent: Bot,
};

const actorLabels = {
  human: "Humano",
  internal_ai: "IA Interna",
  external_agent: "Agente Externo",
};

const actorColors = {
  human: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  internal_ai: "bg-chart-1/10 text-chart-1 border-chart-1/20",
  external_agent: "bg-purple-500/10 text-purple-500 border-purple-500/20",
};

export function TaskActivityFeed({ activities, currentUserId }: TaskActivityFeedProps) {
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(new Set());

  const sortedActivities = React.useMemo(
    () => [...activities].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [activities]
  );

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const getRelativeTime = (dateString: string) => {
    const now = new Date();
    const then = new Date(dateString);
    const diffMs = now.getTime() - then.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "agora mesmo";
    if (diffMins < 60) return `há ${diffMins} min`;
    if (diffHours < 24) return `há ${diffHours}h`;
    if (diffDays < 7) return `há ${diffDays}d`;
    return formatDate(dateString);
  };

  if (sortedActivities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-muted-foreground">
        <Clock className="h-12 w-12 mb-4 opacity-50" />
        <p className="text-center">Nenhuma atividade registrada ainda.</p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col h-full">
        <div className="p-4 border-b border-border">
          <h3 className="font-medium flex items-center gap-2">
            <LayoutDashboard className="h-5 w-5" />
            Histórico de Atividades ({sortedActivities.length})
          </h3>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-3">
            {sortedActivities.map((activity, index) => {
              const Icon = actionIcons[activity.action] || Edit2;
              const ActorIcon = actorIcons[activity.actor_type] || User;
              const actorColor = actorColors[activity.actor_type] || actorColors.human;
              const actionLabel = actionLabels[activity.action] || activity.action;
              const isExpanded = expandedIds.has(activity.id);
              const hasPayloadDetails = activity.payload && Object.keys(activity.payload).length > 0;

              return (
                <div
                  key={activity.id}
                  className="border border-border/50 rounded-lg bg-card hover:bg-muted/30 transition-colors"
                >
                  {/* Main row */}
                  <div className="p-4 flex items-start gap-3">
                    <div className={cn("flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center", actorColor)}>
                      <ActorIcon className="h-4 w-4" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm">{activity.actor_label}</span>
                        <Badge variant="outline" className="text-xs">
                          {actorLabels[activity.actor_type]}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{getRelativeTime(activity.created_at)}</span>
                      </div>

                      <div className="flex items-center gap-2 text-sm text-muted-foreground/90">
                        <Icon className="h-4 w-4" />
                        <span>{actionLabel}</span>
                      </div>

                      {/* Payload details */}
                      {hasPayloadDetails && (
                        <div className={cn("mt-2 text-xs text-muted-foreground", isExpanded ? "" : "line-clamp-2")}>
                          <pre className="bg-muted/50 p-2 rounded text-xs overflow-x-auto max-h-40">
                            {JSON.stringify(activity.payload, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>

                    {/* Expand/Collapse */}
                    {hasPayloadDetails && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => toggleExpand(activity.id)}
                            className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground"
                            aria-label={isExpanded ? "Recolher" : "Expandir"}
                          >
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{isExpanded ? "Recolher" : "Expandir"}</TooltipContent>
                      </Tooltip>
                    )}
                  </div>

                  {/* Expanded payload */}
                  {isExpanded && hasPayloadDetails && (
                    <div className="px-4 pb-4 border-t border-border/50">
                      <pre className="bg-muted/50 p-3 rounded text-xs overflow-x-auto max-h-60">
                        {JSON.stringify(activity.payload, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    </TooltipProvider>
  );
}