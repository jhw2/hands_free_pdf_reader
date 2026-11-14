import type { NavigationMeasure } from "./navigation";

export const markerLabels = {
  repeatStart: "도돌이표 시작", repeatEnd: "도돌이표 끝", segno: "세뇨",
  ds: "달세뇨 (D.S.)", dc: "다카포 (D.C.)", fine: "Fine (끝)",
  toCoda: "To Coda", coda: "코다", volta: "1·2번 엔딩",
} as const;
export type NavigationMarker = {
  measure: number;
  kind: keyof typeof markerLabels;
  end?: number;
  count?: number;
  passes?: string;
  mode?: "" | "fine" | "coda";
};
export type NavigationEdits = { measureIds: string[]; markers: NavigationMarker[] };

export function getNavigationMarkers(measures: readonly NavigationMeasure[]) {
  const markers: NavigationMarker[] = [];
  let ending: NavigationMarker | undefined;
  measures.forEach((measure, index) => {
    const number = index + 1;
    for (const kind of ["repeatStart", "segno", "fine", "toCoda", "coda"] as const) {
      if (measure[kind]) markers.push({ measure: number, kind });
    }
    if (measure.repeatEnd) markers.push({ measure: number, kind: "repeatEnd", count: measure.repeatEnd === true ? 2 : measure.repeatEnd });
    if (measure.jump) markers.push({ measure: number, kind: measure.jump, mode: measure.jumpMode ?? "" });
    const passes = [...new Set([...(measure.volta ?? []), ...(measure.voltaPasses ?? [])])].sort((a, b) => a - b).join(",");
    if (!passes) ending = undefined;
    else if (ending && ending.passes === passes && ending.end === index) ending.end = number;
    else {
      ending = { measure: number, kind: "volta", end: number, passes };
      markers.push(ending);
    }
  });
  return markers;
}

export function validateNavigationMarkers(markers: readonly NavigationMarker[], measureCount: number): string | null {
  if (!Array.isArray(markers)) return "저장된 반복 설정을 읽을 수 없어요. 자동 인식으로 되돌려 주세요.";
  const occupied = new Set<string>();
  for (const marker of markers) {
    if (!marker || !Object.hasOwn(markerLabels, marker.kind)) return "기호 종류를 선택해 주세요.";
    if (!Number.isInteger(marker.measure) || marker.measure < 1 || marker.measure > measureCount) return `마디 번호는 1~${measureCount} 사이로 입력해 주세요.`;
    const end = marker.kind === "volta" ? marker.end : marker.measure;
    if (!Number.isInteger(end) || end! < marker.measure || end! > measureCount) return "엔딩의 마지막 마디를 시작 마디 이상으로 입력해 주세요.";
    if (marker.kind === "repeatEnd" && (!Number.isInteger(marker.count) || marker.count! < 2 || marker.count! > 16)) return "반복은 총 2~16회 사이로 입력해 주세요.";
    if (marker.kind === "volta" && (typeof marker.passes !== "string" || !/^\d+(?:\s*,\s*\d+)*$/.test(marker.passes)
      || marker.passes.split(",").some((pass: string) => Number(pass) < 1 || Number(pass) > 16))) return "엔딩 회차는 1~16으로 입력해 주세요. 여러 회차는 쉼표로 구분해요.";
    if ((marker.kind === "ds" || marker.kind === "dc") && !["", "fine", "coda", undefined].includes(marker.mode)) return "달세뇨·다카포의 종료 방식을 선택해 주세요.";
    for (let number = marker.measure; number <= end!; number++) {
      const key = `${number}:${marker.kind === "ds" || marker.kind === "dc" ? "jump" : marker.kind}`;
      if (occupied.has(key)) return `${number}마디의 기호가 중복돼요. 중복된 기호를 삭제해 주세요.`;
      occupied.add(key);
    }
  }
  return null;
}

export function buildNavigationMeasures<T extends NavigationMeasure>(measures: readonly T[], markers: readonly NavigationMarker[]): T[] {
  const result = measures.map(measure => {
    const copy = { ...measure };
    for (const key of ["repeatStart", "repeatEnd", "segno", "fine", "toCoda", "coda", "jump", "jumpMode", "volta", "voltaPasses"] as const) delete copy[key];
    return copy;
  });
  for (const marker of markers) {
    const measure = result[marker.measure - 1];
    if (marker.kind === "repeatEnd") measure.repeatEnd = marker.count;
    else if (marker.kind === "ds" || marker.kind === "dc") { measure.jump = marker.kind; measure.jumpMode = marker.mode || undefined; }
    else if (marker.kind === "volta") {
      for (let index = marker.measure - 1; index < marker.end!; index++) result[index].volta = [...new Set(marker.passes!.split(",").map(Number))];
    } else measure[marker.kind] = true;
  }
  return result;
}

export const navigationEditsMatch = (edits: NavigationEdits, measures: readonly { id: string }[]) =>
  Array.isArray(edits.measureIds) && edits.measureIds.length === measures.length && edits.measureIds.every((id, index) => id === measures[index].id);
