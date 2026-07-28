import {
  BaseEdge,
  type EdgeProps,
  getBezierPath,
  useStore,
} from "@xyflow/react";
import { memo, useMemo } from "react";
import type { ElkEdgeData } from "../types";
import {
  parsePolyline,
  polylineEndpoints,
  polylineLength,
} from "../utils/path-utils";

const zoomSelector = (s: { transform: [number, number, number] }) =>
  s.transform[2] < 0.35;

export const ElkEdge = memo(function ElkEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
  selected,
}: EdgeProps) {
  const edgeData = (data as ElkEdgeData) ?? {};
  const isLowZoom = useStore(zoomSelector);

  const path = edgeData.path;
  const active = edgeData.active !== false;
  const animated =
    edgeData.edgeType === "depends_on" && (edgeData.animated ?? active);

  const points = useMemo(() => (path ? parsePolyline(path) : []), [path]);
  const ep = useMemo(() => polylineEndpoints(points), [points]);

  const { dur, dotCount } = useMemo(() => {
    if (!animated || !path) return { dur: 0, dotCount: 0 };
    const length = polylineLength(points);
    return {
      dur: Math.max(1.5, length / 40),
      dotCount: Math.min(20, Math.max(3, Math.round(length / 25))),
    };
  }, [animated, path, points]);

  let pathString = path;
  if (!pathString) {
    const [bezierPath] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
    pathString = bezierPath;
  }

  const strokeColor = selected ? "#3b82f6" : (style?.stroke ?? "#64748b");
  const strokeWidth = selected ? 3.5 : (style?.strokeWidth ?? 2);
  const opacity = (style?.opacity as number) ?? 1;

  if (isLowZoom && (edgeData.nodeCount ?? 0) > 80) return null;

  return (
    <g opacity={opacity}>
      <BaseEdge
        id={id}
        path={pathString}
        interactionWidth={14}
        style={{
          ...style,
          stroke: strokeColor,
          strokeWidth,
          strokeDasharray: !active ? "4 4" : undefined,
        }}
      />
      {ep && <circle cx={ep.sx} cy={ep.sy} r={3} fill={strokeColor} />}
      {ep && <circle cx={ep.ex} cy={ep.ey} r={3} fill={strokeColor} />}
      {animated &&
        Array.from({ length: dotCount }, (_, i) => {
          const offset = i / dotCount;
          return (
            <circle key={i} r={2} fill={strokeColor} opacity={0.8}>
              <animateMotion
                dur={`${dur}s`}
                repeatCount="indefinite"
                begin={`${offset * dur}s`}
                path={pathString}
              />
            </circle>
          );
        })}
    </g>
  );
});
