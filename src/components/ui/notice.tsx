"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface NoticeState {
  id: number;
  message: string;
  tone: "info" | "error";
}

/** Aviso não bloqueante (substitui window.alert). */
export function useNotice(timeoutMs = 6000) {
  const [notice, setNotice] = React.useState<NoticeState | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = React.useCallback(() => setNotice(null), []);

  const notify = React.useCallback(
    (message: string, tone: NoticeState["tone"] = "info") => {
      if (timer.current) clearTimeout(timer.current);
      setNotice({ id: Date.now(), message, tone });
      timer.current = setTimeout(() => setNotice(null), timeoutMs);
    },
    [timeoutMs]
  );

  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { notice, notify, clear };
}

export function Notice({ notice, onClose }: { notice: NoticeState | null; onClose: () => void }) {
  if (!notice) return null;
  return (
    <div
      role={notice.tone === "error" ? "alert" : "status"}
      className={cn(
        "fixed bottom-4 left-1/2 z-[60] flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-start gap-3 rounded-md border px-4 py-3 text-sm shadow-lg",
        notice.tone === "error"
          ? "border-destructive/50 bg-destructive text-destructive-foreground"
          : "border-border bg-card text-card-foreground"
      )}
    >
      <span className="whitespace-pre-line">{notice.message}</span>
      <button type="button" onClick={onClose} aria-label="Fechar aviso" className="opacity-70 hover:opacity-100">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
