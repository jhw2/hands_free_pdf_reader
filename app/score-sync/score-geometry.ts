import type { PDFPageProxy } from "pdfjs-dist";

type HorizontalLine = { y: number; left: number; right: number };
type VerticalLine = { x: number; top: number; bottom: number };
export type ScoreGeometry = { horizontal: HorizontalLine[]; vertical: VerticalLine[] };
export type StaffGeometry = { lines: number[]; spacing: number; left: number; right: number };

export function readScoreGeometry(operators: Awaited<ReturnType<PDFPageProxy["getOperatorList"]>>, viewport: number[], pdfjs: Pick<typeof import("pdfjs-dist"), "OPS" | "Util">): ScoreGeometry {
  const { OPS, Util } = pdfjs;
  const result: ScoreGeometry = { horizontal: [], vertical: [] };
  let matrix = [...viewport];
  const stack: number[][] = [];
  for (let i = 0; i < operators.fnArray.length; i++) {
    const op = operators.fnArray[i];
    const args = operators.argsArray[i];
    if (op === OPS.save || op === OPS.paintFormXObjectBegin || op === OPS.beginGroup) {
      stack.push([...matrix]);
      const transform = op === OPS.paintFormXObjectBegin ? args[0] : null;
      if (transform) matrix = Util.transform(matrix, transform);
    } else if (op === OPS.restore || op === OPS.paintFormXObjectEnd || op === OPS.endGroup) {
      matrix = stack.pop() ?? matrix;
    } else if (op === OPS.transform) {
      matrix = Util.transform(matrix, args);
    } else if (op === OPS.constructPath && args[0] === OPS.stroke) {
      // PDF.js 6.2 paths are decoded before render() replaces them with Path2D.
      const path = args[1]?.[0];
      if (!path || path.length !== 6 || path[0] !== 0 || path[3] !== 1) continue;
      const point = (x: number, y: number) => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
      const a = point(path[1], path[2]);
      const b = point(path[4], path[5]);
      if (![...a, ...b].every(Number.isFinite)) continue;
      if (Math.abs(a[0] - b[0]) < .25 && Math.abs(a[1] - b[1]) > 3) {
        result.vertical.push({ x: (a[0] + b[0]) / 2, top: Math.min(a[1], b[1]), bottom: Math.max(a[1], b[1]) });
      } else if (Math.abs(a[1] - b[1]) < .25 && Math.abs(a[0] - b[0]) > 3) {
        result.horizontal.push({ y: (a[1] + b[1]) / 2, left: Math.min(a[0], b[0]), right: Math.max(a[0], b[0]) });
      }
    }
  }
  return result;
}

export function findVectorStaves(geometry: ScoreGeometry, width: number): StaffGeometry[] {
  const rows: HorizontalLine[] = [];
  for (const line of geometry.horizontal.filter(line => line.right - line.left > width * .35).sort((a, b) => a.y - b.y)) {
    const previous = rows.at(-1);
    if (!previous || Math.abs(previous.y - line.y) > .5) rows.push({ ...line });
  }
  const staves: StaffGeometry[] = [];
  for (let i = 0; i <= rows.length - 5;) {
    const lines = rows.slice(i, i + 5);
    const spacing = (lines[4].y - lines[0].y) / 4;
    const tolerance = Math.max(.4, spacing * .08);
    if (spacing < 3 || spacing > width * .03 || !lines.every((line, j) => Math.abs(line.y - lines[0].y - spacing * j) <= tolerance)) { i++; continue; }
    const sixth = rows[i + 5];
    if (sixth && Math.abs(sixth.y - lines[0].y - spacing * 5) <= tolerance) lines.push(sixth);
    const left = Math.max(...lines.map(line => line.left));
    const right = Math.min(...lines.map(line => line.right));
    if (right - left > width * .35) staves.push({ lines: lines.map(line => line.y), spacing, left, right });
    i += lines.length;
  }
  return staves;
}

export function vectorBarsForStaff(geometry: ScoreGeometry, staff: StaffGeometry, staves: StaffGeometry[] = [staff]): number[] | null {
  const top = staff.lines[0];
  const bottom = staff.lines.at(-1)!;
  const tolerance = Math.max(.5, staff.spacing * .07);
  const bars = geometry.vertical.filter(line => line.x >= staff.left - tolerance && line.x <= staff.right + tolerance
    && line.top <= top + tolerance && line.bottom >= bottom - tolerance
    && staves.some(other => Math.abs(line.top - other.lines[0]) <= tolerance)
    && staves.some(other => Math.abs(line.bottom - other.lines.at(-1)!) <= tolerance)).map(line => line.x);
  // shortcut: require an isolated staff-end stroke; use image detection for other PDF drawing formats.
  return bars.some(x => Math.abs(x - staff.right) <= staff.spacing * 1.5) ? bars : null;
}
