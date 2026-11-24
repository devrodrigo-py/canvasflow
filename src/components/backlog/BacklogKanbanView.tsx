"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { Task, TaskStatus } from "@/types/domain";
import { Plus, GripVertical, ExternalLink, Columns, MoreHorizontal } from "lucide-react";
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult,
} from "@hello-pangea/dnd";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

interface BacklogKanbanViewProps {
  tasks: Task[];
  onDragEnd: (result: DropResult) => void;
  onViewOnCanvas: (task: Task) => void;
  onOpenDrawer: (taskId: string) => void;
  onAddTask: (status: TaskStatus) => void;
}

const statusOrder: TaskStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "done",
];

const statusLabels: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "A fazer",
  in_progress: "Em progresso",
  in_review: "Em revisão",
  blocked: "Bloqueado",
  done: "Concluído",
};

const statusColors: Record<TaskStatus, string> = {
  backlog: "bg-muted/50 border-muted",
  todo: "bg-blue-500/10 border-blue-500/20",
  in_progress: "bg-yellow-500/10 border-yellow-500/20",
  in_review: "bg-purple-500/10 border-purple-500/20",
  blocked: "bg-red-500/10 border-red-500/20",
  done: "bg-green-500/10 border-green-500/20",
};

const statusHeaderColors: Record<TaskStatus, string> = {
  backlog: "bg-muted",
  todo: "bg-blue-500",
  in_progress: "bg-yellow-500",
  in_review: "bg-purple-500",
  blocked: "bg-red-500",
  done: "bg-green-500",
};

const priorityLabels: Record<string, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  urgent: "Urgente",
};

const typeLabels: Record<string, string> = {
  epic: "Épico",
  feature: "Feature",
  task: "Tarefa",
  bug: "Bug",
  tech_debt: "Dívida Técnica",
};

interface KanbanColumnProps {
  status: TaskStatus;
  tasks: Task[];
  onDragEnd: (result: DropResult) => void;
  onViewOnCanvas: (task: Task) => void;
  onOpenDrawer: (taskId: string) => void;
  onAddTask: (status: TaskStatus) => void;
}

function KanbanColumn({
  status,
  tasks,
  onViewOnCanvas,
  onOpenDrawer,
  onAddTask,
}: KanbanColumnProps) {
  return (
    <Droppable droppableId={status}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.droppableProps}
          className={cn(
            "flex flex-col min-h-[500px] max-w-[320px] w-[320px] rounded-xl border-2 transition-colors",
            statusColors[status],
            snapshot.isDraggingOver && "ring-2 ring-primary"
          )}
        >
          {/* Column Header */}
          <div
            className={cn(
              "px-4 py-3 rounded-t-xl font-semibold text-white flex items-center justify-between",
              statusHeaderColors[status]
            )}
          >
            <div className="flex items-center gap-2">
              <span>{statusLabels[status]}</span>
              <Badge variant="secondary" className="text-xs">
                {tasks.length}
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-white hover:bg-white/20"
              onClick={() => onAddTask(status)}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {/* Tasks List */}
          <div
            className="flex-1 overflow-y-auto p-3 space-y-3"
            {...provided.droppableProps}
            ref={provided.innerRef}
          >
            {tasks.map((task, index) => (
              <Draggable key={task.id} draggableId={task.id} index={index}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                    className={cn(
                      "bg-card border border-border rounded-lg p-3 shadow-sm transition-all",
                      snapshot.isDragging && "shadow-lg ring-2 ring-primary"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span className="font-mono text-xs font-medium text-muted-foreground flex-1 truncate">
                        {task.task_key}
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={(e) => { e.stopPropagation(); onOpenDrawer(task.id); }}
                            className="flex items-center gap-2"
                          >
                            <Columns className="h-4 w-4" />
                            Ver Detalhes
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => { e.stopPropagation(); onViewOnCanvas(task); }}
                            className="flex items-center gap-2"
                          >
                            <ExternalLink className="h-4 w-4" />
                            Abrir no Canvas
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <h4 className="font-medium text-sm mb-1 truncate" title={task.title}>
                      {task.title}
                    </h4>

                    <div className="flex flex-wrap items-center gap-1.5 mb-2">
                      <Badge variant="outline" className="text-xs capitalize">
                        {typeLabels[task.type] || task.type}
                      </Badge>
                      <Badge variant="outline" className="text-xs capitalize">
                        {priorityLabels[task.priority] || task.priority}
                      </Badge>
                    </div>

                    {task.acceptance_criteria && task.acceptance_criteria.length > 0 && (
                      <div className="text-xs text-muted-foreground mb-2">
                        {task.acceptance_criteria.filter((c) => c.completed).length}/{task.acceptance_criteria.length} critérios
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-2 border-t border-border/50">
                      {task.assignee_id && (
                        <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
                          <span className="text-xs font-medium text-primary">
                            {task.assignee_id.slice(0, 2).toUpperCase()}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-1">
                        {task.last_updated_by_type !== "human" && (
                          <span className="flex items-center gap-0.5 text-xs text-chart-1">
                            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                            </svg>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Drag handle */}
                    <div
                      {...provided.dragHandleProps}
                      className="absolute top-2 right-2 opacity-0 hover:opacity-100 transition-colors cursor-grab"
                      aria-label="Arrastrar tarefa"
                    >
                      <GripVertical className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>

          {/* Add Task Button */}
          <Button
            variant="outline"
            size="sm"
            className="mx-3 mb-3 w-full gap-1"
            onClick={() => onAddTask(status)}
          >
            <Plus className="h-4 w-4" />
            Adicionar tarefa
          </Button>
        </div>
      )}
    </Droppable>
  );
}

export function BacklogKanbanView({
  tasks,
  onDragEnd,
  onViewOnCanvas,
  onOpenDrawer,
  onAddTask,
}: BacklogKanbanViewProps) {
  const tasksByStatus = React.useMemo(() => {
    const grouped: Record<TaskStatus, Task[]> = {
      backlog: [],
      todo: [],
      in_progress: [],
      in_review: [],
      blocked: [],
      done: [],
    };
    tasks.forEach((task) => {
      grouped[task.status].push(task);
    });
    return grouped;
  }, [tasks]);

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex-1 overflow-auto p-4">
        <div className="flex gap-4 min-w-max h-full items-start">
          {statusOrder.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              tasks={tasksByStatus[status]}
              onViewOnCanvas={onViewOnCanvas}
              onOpenDrawer={onOpenDrawer}
              onAddTask={onAddTask}
              onDragEnd={onDragEnd}
            />
          ))}
        </div>
      </div>
    </DragDropContext>
  );
}