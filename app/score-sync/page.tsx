"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { compilePlaybackOrder, type NavigationMeasure } from "./navigation";
import styles from "./score-sync.module.css";

type ScoreTextItem = { text: string; x: number; y: number; width: number; height: number; fontName: string };
type MeasureBox = NavigationMeasure & {
  id: string; page: number; system: number;
  top: number; left: number; width: number; height: number;
  pixelLeft: number; pixelRight: number; staffTop: number; staffBottom: number; spacing: number;
  repeatCountHint?: number;
  voltaGroup?: string;
};
type YoutubePlayer = { getCurrentTime(): number; getDuration(): number; getPlayerState(): number; playVideo(): void; pauseVideo(): void; seekTo(time: number, allowSeekAhead: boolean): void; mute(): void; unMute(): void; destroy(): void };

declare global {
  interface Window {
    YT?: { Player: new (element: HTMLElement, options: Record<string, unknown>) => YoutubePlayer };
    onYouTubeIframeAPIReady?: () => void;
  }
}

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const getVideoId = (value: string) => {
  const trimmed = value.trim();
  if (YOUTUBE_VIDEO_ID.test(trimmed)) return trimmed;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withProtocol);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const youtubeHost = hostname === "youtube.com" || hostname.endsWith(".youtube.com") || hostname === "youtube-nocookie.com" || hostname.endsWith(".youtube-nocookie.com");
    let candidate: string | null = null;
    if (hostname === "youtu.be") candidate = url.pathname.split("/").filter(Boolean)[0] ?? null;
    else if (youtubeHost) {
      const parts = url.pathname.split("/").filter(Boolean);
      candidate = ["shorts", "embed", "live", "v"].includes(parts[0]) ? parts[1] ?? null : url.searchParams.get("v");
    }
    return candidate && YOUTUBE_VIDEO_ID.test(candidate) ? candidate : null;
  } catch { return null; }
};

const youtubeErrorMessage = (code: number) => {
  if (code === 2) return "YouTube 링크의 영상 ID가 올바르지 않아요. 링크를 다시 확인해 주세요. (오류 2)";
  if (code === 5) return "브라우저가 이 영상을 재생하지 못했어요. 같은 링크로 다시 연결해 주세요. (오류 5)";
  if (code === 100) return "삭제됐거나 비공개인 영상이라 재생할 수 없어요. 다른 공개 영상을 사용해 주세요. (오류 100)";
  if (code === 101 || code === 150) return `영상 소유자가 외부 재생을 허용하지 않았어요. 다른 영상 링크를 사용해 주세요. (오류 ${code})`;
  if (code === 153) return "YouTube가 이 페이지의 재생 요청을 확인하지 못했어요. 같은 링크로 다시 연결해 주세요. (오류 153)";
  return `YouTube 재생 중 오류가 발생했어요. 같은 링크로 다시 연결해 주세요. (오류 ${code})`;
};

const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

const detectTempo = (text: string) => {
  const normalized = text.replace(/\s+/g, " ");
  const match = normalized.match(/\bBPM\s*[:=]?\s*(\d{2,3})\b/i) ?? normalized.match(/[=＝]\s*(\d{2,3})\b/);
  if (!match) return null;
  const value = Number(match[1]);
  return value >= 30 && value <= 300 ? value : null;
};

const detectBeatsPerMeasure = (text: string) => {
  // shortcut: only labeled quarter-note meters are safe until the BPM beat unit is recognized.
  const match = text.replace(/\s+/g, " ").match(/(?:time\s*signature|meter|박자)\s*[:=]?\s*([2-9])\s*\/\s*4/i);
  return match ? Number(match[1]) : 4;
};

const SCORE_SYNC_LOCAL_KEY = "score-sync:last-session";
const SCORE_SYNC_DB_NAME = "score-sync-cache";
const SCORE_SYNC_STORE_NAME = "session";
const SCORE_SYNC_PDF_KEY = "last-pdf";

type StoredPdf = { blob: Blob; fileName: string; updatedAt: number };
type StoredMetadata = { youtubeUrl?: string; fileName?: string; bpm?: number; beatsPerMeasure?: number };

const openScoreSyncDb = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(SCORE_SYNC_DB_NAME, 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(SCORE_SYNC_STORE_NAME)) request.result.createObjectStore(SCORE_SYNC_STORE_NAME);
  };
  request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error("IndexedDB is blocked"));
});

const readStoredPdf = async () => {
  const db = await openScoreSyncDb();
  return new Promise<StoredPdf | null>((resolve, reject) => {
    const transaction = db.transaction(SCORE_SYNC_STORE_NAME, "readonly");
    const request = transaction.objectStore(SCORE_SYNC_STORE_NAME).get(SCORE_SYNC_PDF_KEY);
    transaction.oncomplete = () => { resolve((request.result as StoredPdf | undefined) ?? null); db.close(); };
    transaction.onerror = () => { reject(transaction.error); db.close(); };
    transaction.onabort = transaction.onerror;
  });
};

const storePdf = async (blob: Blob, fileName: string) => {
  const db = await openScoreSyncDb();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(SCORE_SYNC_STORE_NAME, "readwrite");
    transaction.objectStore(SCORE_SYNC_STORE_NAME).put({ blob, fileName, updatedAt: Date.now() } satisfies StoredPdf, SCORE_SYNC_PDF_KEY);
    transaction.oncomplete = () => { resolve(); db.close(); };
    transaction.onerror = () => { reject(transaction.error); db.close(); };
    transaction.onabort = transaction.onerror;
  });
};

const readStoredMetadata = (): StoredMetadata => {
  try {
    const value = JSON.parse(localStorage.getItem(SCORE_SYNC_LOCAL_KEY) ?? "{}");
    return value && typeof value === "object" ? value as StoredMetadata : {};
  }
  catch { return {}; }
};

const storeMetadata = (changes: StoredMetadata) => {
  localStorage.setItem(SCORE_SYNC_LOCAL_KEY, JSON.stringify({ ...readStoredMetadata(), ...changes }));
};

