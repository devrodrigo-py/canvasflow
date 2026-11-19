"use client";

import * as React from "react";
import { Sparkles, Loader2, Zap, GitBranch, Boxes, Wand2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CanvasNodeType } from "@/types/domain";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

interface SelectedNode {
  id: string;
  type: CanvasNodeType;
  title?: string;
  content?: string;
}

interface CanvasAICommandBarProps {
  selectedNodes: SelectedNode[];
  onDecomposeEpic: (nodes: SelectedNode[]) => void;
  onClusterNotes: (nodes: SelectedNode[]) => void;
  onPromoteStickyNotes: (nodes: SelectedNode[]) => void;
  onDismiss: () => void;
  isLoading?: boolean;
}

export function CanvasAICommandBar({
  selectedNodes,
  onDecomposeEpic,
  onClusterNotes,
  onPromoteStickyNotes,
  onDismiss,
  isLoading,
}: CanvasAICommandBarProps) {
  const hasTaskOrEpic = selectedNodes.some((n) => n.type === "task_card" || (n.type === "sticky_note" && n.title?.toLowerCase().includes("épico")));
  const hasStickyNotes = selectedNodes.filter((n) => n.type === "sticky_note").length > 0;
  const hasMultipleStickyNotes = selectedNodes.filter((n) => n.type === "sticky_note").length > 1;

  if (selectedNodes.length === 0) return null;

  return (
    <TooltipProvider>
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 animate-in slide-in-from-bottom-4 fade-in">
        <div className="flex items-center gap-2 bg-card/95 backdrop-blur-sm border border-border rounded-xl shadow-xl p-3 min-w-[300px] max-w-[500px]">
          <div className="flex items-center gap-2 text-chart-1">
            <Sparkles className="h-5 w-5" />
            <span className="text-sm font-medium">IA CanvasFlow</span>
            <span className="text-xs text-muted-foreground">({selectedNodes.length} selecionado{selectedNodes.length > 1 ? "s" : ""})</span>
          </div>

          <Button variant="ghost" size="icon" className="ml-auto h-7 w-7" onClick={onDismiss} aria-label="Fechar">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="mt-2 flex items-center gap-2 bg-card/95 backdrop-blur-sm border border-border rounded-xl shadow-xl p-3 min-w-[300px] max-w-[500px]">
          <div className="flex flex-wrap items-center gap-2">
            {/* Decompose Epic */}
            {hasTaskOrEpic && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="default"
                    size="sm"
                    className="gap-1"
                    onClick={() => onDecomposeEpic(selectedNodes)}
                    disabled={isLoading}
                  >
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                    <span>Quebrar em Tarefas</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Quebra épicos/ideias em subtarefas com specs</TooltipContent>
              </Tooltip>
            )}

            {/* Cluster Notes */}
            {hasMultipleStickyNotes && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={() => onClusterNotes(selectedNodes)}
                    disabled={isLoading}
                  >
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Boxes className="h-4 w-4" />}
                    <span>Agrupar em Frames</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Agrupa post-its similares em frames temáticos</TooltipContent>
              </Tooltip>
            )}

            {/* Promote Sticky Notes */}
            {hasStickyNotes && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={() => onPromoteStickyNotes(selectedNodes)}
                    disabled={isLoading}
                  >
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
                    <span>Promover para Tarefas</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Converte post-its selecionados em tarefas oficiais do backlog</TooltipContent>
              </Tooltip>
            )}

            {/* Auto Layout */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => {}}
                  disabled={isLoading}
                >
                  <Wand2 className="h-4 w-4" />
                  <span>Auto-Layout</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Organiza nós automaticamente (Shift+L)</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}