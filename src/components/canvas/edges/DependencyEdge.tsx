"use client";

import * as React from "react";
import { BezierEdge as EdgeComponent, MarkerType } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { CanvasEdgeType } from "@/types/domain";

// Use BezierEdge as the base edge component
const Edge = EdgeComponent as React.ComponentType<any>;

interface DependencyEdgeData {
  edgeType: CanvasEdgeType;
  label?: string;
}

interface DependencyEdgeProps {
  data?: DependencyEdgeData;
  style?: React.CSSProperties;
  markerEnd?: any;
  // Edge passes many props - we accept them all
  [key: string]: any;
}

const edgeTypeStyles: Record<CanvasEdgeType, { color: string; dash?: string; label: string }> = {
  blocks: {
    color: "hsl(var(--destructive))",
    dash: "5,5",
    label: "bloqueia",
  },
  parent_of: {
    color: "hsl(var(--primary))",
    label: "pai de",
  },
  relates_to: {
    color: "hsl(var(--muted-foreground))",
    dash: "3,3",
    label: "relaciona",
  },
  derived_from: {
    color: "hsl(var(--chart-1))",
    dash: "2,2",
    label: "derivado de",
  },
};

const edgeTypeMarkers: Record<CanvasEdgeType, MarkerType> = {
  blocks: MarkerType.ArrowClosed,
  parent_of: MarkerType.ArrowClosed,
  relates_to: MarkerType.Arrow,
  derived_from: MarkerType.ArrowClosed,
};

const DependencyEdgeComponent = React.memo(function DependencyEdgeComponent(props: DependencyEdgeProps) {
  const { data, style = {}, markerEnd, ...rest } = props;
  const edgeType = data?.edgeType || "relates_to";
  const { color, dash, label: defaultLabel } = edgeTypeStyles[edgeType];
  const edgeLabel = data?.label || defaultLabel;
  const markerType = edgeTypeMarkers[edgeType];

  const strokeWidth = 2;
  const strokeDasharray = dash || "none";

  return (
    <Edge
      {...rest}
      markerEnd={markerEnd ?? { type: markerType, color, width: 20, height: 20 }}
      style={{
        stroke: color,
        strokeWidth,
        strokeDasharray,
        ...style,
      }}
    >
      {edgeLabel && (
        <div
          className={cn(
            "absolute pointer-events-none -translate-x-1/2 -translate-y-1/2",
            "bg-background/95 backdrop-blur px-1.5 py-0.5 rounded text-xs font-medium",
            "border border-border/50 shadow-sm"
          )}
          style={{
            color,
            top: "50%",
            left: "50%",
          }}
        >
          {edgeLabel}
        </div>
      )}
    </Edge>
  );
});

DependencyEdgeComponent.displayName = "DependencyEdge";

export const DependencyEdge = DependencyEdgeComponent as any;