const parseNavigationText = (value: string) => {
  const text = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  const mark: NavigationMeasure & { repeatCount?: number } = {};
  const isDs = /(?:\bD\s*\.?\s*S\s*\.?\b|\bDal\s+Segno\b|달\s*세뇨)/i.test(text);
  const isDc = /(?:\bD\s*\.?\s*C\s*\.?\b|\bDa\s+Capo\b|다\s*카포)/i.test(text);
  if (isDs || isDc) {
    mark.jump = isDs ? "ds" : "dc";
    if (/(?:\bal\s+Coda\b|알\s*코다)/i.test(text)) mark.jumpMode = "coda";
    else if (/(?:\bal\s+Fine\b|알\s*피네)/i.test(text)) mark.jumpMode = "fine";
  } else if (/(?:\bTo\s+Coda\b|코다로)/i.test(text)) mark.toCoda = true;

  const raw = value.trim();
  if (/^(?:Segno|세뇨)$/i.test(text) || ["𝄋", "\uE047", "\uF025"].includes(raw)) mark.segno = true;
  if (/^(?:Coda|코다)$/i.test(text) || ["𝄌", "\uE048", "\uF0DE"].includes(raw)) mark.coda = true;
  if (/^(?:Fine|피네)[.!]?$/i.test(text)) mark.fine = true;

  const count = text.match(/^(?:repeat|반복)\s*(\d{1,2})(?:\s*(?:times?|x|회))?[.!]?$/i)
    ?? text.match(/^(\d{1,2})\s*(?:x|×|times?|회)[.!]?$/i)
    ?? text.match(/^(?:x|×)\s*(\d{1,2})[.!]?$/i)
    ?? text.match(/^[<(]\s*(\d{1,2})\s*(?:x|×|times?|회)\s*[>)]$/i)
    ?? text.match(/^[<(]\s*(?:x|×)\s*(\d{1,2})\s*[>)]$/i);
  if (count) {
    const total = Number(count[1]);
    if (total >= 2 && total <= 16) mark.repeatCount = total;
  }
  return mark;
};

const sharedBarPositions = (staffBars: number[][], tolerance: number) => {
  const required = staffBars.length === 1 ? 1 : Math.ceil(staffBars.length * 2 / 3);
  return staffBars.flat().sort((a, b) => a - b).flatMap((candidate) => {
    const matches = staffBars.flatMap((bars) => {
      const closest = bars.reduce<number | null>((found, bar) => Math.abs(bar - candidate) <= tolerance
        && (found === null || Math.abs(bar - candidate) < Math.abs(found - candidate)) ? bar : found, null);
      return closest === null ? [] : [closest];
    });
    if (matches.length < required) return [];
    const sorted = matches.sort((a, b) => a - b);
    return [sorted[Math.floor(sorted.length / 2)]];
  }).filter((bar, index, bars) => index === 0 || bar - bars[index - 1] > tolerance);
};

const hasDoubleBarRuns = (columns: number[], spacing: number) => {
  const runs: number[][] = [];
  columns.forEach((column) => {
    const run = runs.at(-1);
    if (!run || column - run.at(-1)! > 1) runs.push([column]);
    else run.push(column);
  });
  return runs.some((run, index) => {
    const next = runs[index + 1];
    return next && next[0] - run.at(-1)! >= 2 && next[0] - run.at(-1)! <= spacing;
  });
};

const isRepeatDotPair = (densities: number[], bridgeDark: number, bridgeRows: number) =>
  densities.every((density) => density >= .22) && bridgeDark / Math.max(1, bridgeRows) <= .5;

const clusterBarColumns = (columns: number[], maxGap: number) => {
  const runs: number[][] = [];
  [...columns].sort((a, b) => a - b).forEach((column) => {
    const run = runs.at(-1);
    if (!run || column - run.at(-1)! > maxGap) runs.push([column]);
    else run.push(column);
  });
  return runs.map((run) => run[Math.floor(run.length / 2)]);
};

const hasDenseInk = (rows: boolean[], minimumDensity = .72) =>
  rows.length > 0 && rows.filter(Boolean).length / rows.length >= minimumDensity;

const recoverAlignedBars = (bars: number[], rejectedBars: number[], otherSystems: number[][], tolerance: number) => {
  const recovered = rejectedBars.filter((candidate) => otherSystems.filter((systemBars) =>
    systemBars.some((bar) => Math.abs(bar - candidate) <= tolerance)).length >= 2);
  return clusterBarColumns([...bars, ...recovered], tolerance);
};

const restoreSupportedBars = (bars: number[], rejectedBars: number[], supportedBars: number[], tolerance: number) =>
  clusterBarColumns([...bars, ...rejectedBars.filter((candidate) =>
    supportedBars.some((bar) => Math.abs(bar - candidate) <= tolerance))], tolerance);

const applyVoltaPasses = (measures: MeasureBox[]) => {
  const groups = new Map<string, number[]>();
  measures.forEach((measure, index) => {
    if (!measure.voltaGroup) return;
    const indexes = groups.get(measure.voltaGroup) ?? [];
    indexes.push(index);
    groups.set(measure.voltaGroup, indexes);
  });
  let pass = 0;
  let previousEnd = -2;
  for (const indexes of groups.values()) {
    const start = indexes[0];
    const end = indexes.at(-1)!;
    const hasRepeatEnd = indexes.some((index) => Boolean(measures[index].repeatEnd));
    if (!pass || start > previousEnd + 1) {
      if (!hasRepeatEnd) continue;
      pass = 1;
    } else pass++;
    indexes.forEach((index) => { measures[index].volta = [pass]; });
    previousEnd = end;
    if (!hasRepeatEnd) pass = 0;
  }
};

const applyRepeatCountHints = (measures: MeasureBox[]) => {
  measures.forEach((measure, index) => {
    if (!measure.repeatCountHint) return;
    if (measure.repeatEnd) { measure.repeatEnd = measure.repeatCountHint; return; }
    if (!measure.repeatStart) return;
    let nested = 0;
    for (let next = index + 1; next < measures.length; next++) {
      if (measures[next].repeatStart) nested++;
      if (!measures[next].repeatEnd) continue;
      if (nested > 0) { nested--; continue; }
      measures[next].repeatEnd = measure.repeatCountHint;
      break;
    }
  });
};

