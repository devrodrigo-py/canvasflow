"use client";

import * as React from "react";
import {
  Plus,
  StickyNote,
  Square,
  FileText,
  Wand2,
  LayoutDashboard,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  LayoutGrid,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";

interface CanvasToolbarProps {
  onAddStickyNote: () => void;
  onAddTask: () => void;
  onAddFrame: () => void;
  onAddDocBlock: () => void;
  onAutoLayout: () => void;
  onAIDiagnostic: () => void;
  onFitView: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetViewport: () => void;
  zoom: number;
  isAutoLayoutRunning?: boolean;
}

export function CanvasToolbar({
  onAddStickyNote,
  onAddTask,
  onAddFrame,
  onAddDocBlock,
  onAutoLayout,
  onAIDiagnostic,
  onFitView,
  onZoomIn,
  onZoomOut,
  onResetViewport,
  zoom,
  isAutoLayoutRunning,
}: CanvasToolbarProps) {
  return (
    <TooltipProvider>
      <div className="fixed top-4 left-4 z-40 flex items-center gap-1 rounded-lg bg-card/95 backdrop-blur-sm border border-border shadow-lg p-2">
        {/* Add Nodes Dropdown */}
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Adicionar elemento">
                  <Plus className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuItem onClick={onAddStickyNote}>
                  <StickyNote className="mr-2 h-4 w-4" />
                  Post-it (N)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onAddTask}>
                  <Square className="mr-2 h-4 w-4" />
                  Tarefa (T)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onAddFrame}>
                  <Square className="mr-2 h-4 w-4" />
                  Frame (F)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onAddDocBlock}>
                  <FileText className="mr-2 h-4 w-4" />
                  Bloco de Doc (D)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </TooltipTrigger>
          <TooltipContent>Adicionar elemento (A)</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* AI Actions */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 text-chart-1 hover:text-chart-1 hover:bg-chart-1/10"
              onClick={onAutoLayout}
              disabled={isAutoLayoutRunning}
              aria-label="Organizar com Auto-Layout"
            >
              <Wand2 className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Auto-Layout (Shift+L)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 text-chart-1 hover:text-chart-1 hover:bg-chart-1/10"
              onClick={onAIDiagnostic}
              aria-label="Diagnóstico IA"
            >
              <LayoutGrid className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Diagnóstico IA</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* View Controls */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon" className="h-9 w-9" onClick={onZoomIn} aria-label="Zoom in">
              <ZoomIn className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom in (+)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon" className="h-9 w-9" onClick={onZoomOut} aria-label="Zoom out">
              <ZoomOut className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom out (-)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon" className="h-9 w-9" onClick={onFitView} aria-label="Ajustar visão">
              <LayoutDashboard className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Ajustar visão (Shift+1)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon" className="h-9 w-9" onClick={onResetViewport} aria-label="Resetar viewport">
              <RotateCcw className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Resetar viewport (R)</TooltipContent>
        </Tooltip>

        {/* Zoom Display */}
        <div className="hidden sm:flex items-center px-2 text-xs text-muted-foreground font-mono">
          {Math.round(zoom * 100)}%
        </div>
      </div>
    </TooltipProvider>
  );
}