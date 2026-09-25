import type { MaharFrameShape } from "@/lib/mahar-types";

export interface Point {
  x: number;
  y: number;
}

function rectanglePoints(width: number, height: number): Point[] {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
}

function ovalPoints(width: number, height: number, segments = 64): Point[] {
  const cx = width / 2;
  const cy = height / 2;
  const points: Point[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points.push({ x: cx + cx * Math.cos(angle), y: cy + cy * Math.sin(angle) });
  }
  return points;
}

function circlePoints(width: number, height: number, segments = 64): Point[] {
  const diameter = Math.min(width, height);
  const offsetX = (width - diameter) / 2;
  const offsetY = (height - diameter) / 2;
  return ovalPoints(diameter, diameter, segments).map((p) => ({ x: p.x + offsetX, y: p.y + offsetY }));
}

/** Flat-top hexagon inscribed in the width x height bounding box. */
function hexagonPoints(width: number, height: number): Point[] {
  const cx = width / 2;
  const cy = height / 2;
  const points: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = -Math.PI / 2 + i * (Math.PI / 3);
    points.push({ x: cx + cx * Math.cos(angle), y: cy + cy * Math.sin(angle) });
  }
  return points;
}

/** The plaque's own cut-line, as a closed polygon in local (0,0)-origin space, sized to width x height. */
export function maharShapePoints(shape: MaharFrameShape, width: number, height: number): Point[] {
  switch (shape) {
    case "oval":
      return ovalPoints(width, height);
    case "circle":
      return circlePoints(width, height);
    case "hexagon":
      return hexagonPoints(width, height);
    case "rectangle":
    default:
      return rectanglePoints(width, height);
  }
}

/** Same polygon, as an SVG path `d` string — for the live preview/canvas. */
export function pointsToSvgPath(points: Point[]): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  return `M ${first.x} ${first.y} ${rest.map((p) => `L ${p.x} ${p.y}`).join(" ")} Z`;
}
