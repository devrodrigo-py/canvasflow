"use client";

import * as React from "react";
import {
  ReactFlow,
  Node,
  Edge,
  Connection,
  OnNodesChange,
  OnEdgesChange,
  OnConnect,
  addEdge,
  Viewport,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  NodeTypes,
  EdgeTypes,
  applyNodeChanges,
  applyEdgeChanges,
  ConnectionLineType,
  ConnectionMode,
  PanOnScrollMode,
  BackgroundVariant,
  SelectionMode,
} from "@xyflow/react";
import { cn } from "@/lib/utils";
import { CanvasToolbar } from "./CanvasToolbar";
import { LiveCursors } from "./LiveCursors";
import { FollowModeBar } from "./FollowModeBar";
import { CanvasAICommandBar } from "@/components/ai/CanvasAICommandBar";
import { TaskCardNode } from "./nodes/TaskCardNode";
import { StickyNoteNode } from "./nodes/StickyNoteNode";
import { FrameNode } from "./nodes/FrameNode";
import { DocBlockNode } from "./nodes/DocBlockNode";
import { DependencyEdge } from "./edges/DependencyEdge";
import { CanvasNode, CanvasEdge, CanvasNodeType, CanvasEdgeType } from "@/types/domain";
import { ZoomIn, ZoomOut, LayoutDashboard, RotateCcw, HelpCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { useState } from "react";

interface HybridCanvasProps {
  canvasId: string;
  projectId: string;
  initialNodes: CanvasNode[];
  initialEdges: CanvasEdge[];
  initialViewport?: Viewport;
  onNodesChange: (nodes: CanvasNode[]) => void;
  onEdgesChange: (edges: CanvasEdge[]) => void;
  onViewportChange: (viewport: Viewport) => void;
  onAddStickyNote: (position: { x: number; y: number }) => void;
  onAddTask: (position: { x: number; y: number }) => void;
  onAddFrame: (position: { x: number; y: number }) => void;
  onAddDocBlock: (position: { x: number; y: number }) => void;
  onPromoteStickyNote: (nodeId: string, text: string, color: string) => void;
  onUpdateStickyNote: (nodeId: string, text: string, color?: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onDuplicateNode: (nodeId: string) => void;
  onUpdateFrame: (nodeId: string, title: string, description?: string) => void;
  onDeleteFrame: (nodeId: string) => void;
  onDuplicateFrame: (nodeId: string) => void;
  onToggleFrameCollapse: (nodeId: string) => void;
  onUpdateDocBlock: (nodeId: string, title: string, content: string) => void;
  onDeleteDocBlock: (nodeId: string) => void;
  onDuplicateDocBlock: (nodeId: string) => void;
  onOpenDocBlockEditor: (nodeId: string) => void;
  onOpenTaskDrawer: (taskId: string) => void;
  onAutoLayout: () => Promise<void>;
  onAIDiagnostic: () => Promise<void>;
  onDecomposeEpic: (nodes: Array<{ id: string; type: CanvasNodeType; title?: string; content?: string }>) => void;
  onClusterNotes: (nodes: Array<{ id: string; type: CanvasNodeType; title?: string; content?: string }>) => void;
  onPromoteStickyNotes: (nodes: Array<{ id: string; type: CanvasNodeType; title?: string; content?: string }>) => void;
  presenceUsers: Array<{ id: string; name: string; avatar?: string; color: string; cursor?: { x: number; y: number } }>;
  currentUserId: string;
  followedUserId: string | null;
  onFollowUser: (userId: string | null) => void;
  isAutoLayoutRunning?: boolean;
  tasks: Record<string, any>; // Task data for TaskCardNode
}

const nodeTypes: NodeTypes = {
  task_card: TaskCardNode as any,
  sticky_note: StickyNoteNode as any,
  frame: FrameNode as any,
  doc_block: DocBlockNode as any,
};

const edgeTypes: EdgeTypes = {
  dependency: DependencyEdge as any,
};

// Cores estáticas: vars CSS em hsl() quebram o fill SVG do minimap
const NODE_TYPE_COLORS: Record<CanvasNodeType, string> = {
  task_card: "#3b82f6",
  sticky_note: "#fef9c3",
  frame: "#64748b",
  doc_block: "#22d3ee",
};

interface NodeCallbacks {
  onPromoteStickyNote: (nodeId: string, text: string, color: string) => void;
  onUpdateStickyNote: (nodeId: string, text: string, color?: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onDuplicateNode: (nodeId: string) => void;
  onUpdateFrame: (nodeId: string, title: string, description?: string) => void;
  onDeleteFrame: (nodeId: string) => void;
  onDuplicateFrame: (nodeId: string) => void;
  onToggleFrameCollapse: (nodeId: string) => void;
  onUpdateDocBlock: (nodeId: string, title: string, content: string) => void;
  onDeleteDocBlock: (nodeId: string) => void;
  onDuplicateDocBlock: (nodeId: string) => void;
  onOpenDocBlockEditor: (nodeId: string) => void;
}

function canvasNodeToReactFlowNode(canvasNode: CanvasNode, tasks: Record<string, any>, callbacks?: NodeCallbacks): Node {
  const baseNode: Node = {
    id: canvasNode.id,
    type: canvasNode.node_type,
    position: { x: canvasNode.position_x, y: canvasNode.position_y },
    width: canvasNode.width ?? undefined,
    height: canvasNode.height ?? undefined,
    zIndex: canvasNode.z_index,
    selected: false,
    draggable: canvasNode.node_type !== "frame", // Frames are not draggable by default
    data: {
      ...canvasNode.data,
      needsAutoLayout: canvasNode.needs_auto_layout,
    },
  };

  // Injeta os callbacks de ação esperados por cada tipo de nó
  if (callbacks) {
    switch (canvasNode.node_type) {
      case "sticky_note":
        (baseNode.data as any).onPromote = callbacks.onPromoteStickyNote;
        (baseNode.data as any).onUpdate = callbacks.onUpdateStickyNote;
        (baseNode.data as any).onDelete = callbacks.onDeleteNode;
        (baseNode.data as any).onDuplicate = callbacks.onDuplicateNode;
        break;
      case "frame":
        (baseNode.data as any).onUpdate = callbacks.onUpdateFrame;
        (baseNode.data as any).onDelete = callbacks.onDeleteFrame;
        (baseNode.data as any).onDuplicate = callbacks.onDuplicateFrame;
        (baseNode.data as any).onToggleCollapse = callbacks.onToggleFrameCollapse;
        break;
      case "doc_block":
        (baseNode.data as any).onUpdate = callbacks.onUpdateDocBlock;
        (baseNode.data as any).onDelete = callbacks.onDeleteDocBlock;
        (baseNode.data as any).onDuplicate = callbacks.onDuplicateDocBlock;
        (baseNode.data as any).onOpenEditor = callbacks.onOpenDocBlockEditor;
        break;
    }
  }

  // Add task data for task_card nodes
  if (canvasNode.node_type === "task_card" && canvasNode.task_id && tasks[canvasNode.task_id]) {
    (baseNode.data as any).task = tasks[canvasNode.task_id];
  }

  return baseNode;
}

function canvasEdgeToReactFlowEdge(canvasEdge: CanvasEdge): Edge {
  return {
    id: canvasEdge.id,
    source: canvasEdge.source_node_id,
    target: canvasEdge.target_node_id,
    type: "dependency",
    data: {
      edgeType: canvasEdge.edge_type,
      label: canvasEdge.label,
    },
    markerEnd: { type: "arrowclosed" as const },
    style: { strokeWidth: 2 },
  };
}

export function HybridCanvas({
  canvasId,
  projectId,
  initialNodes,
  initialEdges,
  initialViewport,
  onNodesChange,
  onEdgesChange,
  onViewportChange,
  onAddStickyNote,
  onAddTask,
  onAddFrame,
  onAddDocBlock,
  onPromoteStickyNote,
  onUpdateStickyNote,
  onDeleteNode,
  onDuplicateNode,
  onUpdateFrame,
  onDeleteFrame,
  onDuplicateFrame,
  onToggleFrameCollapse,
  onUpdateDocBlock,
  onDeleteDocBlock,
  onDuplicateDocBlock,
  onOpenDocBlockEditor,
  onOpenTaskDrawer,
  onAutoLayout,
  onAIDiagnostic,
  onDecomposeEpic,
  onClusterNotes,
  onPromoteStickyNotes,
  presenceUsers,
  currentUserId,
  followedUserId,
  onFollowUser,
  isAutoLayoutRunning,
  tasks,
}: HybridCanvasProps) {
  const [nodes, setNodes, onNodesChangeRF] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChangeRF] = useEdgesState<Edge>([]);
  const [viewport, setViewport] = useState<Viewport>(initialViewport || { x: 0, y: 0, zoom: 1 });
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [showHelp, setShowHelp] = useState(false);
  const { fitView, zoomIn, zoomOut, screenToFlowPosition } = useReactFlow();

  // Refs para os callbacks de nós — mantém o effect de sync estável
  const nodeCallbacksRef = React.useRef<NodeCallbacks>({} as NodeCallbacks);
  nodeCallbacksRef.current = {
    onPromoteStickyNote,
    onUpdateStickyNote,
    onDeleteNode,
    onDuplicateNode,
    onUpdateFrame,
    onDeleteFrame,
    onDuplicateFrame,
    onToggleFrameCollapse,
    onUpdateDocBlock,
    onDeleteDocBlock,
    onDuplicateDocBlock,
    onOpenDocBlockEditor,
  };

  // Sync: mescla nós do banco no estado RF sem recriar objetos (recriar reseta
  // as dimensões medidas e deixa os nós presos em visibility: hidden)
  React.useEffect(() => {
    setNodes((currentRfNodes) => {
      const byId = new Map(currentRfNodes.map((n) => [n.id, n]));
      let changed = currentRfNodes.length !== initialNodes.length;

      const next = initialNodes.map((cn) => {
        const mapped = canvasNodeToReactFlowNode(cn, tasks, nodeCallbacksRef.current);
        const existing = byId.get(cn.id);
        if (existing) {
          // Compara conteúdo sem os handlers (injetados nos dois lados via ref estável)
          const stripHandlers = (d: Record<string, unknown>) => {
            const { onPromote: _p, onUpdate: _u, onDelete: _d, onDuplicate: _c, onToggleCollapse: _t, onOpenEditor: _o, ...rest } = d;
            return rest;
          };
          const samePosition =
            existing.position.x === mapped.position.x && existing.position.y === mapped.position.y;
          const sameData =
            JSON.stringify(stripHandlers(existing.data as Record<string, unknown>)) ===
            JSON.stringify(stripHandlers(mapped.data));
          const sameMeta =
            existing.type === mapped.type &&
            existing.width === mapped.width &&
            existing.height === mapped.height &&
            existing.zIndex === mapped.zIndex;
          if (samePosition && sameData && sameMeta) {
            // mantém referência: RF não re-renderiza, measured e handlers preservados
            return existing;
          }
          changed = true;
          return {
            ...mapped,
            width: mapped.width ?? existing.width,
            height: mapped.height ?? existing.height,
            measured: existing.measured,
          };
        }
        changed = true;
        return mapped;
      });

      if (!changed) {
        // Também detecta remoções
        const nextIds = new Set(initialNodes.map((n) => n.id));
        const hasRemoved = currentRfNodes.some((n) => !nextIds.has(n.id));
        if (!hasRemoved) return currentRfNodes;
      }

      return next;
    });

    setEdges((currentRfEdges) => {
      const next = initialEdges.map((e) => canvasEdgeToReactFlowEdge(e));
      const sameLength = currentRfEdges.length === next.length;
      if (sameLength && next.every((e, i) => currentRfEdges[i]?.id === e.id)) {
        return currentRfEdges;
      }
      return next;
    });
  }, [initialNodes, initialEdges, tasks, setNodes, setEdges]);

  // Sync viewport
  React.useEffect(() => {
    if (initialViewport) {
      setViewport(initialViewport);
    }
  }, [initialViewport]);

  // Handle nodes change
  const handleNodesChange: OnNodesChange = (changes) => {
    onNodesChangeRF(changes);
    const newNodes = applyNodeChanges(changes, nodes);
    const canvasNodes = newNodes.map((n) => reactFlowNodeToCanvasNode(n));
    onNodesChange(canvasNodes);
  };

  // Handle edges change
  const handleEdgesChange: OnEdgesChange = (changes) => {
    onEdgesChangeRF(changes);
    const newEdges = applyEdgeChanges(changes, edges);
    const canvasEdges = newEdges.map((e) => reactFlowEdgeToCanvasEdge(e));
    onEdgesChange(canvasEdges);
  };

  // Handle connect
  const handleConnect: OnConnect = (connection) => {
    const newEdge = addEdge(
      {
        ...connection,
        type: "dependency",
        data: { edgeType: "relates_to" },
        markerEnd: { type: "arrowclosed" as const },
        style: { strokeWidth: 2 },
      },
      edges
    );
    setEdges(newEdge);
    const canvasEdges = newEdge.map((e) => reactFlowEdgeToCanvasEdge(e));
    onEdgesChange(canvasEdges);
  };

  // Handle viewport change
  const handleViewportChange = (newViewport: Viewport) => {
    setViewport(newViewport);
    onViewportChange(newViewport);
  };

  // Handle selection change
  const handleSelectionChange = (params: { nodes: Node[]; edges: Edge[] }) => {
    const ids = params.nodes.map((n) => n.id);
    setSelectedNodeIds((prev) => {
      // Mesma seleção → mesma referência (evita loop de re-render: o RF
      // dispara onSelectionChange a cada render quando um node selectiona)
      if (prev.length === ids.length && prev.every((id, i) => ids.includes(id))) {
        return prev;
      }
      return ids;
    });
  };

  // Handle key down
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Shortcuts
    if (e.key === "n" || e.key === "N") {
      if (!e.ctrlKey && !e.metaKey && e.target === e.currentTarget) {
        e.preventDefault();
        const pos = screenToFlowPosition({ x: viewport.x + 200, y: viewport.y + 200 });
        onAddStickyNote(pos);
      }
    }
    if (e.key === "t" || e.key === "T") {
      if (!e.ctrlKey && !e.metaKey && e.target === e.currentTarget) {
        e.preventDefault();
        const pos = screenToFlowPosition({ x: viewport.x + 200, y: viewport.y + 200 });
        onAddTask(pos);
      }
    }
    if (e.key === "f" || e.key === "F") {
      if (!e.ctrlKey && !e.metaKey && e.target === e.currentTarget) {
        e.preventDefault();
        const pos = screenToFlowPosition({ x: viewport.x + 200, y: viewport.y + 200 });
        onAddFrame(pos);
      }
    }
    if (e.key === "d" || e.key === "D") {
      if (!e.ctrlKey && !e.metaKey && e.target === e.currentTarget) {
        e.preventDefault();
        const pos = screenToFlowPosition({ x: viewport.x + 200, y: viewport.y + 200 });
        onAddDocBlock(pos);
      }
    }
    if (e.key === "l" || e.key === "L") {
      if (e.shiftKey && e.target === e.currentTarget) {
        e.preventDefault();
        onAutoLayout();
      }
    }
    if (e.key === "1" && e.shiftKey) {
      if (e.target === e.currentTarget) {
        e.preventDefault();
        fitView();
      }
    }
    if (e.key === "r" || e.key === "R") {
      if (!e.ctrlKey && !e.metaKey && e.target === e.currentTarget) {
        e.preventDefault();
        setViewport({ x: 0, y: 0, zoom: 1 });
      }
    }
    if (e.key === "Escape") {
      if (followedUserId) {
        onFollowUser(null);
      }
    }
    if (e.key === "?" && e.shiftKey) {
      e.preventDefault();
      setShowHelp(!showHelp);
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (selectedNodeIds.length > 0 && e.target === e.currentTarget) {
        e.preventDefault();
        selectedNodeIds.forEach((id) => onDeleteNode(id));
      }
    }
  };

  // Convert React Flow nodes back to CanvasNode format
  function reactFlowNodeToCanvasNode(rfNode: Node): CanvasNode {
    const baseNode: CanvasNode = {
      id: rfNode.id,
      canvas_id: canvasId,
      node_type: rfNode.type as CanvasNodeType,
      task_id: (rfNode.data as any)?.task?.id || null,
      parent_frame_id: rfNode.parentId || null,
      position_x: rfNode.position.x,
      position_y: rfNode.position.y,
      width: rfNode.width ?? null,
      height: rfNode.height ?? null,
      z_index: rfNode.zIndex || 0,
      needs_auto_layout: (rfNode.data as any)?.needsAutoLayout || false,
      data: { ...rfNode.data },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    // Remove internal properties
    delete (baseNode.data as any).needsAutoLayout;
    delete (baseNode.data as any).task;
    return baseNode;
  }

  // Convert React Flow edges back to CanvasEdge format
  function reactFlowEdgeToCanvasEdge(rfEdge: Edge): CanvasEdge {
    const edgeData = rfEdge.data as any;
    return {
      id: rfEdge.id,
      canvas_id: canvasId,
      source_node_id: rfEdge.source,
      target_node_id: rfEdge.target,
      edge_type: (edgeData?.edgeType as CanvasEdgeType) || "relates_to",
      label: edgeData?.label || null,
      created_at: new Date().toISOString(),
    };
  }

  // Get selected nodes for AI command bar
  const selectedNodes = nodes
    .filter((n) => selectedNodeIds.includes(n.id))
    .map((n) => ({
      id: n.id,
      type: n.type as CanvasNodeType,
      title: (n.data as any)?.title || (n.data as any)?.task?.title,
      content: (n.data as any)?.text || (n.data as any)?.content,
    }));

  return (
    <TooltipProvider>
      <div
        className="relative w-full h-full"
        onKeyDown={handleKeyDown}
        tabIndex={0}
        style={{ outline: "none" }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onViewportChange={handleViewportChange}
          onSelectionChange={handleSelectionChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionLineType={ConnectionLineType.Bezier}
          defaultViewport={viewport}
          viewport={viewport}
          fitView={false}
          minZoom={0.1}
          maxZoom={2}
          snapToGrid={false}
          snapGrid={[16, 16]}
          connectionMode={ConnectionMode.Loose}
          nodesDraggable={true}
          nodesConnectable={true}
          elementsSelectable={true}
          selectionMode={SelectionMode.Full}
          selectNodesOnDrag={true}
          panOnScroll={true}
          panOnScrollSpeed={0.5}
          panOnScrollMode={PanOnScrollMode.Free}
        >
          <Background
            color="var(--border)"
            gap={16}
            size={1}
            variant={BackgroundVariant.Dots}
            className="opacity-50"
          />
          <Controls
            showZoom={false}
            showFitView={false}
            showInteractive={false}
          />
          <MiniMap
            nodeColor={(node) => NODE_TYPE_COLORS[node.type as CanvasNodeType] || "var(--muted-foreground)"}
            maskColor="rgba(0, 0, 0, 0.1)"
          />

          {/* Custom Panels */}
          <Panel position="top-left">
            <CanvasToolbar
              onAddStickyNote={() => {
                const pos = screenToFlowPosition({ x: viewport.x + 200, y: viewport.y + 200 });
                onAddStickyNote(pos);
              }}
              onAddTask={() => {
                const pos = screenToFlowPosition({ x: viewport.x + 200, y: viewport.y + 200 });
                onAddTask(pos);
              }}
              onAddFrame={() => {
                const pos = screenToFlowPosition({ x: viewport.x + 200, y: viewport.y + 200 });
                onAddFrame(pos);
              }}
              onAddDocBlock={() => {
                const pos = screenToFlowPosition({ x: viewport.x + 200, y: viewport.y + 200 });
                onAddDocBlock(pos);
              }}
              onAutoLayout={onAutoLayout}
              onAIDiagnostic={onAIDiagnostic}
              onFitView={fitView}
              onZoomIn={zoomIn}
              onZoomOut={zoomOut}
              onResetViewport={() => setViewport({ x: 0, y: 0, zoom: 1 })}
              zoom={viewport.zoom}
              isAutoLayoutRunning={isAutoLayoutRunning}
            />
          </Panel>

          <Panel position="top-right">
            <FollowModeBar
              users={presenceUsers}
              currentUserId={currentUserId}
              followedUserId={followedUserId}
              onFollow={onFollowUser}
              viewport={viewport}
            />
          </Panel>

          <Panel position="bottom-right">
            <div className="flex flex-col gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => zoomIn()} aria-label="Zoom in">
                    <ZoomIn className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Zoom in (+)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => zoomOut()} aria-label="Zoom out">
                    <ZoomOut className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Zoom out (-)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => fitView()} aria-label="Ajustar visão">
                    <LayoutDashboard className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Ajustar visão (Shift+1)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setViewport({ x: 0, y: 0, zoom: 1 })} aria-label="Resetar viewport">
                    <RotateCcw className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Resetar viewport (R)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setShowHelp(!showHelp)} aria-label="Atalhos">
                    <HelpCircle className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Atalhos (Shift+/)</TooltipContent>
              </Tooltip>
            </div>
          </Panel>

          {/* Live Cursors */}
          <LiveCursors
            cursors={presenceUsers.map((u) => ({
              userId: u.id,
              userName: u.name,
              color: u.color,
              x: u.cursor?.x || 0,
              y: u.cursor?.y || 0,
              timestamp: Date.now(),
            }))}
            currentUserId={currentUserId}
            viewport={viewport}
          />
        </ReactFlow>

        {/* AI Command Bar */}
        <CanvasAICommandBar
          selectedNodes={selectedNodes}
          onDecomposeEpic={onDecomposeEpic}
          onClusterNotes={onClusterNotes}
          onPromoteStickyNotes={onPromoteStickyNotes}
          onDismiss={() => setSelectedNodeIds([])}
          isLoading={isAutoLayoutRunning}
        />

        {/* Help Modal */}
        {showHelp && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowHelp(false)}>
            <div className="bg-card border border-border rounded-xl p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Atalhos do Teclado</h2>
                <Button variant="ghost" size="icon" onClick={() => setShowHelp(false)}>
                  <X className="h-5 w-5" />
                </Button>
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between"><kbd className="px-2 py-1 bg-muted rounded">N</kbd><span>Novo Post-it</span></div>
                <div className="flex justify-between"><kbd className="px-2 py-1 bg-muted rounded">T</kbd><span>Nova Tarefa</span></div>
                <div className="flex justify-between"><kbd className="px-2 py-1 bg-muted rounded">F</kbd><span>Novo Frame</span></div>
                <div className="flex justify-between"><kbd className="px-2 py-1 bg-muted rounded">D</kbd><span>Novo Bloco Doc</span></div>
                <div className="flex justify-between"><kbd className="px-2 py-1 bg-muted rounded">Shift+L</kbd><span>Auto-Layout</span></div>
                <div className="flex justify-between"><kbd className="px-2 py-1 bg-muted rounded">Shift+1</kbd><span>Ajustar Visão</span></div>
                <div className="flex justify-between"><kbd className="px-2 py-1 bg-muted rounded">R</kbd><span>Resetar Viewport</span></div>
                <div className="flex justify-between"><kbd className="px-2 py-1 bg-muted rounded">Delete</kbd><span>Excluir Selecionados</span></div>
                <div className="flex justify-between"><kbd className="px-2 py-1 bg-muted rounded">Esc</kbd><span>Parar Seguir</span></div>
                <div className="flex justify-between"><kbd className="px-2 py-1 bg-muted rounded">Shift+/</kbd><span>Mostrar Atalhos</span></div>
              </div>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}