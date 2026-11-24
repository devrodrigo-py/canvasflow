"use client";

import * as React from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ReactFlowProvider, type Viewport } from "@xyflow/react";
import { HybridCanvas } from "@/components/canvas/HybridCanvas";
import { TaskDrawer } from "@/components/task/TaskDrawer";
import { useTaskDrawer } from "@/components/task/useTaskDrawer";
import { AIChatPanel } from "@/components/ai/AIChatPanel";
import { Button } from "@/components/ui/button";
import { PromptDialog } from "@/components/ui/prompt-dialog";
import { Notice, useNotice } from "@/components/ui/notice";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { useCanvasData } from "@/components/canvas/hooks/useCanvasData";
import { useCanvasPresence } from "@/components/canvas/hooks/useCanvasPresence";
import { useAutoLayout } from "@/components/canvas/hooks/useAutoLayout";
import { useCanvasMutations } from "@/components/canvas/hooks/useCanvasMutations";
import { isLayoutLeader } from "@/lib/layout/pendingPlacement";
import { createClient } from "@/lib/supabase/client";
import { Eye, Loader2, Sparkles } from "lucide-react";

/**
 * Página do canvas: apenas composição. Dados/realtime, presença, auto-layout,
 * mutações e drawer vivem em hooks dedicados.
 */
