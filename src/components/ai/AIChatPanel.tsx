"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

import {
  Sparkles,
  X,
  SendHorizonal,
  Loader2,
  StickyNote,
  ListChecks,
  Frame as FrameIcon,
} from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  created?: Array<{ type: string; label: string }>;
}

interface AIChatPanelProps {
  canvasId: string;
  suggestedOrigin: { x: number; y: number };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SUGGESTIONS = [
  "Crie 5 post-its com ideias para um app de delivery",
  "Monte o backlog de um app de tarefas com 6 tarefas",
  "Crie um frame 'Sprint 1' e 3 tarefas para ele",
];

const TYPE_META: Record<string, { icon: React.ReactNode; label: string; className: string }> = {
  sticky: { icon: <StickyNote className="h-3 w-3" />, label: "Post-it", className: "bg-yellow-100 text-yellow-800" },
  task: { icon: <ListChecks className="h-3 w-3" />, label: "Tarefa", className: "bg-blue-100 text-blue-800" },
  frame: { icon: <FrameIcon className="h-3 w-3" />, label: "Frame", className: "bg-violet-100 text-violet-800" },
};

export function AIChatPanel({ canvasId, suggestedOrigin, open, onOpenChange }: AIChatPanelProps) {
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleSubmit = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || isLoading || !canvasId) return;

    const userMessage: ChatMessage = { role: "user", content };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setIsLoading(true);
    setError("");

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canvas_id: canvasId,
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
          suggested_origin: suggestedOrigin,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "Falha ao chamar a IA.");
        return;
      }
      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content: body.reply,
          created: body.created ?? [],
        },
      ]);
    } catch {
      setError("Não foi possível falar com a IA.");
    } finally {
      setIsLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[380px] max-w-[calc(100vw-2rem)]">
      <div className="flex h-[520px] max-h-[calc(100vh-6rem)] flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-none">Assistente IA</p>
              <p className="text-xs text-muted-foreground">Cria post-its, tarefas e frames no canvas</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onOpenChange(false)} aria-label="Fechar chat">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Mensagens */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.length === 0 && (
            <div className="space-y-3 pt-4">
              <p className="text-sm text-muted-foreground text-center">
                Peça para eu criar elementos no canvas e no backlog:
              </p>
              <div className="space-y-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => handleSubmit(s)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, i) => (
            <div key={i} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-xl px-3 py-2 text-sm",
                  message.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-sm"
                    : "bg-muted text-foreground rounded-bl-sm"
                )}
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
                {message.created && message.created.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {message.created.map((item, j) => {
                      const meta = TYPE_META[item.type] ?? TYPE_META.sticky;
                      return (
                        <span
                          key={j}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                            meta.className
                          )}
                          title={item.label}
                        >
                          {meta.icon}
                          {item.label.length > 32 ? `${item.label.slice(0, 32)}…` : item.label}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Pensando…
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-border p-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
            className="flex items-end gap-2"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="Ex: crie o backlog de um app de receitas…"
              rows={2}
              className="flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              disabled={isLoading}
            />
            <Button type="submit" size="icon" className="h-9 w-9 shrink-0" disabled={isLoading || !input.trim()} aria-label="Enviar">
              <SendHorizonal className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
