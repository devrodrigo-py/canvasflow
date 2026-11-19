"use client";

import * as React from "react";
import { Handle, Position } from "@xyflow/react";
import { Plus, SquarePen, GripVertical, Trash2, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

interface StickyNoteNodeData {
  text: string;
  color: string;
  onUpdate: (id: string, text: string, color?: string) => void;
  onPromote: (id: string, text: string, color: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}

interface StickyNoteNodeProps {
  data: StickyNoteNodeData;
  selected?: boolean;
  id: string;
  position?: { x: number; y: number };
  width?: number;
  height?: number;
  style?: React.CSSProperties;
  className?: string;
  type?: string;
}

const STICKY_COLORS = [
  { value: "#fef9c3", name: "Amarelo" },
  { value: "#dcfce7", name: "Verde" },
  { value: "#bfdbfe", name: "Azul" },
  { value: "#fce7f3", name: "Rosa" },
  { value: "#fed7aa", name: "Laranja" },
  { value: "#e9d5ff", name: "Roxo" },
  { value: "#fecaca", name: "Vermelho" },
  { value: "#f3f4f6", name: "Cinza" },
];

const StickyNoteNodeComponent = React.memo(function StickyNoteNodeComponent(props: StickyNoteNodeProps) {
  const { data, selected, id } = props;
  const { text, color, onUpdate, onPromote, onDelete, onDuplicate } = data;
  const [isEditing, setIsEditing] = React.useState(false);
  const [editText, setEditText] = React.useState(text);
  const [editColor, setEditColor] = React.useState(color);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isEditing]);

  const handleBlur = () => {
    if (isEditing) {
      setIsEditing(false);
      if (editText !== text || editColor !== color) {
        onUpdate(id, editText, editColor);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleBlur();
    } else if (e.key === "Escape") {
      setEditText(text);
      setEditColor(color);
      handleBlur();
    }
  };

  const handlePromote = () => {
    onPromote(id, editText || text, editColor || color);
  };

  const handleDuplicate = () => {
    onDuplicate(id);
  };

  const handleDelete = () => {
    if (window.confirm("Excluir este post-it?")) {
      onDelete(id);
    }
  };

  return (
    <TooltipProvider>
      <div
        className={cn(
          "sticky-note-node relative flex flex-col",
          selected && "ring-2 ring-primary"
        )}
        style={{
          minWidth: 180,
          maxWidth: 280,
          backgroundColor: editColor || color,
          boxShadow: selected
            ? "0 4px 16px rgba(0, 0, 0, 0.15), 0 0 0 2px var(--primary)"
            : "0 2px 8px rgba(0, 0, 0, 0.1)",
        }}
      >
        {/* Drag Handle */}
        <div className="absolute top-1 right-1 flex items-center gap-1 opacity-0 transition-opacity hover:opacity-100 focus-within:opacity-100">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="p-1 rounded hover:bg-black/10 transition-colors"
                aria-label="Mover"
              >
                <GripVertical className="h-4 w-4 text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Arraste para mover</TooltipContent>
          </Tooltip>
        </div>

        {/* Content */}
        <div className="flex-1 p-3">
          {isEditing ? (
            <textarea
              ref={textareaRef}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              className="w-full min-h-[80px] resize-none bg-transparent border-none outline-none text-sm leading-relaxed"
              placeholder="Digite sua nota..."
              autoFocus
            />
          ) : (
            <div
              className="min-h-[80px] text-sm leading-relaxed whitespace-pre-wrap"
              onDoubleClick={() => setIsEditing(true)}
              onClick={() => setIsEditing(true)}
            >
              {text || <span className="text-muted-foreground/60 italic">Clique para editar...</span>}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between p-2 border-t border-black/10">
          <div className="flex items-center gap-1">
            {/* Color Picker */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className="p-1 rounded hover:bg-black/10 transition-colors"
                      aria-label="Cor do post-it"
                      style={{ backgroundColor: editColor || color }}
                    >
                      <div
                        className="h-4 w-4 rounded border border-black/10"
                        style={{ backgroundColor: editColor || color }}
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Cor</TooltipContent>
                </Tooltip>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {STICKY_COLORS.map((c) => (
                  <DropdownMenuItem
                    key={c.value}
                    onClick={() => setEditColor(c.value)}
                    className="flex items-center gap-2"
                  >
                    <div
                      className="h-4 w-4 rounded border border-black/10"
                      style={{ backgroundColor: c.value }}
                    />
                    <span>{c.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Promote to Task */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-primary hover:bg-primary/10"
                  onClick={handlePromote}
                  aria-label="Promover para tarefa"
                >
                  <SquarePen className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Promover para tarefa (P)</TooltipContent>
            </Tooltip>
          </div>

          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleDuplicate} aria-label="Duplicar">
                  <Copy className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Duplicar (D)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={handleDelete} aria-label="Excluir">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Excluir</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Handles */}
        <Handle type="source" position={Position.Right} className="w-2 h-2 bg-primary/60" />
        <Handle type="target" position={Position.Left} className="w-2 h-2 bg-primary/60" />
        <Handle type="source" position={Position.Bottom} className="w-2 h-2 bg-primary/60" />
        <Handle type="target" position={Position.Top} className="w-2 h-2 bg-primary/60" />
      </div>
    </TooltipProvider>
  );
});

StickyNoteNodeComponent.displayName = "StickyNoteNode";

export const StickyNoteNode = StickyNoteNodeComponent as any;