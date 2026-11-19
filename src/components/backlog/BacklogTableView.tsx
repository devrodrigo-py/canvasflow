"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Task, TaskStatus, TaskPriority, TaskType } from "@/types/domain";
import {
  ChevronLeft,
  ChevronRight,
  Search,
  Filter,
  Columns,
  ExternalLink,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

interface BacklogTableViewProps {
  tasks: Task[];
  sortBy: string;
  sortOrder: "asc" | "desc";
  onSort: (field: string) => void;
  onViewOnCanvas: (task: Task) => void;
  onOpenDrawer: (taskId: string) => void;
  selectedTaskIds: string[];
  onSelectTask: (taskId: string, selected: boolean) => void;
  onSelectAll: (selected: boolean) => void;
}

const statusColors: Record<TaskStatus, string> = {
  backlog: "bg-muted-foreground/20 text-muted-foreground",
  todo: "bg-blue-500/10 text-blue-500",
  in_progress: "bg-yellow-500/10 text-yellow-500",
  in_review: "bg-purple-500/10 text-purple-500",
  blocked: "bg-red-500/10 text-red-500",
  done: "bg-green-500/10 text-green-500",
};

const statusLabels: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "A fazer",
  in_progress: "Em progresso",
  in_review: "Em revisão",
  blocked: "Bloqueado",
  done: "Concluído",
};

const priorityLabels: Record<TaskPriority, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  urgent: "Urgente",
};

const typeLabels: Record<TaskType, string> = {
  epic: "Épico",
  feature: "Feature",
  task: "Tarefa",
  bug: "Bug",
  tech_debt: "Dívida Técnica",
};

const columns = [
  { key: "select", label: "", width: "40px" },
  { key: "task_key", label: "Chave", width: "100px" },
  { key: "title", label: "Título", width: "300px" },
  { key: "status", label: "Status", width: "140px" },
  { key: "priority", label: "Prioridade", width: "120px" },
  { key: "type", label: "Tipo", width: "120px" },
  { key: "sprint", label: "Sprint", width: "100px" },
  { key: "assignee", label: "Responsável", width: "140px" },
  { key: "updated_at", label: "Atualizado", width: "160px" },
  { key: "actions", label: "", width: "80px" },
];

export function BacklogTableView({
  tasks,
  sortBy,
  sortOrder,
  onSort,
  onViewOnCanvas,
  onOpenDrawer,
  selectedTaskIds,
  onSelectTask,
  onSelectAll,
}: BacklogTableViewProps) {
  const handleRowClick = (task: Task, e: React.MouseEvent<HTMLTableRowElement>) => {
    const target = e.target as HTMLElement;
    if (
      target instanceof HTMLButtonElement ||
      target instanceof HTMLInputElement ||
      target.closest("button") ||
      target.closest("input")
    ) {
      return;
    }
    onOpenDrawer(task.id);
  };

  const getSortIcon = (field: string) => {
    if (sortBy !== field) return null;
    return sortOrder === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />;
  };

  const handleSortClick = (field: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onSort(field);
  };

  return (
    <div className="flex-1 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead className="bg-muted/50 sticky top-0 z-10">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={{ width: col.width, minWidth: col.width }}
                  className={cn(
                    "px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border",
                    col.key !== "select" && col.key !== "actions" && "cursor-pointer hover:bg-muted/50"
                  )}
                  onClick={(e) => col.key !== "select" && col.key !== "actions" && handleSortClick(col.key, e)}
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    {col.key !== "select" && col.key !== "actions" && getSortIcon(col.key)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-12 text-center text-muted-foreground">
                  Nenhuma tarefa encontrada
                </td>
              </tr>
            ) : (
              tasks.map((task) => (
                <tr
                  key={task.id}
                  onClick={(e) => handleRowClick(task, e)}
                  className={cn(
                    "border-b border-border/50 transition-colors",
                    selectedTaskIds.includes(task.id) && "bg-primary/5"
                  )}
                >
                  {/* Select */}
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selectedTaskIds.includes(task.id)}
                      onChange={(e) => onSelectTask(task.id, e.target.checked)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-ring"
                    />
                  </td>

                  {/* Task Key */}
                  <td className="px-3 py-3 font-mono text-sm font-medium text-muted-foreground">
                    {task.task_key}
                  </td>

                  {/* Title */}
                  <td className="px-3 py-3">
                    <div className="font-medium text-sm truncate max-w-[280px]" title={task.title}>
                      {task.title}
                    </div>
                    {task.acceptance_criteria && task.acceptance_criteria.length > 0 && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {task.acceptance_criteria.filter((c) => c.completed).length}/{task.acceptance_criteria.length} critérios
                      </div>
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-3 py-3">
                    <Badge variant="outline" className={cn("gap-1", statusColors[task.status])}>
                      {statusLabels[task.status]}
                      {task.last_updated_by_type !== "human" && (
                        <span className="flex items-center gap-0.5">
                          <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                          </svg>
                        </span>
                      )}
                    </Badge>
                  </td>

                  {/* Priority */}
                  <td className="px-3 py-3">
                    <Badge variant="outline" className="capitalize">
                      {priorityLabels[task.priority]}
                    </Badge>
                  </td>

                  {/* Type */}
                  <td className="px-3 py-3">
                    <Badge variant="outline" className="capitalize">
                      {typeLabels[task.type]}
                    </Badge>
                  </td>

                  {/* Sprint */}
                  <td className="px-3 py-3 text-sm text-muted-foreground">
                    {task.sprint || "—"}
                  </td>

                  {/* Assignee */}
                  <td className="px-3 py-3">
                    {task.assignee_id ? (
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
                          <span className="text-xs font-medium text-primary">
                            {task.assignee_id.slice(0, 2).toUpperCase()}
                          </span>
                        </div>
                        <span className="text-sm">Usuário</span>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </td>

                  {/* Updated At */}
                  <td className="px-3 py-3 text-sm text-muted-foreground">
                    {new Date(task.updated_at).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>

                  {/* Actions */}
                  <td className="px-3 py-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 p-0">
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                          </svg>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={(e) => { e.stopPropagation(); onOpenDrawer(task.id); }}
                          className="flex items-center gap-2"
                        >
                          <ExternalLink className="h-4 w-4" />
                          Abrir no Canvas
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => { e.stopPropagation(); onOpenDrawer(task.id); }}
                          className="flex items-center gap-2"
                        >
                          <Columns className="h-4 w-4" />
                          Ver Detalhes
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}