function findMeasures(canvas: HTMLCanvasElement, page: number, textItems: ScoreTextItem[]): MeasureBox[] {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  const isDark = (x: number, y: number) => {
    const i = (Math.round(y) * width + Math.round(x)) * 4;
    return data[i] + data[i + 1] + data[i + 2] < 590;
  };

  // A real staff is identified only by five long, evenly-spaced horizontal lines.
  // This deliberately excludes titles, lyrics and other dense text regions.
  const rowCandidates: number[] = [];
  for (let y = Math.floor(height * .04); y < height * .97; y++) {
    let dark = 0;
    for (let x = Math.floor(width * .06); x < width * .94; x += 2) if (isDark(x, y)) dark++;
    if (dark > width * .25) rowCandidates.push(y);
  }
  const staffLines: number[] = [];
  rowCandidates.forEach((y) => {
    const last = staffLines.at(-1);
    if (last === undefined || y - last > 3) staffLines.push(y);
    else staffLines[staffLines.length - 1] = (last + y) / 2;
  });

  const staves: Array<{ lines: number[]; spacing: number }> = [];
  for (let i = 0; i <= staffLines.length - 5;) {
    const lines = staffLines.slice(i, i + 5);
    const gaps = lines.slice(1).map((line, index) => line - lines[index]);
    const spacing = gaps.reduce((sum, gap) => sum + gap, 0) / 4;
    const evenlySpaced = spacing >= 3 && spacing < height * .018 && gaps.every((gap) => Math.abs(gap - spacing) < Math.max(2.5, spacing * .28));
    if (evenlySpaced) { staves.push({ lines, spacing }); i += 5; }
    else i++;
  }

  type DetectedStaff = { lines: number[]; coreTop: number; coreBottom: number; spacing: number; left: number; right: number; bars: number[]; rejectedBars: number[] };
  const detectedStaves: DetectedStaff[] = staves.map(({ lines, spacing }) => {
    const coreTop = Math.max(0, Math.round(lines[0]));
    const coreBottom = Math.min(height - 1, Math.round(lines[4]));
    let staffLeft = width * .06;
    let staffRight = width * .94;
    const lineSpans = lines.map((line) => {
      const y = Math.round(line);
      const allowedGap = Math.max(3, Math.round(spacing * 1.2));
      let runStart = -1;
      let lastDark = -1;
      let best: [number, number] = [staffLeft, staffRight];
      let bestLength = 0;
      for (let x = Math.floor(width * .03); x <= width * .97; x++) {
        const dark = isDark(x, y - 1) || isDark(x, y) || isDark(x, y + 1);
        if (!dark) continue;
        if (runStart < 0 || x - lastDark > allowedGap) runStart = x;
        lastDark = x;
        if (lastDark - runStart > bestLength) { best = [runStart, lastDark]; bestLength = lastDark - runStart; }
      }
      return best;
    }).filter(([left, right]) => right - left > width * .45);
    if (lineSpans.length) {
      const lefts = lineSpans.map(([left]) => left).sort((a, b) => a - b);
      const rights = lineSpans.map(([, right]) => right).sort((a, b) => a - b);
      staffLeft = lefts[Math.floor(lefts.length / 2)];
      staffRight = rights[Math.floor(rights.length / 2)];
    }

    const candidates: number[] = [];
    const barSearchStart = staffLeft + spacing * 5;
    for (let x = Math.ceil(barSearchStart); x <= staffRight - spacing; x++) {
      const gapCoverages = lines.slice(0, 4).map((line, lineIndex) => {
        const gapPadding = Math.max(1, Math.round(spacing * .14));
        const startY = Math.ceil(line + gapPadding);
        const endY = Math.floor(lines[lineIndex + 1] - gapPadding);
        let covered = 0;
        for (let y = startY; y <= endY; y++) {
          if (isDark(x - 1, y) || isDark(x, y) || isDark(x + 1, y)) covered++;
        }
        return covered / Math.max(1, endY - startY + 1);
      });
      const totalCoverage = gapCoverages.reduce((sum, coverage) => sum + coverage, 0) / gapCoverages.length;
      if (totalCoverage >= .78 && gapCoverages.every((coverage) => coverage >= .62)) candidates.push(x);
    }
    const isAttachedNoteStem = (bar: number) => {
      const farTail = (direction: -1 | 1) => {
        const start = Math.round((direction < 0 ? coreTop : coreBottom) + direction * spacing * 1.55);
        const end = Math.round((direction < 0 ? coreTop : coreBottom) + direction * spacing * 3.2);
        const rows: boolean[] = [];
        for (let y = start; direction < 0 ? y >= end : y <= end; y += direction) {
          if (y < 0 || y >= height) continue;
          rows.push([-2, -1, 0, 1, 2].some((dx) => isDark(bar + dx, y)));
        }
        return hasDenseInk(rows);
      };
      if (farTail(-1) || farTail(1)) return true;
      let attachedRows = 0;
      const top = Math.max(0, Math.round(coreTop - spacing * 2));
      const bottom = Math.min(height - 1, Math.round(coreBottom + spacing * 2));
      const attachmentWidth = Math.max(5, spacing * .55);
      const attachmentLimit = Math.max(4, Math.round(spacing * .55));
      for (let y = top; y <= bottom; y++) {
        // Staff lines themselves are horizontal attachments for every vertical line.
        if (lines.some((line) => Math.abs(y - line) <= Math.max(2, spacing * .22))) continue;
        let seed: number | null = null;
        for (let dx = -2; dx <= 2; dx++) {
          if (isDark(bar + dx, y)) { seed = bar + dx; break; }
        }
        if (seed === null) continue;
        let inkLeft = seed;
        let inkRight = seed;
        while (inkLeft > bar - spacing * 1.5 && isDark(inkLeft - 1, y)) inkLeft--;
        while (inkRight < bar + spacing * 1.5 && isDark(inkRight + 1, y)) inkRight++;
        if (inkRight - inkLeft + 1 > attachmentWidth) attachedRows++;
        // A notehead or beam stays attached for several rows; an isolated barline does not.
        if (attachedRows >= attachmentLimit) return true;
      }
      return false;
    };
    // Classify each physical stroke before coalescing nearby strokes into a thick
    // or double barline. Coalescing first can move the sample point onto a nearby
    // note stem, either inventing a boundary or discarding the real barline.
    const strokes = clusterBarColumns(candidates, 1);
    const internalStrokes = strokes.filter((x) => x > barSearchStart && x < staffRight - spacing);
    const cleanStrokes = internalStrokes.filter((x) => !isAttachedNoteStem(x));
    const internalBars = clusterBarColumns(cleanStrokes, Math.max(5, spacing * .65));
    const rejectedBars = internalStrokes.filter((x) => !cleanStrokes.includes(x));
    return { lines, coreTop, coreBottom, spacing, left: staffLeft, right: staffRight, bars: internalBars, rejectedBars };
  });

  const hasVerticalBridgeAt = (upper: DetectedStaff, lower: DetectedStaff, x: number) => {
    const gapTop = Math.ceil(upper.coreBottom);
    const gapBottom = Math.floor(lower.coreTop);
    const gapHeight = gapBottom - gapTop;
    if (gapHeight <= 2) return true;
    let covered = 0;
    let longestRun = 0;
    let run = 0;
    let smallGap = 0;
    for (let y = gapTop; y <= gapBottom; y++) {
      const dark = isDark(x - 1, y) || isDark(x, y) || isDark(x + 1, y);
      if (dark) { covered++; run += smallGap + 1; smallGap = 0; longestRun = Math.max(longestRun, run); }
      else if (run > 0 && smallGap < 2) smallGap++;
      else { run = 0; smallGap = 0; }
    }
    return covered / gapHeight >= .68 || longestRun / gapHeight >= .78;
  };
  const hasVerticalConnector = (upper: DetectedStaff, lower: DetectedStaff) => {
    const spacing = Math.max(upper.spacing, lower.spacing);
    const xTolerance = Math.max(spacing * 2.2, width * .008);
    if (Math.abs(upper.left - lower.left) > xTolerance * 1.8) return false;
    const startX = Math.max(1, Math.floor(Math.min(upper.left, lower.left) - xTolerance));
    const endX = Math.min(width - 2, Math.ceil(Math.max(upper.left, lower.left) + xTolerance));
    return Array.from({ length: endX - startX + 1 }, (_, index) => startX + index)
      .some((x) => hasVerticalBridgeAt(upper, lower, x));
  };
  const groups: DetectedStaff[][] = [];
  detectedStaves.forEach((staff) => {
    const group = groups.at(-1);
    const previous = group?.at(-1);
    if (group && previous && hasVerticalConnector(previous, staff)) { group.push(staff); return; }
    groups.push([staff]);
  });
  groups.forEach((group) => {
    if (group.length < 2) return;
    const spacing = group.reduce((sum, staff) => sum + staff.spacing, 0) / group.length;
    const tolerance = Math.max(2, spacing * .4);
    const rawCommonBars = sharedBarPositions(group.map((staff) => [...staff.bars, ...staff.rejectedBars]), tolerance);
    // Connected barlines can look like long stems inside each staff; require one clean witness and a bridge across the gap.
    const connectedBars = rawCommonBars.filter((bar) => group.some((staff) =>
      staff.bars.some((cleanBar) => Math.abs(cleanBar - bar) <= tolerance)) && group.slice(0, -1).some((staff, index) =>
      hasVerticalBridgeAt(staff, group[index + 1], bar)));
    group.forEach((staff) => {
      staff.bars = restoreSupportedBars(staff.bars, staff.rejectedBars, connectedBars, tolerance);
    });
  });
  const originalGroupBars = groups.map((group) => group.flatMap((staff) => staff.bars));
  groups.forEach((group, groupIndex) => {
    const otherSystems = originalGroupBars.filter((_, index) => index !== groupIndex);
    group.forEach((staff) => {
      staff.bars = recoverAlignedBars(staff.bars, staff.rejectedBars, otherSystems, Math.max(2, staff.spacing * .4));
    });
  });

  const hasRepeatDots = (group: DetectedStaff[], boundary: number, side: -1 | 1) => {
    let matchedStaves = 0;
    group.forEach((staff) => {
      const radius = Math.max(1, Math.round(staff.spacing * .32));
      const barColumns: number[] = [];
      for (let x = Math.floor(boundary - staff.spacing * 1.6); x <= Math.ceil(boundary + staff.spacing * 1.6); x++) {
        let dark = 0;
        let checked = 0;
        for (let y = Math.ceil(staff.coreTop); y <= Math.floor(staff.coreBottom); y++) {
          if (staff.lines.some((line) => Math.abs(y - line) <= Math.max(1, staff.spacing * .16))) continue;
          checked++;
          if (isDark(x, y)) dark++;
        }
        if (dark / Math.max(1, checked) >= .62) barColumns.push(x);
      }
      const hasDoubleBar = hasDoubleBarRuns(barColumns, staff.spacing);
      const yTargets = [(staff.lines[1] + staff.lines[2]) / 2, (staff.lines[2] + staff.lines[3]) / 2];
      const start = boundary + side * staff.spacing * .45;
      const end = boundary + side * staff.spacing * 2.5;
      const minX = Math.max(radius, Math.floor(Math.min(start, end)));
      const maxX = Math.min(width - radius - 1, Math.ceil(Math.max(start, end)));
      let pairFound = false;
      for (let x = minX; x <= maxX && !pairFound; x++) {
        const densities = yTargets.map((centerY) => {
          let dark = 0;
          let total = 0;
          for (let py = Math.round(centerY) - radius; py <= Math.round(centerY) + radius; py++) {
            for (let px = x - radius; px <= x + radius; px++) { total++; if (isDark(px, py)) dark++; }
          }
          return dark / Math.max(1, total);
        });
        let bridgeDark = 0;
        let bridgeRows = 0;
        for (let py = Math.round(yTargets[0]) + radius; py <= Math.round(yTargets[1]) - radius; py++) {
          if (Math.abs(py - staff.lines[2]) <= Math.max(1, staff.spacing * .16)) continue;
          bridgeRows++;
          for (let px = x - radius; px <= x + radius; px++) {
            if (!isDark(px, py)) continue;
            bridgeDark++;
            break;
          }
        }
        pairFound = isRepeatDotPair(densities, bridgeDark, bridgeRows);
      }
      if (pairFound && hasDoubleBar) matchedStaves++;
    });
    return matchedStaves >= Math.max(1, Math.ceil(group.length / 2));
  };

  const measures: MeasureBox[] = [];
  groups.forEach((group, groupIndex) => {
    const first = group[0];
    const last = group[group.length - 1];
    const spacing = group.reduce((sum, staff) => sum + staff.spacing, 0) / group.length;
    // Real barlines share virtually the same x position on every staff in a connected
    // system. A wider tolerance can accidentally pair aligned melody/drum note stems.
    const tolerance = Math.max(2, spacing * .4);
    const left = group.reduce((sum, staff) => sum + staff.left, 0) / group.length;
    const right = group.reduce((sum, staff) => sum + staff.right, 0) / group.length;
    const commonBars = sharedBarPositions(group.map((staff) => staff.bars), tolerance);
    const rawBoundaries = [left, ...commonBars, right].sort((a, b) => a - b);
    const rawWidths = rawBoundaries.slice(1).map((boundary, index) => boundary - rawBoundaries[index]);
    const sortedWidths = [...rawWidths].sort((a, b) => a - b);
    const referenceWidth = sortedWidths[Math.floor(sortedWidths.length / 2)] ?? 0;
    let firstBoundary = 0;
    let lastBoundary = rawBoundaries.length - 1;
    // Clef/key/repeat preambles and a trailing key change can sit between the staff
    // edge and the first/last real barline. Do not turn those short edge fragments
    // into extra measures.
    if (rawWidths.length >= 3 && rawWidths[0] < referenceWidth * .45) firstBoundary++;
    if (rawWidths.length >= 3 && rawWidths.at(-1)! < referenceWidth * .45) lastBoundary--;
    const boundaries = rawBoundaries.slice(firstBoundary, lastBoundary + 1);
    const boundaryMarks = boundaries.map((boundary) => ({
      startsRepeat: hasRepeatDots(group, boundary, 1),
      endsRepeat: hasRepeatDots(group, boundary, -1),
    }));
    const groupMeasures: MeasureBox[] = [];
    for (let i = 0; i < boundaries.length - 1; i++) {
      const measureLeft = boundaries[i];
      const measureRight = boundaries[i + 1];
      if (measureRight - measureLeft < Math.max(width * .035, spacing * 3)) continue;
      groupMeasures.push({
        id: `${page}-${groupIndex}-${i}`,
        page,
        system: groupIndex,
        top: Math.max(0, first.coreTop - spacing * 2.2) / height * 100,
        left: measureLeft / width * 100,
        width: (measureRight - measureLeft) / width * 100,
        height: Math.min(height - first.coreTop, last.coreBottom - first.coreTop + spacing * 4.4) / height * 100,
        pixelLeft: measureLeft,
        pixelRight: measureRight,
        staffTop: first.coreTop,
        staffBottom: last.coreBottom,
        spacing,
        ...(boundaryMarks[i].startsRepeat ? { repeatStart: true } : {}),
        ...(boundaryMarks[i + 1].endsRepeat ? { repeatEnd: true } : {}),
      });
    }

    const measureAt = (x: number) => groupMeasures.find((measure) => x >= measure.pixelLeft && x < measure.pixelRight)
      ?? groupMeasures.find((measure) => x >= measure.pixelLeft - spacing * .3 && x < measure.pixelRight + spacing * .3)
      ?? groupMeasures.reduce<MeasureBox | null>((closest, measure) => {
        const distance = Math.min(Math.abs(x - measure.pixelLeft), Math.abs(x - measure.pixelRight));
        if (!closest) return measure;
        const closestDistance = Math.min(Math.abs(x - closest.pixelLeft), Math.abs(x - closest.pixelRight));
        return distance < closestDistance ? measure : closest;
      }, null);
    const measureBefore = (x: number) => {
      const before = [...groupMeasures].reverse().find((measure) => measure.pixelRight <= x + spacing * 1.5);
      return before && Math.abs(before.pixelRight - x) <= spacing * 2 ? before : measureAt(x);
    };

    const voltaBracketRight = (measure: MeasureBox) => {
      const startY = Math.max(1, Math.floor(first.coreTop - spacing * 6.5));
      const endY = Math.min(height - 2, Math.ceil(first.coreTop - spacing * .6));
      let bestRight = 0;
      for (let y = startY; y <= endY; y++) {
        const hookRight = measure === groupMeasures[0] ? measure.pixelLeft + spacing * 8 : measure.pixelLeft + spacing;
        for (let hookX = Math.floor(measure.pixelLeft - spacing); hookX <= Math.ceil(hookRight); hookX++) {
          if (hookX < 1 || hookX >= width - 1) continue;
          let vertical = 0;
          const verticalEnd = Math.min(first.coreTop, y + spacing * 2.2);
          for (let py = y; py <= verticalEnd; py++) if (isDark(hookX - 1, py) || isDark(hookX, py) || isDark(hookX + 1, py)) vertical++;
          if (vertical / Math.max(1, verticalEnd - y + 1) < .48) continue;
          let lastDark = hookX;
          let gap = 0;
          for (let x = hookX; x <= Math.min(width - 2, right + spacing); x++) {
            const dark = isDark(x, y - 1) || isDark(x, y) || isDark(x, y + 1);
            if (dark) { lastDark = x; gap = 0; }
            else if (++gap > Math.max(3, spacing * .45)) break;
          }
          if (lastDark - hookX >= Math.max(spacing * 3, (measure.pixelRight - measure.pixelLeft) * .32)) bestRight = Math.max(bestRight, lastDark);
        }
      }
      return bestRight || null;
    };

    groupMeasures.forEach((measure, measureIndex) => {
      const bracketRight = voltaBracketRight(measure);
      if (!bracketRight) return;
      const covered = groupMeasures.filter((candidate) => candidate.pixelRight > measure.pixelLeft && candidate.pixelLeft < bracketRight - spacing * .25);
      (covered.length ? covered : [measure]).forEach((candidate) => { candidate.voltaGroup = `${page}-${groupIndex}-${measureIndex}`; });
    });

    const nearbyText = textItems.filter((item) => {
      const centerY = item.y + item.height / 2;
      return item.x + item.width >= left - spacing * 3 && item.x <= right + spacing * 3
        && centerY >= first.coreTop - spacing * 4.5 && centerY <= last.coreBottom + spacing * 3.5;
    });
    const rows: ScoreTextItem[][] = [];
    [...nearbyText].sort((a, b) => a.y - b.y || a.x - b.x).forEach((item) => {
      const baseline = item.y + item.height;
      const row = rows.find((candidate) => Math.abs((candidate[0].y + candidate[0].height) - baseline) <= Math.max(3, spacing * .5));
      if (row) row.push(item); else rows.push([item]);
    });
    const phrases: ScoreTextItem[] = [...nearbyText];
    rows.forEach((row) => {
      row.sort((a, b) => a.x - b.x);
      for (let start = 0; start < row.length; start++) {
        let text = row[start].text;
        let rightEdge = row[start].x + row[start].width;
        let maxHeight = row[start].height;
        for (let end = start + 1; end < Math.min(row.length, start + 4); end++) {
          if (row[end].x - rightEdge > Math.max(spacing * 3, maxHeight * 2.5)) break;
          text += ` ${row[end].text}`;
          rightEdge = row[end].x + row[end].width;
          maxHeight = Math.max(maxHeight, row[end].height);
          phrases.push({ ...row[start], text, width: rightEdge - row[start].x, height: maxHeight });
        }
      }
    });

    const applied = new Set<string>();
    phrases.forEach((phrase) => {
      const mark = parseNavigationText(phrase.text);
      if (!mark.jump && !mark.toCoda && !mark.segno && !mark.coda && !mark.fine && !mark.repeatCount) return;
      const key = `${phrase.x}:${phrase.y}:${mark.jump ?? ""}:${mark.toCoda ? "t" : ""}:${mark.segno ? "s" : ""}:${mark.coda ? "c" : ""}:${mark.fine ? "f" : ""}:${mark.repeatCount ?? ""}`;
      if (applied.has(key)) return;
      applied.add(key);
      const anchorX = mark.toCoda ? phrase.x : phrase.x + phrase.width / 2;
      const measure = mark.toCoda ? measureBefore(anchorX) : measureAt(anchorX);
      if (!measure) return;
      if (mark.jump) { measure.jump = mark.jump; measure.jumpMode = mark.jumpMode; }
      if (mark.toCoda) measure.toCoda = true;
      if (mark.segno) measure.segno = true;
      if (mark.coda) measure.coda = true;
      if (mark.fine) measure.fine = true;
      if (mark.repeatCount) {
        if (measure.repeatEnd) measure.repeatEnd = mark.repeatCount;
        else if (measure.repeatStart) measure.repeatCountHint = mark.repeatCount;
      }
    });

    measures.push(...groupMeasures);
  });
  return measures;
}

