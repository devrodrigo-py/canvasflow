"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Comment } from "@/types/domain";
import { MessageSquare, Send, Loader2, X, Edit2, Trash2, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

interface TaskCommentsProps {
  comments: Comment[];
  onAddComment: (taskId: string, body: string) => Promise<void>;
  onUpdateComment: (commentId: string, body: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
  onResolveComment: (commentId: string, resolved: boolean) => Promise<void>;
  currentUserId: string;
  taskId: string;
}

export function TaskComments({
  comments,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
  onResolveComment,
  currentUserId,
  taskId,
}: TaskCommentsProps) {
  const [newComment, setNewComment] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [editingCommentId, setEditingCommentId] = React.useState<string | null>(null);
  const [editText, setEditText] = React.useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onAddComment(taskId, newComment.trim());
      setNewComment("");
    } finally {
      setIsSubmitting(false);
    }
  };

  const startEditing = (comment: Comment) => {
    setEditingCommentId(comment.id);
    setEditText(comment.body_markdown);
  };

  const saveEdit = async (commentId: string) => {
    if (!editText.trim()) return;
    try {
      await onUpdateComment(commentId, editText.trim());
      setEditingCommentId(null);
      setEditText("");
    } catch (error) {
      console.error("Failed to update comment:", error);
    }
  };

  const cancelEdit = () => {
    setEditingCommentId(null);
    setEditText("");
  };

  const handleDelete = async (commentId: string) => {
    if (window.confirm("Excluir este comentário?")) {
      await onDeleteComment(commentId);
    }
  };

  const handleResolve = async (commentId: string, resolved: boolean) => {
    await onResolveComment(commentId, resolved);
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Separate comments by task vs canvas pins
  const taskComments = comments.filter((c) => c.task_id === taskId);
  const canvasComments = comments.filter((c) => c.canvas_id && !c.task_id);

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <h3 className="font-medium flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          Discussão ({taskComments.length + canvasComments.length})
        </h3>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Task Comments */}
          {taskComments.length > 0 && (
            <div className="space-y-4">
              {taskComments.map((comment) => (
                <CommentItem
                  key={comment.id}
                  comment={comment}
                  currentUserId={currentUserId}
                  editingCommentId={editingCommentId}
                  editText={editText}
                  onEdit={startEditing}
                  onSave={saveEdit}
                  onCancel={cancelEdit}
                  onDelete={handleDelete}
                  onResolve={handleResolve}
                  formatDate={formatDate}
                  getInitials={getInitials}
                />
              ))}
            </div>
          )}

          {/* Canvas Comments */}
          {canvasComments.length > 0 && (
            <div className="space-y-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
                Comentários no Canvas
              </div>
              {canvasComments.map((comment) => (
                <CommentItem
                  key={comment.id}
                  comment={comment}
                  currentUserId={currentUserId}
                  editingCommentId={editingCommentId}
                  editText={editText}
                  onEdit={startEditing}
                  onSave={saveEdit}
                  onCancel={cancelEdit}
                  onDelete={handleDelete}
                  onResolve={handleResolve}
                  formatDate={formatDate}
                  getInitials={getInitials}
                  isCanvasComment
                />
              ))}
            </div>
          )}

          {comments.length === 0 && (
            <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
              <MessageSquare className="h-12 w-12 mb-4 opacity-50" />
              <p className="text-center">Nenhum comentário ainda.</p>
              <p className="text-sm text-center mt-1">Seja o primeiro a comentar!</p>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Add Comment Form */}
      <div className="p-4 border-t border-border">
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-1">
              <span className="text-xs font-medium text-primary">
                {currentUserId.slice(0, 2).toUpperCase()}
              </span>
            </div>
            <Textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Escreva um comentário..."
              className="flex-1 min-h-[80px] resize-none"
              rows={3}
              disabled={isSubmitting}
            />
          </div>
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={!newComment.trim() || isSubmitting}
              className="gap-1"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Comentar
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface CommentItemProps {
  comment: Comment;
  currentUserId: string;
  editingCommentId: string | null;
  editText: string;
  onEdit: (comment: Comment) => void;
  onSave: (commentId: string) => void;
  onCancel: () => void;
  onDelete: (commentId: string) => void;
  onResolve: (commentId: string, resolved: boolean) => void;
  formatDate: (dateString: string) => string;
  getInitials: (name: string) => string;
  isCanvasComment?: boolean;
}

function CommentItem({
  comment,
  currentUserId,
  editingCommentId,
  editText,
  onEdit,
  onSave,
  onCancel,
  onDelete,
  onResolve,
  formatDate,
  getInitials,
  isCanvasComment,
}: CommentItemProps) {
  const isAuthor = comment.author_user_id === currentUserId;
  const isEditing = editingCommentId === comment.id;

  return (
    <TooltipProvider>
      <div
        className={cn(
          "flex gap-3 p-4 bg-card border border-border rounded-lg",
          isCanvasComment && "border-primary/20 bg-primary/5"
        )}
      >
        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
          <span className="text-xs font-medium text-muted-foreground">
            {getInitials(comment.author_label)}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{comment.author_label}</span>
              {comment.actor_type === "external_agent" && (
                <span className="px-1.5 py-0.5 text-xs bg-chart-1/10 text-chart-1 rounded">
                  <span className="flex items-center gap-1">
                    <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                    </svg>
                    Agente
                  </span>
                </span>
              )}
              <span className="text-xs text-muted-foreground">{formatDate(comment.created_at)}</span>
            </div>

            {isAuthor && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button className="p-1 rounded hover:bg-muted transition-colors" aria-label="Mais opções">
                        <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Opções</TooltipContent>
                  </Tooltip>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {!isEditing && (
                    <DropdownMenuItem onClick={() => onEdit(comment)} className="flex items-center gap-2">
                      <Edit2 className="h-4 w-4" />
                      Editar
                    </DropdownMenuItem>
                  )}
                  {!isEditing && (
                    <DropdownMenuItem
                      onClick={() => onResolve(comment.id, !comment.resolved)}
                      className="flex items-center gap-2"
                    >
                      {comment.resolved ? (
                        <>
                          <X className="h-4 w-4" />
                          Reabrir
                        </>
                      ) : (
                        <>
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                          </svg>
                          {comment.resolved ? "Reabrir" : "Resolver"}
                        </>
                      )}
                    </DropdownMenuItem>
                  )}
                  {isAuthor && (
                    <DropdownMenuItem
                      onClick={() => onDelete(comment.id)}
                      className="flex items-center gap-2 text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                      Excluir
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {isEditing ? (
            <div className="space-y-2">
              <Textarea
                value={editText}
                onChange={(e) => {}}
                defaultValue={editText}
                className="min-h-[80px] resize-none"
                onBlur={() => onSave(comment.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onSave(comment.id);
                  } else if (e.key === "Escape") {
                    onCancel();
                  }
                }}
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={onCancel}>
                  Cancelar
                </Button>
                <Button size="sm" onClick={() => onSave(comment.id)}>
                  Salvar
                </Button>
              </div>
            </div>
          ) : (
            <div className="prose prose-sm max-w-none whitespace-pre-wrap text-muted-foreground/90">
              {comment.body_markdown}
            </div>
          )}

          {comment.resolved && (
            <div className="mt-2 flex items-center gap-1 text-xs text-green-500">
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
              <span>Resolvido</span>
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}