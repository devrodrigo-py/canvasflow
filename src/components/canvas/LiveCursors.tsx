"use client";

import * as React from "react";


interface CursorData {
  userId: string;
  userName: string;
  color: string;
  x: number;
  y: number;
  timestamp: number;
}

interface LiveCursorsProps {
  cursors: CursorData[];
  currentUserId: string;
  viewport: { x: number; y: number; zoom: number };
}

const CURSOR_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
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

export function LiveCursors({ cursors, currentUserId, viewport }: LiveCursorsProps) {
  const otherCursors = cursors.filter((c) => c.userId !== currentUserId);

  if (otherCursors.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {otherCursors.map((cursor) => {
        const color = cursor.color || getUserColor(cursor.userId);
        const initials = getInitials(cursor.userName);

        // Transform cursor position to viewport coordinates
        const x = (cursor.x - viewport.x) * viewport.zoom;
        const y = (cursor.y - viewport.y) * viewport.zoom;

        return (
          <div
            key={cursor.userId}
            className="live-cursor"
            style={{
              transform: `translate(${x}px, ${y}px)`,
              transition: "transform 50ms linear",
            }}
          >
            {/* Cursor pointer */}
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              style={{
                filter: `drop-shadow(0 1px 2px rgba(0,0,0,0.3))`,
              }}
            >
              <path
                d="M5.5 3.21V20.8c0 .45.54.67.85.35l6.49-6.49 6.49 6.49c.31.32.85.09.85-.35V3.21c0-.45-.54-.67-.85-.35L12.85 9.7l-6.49-6.49C5.04 2.54 4.5 2.77 4.5 3.21Z"
                fill={color}
                stroke="white"
                strokeWidth="1.5"
              />
            </svg>

            {/* Label */}
            <div
              className="live-cursor-label"
              style={{
                backgroundColor: color,
                color: "white",
              }}
            >
              {initials}
            </div>
          </div>
        );
      })}
    </div>
  );
}