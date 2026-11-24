"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";


import {
  X,
  Maximize2,
  Minimize2,
  Save,
  Loader2,
  AlertCircle,
  CheckCircle,
  Clock,
  Zap,
  Bug,
  Package,
  Sparkles,
  MessageSquare,
  LayoutDashboard,
  FileText,
} from "lucide-react";
import { TaskSpecEditor } from "./TaskSpecEditor";
import { AgentExecutionLog } from "./AgentExecutionLog";
import { TaskComments } from "./TaskComments";
import { TaskActivityFeed } from "./TaskActivityFeed";
import {
  Task,
  TaskStatus,
  TaskPriority,
  TaskType,
  AcceptanceCriterion,
  Comment,
  ActivityLog,
} from "@/types/domain";

interface TaskDrawerProps {
  task: Task | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdateTask: (taskId: string, updates: Partial<Task>) => Promise<void>;
  onAddComment: (taskId: string, body: string) => Promise<void>;
  onUpdateComment: (commentId: string, body: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
  onResolveComment: (commentId: string, resolved: boolean) => Promise<void>;
  onApproveAndComplete: (taskId: string) => Promise<void>;
  onGenerateSpec: (taskId: string) => Promise<void>;
  currentUserId: string;
  comments: Comment[];
  activities: ActivityLog[];
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  /** Leitores (viewer) não editam. */
  readOnly?: boolean;
  isGeneratingSpec?: boolean;
}

const statusOptions: { value: TaskStatus; label: string }[] = [
  { value: "backlog", label: "Backlog" },
  { value: "todo", label: "A fazer" },
  { value: "in_progress", label: "Em progresso" },
  { value: "in_review", label: "Em revisão" },
  { value: "blocked", label: "Bloqueado" },
  { value: "done", label: "Concluído" },
];

const priorityOptions: { value: TaskPriority; label: string }[] = [
  { value: "low", label: "Baixa" },
  { value: "medium", label: "Média" },
  { value: "high", label: "Alta" },
  { value: "urgent", label: "Urgente" },
];

const typeOptions: { value: TaskType; label: string }[] = [
  { value: "epic", label: "Épico" },
  { value: "feature", label: "Feature" },
  { value: "task", label: "Tarefa" },
  { value: "bug", label: "Bug" },
  { value: "tech_debt", label: "Dívida Técnica" },
];

const priorityIcons = {
  low: Clock,
  medium: CheckCircle,
  high: AlertCircle,
  urgent: Zap,
};

const typeIcons = {
  epic: Package,
  feature: CheckCircle,
  task: CheckCircle,
  bug: Bug,
  tech_debt: Zap,
};

export function TaskDrawer({
  task,
  isOpen,
  onClose,
  onUpdateTask,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
  onResolveComment,
  onApproveAndComplete,
  onGenerateSpec,
  currentUserId,
  comments,
  activities,
  isFullscreen,
  onToggleFullscreen,
  readOnly = false,
  isGeneratingSpec = false,
}: TaskDrawerProps) {
  const [isSaving, setIsSaving] = React.useState(false);
  const [localTitle, setLocalTitle] = React.useState("");
  const [localSprint, setLocalSprint] = React.useState("");
  const [localEstimate, setLocalEstimate] = React.useState("");

  React.useEffect(() => {
    if (task) {
      setLocalTitle(task.title);
      setLocalSprint(task.sprint || "");
      setLocalEstimate(task.estimate_points?.toString() || "");
    }
  }, [task]);

  const handleSave = async () => {
    if (!task || isSaving) return;

    setIsSaving(true);
    try {
      await onUpdateTask(task.id, {
        title: localTitle,
        sprint: localSprint || null,
        estimate_points: localEstimate ? parseInt(localEstimate) : null,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleStatusChange = async (status: TaskStatus) => {
    if (!task) return;
    await onUpdateTask(task.id, { status });
  };

  const handlePriorityChange = async (priority: TaskPriority) => {
    if (!task) return;
    await onUpdateTask(task.id, { priority });
  };

  const handleTypeChange = async (type: TaskType) => {
    if (!task) return;
    await onUpdateTask(task.id, { type });
  };

  const handleGenerateSpec = async () => {
    if (!task) return;
    await onGenerateSpec(task.id);
  };

  if (!task || !isOpen) return null;

  const PriorityIcon = priorityIcons[task.priority];
  const TypeIcon = typeIcons[task.type];
  const isInReview = task.status === "in_review";
  const isDone = task.status === "done";

  const drawerWidth = isFullscreen ? "100vw" : "720px";
  const drawerHeight = isFullscreen ? "100vh" : "100vh";

  return (
    <div
      className={cn(
        "fixed right-0 top-0 z-50 flex flex-col bg-card border-l border-border shadow-xl transition-transform duration-300",
        isFullscreen ? "w-full h-full" : "w-[720px] h-full"
      )}
      style={{ width: drawerWidth, height: drawerHeight }}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Button variant="ghost" size="icon" onClick={onClose} className="h-9 w-9">
            {isFullscreen ? <Minimize2 className="h-5 w-5" /> : <X className="h-5 w-5" />}
          </Button>

          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="font-mono text-sm font-medium text-muted-foreground">{task.task_key}</span>
            <Badge variant="outline" className="text-xs">
              {typeOptions.find((t) => t.value === task.type)?.label}
            </Badge>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleFullscreen}
            className="h-9 w-9"
            aria-label={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
          >
            {isFullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-9 w-9">
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Title & Quick Fields */}
        <div className="p-4 border-b border-border flex-shrink-0">
          <div className="flex items-start gap-3 mb-4">
            <div className="flex-1 min-w-0">
              <input
                type="text"
                value={localTitle}
                onChange={(e) => setLocalTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
                className="w-full text-xl font-semibold bg-transparent border-none focus:outline-none focus:ring-2 focus:ring-ring rounded px-2 py-1"
                placeholder="Título da tarefa"
              />
            </div>
            <Button variant="outline" size="sm" onClick={handleSave} disabled={isSaving} className="gap-1 self-start">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-sm">
            {/* Status */}
            <div className="flex items-center gap-2">
              <Select value={task.status} onValueChange={handleStatusChange}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Priority */}
            <div className="flex items-center gap-2">
              <PriorityIcon className="h-4 w-4 text-muted-foreground" />
              <Select value={task.priority} onValueChange={handlePriorityChange}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="Prioridade" />
                </SelectTrigger>
                <SelectContent>
                  {priorityOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Type */}
            <div className="flex items-center gap-2">
              <TypeIcon className="h-4 w-4 text-muted-foreground" />
              <Select value={task.type} onValueChange={handleTypeChange}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent>
                  {typeOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Sprint */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={localSprint}
                onChange={(e) => setLocalSprint(e.target.value)}
                onBlur={handleSave}
                placeholder="Sprint"
                className="w-32 px-2 py-1 text-sm border border-input bg-background rounded focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Estimate */}
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={localEstimate}
                onChange={(e) => setLocalEstimate(e.target.value)}
                onBlur={handleSave}
                placeholder="Pts"
                className="w-20 px-2 py-1 text-sm border border-input bg-background rounded focus:outline-none focus:ring-2 focus:ring-ring"
                min="0"
              />
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="spec" className="flex-1 flex flex-col">
          <TabsList className="border-b border-border px-4">
            <TabsTrigger value="spec" className="gap-1">
              <FileText className="h-4 w-4" />
              Especificação
            </TabsTrigger>
            <TabsTrigger value="agents" className="gap-1">
              <Sparkles className="h-4 w-4" />
              Execução de Agentes
              {task.agent_execution_log && task.agent_execution_log.length > 0 && (
                <span className="bg-chart-1/10 text-chart-1 text-xs px-1.5 py-0.5 rounded-full">
                  {task.agent_execution_log.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="comments" className="gap-1">
              <MessageSquare className="h-4 w-4" />
              Discussão
              {comments.length > 0 && (
                <span className="bg-primary/10 text-primary text-xs px-1.5 py-0.5 rounded-full">
                  {comments.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="activity" className="gap-1">
              <LayoutDashboard className="h-4 w-4" />
              Histórico
              {activities.length > 0 && (
                <span className="bg-muted-foreground/10 text-muted-foreground text-xs px-1.5 py-0.5 rounded-full">
                  {activities.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-hidden">
            {/* Spec Tab */}
            <TabsContent value="spec" className="h-full flex flex-col">
              <TaskSpecEditor
                key={task.id}
                specJson={task.spec_json}
                specMarkdown={task.spec_markdown}
                onChange={async (change) => {
                  await onUpdateTask(task.id, {
                    spec_json: change.spec_json as unknown as Task["spec_json"],
                    spec_markdown: change.spec_markdown,
                  });
                }}
                editable={!readOnly}
                placeholder="Escreva a especificação técnica da tarefa..."
              />
              <div className="p-4 border-t border-border flex-shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleGenerateSpec}
                      className="gap-1"
                      disabled={isSaving || readOnly || isGeneratingSpec}
                    >
                      <Sparkles className={cn("h-4 w-4", isGeneratingSpec && "animate-pulse")} />
                      {isGeneratingSpec ? "Gerando spec..." : "Gerar/Refinar com IA"}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Critérios: {task.acceptance_criteria?.filter((c: AcceptanceCriterion) => c.completed).length || 0}/{task.acceptance_criteria?.length || 0}
                    </span>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Agents Tab */}
            <TabsContent value="agents" className="h-full">
              <AgentExecutionLog
                logs={task.agent_execution_log || []}
                onApproveAndComplete={onApproveAndComplete}
                taskId={task.id}
                taskStatus={task.status}
              />
              {isInReview && (
                <div className="p-4 border-t border-border bg-destructive/5">
                  <div className="flex items-center gap-3">
                    <AlertCircle className="h-5 w-5 text-destructive" />
                    <div>
                      <p className="font-medium">Aguardando aprovação humana</p>
                      <p className="text-sm text-muted-foreground">
                        Um agente externo moveu esta tarefa para "Em revisão". Revise as alterações e aprove para concluir.
                      </p>
                    </div>
                    <Button
                      variant="destructive"
                      onClick={() => onApproveAndComplete(task.id)}
                      className="ml-auto gap-1"
                      disabled={readOnly}
                    >
                      <CheckCircle className="h-4 w-4" />
                      Aprovar e Concluir
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>

            {/* Comments Tab */}
            <TabsContent value="comments" className="h-full">
              <TaskComments
                comments={comments}
                onAddComment={onAddComment}
                onUpdateComment={onUpdateComment}
                onDeleteComment={onDeleteComment}
                onResolveComment={onResolveComment}
                currentUserId={currentUserId}
                taskId={task.id}
              />
            </TabsContent>

            {/* Activity Tab */}
            <TabsContent value="activity" className="h-full">
              <TaskActivityFeed
                activities={activities}
                currentUserId={currentUserId}
              />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}

import { Badge } from "@/components/ui/badge";