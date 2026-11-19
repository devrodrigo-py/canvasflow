"use client";

import * as React from "react";
import { User, Users, MousePointer2, X, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

interface PresenceUser {
  id: string;
  name: string;
  avatar?: string;
  color: string;
  cursor?: { x: number; y: number };
}

interface FollowModeBarProps {
  users: PresenceUser[];
  currentUserId: string;
  followedUserId: string | null;
  onFollow: (userId: string | null) => void;
  viewport: { x: number; y: number; zoom: number };
}

const CURSOR_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

function getUserColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function FollowModeBar({
  users,
  currentUserId,
  followedUserId,
  onFollow,
  viewport,
}: FollowModeBarProps) {
  const otherUsers = users.filter((u) => u.id !== currentUserId);
  const followedUser = users.find((u) => u.id === followedUserId);

  if (users.length <= 1) return null;

  return (
    <TooltipProvider>
      <div className="fixed top-4 right-4 z-40 flex flex-col items-end gap-2">
        {/* Follow Mode Indicator */}
        {followedUserId && (
          <div className="follow-mode-indicator flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg shadow-lg">
            <div className="flex items-center gap-2">
              <MousePointer2 className="h-4 w-4" />
              <span className="font-medium">Seguindo</span>
              <div
                className="h-6 w-6 rounded-full flex items-center justify-center text-xs font-medium"
                style={{
                  backgroundColor: followedUser?.color || getUserColor(followedUserId),
                }}
              >
                {followedUser ? getInitials(followedUser.name) : "?"}
              </div>
              <span className="text-sm">{followedUser?.name || "Usuário"}</span>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => onFollow(null)}
                  aria-label="Parar de seguir"
                >
                  <X className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Parar de seguir (Esc)</TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* Users List */}
        <div className="flex items-center gap-1 bg-card/95 backdrop-blur-sm border border-border rounded-lg shadow-lg p-1">
          {users.map((user) => {
            const isCurrent = user.id === currentUserId;
            const isFollowed = user.id === followedUserId;
            const color = user.color || getUserColor(user.id);
            const initials = getInitials(user.name);

            return (
              <Tooltip key={user.id}>
                <TooltipTrigger asChild>
                  <Button
                    variant={isFollowed ? "default" : isCurrent ? "secondary" : "outline"}
                    size="icon"
                    className={cn(
                      "h-9 w-9 relative transition-all",
                      isFollowed && "ring-2 ring-primary ring-offset-2"
                    )}
                    onClick={() => onFollow(isFollowed ? null : user.id)}
                    disabled={isCurrent && !followedUserId}
                    aria-label={
                      isCurrent
                        ? "Você"
                        : isFollowed
                        ? `Parar de seguir ${user.name}`
                        : `Seguir ${user.name}`
                    }
                  >
                    <div
                      className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-medium"
                      style={{
                        backgroundColor: isCurrent ? "transparent" : color,
                        color: isCurrent ? "inherit" : "white",
                        border: isCurrent ? "1px solid currentColor" : "none",
                      }}
                    >
                      {initials}
                    </div>
                    {isCurrent && (
                      <span className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center">
                        <User className="h-3 w-3" />
                      </span>
                    )}
                    {isFollowed && (
                      <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center">
                        <Eye className="h-3 w-3" />
                      </span>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left" align="center">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium"
                      style={{ backgroundColor: color, color: "white" }}
                    >
                      {initials}
                    </div>
                    <div>
                      <p className="font-medium">{user.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {isCurrent ? "Você" : isFollowed ? "Seguindo" : "Clique para seguir"}
                      </p>
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}