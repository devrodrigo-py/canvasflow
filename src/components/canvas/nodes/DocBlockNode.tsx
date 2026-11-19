"use client";

import * as React from "react";
import { Handle, Position } from "@xyflow/react";
import { FileText, Edit2, Trash2, Copy, Type } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

interface DocBlockNodeData {
  title: string;
  content: string;
  onUpdate: (id: string, title: string, content: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onOpenEditor: (id: string) => void;
}

interface DocBlockNodeProps {
  data: DocBlockNodeData;
  selected?: boolean;
  id: string;
  position?: { x: number; y: number };
  width?: number;
  height?: number;
  style?: React.CSSProperties;
  className?: string;
  type?: string;
}

const DocBlockNodeComponent = React.memo(function DocBlockNodeComponent(props: DocBlockNodeProps) {
  const { data, selected, id } = props;
  const { title, content, onUpdate, onDelete, onDuplicate, onOpenEditor } = data;
  const [isEditing, setIsEditing] = React.useState(false);
  const [editTitle, setEditTitle] = React.useState(title);
  const [editContent, setEditContent] = React.useState(content);
  const titleInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (isEditing && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditing]);

  const handleBlur = () => {
    if (isEditing) {
      setIsEditing(false);
      if (editTitle !== title || editContent !== content) {
        onUpdate(id, editTitle, editContent);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleBlur();
    } else if (e.key === "Escape") {
      setEditTitle(title);
      setEditContent(content);
      handleBlur();
    }
  };

  const handleDuplicate = () => {
    onDuplicate(id);
  };

  const handleDelete = () => {
    if (window.confirm(`Excluir o bloco "${title}"?`)) {
      onDelete(id);
    }
  };

  const handleOpenEditor = () => {
    onOpenEditor(id);
  };

  const previewContent = content.slice(0, 200) + (content.length > 200 ? "..." : "");

  return (
    <TooltipProvider>
      <div
        className={cn(
          "doc-block-node relative flex flex-col",
          selected && "ring-2 ring-primary"
        )}
        style={{ minWidth: 200, maxWidth: 400 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-border">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <FileText className="h-5 w-5 text-muted-foreground flex-shrink-0" />
            {isEditing ? (
              <input
                ref={titleInputRef}
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                className="flex-1 bg-transparent border-none outline-none text-sm font-medium"
                autoFocus
              />
            ) : (
              <h3
                className="font-medium text-sm truncate flex-1"
                onDoubleClick={() => setIsEditing(true)}
              >
                {title}
              </h3>
            )}
          </div>

          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleOpenEditor} aria-label="Abrir editor completo">
                  <Type className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Abrir editor (E)</TooltipContent>
            </Tooltip>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Mais opções">
                      <FileText className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Opções</TooltipContent>
                </Tooltip>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
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

        {/* Content Preview */}
        <div
          className="p-3 flex-1 min-h-[100px]"
          onDoubleClick={() => setIsEditing(true)}
        >
          {isEditing ? (
            <div className="space-y-2">
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                className="w-full bg-transparent border-none outline-none text-sm font-medium"
                autoFocus
              />
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                className="w-full min-h-[80px] resize-none bg-transparent border-none outline-none text-sm"
                placeholder="Conteúdo do bloco..."
              />
            </div>
          ) : (
            <div className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground/80">
              {previewContent || <span className="italic">Clique para editar...</span>}
            </div>
          )}
        </div>

        {/* Handles */}
        <Handle type="source" position={Position.Right} className="w-2 h-2 bg-primary" />
        <Handle type="target" position={Position.Left} className="w-2 h-2 bg-primary" />
        <Handle type="source" position={Position.Bottom} className="w-2 h-2 bg-primary" />
        <Handle type="target" position={Position.Top} className="w-2 h-2 bg-primary" />
      </div>
    </TooltipProvider>
  );
});

DocBlockNodeComponent.displayName = "DocBlockNode";

export const DocBlockNode = DocBlockNodeComponent as any;