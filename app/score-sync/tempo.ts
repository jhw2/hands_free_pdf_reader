import type { SavedSong } from "./library";
import type { Worker } from "tesseract.js";

export function detectTempo(text: string) {
  const match = text.replace(/\s+/g, " ").match(/(?:\bBPM\s*[:=]?|[=＝])\s*(\d{2,3})\b/i);
  const value = Number(match?.[1]);
  return value >= 30 && value <= 300 ? value : null;
}

export function resolveTempo(saved: Pick<SavedSong, "bpm" | "bpmSource"> | undefined, detected: number | null) {
  // Legacy saves cannot distinguish a manually chosen 120 from the old fallback; preserve them.
  if (saved && saved.bpmSource !== "default") return { bpm: saved.bpm, bpmSource: saved.bpmSource ?? "manual" };
  return { bpm: detected ?? 120, bpmSource: detected ? "detected" as const : "default" as const };
}

export async function detectImageTempo(header: HTMLCanvasElement): Promise<number | null> {
  let initializing: Promise<Worker> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const { createWorker, PSM } = await import("tesseract.js");
    initializing = createWorker("eng", 1, {
      workerPath: "/ocr/worker.min.js", corePath: "/ocr", langPath: "/ocr",
      workerBlobURL: false, errorHandler: () => {},
    });
    const workerReady = initializing;
    return await Promise.race([
      (async () => {
        const worker = await workerReady;
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
        const { data } = await worker.recognize(header, {}, { blocks: true });
        const candidates = data.blocks?.flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines))
          .filter(line => detectTempo(line.text) !== null) ?? [];
        if (candidates.length !== 1) return null;
        const line = candidates[0];
        const left = Math.max(0, line.bbox.x0 - 10), top = Math.max(0, line.bbox.y0 - 10);
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
        const checked = await worker.recognize(header, { rectangle: {
          left, top, width: Math.min(header.width, line.bbox.x1 + 10) - left,
          height: Math.min(header.height, line.bbox.y1 + 10) - top,
        } });
        const tempo = detectTempo(line.text);
        return detectTempo(checked.data.text) === tempo ? tempo : null;
      })(),
      new Promise<null>(resolve => { timeout = setTimeout(() => resolve(null), 20000); }),
    ]);
  } catch { return null; }
  finally {
    clearTimeout(timeout);
    void initializing?.then(worker => worker.terminate()).catch(() => {});
  }
}