export default function CanvasPage() {
  const params = useParams<{ projectSlug: string; canvasId: string }>();
  const searchParams = useSearchParams();
  const { workspace, user, canWrite } = useWorkspace();
  const supabase = React.useMemo(() => createClient(), []);
  const { notice, notify, clear } = useNotice();
  const notifyError = React.useCallback((message: string) => notify(message, "error"), [notify]);

  const data = useCanvasData({
    supabase,
    workspaceId: workspace.id,
    projectSlug: params.projectSlug,
    canvasIdParam: params.canvasId,
  });

  const presence = useCanvasPresence({
    supabase,
    canvasId: data.canvasId,
    userId: user.id,
    userName: user.name,
  });

  // Só o líder posiciona nós pendentes. Se a presença não sincronizar em 3s (Realtime
  // indisponível), este cliente assume; a gravação condicional evita conflito no banco.
  const [presenceTimedOut, setPresenceTimedOut] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setPresenceTimedOut(true), 3000);
    return () => clearTimeout(t);
  }, []);
  const isLeader = presence.isSynced
    ? isLayoutLeader(user.id, presence.presentUserIds)
    : presenceTimedOut;

  const layout = useAutoLayout({
    supabase,
    canvasId: data.canvasId,
    nodes: data.nodes,
    nodesRef: data.nodesRef,
    edgesRef: data.edgesRef,
    setNodes: data.setNodes,
    isLeader,
    canWrite,
    onError: notifyError,
  });

  const mutations = useCanvasMutations({
    supabase,
    canvasId: data.canvasId,
    projectId: data.projectId,
    userName: user.name,
    canWrite,
    nodesRef: data.nodesRef,
    edgesRef: data.edgesRef,
    setNodes: data.setNodes,
    setEdges: data.setEdges,
    setTasks: data.setTasks,
    markLocallyMoving: data.markLocallyMoving,
    notify,
  });

  const getTask = React.useCallback((taskId: string) => data.tasksRef.current[taskId], [data.tasksRef]);
  const drawer = useTaskDrawer({ supabase, getTask, patchTask: data.patchTask, onError: notifyError });
  const [isFullscreenDrawer, setIsFullscreenDrawer] = React.useState(false);

  // ---- Viewport / follow mode ----
  const lastViewportRef = React.useRef<Viewport>({ x: 0, y: 0, zoom: 1 });
  const userInteractedRef = React.useRef(false);
  const followAppliedRef = React.useRef("");
  const { followedUserId, setFollowedUserId, broadcastViewport, broadcastCursor, presenceUsers } = presence;
  const { setInitialViewport } = data;

  React.useEffect(() => {
    if (data.initialViewport) lastViewportRef.current = data.initialViewport;
  }, [data.initialViewport]);

  React.useEffect(() => {
    if (!followedUserId) return;
    const vp = presenceUsers.find((u) => u.id === followedUserId)?.viewport;
    if (!vp) return;
    const key = `${vp.x}:${vp.y}:${vp.zoom}`;
    if (followAppliedRef.current !== key) {
      followAppliedRef.current = key;
      setInitialViewport(vp);
    }
  }, [followedUserId, presenceUsers, setInitialViewport]);

  const handleViewportChange = React.useCallback(
    (viewport: Viewport) => {
      lastViewportRef.current = viewport;
      if (followedUserId && userInteractedRef.current) {
        // Interação própria encerra o follow mode
        setFollowedUserId(null);
        followAppliedRef.current = "";
      }
      userInteractedRef.current = false;
      if (!followedUserId) broadcastViewport(viewport);
      mutations.saveViewport(viewport);
    },
    [followedUserId, setFollowedUserId, broadcastViewport, mutations]
  );

  // ---- Foco via ?focus=APP-1 (vindo do backlog) ----
  const [focusTaskKey, setFocusTaskKey] = React.useState<string | null>(searchParams.get("focus"));
  const { open: openDrawer } = drawer;
  React.useEffect(() => {
    if (!focusTaskKey || data.loading) return;
    const task = Object.values(data.tasks).find((t) => t.task_key === focusTaskKey);
    if (!task) return;
    const node = data.nodes.find((n) => n.task_id === task.id);
    if (node) setInitialViewport({ x: -node.position_x + 200, y: -node.position_y + 150, zoom: 1.2 });
    void openDrawer(task.id);
    setFocusTaskKey(null);
  }, [focusTaskKey, data.loading, data.tasks, data.nodes, setInitialViewport, openDrawer]);

  // ---- Chat IA ----
  const [isChatOpen, setIsChatOpen] = React.useState(false);
  const [chatOrigin, setChatOrigin] = React.useState({ x: 0, y: 0 });
  const canvasContainerRef = React.useRef<HTMLDivElement>(null);

  const openChat = () => {
    // Origem = centro da área visível do canvas em coordenadas do fluxo
    const vp = lastViewportRef.current;
    const rect = canvasContainerRef.current?.getBoundingClientRect();
    const centerX = rect ? rect.width / 2 : window.innerWidth / 2;
    const centerY = rect ? rect.height / 2 : window.innerHeight / 2;
    setChatOrigin({ x: Math.round((centerX - vp.x) / vp.zoom), y: Math.round((centerY - vp.y) / vp.zoom) });
    setIsChatOpen(true);
  };

  if (data.loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (data.error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">{data.error}</p>
      </div>
    );
  }

  return (
    <div
      ref={canvasContainerRef}
      className="relative h-full w-full"
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        broadcastCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }}
      onKeyDown={() => {
        userInteractedRef.current = true;
      }}
      onMouseDown={() => {
        userInteractedRef.current = true;
      }}
      onWheel={() => {
        userInteractedRef.current = true;
      }}
    >
      {!canWrite && (
        <div className="absolute left-1/2 top-3 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground shadow">
          <Eye className="h-3 w-3" /> Modo leitura
        </div>
      )}

      <ReactFlowProvider>
        <HybridCanvas
          canvasId={data.canvasId}
          projectId={data.projectId}
          initialNodes={data.nodes}
          initialEdges={data.edges}
          initialViewport={data.initialViewport}
          onNodesChange={mutations.handleNodesChange}
          onEdgesChange={mutations.handleEdgesChange}
          onCreateEdge={mutations.createEdge}
          onViewportChange={handleViewportChange}
          onAddStickyNote={mutations.addStickyNote}
          onAddTask={mutations.requestAddTask}
          onAddFrame={mutations.addFrame}
          onAddDocBlock={mutations.addDocBlock}
          onPromoteStickyNote={(nodeId) => void mutations.promoteStickyNote(nodeId)}
          onUpdateStickyNote={mutations.updateStickyNote}
          onDeleteNode={mutations.deleteNode}
          onDuplicateNode={mutations.duplicateNode}
          onUpdateFrame={mutations.updateFrame}
          onDeleteFrame={mutations.deleteFrame}
          onDuplicateFrame={mutations.duplicateNode}
          onToggleFrameCollapse={mutations.toggleFrameCollapse}
          onUpdateDocBlock={mutations.updateDocBlock}
          onDeleteDocBlock={mutations.deleteNode}
          onDuplicateDocBlock={mutations.duplicateNode}
          onOpenDocBlockEditor={() => undefined}
          onOpenTaskDrawer={(taskId) => void drawer.open(taskId)}
          onAutoLayout={layout.runAutoLayout}
          onAIDiagnostic={mutations.aiDiagnostic}
          onDecomposeEpic={mutations.decomposeEpic}
          onClusterNotes={mutations.clusterNotes}
          onPromoteStickyNotes={mutations.promoteSelected}
          presenceUsers={presenceUsers}
          currentUserId={user.id}
          followedUserId={followedUserId}
          onFollowUser={setFollowedUserId}
          isAutoLayoutRunning={layout.isRunning || mutations.isAIRunning}
          tasks={data.tasks}
        />

        <TaskDrawer
          {...drawer.drawerProps}
          isFullscreen={isFullscreenDrawer}
          onToggleFullscreen={() => setIsFullscreenDrawer((v) => !v)}
        />

        {!isChatOpen && canWrite && (
          <Button className="absolute bottom-4 right-4 z-40 gap-2 shadow-lg" onClick={openChat}>
            <Sparkles className="h-4 w-4" />
            Assistente IA
          </Button>
        )}
        <AIChatPanel
          canvasId={data.canvasId}
          suggestedOrigin={chatOrigin}
          open={isChatOpen}
          onOpenChange={setIsChatOpen}
        />
      </ReactFlowProvider>

      <PromptDialog
        open={mutations.pendingTaskPosition !== null}
        onOpenChange={(open) => !open && mutations.cancelAddTask()}
        title="Nova tarefa"
        description="O card é criado na posição escolhida e a tarefa entra no backlog."
        label="Título"
        placeholder="Ex.: Implementar login social"
        onSubmit={mutations.createTaskAt}
      />
      <Notice notice={notice} onClose={clear} />
    </div>
  );
}
