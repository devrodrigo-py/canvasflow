"use client";

import * as React from "react";
import { Handle, Position } from "@xyflow/react";
import { CheckSquare, AlertCircle, Clock, Zap, Bug, Package, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Task, TaskStatus, TaskPriority, TaskType } from "@/types/domain";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

interface TaskCardNodeData {
  task: Task;
  onOpenDrawer: (taskId: string) => void;
  needsAutoLayout?: boolean;
}

// Custom props type for the component (not using NodeProps to avoid constraint issues)
interface TaskCardNodeProps {
  data: TaskCardNodeData;
  selected?: boolean;
  id: string;
  // React Flow provides these automatically
  position?: { x: number; y: number };
  width?: number;
  height?: number;
  style?: React.CSSProperties;
  className?: string;
  type?: string;
}

const statusColors: Record<TaskStatus, string> = {
  backlog: "bg-muted-foreground/20",
  todo: "bg-blue-500",
  in_progress: "bg-yellow-500",
  in_review: "bg-purple-500",
  blocked: "bg-red-500",
  done: "bg-green-500",
};

const statusLabels: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "A fazer",
  in_progress: "Em progresso",
  in_review: "Em revisão",
  blocked: "Bloqueado",
  done: "Concluído",
};

const priorityIcons: Record<TaskPriority, React.ReactNode> = {
  low: <Clock className="h-3 w-3" />,
  medium: <CheckSquare className="h-3 w-3" />,
  high: <AlertCircle className="h-3 w-3" />,
  urgent: <Zap className="h-3 w-3" />,
};

const typeIcons: Record<TaskType, React.ReactNode> = {
  epic: <Package className="h-3 w-3" />,
  feature: <CheckSquare className="h-3 w-3" />,
  task: <CheckSquare className="h-3 w-3" />,
  bug: <Bug className="h-3 w-3" />,
  tech_debt: <Zap className="h-3 w-3" />,
};

const typeLabels: Record<TaskType, string> = {
  epic: "Épico",
  feature: "Feature",
  task: "Tarefa",
  bug: "Bug",
  tech_debt: "Dívida Técnica",
};

function getAcceptanceProgress(criteria: Task["acceptance_criteria"]): { completed: number; total: number } {
  if (!criteria || criteria.length === 0) return { completed: 0, total: 0 };
  const completed = criteria.filter((c) => c.completed).length;
  return { completed, total: criteria.length };
}

const TaskCardNodeComponent = React.memo(function TaskCardNodeComponent(props: TaskCardNodeProps) {
  const { data, selected } = props;
  const { task, onOpenDrawer } = data;
  const { completed, total } = getAcceptanceProgress(task.acceptance_criteria);
  const isAIUpdated = task.last_updated_by_type !== "human";

  const handleDoubleClick = () => {
    onOpenDrawer(task.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpenDrawer(task.id);
    }
  };

  return (
    <div
      className={cn(
        "task-card-node relative flex flex-col",
        selected && "selected",
        isAIUpdated && "ring-2 ring-chart-1/50"
      )}
      style={{
        minWidth: 240,
        maxWidth: 320,
        borderLeft: `4px solid ${statusColors[task.status]}`,
      }}
      tabIndex={0}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      role="button"
      aria-label={`Tarefa ${task.task_key}: ${task.title}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between p-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="font-mono text-xs font-medium text-muted-foreground">{task.task_key}</span>
          <span
            className={cn(
              "px-1.5 py-0.5 text-xs font-medium rounded",
              statusColors[task.status].replace("bg-", "bg-").replace("/20", "/20 text-")
            )}
          >
            {statusLabels[task.status]}
          </span>
        </div>
        {isAIUpdated && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="ai-badge flex items-center gap-1">
                <Sparkles className="h-3 w-3" />
                {task.last_updated_by_label || "IA"}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              Atualizado por {task.last_updated_by_label || "agente externo"}
              {task.agent_execution_log && task.agent_execution_log.length > 0 && (
                <>
                  <br />
                  Último: {task.agent_execution_log[task.agent_execution_log.length - 1].summary}
                </>
              )}
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Title */}
      <div className="px-3 pb-2">
        <h3 className="font-medium text-sm leading-tight truncate">{task.title}</h3>
      </div>

      {/* Meta */}
      <div className="flex items-center gap-3 px-3 pb-2 text-xs text-muted-foreground">
        {typeIcons[task.type]}
        <span>{typeLabels[task.type]}</span>
        {priorityIcons[task.priority]}
        <span className="capitalize">{task.priority}</span>
        {task.sprint && (
          <>
            <span className="px-1.5 py-0.5 bg-primary/10 text-primary rounded text-xs">
              {task.sprint}
            </span>
          </>
        )}
      </div>

      {/* Acceptance Criteria Progress */}
      {total > 0 && (
        <div className="px-3 pb-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>Critérios de aceite</span>
            <span className="font-medium">{completed}/{total}</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${(completed / total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Assignee */}
      {task.assignee_id && (
        <div className="px-3 pb-2 border-t border-border">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center">
              <span className="text-xs font-medium text-primary">
                {task.assignee_id.slice(0, 2).toUpperCase()}
              </span>
            </div>
            <span>Responsável</span>
          </div>
        </div>
      )}

      {/* Handles */}
      <Handle type="source" position={Position.Right} className="w-2 h-2 bg-primary" />
      <Handle type="target" position={Position.Left} className="w-2 h-2 bg-primary" />
      <Handle type="source" position={Position.Bottom} className="w-2 h-2 bg-primary" />
      <Handle type="target" position={Position.Top} className="w-2 h-2 bg-primary" />
    </div>
  );
});

TaskCardNodeComponent.displayName = "TaskCardNode";

export const TaskCardNode = TaskCardNodeComponent as any;