export default function ScoreSyncPage() {
  const [fileName, setFileName] = useState("");
  const [pages, setPages] = useState<string[]>([]);
  const [measures, setMeasures] = useState<MeasureBox[]>([]);
  const [url, setUrl] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [playerGeneration, setPlayerGeneration] = useState(0);
  const [duration, setDuration] = useState(240);
  const [offset, setOffset] = useState(0);
  const [bpm, setBpm] = useState(120);
  const [beatsPerMeasure, setBeatsPerMeasure] = useState(4);
  const [tempoDetected, setTempoDetected] = useState(false);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [countdownMeasure, setCountdownMeasure] = useState<number | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const playerHostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YoutubePlayer | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  const playerReadyRef = useRef(false);
  const desiredPlayingRef = useRef(false);
  const lastProgressRef = useRef({ time: 0, changedAt: 0 });
  const lastRecoveryRef = useRef(0);
  const pollFailuresRef = useRef(0);
  const lastSelectedTargetRef = useRef(0);
  const pdfLoadVersionRef = useRef(0);

  const navigation = useMemo(() => compilePlaybackOrder(measures), [measures]);
  const playbackOrder = useMemo(() => navigation.valid && navigation.order.length
    ? navigation.order
    : measures.map((_, index) => index), [measures, navigation]);
  const playbackStep = useMemo(() => {
    if (!playbackOrder.length) return -1;
    const measureDuration = (60 / Math.max(1, bpm)) * beatsPerMeasure;
    const scoreTime = Math.max(0, time - offset + .06);
    return Math.max(0, Math.min(playbackOrder.length - 1, Math.floor(scoreTime / measureDuration)));
  }, [beatsPerMeasure, bpm, offset, playbackOrder.length, time]);
  const activeIndex = playbackStep >= 0 ? playbackOrder[playbackStep] ?? -1 : -1;

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!playerRef.current || !playerReadyRef.current) return;
      try {
        const now = performance.now();
        const next = playerRef.current.getCurrentTime();
        const actualDuration = playerRef.current.getDuration();
        const state = playerRef.current.getPlayerState();
        pollFailuresRef.current = 0;
        if (Math.abs(next - lastProgressRef.current.time) > .015) lastProgressRef.current = { time: next, changedAt: now };
        setTime(next || 0);
        setPlaying(state === 1);
        if (actualDuration > 0) setDuration((current) => current === 240 ? Math.round(actualDuration) : current);

        const shouldRecover = desiredPlayingRef.current && countdownTimerRef.current === null && state !== 0;
        if (shouldRecover && now - lastRecoveryRef.current > 900) {
          if (state === -1 || state === 2 || state === 5) {
            lastRecoveryRef.current = now;
            playerRef.current.playVideo();
          } else if ((state === 1 && now - lastProgressRef.current.changedAt > 1800) || (state === 3 && now - lastProgressRef.current.changedAt > 5000)) {
            lastRecoveryRef.current = now;
            playerRef.current.seekTo(next + .03, true);
            playerRef.current.playVideo();
          }
        }
      } catch {
        pollFailuresRef.current += 1;
        if (pollFailuresRef.current === 20) setError("재생 연결이 불안정해요. 잠시 후 재생 버튼을 다시 눌러 주세요.");
      }
    }, 60);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (activeIndex < 0) return;
    const current = document.querySelector<HTMLElement>('[data-current="true"]');
    if (!current) return;
    const rect = current.getBoundingClientRect();
    if (rect.top < 70 || rect.bottom > window.innerHeight - 12) current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIndex]);

  useEffect(() => {
    const container = playerHostRef.current;
    if (!videoId || !container) return;
    let disposed = false;
    let createdPlayer: YoutubePlayer | null = null;
    let apiTimeout = 0;
    playerRef.current?.destroy();
    playerRef.current = null;
    container.replaceChildren();
    playerReadyRef.current = false;
    desiredPlayingRef.current = false;
    setPlayerReady(false);
    const create = () => {
      if (disposed || createdPlayer || !window.YT?.Player) return;
      const mount = document.createElement("div");
      container.replaceChildren(mount);
      const Player = window.YT.Player;
      createdPlayer = new Player(mount, {
        width: "320",
        height: "200",
        videoId,
        playerVars: { rel: 0, playsinline: 1, enablejsapi: 1, origin: window.location.origin },
        events: {
          onReady: () => {
            if (disposed) return;
            playerReadyRef.current = true;
            lastProgressRef.current = { time: 0, changedAt: performance.now() };
            setPlayerReady(true);
          },
          onStateChange: (event: { data: number }) => {
            if (disposed) return;
            setPlaying(event.data === 1);
            if (event.data === 0) desiredPlayingRef.current = false;
          },
          onError: (event: { data: number }) => {
            if (disposed) return;
            playerReadyRef.current = false;
            desiredPlayingRef.current = false;
            setPlayerReady(false);
            setError(youtubeErrorMessage(event.data));
          },
          onAutoplayBlocked: () => {
            if (disposed) return;
            desiredPlayingRef.current = false;
            setPlaying(false);
            setError("브라우저가 4초 후 자동 재생을 차단했어요. 위의 재생 버튼을 한 번 눌러 주세요.");
          },
        },
      });
      playerRef.current = createdPlayer;
    };
    if (window.YT?.Player) create();
    else {
      window.onYouTubeIframeAPIReady = create;
      let script = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]');
      if (!script) {
        script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        script.addEventListener("error", () => {
          if (!disposed) setError("YouTube 연결 모듈을 불러오지 못했어요. 광고 차단 설정이나 네트워크를 확인해 주세요.");
        }, { once: true });
        document.head.appendChild(script);
      }
      apiTimeout = window.setTimeout(() => {
        if (!disposed && !window.YT?.Player) setError("YouTube 연결 시간이 초과됐어요. 광고 차단 설정이나 네트워크를 확인해 주세요.");
      }, 12000);
    }
    return () => {
      disposed = true;
      if (apiTimeout) window.clearTimeout(apiTimeout);
      if (playerRef.current === createdPlayer) playerRef.current = null;
      createdPlayer?.destroy();
      container.replaceChildren();
      if (countdownTimerRef.current !== null) {
        window.clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    };
  }, [playerGeneration, videoId]);

  const openPdfBlob = async (blob: Blob, nextFileName: string, shouldPersist: boolean, requestedVersion?: number) => {
    const loadVersion = requestedVersion ?? ++pdfLoadVersionRef.current;
    if (loadVersion !== pdfLoadVersionRef.current) return;
    setLoading(true); setError(""); setPages([]); setMeasures([]); setFileName(nextFileName);
    if (shouldPersist) { setBpm(120); setBeatsPerMeasure(4); setTempoDetected(false); }
    try {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const pdf = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;
      const nextPages: string[] = []; const nextMeasures: MeasureBox[] = []; const scoreText: string[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2, 1200 / base.width) });
        const pageTextItems = textContent.items.flatMap((raw: unknown): ScoreTextItem[] => {
          const item = raw as { str?: unknown; transform?: number[]; width?: number; height?: number; fontName?: string };
          if (typeof item.str !== "string" || !Array.isArray(item.transform)) return [];
          scoreText.push(item.str);
          const transform = pdfjs.Util.transform(viewport.transform, item.transform);
          const textHeight = Math.max(1, Math.hypot(transform[2], transform[3]) || (item.height ?? 0) * viewport.scale);
          return [{
            text: item.str,
            x: transform[4],
            y: transform[5] - textHeight,
            width: Math.abs(item.width ?? 0) * viewport.scale,
            height: textHeight,
            fontName: item.fontName ?? "",
          }];
        });
        const canvas = document.createElement("canvas"); canvas.width = viewport.width; canvas.height = viewport.height;
        const context = canvas.getContext("2d"); if (!context) continue;
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        nextMeasures.push(...findMeasures(canvas, pageNumber, pageTextItems));
        nextPages.push(canvas.toDataURL("image/jpeg", .9));
      }
      if (loadVersion !== pdfLoadVersionRef.current) return;
      applyRepeatCountHints(nextMeasures);
      applyVoltaPasses(nextMeasures);
      const detectedBpm = detectTempo(scoreText.join(" "));
      const detectedBeats = detectBeatsPerMeasure(scoreText.join(" "));
      if (detectedBpm) { setBpm(detectedBpm); setTempoDetected(true); }
      else setTempoDetected(false);
      setBeatsPerMeasure(detectedBeats);
      setPages(nextPages); setMeasures(nextMeasures);
      if (!nextMeasures.length) setError("오선 5개를 정확히 확인할 수 없어요. 더 선명한 악보 PDF를 사용해 주세요.");
      if (shouldPersist) {
        try {
          await storePdf(blob, nextFileName);
          storeMetadata({ fileName: nextFileName, ...(detectedBpm ? { bpm: detectedBpm } : {}), beatsPerMeasure: detectedBeats });
        } catch {
          setError("악보는 열었지만 브라우저 저장 공간이 부족해 자동 저장하지 못했어요.");
        }
      }
    } catch { setError("PDF를 읽지 못했어요. 다른 악보 파일로 다시 시도해 주세요."); }
    finally { if (loadVersion === pdfLoadVersionRef.current) setLoading(false); }
  };

  const loadPdf = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await openPdfBlob(file, file.name, true);
    event.target.value = "";
  };

  useEffect(() => {
    const restoreVersion = ++pdfLoadVersionRef.current;
    const restore = async () => {
      const metadata = readStoredMetadata();
      if (metadata.youtubeUrl) {
        const storedVideoId = getVideoId(metadata.youtubeUrl);
        if (storedVideoId) { setUrl(metadata.youtubeUrl); setVideoId(storedVideoId); }
      }
      if (metadata.bpm && metadata.bpm >= 30 && metadata.bpm <= 300) setBpm(metadata.bpm);
      if (metadata.beatsPerMeasure && metadata.beatsPerMeasure >= 2 && metadata.beatsPerMeasure <= 12) setBeatsPerMeasure(metadata.beatsPerMeasure);
      try {
        const storedPdf = await readStoredPdf();
        if (restoreVersion !== pdfLoadVersionRef.current) return;
        if (storedPdf?.blob) await openPdfBlob(storedPdf.blob, storedPdf.fileName || metadata.fileName || "저장된 악보.pdf", false, restoreVersion);
      } catch {
        if (restoreVersion === pdfLoadVersionRef.current) setError("저장된 악보를 다시 불러오지 못했어요. PDF를 다시 선택해 주세요.");
      }
    };
    void restore();
  }, []);

  const attachYoutube = () => {
    const id = getVideoId(url);
    if (!id) { setError("올바른 유튜브 링크를 입력해 주세요."); return; }
    setError("");
    setTime(0);
    setDuration(240);
    lastSelectedTargetRef.current = 0;
    try { storeMetadata({ youtubeUrl: url.trim() }); }
    catch { setError("링크를 연결했지만 브라우저 저장 공간에 저장하지 못했어요."); }
    setVideoId(id);
    setPlayerGeneration((generation) => generation + 1);
  };

  const jumpToMeasure = (index: number) => {
    if (!playerRef.current) { setError("먼저 YouTube 링크를 연결해 주세요."); return; }
    if (countdownTimerRef.current !== null) window.clearInterval(countdownTimerRef.current);
    const secondsPerMeasure = (60 / Math.max(1, bpm)) * beatsPerMeasure;
    const currentStep = Math.max(0, Math.floor(Math.max(0, time - offset) / secondsPerMeasure));
    const nextOccurrence = playbackOrder.findIndex((measure, step) => step >= currentStep && measure === index);
    const targetStep = nextOccurrence >= 0 ? nextOccurrence : Math.max(0, playbackOrder.indexOf(index));
    const target = offset + targetStep * secondsPerMeasure;
    desiredPlayingRef.current = false;
    lastSelectedTargetRef.current = target;
    // Prime playback while this click still carries browser user activation.
    playerRef.current.mute();
    playerRef.current.seekTo(target, true);
    playerRef.current.playVideo();
    window.setTimeout(() => playerRef.current?.pauseVideo(), 80);
    setTime(target);
    setPlaying(false);
    setError("");
    setCountdown(4);
    setCountdownMeasure(index);
    const startedAt = performance.now();
    countdownTimerRef.current = window.setInterval(() => {
      const elapsed = performance.now() - startedAt;
      if (elapsed >= 4000) {
        if (countdownTimerRef.current !== null) window.clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
        setCountdown(null);
        setCountdownMeasure(null);
        playerRef.current?.seekTo(target, true);
        playerRef.current?.unMute();
        desiredPlayingRef.current = true;
        lastProgressRef.current = { time: target, changedAt: performance.now() };
        playerRef.current?.playVideo();
        return;
      }
      setCountdown(4 - Math.floor(elapsed / 1000));
    }, 100);
  };

  const togglePlayback = () => {
    if (!playerRef.current) return;
    if (countdownTimerRef.current !== null) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
      setCountdown(null);
      setCountdownMeasure(null);
    }
    if (playing) {
      desiredPlayingRef.current = false;
      playerRef.current.pauseVideo();
    } else {
      desiredPlayingRef.current = true;
      const currentTime = playerRef.current.getCurrentTime();
      if (playerRef.current.getPlayerState() === 0) playerRef.current.seekTo(lastSelectedTargetRef.current, true);
      lastProgressRef.current = { time: currentTime, changedAt: performance.now() };
      playerRef.current.playVideo();
    }
  };

  const updateBpm = (value: number) => {
    const next = Math.max(30, Math.min(300, value || 30));
    setBpm(next);
    setTempoDetected(false);
    try { storeMetadata({ bpm: next }); } catch { /* Playback can continue without persistence. */ }
  };

  const updateBeatsPerMeasure = (value: number) => {
    setBeatsPerMeasure(value);
    try { storeMetadata({ beatsPerMeasure: value }); } catch { /* Playback can continue without persistence. */ }
  };

  return <main className={styles.shell}>
    <div className={styles.hiddenPlayer} aria-hidden="true">{videoId ? <div ref={playerHostRef}/> : null}</div>
    <header className={styles.toolbar}>
      <label className={styles.fileButton}>{fileName || "PDF 열기"}<input type="file" accept="application/pdf" onChange={loadPdf}/></label>
      <div className={styles.youtubeInput}><input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && attachYoutube()} placeholder="YouTube 링크" aria-label="유튜브 링크"/><button onClick={attachYoutube}>연결</button></div>
      <button className={styles.playButton} onClick={togglePlayback} disabled={!playerReady} aria-label={playing ? "일시 정지" : "재생"}>{playing ? "Ⅱ" : "▶"}</button>
      <label className={styles.tempoControl}><span>{tempoDetected ? "감지 BPM" : "BPM"}</span><input type="number" min="30" max="300" value={bpm} onChange={(event) => updateBpm(Number(event.target.value))}/></label>
      <label className={styles.meterControl}><span>박자</span><select value={beatsPerMeasure} onChange={(event) => updateBeatsPerMeasure(Number(event.target.value))}><option value={2}>2박</option><option value={3}>3박</option><option value={4}>4박</option><option value={6}>6박</option></select></label>
      <div className={styles.progress}><span style={{ width: `${Math.min(100, time / duration * 100)}%` }}/></div>
      <span className={styles.clock}>{formatTime(time)} / {formatTime(duration)}</span>
      <label className={styles.offset}>시작 <input type="range" min="0" max={Math.max(30, duration / 2)} value={offset} onChange={(e) => setOffset(Number(e.target.value))}/><output>{formatTime(offset)}</output></label>
      <span className={styles.measureCount}>{activeIndex >= 0 ? `${activeIndex + 1}마디 · ${playbackStep + 1}/${playbackOrder.length}` : measures.length ? `${measures.length}마디` : ""}</span>
    </header>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!error && measures.length > 0 && !navigation.valid && <p className={styles.warning} role="status">반복 경로를 확정하지 못해 악보 순서대로 표시합니다.</p>}
    <section className={styles.scorePanel}>
      <div className={styles.pages}>
        {loading ? <div className={styles.empty}><span className={styles.spinner}/><h3>마디선을 찾고 있어요</h3></div> : !pages.length ? <div className={styles.empty}><div className={styles.note}>♩</div><h3>PDF 악보를 열어주세요</h3></div> : pages.map((src, pageIndex) => <div className={styles.page} key={src}><img src={src} alt={`악보 ${pageIndex + 1}페이지`}/>{measures.map((box, index) => box.page === pageIndex + 1 && <button key={box.id} data-current={index === activeIndex ? "true" : undefined} onClick={() => jumpToMeasure(index)} className={`${styles.system} ${index === activeIndex ? styles.active : ""}`} style={{ top: `${box.top}%`, left: `${box.left}%`, width: `${box.width}%`, height: `${box.height}%` }} aria-label={`${index + 1}번 마디로 이동`}><span>{index === activeIndex ? "현재" : index + 1}</span>{countdown !== null && countdownMeasure === index ? <b className={styles.measureCountdown} role="timer" aria-live="assertive">{countdown}</b> : null}</button>)}</div>)}
      </div>
    </section>
  </main>;
}
