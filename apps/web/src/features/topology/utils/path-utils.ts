export interface Point {
  x: number;
  y: number;
}

export function parsePolyline(d: string): Point[] {
  const nums = d.match(/-?[\d.]+/g)?.map(Number);
  if (!nums || nums.length < 2) return [];
  const points: Point[] = [];
  for (let i = 0; i < nums.length - 1; i += 2) {
    points.push({ x: nums[i], y: nums[i + 1] });
  }
  return points;
}

export function polylineLength(points: Point[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

export function polylineEndpoints(
  points: Point[],
): { sx: number; sy: number; ex: number; ey: number } | null {
  if (points.length < 2) return null;
  return {
    sx: points[0].x,
    sy: points[0].y,
    ex: points[points.length - 1].x,
    ey: points[points.length - 1].y,
  };
}
