"use client";

import * as React from "react";
import type { Viewport } from "@xyflow/react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Db = SupabaseClient<Database>;

const CURSOR_THROTTLE_MS = 50;
const CURSOR_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"];

export function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return CURSOR_COLORS[hash % CURSOR_COLORS.length];
}

export interface PresenceUser {
  id: string;
  name: string;
  avatar?: string;
  color: string;
  cursor?: { x: number; y: number };
  viewport?: Viewport;
  /** Publicado na presença: só quem escreve pode ser eleito para o auto-layout. */
  canWrite?: boolean;
}

/**
 * Presence + broadcast de cursores/viewport num único canal, criado uma vez
 * por canvas/usuário (seguir alguém não derruba nem recria o canal).
 */
export function useCanvasPresence({
  supabase,
  canvasId,
  userId,
  userName,
  canWrite,
}: {
  supabase: Db;
  canvasId: string;
  userId: string;
  userName: string;
  canWrite: boolean;
}) {
  const [presenceUsers, setPresenceUsers] = React.useState<PresenceUser[]>([]);
  const [followedUserId, setFollowedUserId] = React.useState<string | null>(null);
  const [isSynced, setIsSynced] = React.useState(false);
  const channelRef = React.useRef<RealtimeChannel | null>(null);
  const lastCursorSent = React.useRef(0);

  React.useEffect(() => {
    if (!canvasId || !userId) return;

    const channel = supabase.channel(`presence-canvas-${canvasId}`, {
      config: { presence: { key: userId }, broadcast: { self: false } },
    });
    channelRef.current = channel;

    channel
      .on("broadcast", { event: "cursor" }, ({ payload }) => {
        const p = payload as { userId: string; name: string; x: number; y: number };
        setPresenceUsers((prev) => {
          const existing = prev.find((u) => u.id === p.userId);
          const others = prev.filter((u) => u.id !== p.userId);
          return [
            ...others,
            {
              id: p.userId,
              name: p.name,
              color: existing?.color ?? colorForUser(p.userId),
              cursor: { x: p.x, y: p.y },
              viewport: existing?.viewport,
            },
          ];
        });
      })
      .on("broadcast", { event: "viewport" }, ({ payload }) => {
        const p = payload as { userId: string; viewport: Viewport };
        setPresenceUsers((prev) => prev.map((u) => (u.id === p.userId ? { ...u, viewport: p.viewport } : u)));
      })
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        setIsSynced(true);
        setPresenceUsers((prev) => {
          const next: PresenceUser[] = [];
          for (const [key, metas] of Object.entries(state)) {
            if (key === userId) continue;
            const meta = metas[0] as Record<string, unknown> | undefined;
            const existing = prev.find((u) => u.id === key);
            next.push({
              id: key,
              name: (meta?.name as string) ?? existing?.name ?? "Usuário",
              avatar: meta?.avatar as string | undefined,
              color: (meta?.color as string) ?? colorForUser(key),
              cursor: existing?.cursor,
              viewport: existing?.viewport,
              canWrite: meta?.canWrite === true,
            });
          }
          return next;
        });
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.track({ name: userName, color: colorForUser(userId), canWrite });
        }
      });

    return () => {
      channelRef.current = null;
      setIsSynced(false);
      void supabase.removeChannel(channel);
    };
  }, [supabase, canvasId, userId, userName, canWrite]);

  const broadcastCursor = React.useCallback(
    (screen: { x: number; y: number }) => {
      const now = Date.now();
      if (now - lastCursorSent.current < CURSOR_THROTTLE_MS) return;
      lastCursorSent.current = now;
      void channelRef.current?.send({
        type: "broadcast",
        event: "cursor",
        payload: { userId, name: userName, x: screen.x, y: screen.y },
      });
    },
    [userId, userName]
  );

  const broadcastViewport = React.useCallback(
    (viewport: Viewport) => {
      void channelRef.current?.send({ type: "broadcast", event: "viewport", payload: { userId, viewport } });
    },
    [userId]
  );

  // Viewers não entram na eleição: um leitor eleito travaria o auto-layout de todos
  const presentWriterIds = React.useMemo(
    () => presenceUsers.filter((u) => u.canWrite).map((u) => u.id),
    [presenceUsers]
  );

  return {
    presenceUsers,
    presentWriterIds,
    isSynced,
    followedUserId,
    setFollowedUserId,
    broadcastCursor,
    broadcastViewport,
  };
}
