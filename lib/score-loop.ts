export type MeasureLoop = { startMeasure: number; endMeasure: number; startStep: number; endStep: number };

export function resolveMeasureLoop(order: number[], start: number, end: number): MeasureLoop | null {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return null;
  const startStep = order.indexOf(start - 1);
  const endStep = order.findIndex((measure, step) => step >= startStep && measure === end - 1);
  if (startStep < 0 || endStep < startStep) return null;
  return { startMeasure: start, endMeasure: end, startStep, endStep };
}
