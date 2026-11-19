"use client";

import * as React from "react";
import { Handle, Position } from "@xyflow/react";
import { Square, Edit2, Trash2, Copy, Minimize2, Maximize2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

interface FrameNodeData {
  title: string;
  description?: string;
  onUpdate: (id: string, title: string, description?: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  isCollapsed?: boolean;
  onToggleCollapse: (id: string) => void;
}

interface FrameNodeProps {
  data: FrameNodeData;
  selected?: boolean;
  id: string;
  measured?: { width: number; height: number };
  position?: { x: number; y: number };
  width?: number;
  height?: number;
  style?: React.CSSProperties;
  className?: string;
  type?: string;
}

const FrameNodeComponent = React.memo(function FrameNodeComponent(props: FrameNodeProps) {
  const { data, selected, id, measured } = props;
  const { title, description, onUpdate, onDelete, onDuplicate, isCollapsed, onToggleCollapse } = data;
  const [isEditingTitle, setIsEditingTitle] = React.useState(false);
  const [editTitle, setEditTitle] = React.useState(title);
  const [editDescription, setEditDescription] = React.useState(description || "");
  const titleInputRef = React.useRef<HTMLInputElement>(null);

  const width = measured?.width ?? 400;
  const height = measured?.height ?? 300;

  React.useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  const handleTitleBlur = () => {
    if (isEditingTitle) {
      setIsEditingTitle(false);
      if (editTitle !== title || editDescription !== description) {
        onUpdate(id, editTitle, editDescription);
      }
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleTitleBlur();
    } else if (e.key === "Escape") {
      setEditTitle(title);
      setEditDescription(description || "");
      handleTitleBlur();
    }
  };

  const handleDuplicate = () => {
    onDuplicate(id);
  };

  const handleDelete = () => {
    if (window.confirm(`Excluir o frame "${title}" e todo seu conteúdo?`)) {
      onDelete(id);
    }
  };

  const handleToggleCollapse = () => {
    onToggleCollapse(id);
  };

  if (isCollapsed) {
    return (
      <TooltipProvider>
        <div
          className={cn(
            "frame-node relative flex items-center justify-center",
            selected && "ring-2 ring-primary"
          )}
          style={{ width: 200, height: 60 }}
        >
          <div className="flex items-center gap-2 px-3 py-2">
            <Square className="h-5 w-5 text-muted-foreground" />
            <span className="font-medium text-sm truncate max-w-[150px]">{title}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleToggleCollapse} aria-label="Expandir frame">
                  <Maximize2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Expandir</TooltipContent>
            </Tooltip>
          </div>
          <Handle type="target" position={Position.Left} className="w-2 h-2 bg-primary/60" />
          <Handle type="target" position={Position.Right} className="w-2 h-2 bg-primary/60" />
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <div
        className={cn(
          "frame-node relative flex flex-col",
          selected && "ring-2 ring-primary"
        )}
        style={{ width, height }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-2 border-b border-dashed border-border/50">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Square className="h-5 w-5 text-muted-foreground flex-shrink-0" />
            {isEditingTitle ? (
              <input
                ref={titleInputRef}
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={handleTitleBlur}
                onKeyDown={handleTitleKeyDown}
                className="flex-1 bg-transparent border-none outline-none text-sm font-medium"
                autoFocus
              />
            ) : (
              <h3
                className="font-medium text-sm truncate flex-1"
                onDoubleClick={() => setIsEditingTitle(true)}
              >
                {title}
              </h3>
            )}
          </div>

          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleToggleCollapse} aria-label="Colapsar frame">
                  <Minimize2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Colapsar</TooltipContent>
            </Tooltip>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Mais opções">
                      <Square className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Opções</TooltipContent>
                </Tooltip>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => setIsEditingTitle(true)}
                  className="flex items-center gap-2"
                >
                  <Edit2 className="h-4 w-4" />
                  Renomear
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDuplicate} className="flex items-center gap-2">
                  <Copy className="h-4 w-4" />
                  Duplicar
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDelete} className="flex items-center gap-2 text-destructive">
                  <Trash2 className="h-4 w-4" />
                  Excluir
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Description */}
        {description && (
          <div className="px-3 py-2 text-xs text-muted-foreground border-b border-dashed border-border/50">
            {description}
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 p-3 relative" style={{ minHeight: 100 }}>
          <div className="absolute inset-0 border-2 border-dashed border-border/30 rounded-lg pointer-events-none" />
          <div className="absolute bottom-2 right-2 flex items-center gap-1 px-2 py-1 bg-card/90 backdrop-blur rounded-full text-xs text-muted-foreground">
            <Plus className="h-3 w-3" />
            Solte cards aqui
          </div>
        </div>

        {/* Handles */}
        <Handle type="target" position={Position.Left} className="w-2 h-2 bg-primary/60" />
        <Handle type="target" position={Position.Right} className="w-2 h-2 bg-primary/60" />
        <Handle type="target" position={Position.Top} className="w-2 h-2 bg-primary/60" />
        <Handle type="target" position={Position.Bottom} className="w-2 h-2 bg-primary/60" />
      </div>
    </TooltipProvider>
  );
});

FrameNodeComponent.displayName = "FrameNode";

export const FrameNode = FrameNodeComponent as any;