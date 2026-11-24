"use client";

import * as React from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { CanvasEdge, CanvasNode } from "@/types/domain";
import { calculateAutoLayout } from "@/lib/layout/elkLayout";
import { computePendingPlacements, type Placement } from "@/lib/layout/pendingPlacement";

type Db = SupabaseClient<Database>;

interface UseAutoLayoutOptions {
  supabase: Db;
  canvasId: string;
  nodes: CanvasNode[];
  nodesRef: React.MutableRefObject<CanvasNode[]>;
  edgesRef: React.MutableRefObject<CanvasEdge[]>;
  setNodes: React.Dispatch<React.SetStateAction<CanvasNode[]>>;
  /** Só o líder eleito (e com permissão de escrita) posiciona nós pendentes. */
  isLeader: boolean;
  canWrite: boolean;
  onError?: (message: string) => void;
}

/**
 * Posiciona nós criados por IA/MCP (needs_auto_layout = true) e expõe o
 * auto-layout manual (botão "Organizar").
 *
 * Correções em relação à versão anterior:
 *  - o lock de ciclo é sempre liberado (antes ficava preso após o 1º ciclo);
 *  - só um cliente (líder) posiciona, e a gravação é condicional
 *    (needs_auto_layout = true), então escritas concorrentes não se sobrepõem;
 *  - cards empilham abaixo do último já posicionado (antes caíam no mesmo ponto).
 */
export function useAutoLayout({
  supabase,
  canvasId,
  nodes,
  nodesRef,
  edgesRef,
  setNodes,
  isLeader,
  canWrite,
  onError,
}: UseAutoLayoutOptions) {
  const [isRunning, setIsRunning] = React.useState(false);
  const cycleRunning = React.useRef(false);
  const failed = React.useRef<Set<string>>(new Set());
  const [recheck, setRecheck] = React.useState(0);

  const applyAndPersist = React.useCallback(
    async (placements: Placement[], onlyPending: boolean) => {
      if (placements.length === 0) return;
      const byId = new Map(placements.map((p) => [p.id, p]));
      setNodes((prev) =>
        prev.map((n) => {
          const p = byId.get(n.id);
          return p ? { ...n, position_x: p.x, position_y: p.y, needs_auto_layout: false } : n;
        })
      );
      const results = await Promise.all(
        placements.map((p) => {
          let query = supabase
            .from("canvas_nodes")
            .update({ position_x: p.x, position_y: p.y, needs_auto_layout: false })
            .eq("id", p.id)
            .eq("canvas_id", canvasId);
          // Gravação condicional: se outro cliente já posicionou, esta vira no-op
          if (onlyPending) query = query.eq("needs_auto_layout", true);
          return query;
        })
      );
      const firstError = results.find((r) => r.error)?.error;
      if (firstError) throw firstError;
    },
    [supabase, canvasId, setNodes]
  );

  // Nós pendentes → posicionamento automático (apenas no líder)
  React.useEffect(() => {
    if (!canvasId || !isLeader || !canWrite || cycleRunning.current) return;
    const pending = nodes.filter((n) => n.needs_auto_layout && !failed.current.has(n.id));
    if (pending.length === 0) return;

    cycleRunning.current = true;

    (async () => {
      const currentNodes = nodesRef.current;
      const currentEdges = edgesRef.current;
      const { placements, unplaced } = computePendingPlacements(
        currentNodes.filter((n) => !failed.current.has(n.id)),
        currentEdges
      );

      if (unplaced.length > 0) {
        const result = await calculateAutoLayout(unplaced, currentEdges);
        placements.push(...result.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y })));
      }
      await applyAndPersist(placements, true);
    })()
      .catch((err) => {
        for (const n of pending) failed.current.add(n.id);
        onError?.(`Auto-layout falhou: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        cycleRunning.current = false;
        // Reavalia: nós podem ter chegado enquanto este ciclo rodava
        setRecheck((v) => v + 1);
      });
  }, [nodes, canvasId, isLeader, canWrite, recheck, nodesRef, edgesRef, applyAndPersist, onError]);

  /** Botão "Organizar": layout ELK de todo o canvas. */
  const runAutoLayout = React.useCallback(async () => {
    if (!canvasId || isRunning || !canWrite) return;
    setIsRunning(true);
    try {
      const result = await calculateAutoLayout(nodesRef.current, edgesRef.current, {
        direction: "DOWN",
        hierarchyHandling: "INCLUDE_CHILDREN",
      });
      await applyAndPersist(
        result.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y })),
        false
      );
    } catch (err) {
      onError?.(`Falha ao organizar o canvas: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsRunning(false);
    }
  }, [canvasId, isRunning, canWrite, nodesRef, edgesRef, applyAndPersist, onError]);

  return { isRunning, runAutoLayout };
}
