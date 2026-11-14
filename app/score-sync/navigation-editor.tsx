"use client";

import { useState } from "react";
import { compilePlaybackOrder, type NavigationMeasure } from "./navigation";
import { buildNavigationMeasures, getNavigationMarkers, markerLabels, navigationEditsMatch, validateNavigationMarkers, type NavigationEdits, type NavigationMarker } from "./navigation-edits";
import styles from "./score-sync.module.css";

type Measure = NavigationMeasure & { id: string };
export default function NavigationEditor({ measures, saved, disabled, onSave }: {
  measures: Measure[]; saved: NavigationEdits | null; disabled: boolean;
  onSave: (edits: NavigationEdits | null) => Promise<boolean>;
}) {
  const [markers, setMarkers] = useState<NavigationMarker[]>(() => saved?.markers ?? getNavigationMarkers(measures));
  const [reset, setReset] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const inputError = validateNavigationMarkers(markers, measures.length);
  const route = !inputError ? compilePlaybackOrder(buildNavigationMeasures(measures, markers)) : null;
  const routeError = route && !route.valid ? "반복 경로를 확정할 수 없어요. 도돌이표의 시작·끝, 달세뇨의 세뇨 위치와 종료 기호를 확인해 주세요." : "";
  const jumps = route?.valid ? [...new Set(route.order.slice(0, -1).flatMap((number, i) => route.order[i + 1] !== number + 1 ? [`${number + 1} → ${route.order[i + 1] + 1}마디`] : []))] : [];
  const change = (index: number, changes: Partial<NavigationMarker>) => {
    setMarkers(items => items.map((item, i) => i === index ? { ...item, ...changes } : item));
    setReset(false); setMessage("");
  };
  const save = async () => {
    if (saving || disabled || inputError || (!reset && routeError)) return;
    setSaving(true); setMessage("");
    try {
      const ok = await onSave(reset ? null : { measureIds: measures.map(measure => measure.id), markers });
      setMessage(ok ? "저장했어요." : "설정을 적용했지만 저장하지 못했어요. 다시 저장해 주세요.");
    } catch { setMessage("저장하지 못했어요. 다시 시도해 주세요."); }
    finally { setSaving(false); }
  };
  return <details className={styles.syncSettings}>
    <summary>반복 기호 수정 <span>{saved ? "수정한 설정" : "자동 인식"}</span></summary>
    <fieldset disabled={disabled || saving} className={styles.navigationEditor}>
      <p>인식된 기호를 확인하고, 틀린 기호는 수정·삭제한 뒤 저장하세요.</p>
      {saved && !navigationEditsMatch(saved, measures) && <p role="status">마디 구분이 바뀌어 저장된 설정을 적용하지 않았어요. 마디 번호를 확인한 뒤 다시 저장해 주세요.</p>}
      {!markers.length && <p>인식된 반복 기호가 없어요. 빠진 기호가 있다면 추가해 주세요.</p>}
      <ul className={styles.markerList}>{markers.map((marker, index) => <li key={index}>
        <div className={styles.markerRow}>
          <label>마디<input aria-label={`${index + 1}번 기호 마디`} type="number" min="1" max={measures.length} step="1" value={marker.measure || ""} onChange={event => change(index, { measure: Number(event.target.value) })}/></label>
          <label>기호<select aria-label={`${index + 1}번 기호 종류`} value={marker.kind} onChange={event => change(index, { kind: event.target.value as NavigationMarker["kind"], count: 2, end: marker.measure, passes: "1", mode: "" })}>{Object.entries(markerLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
          <button type="button" className={styles.deleteButton} aria-label={`${index + 1}번 기호 삭제`} onClick={() => { setMarkers(items => items.filter((_, i) => i !== index)); setReset(false); setMessage(""); }}>삭제</button>
        </div>
        {marker.kind === "repeatEnd" && <label className={styles.markerOption}>처음 연주 포함 총 횟수<input aria-label={`${index + 1}번 기호 반복 횟수`} type="number" min="2" max="16" step="1" value={marker.count ?? ""} onChange={event => change(index, { count: Number(event.target.value) })}/></label>}
        {(marker.kind === "ds" || marker.kind === "dc") && <label className={styles.markerOption}>돌아간 뒤<select aria-label={`${index + 1}번 기호 종료 방식`} value={marker.mode ?? ""} onChange={event => change(index, { mode: event.target.value as NavigationMarker["mode"] })}><option value="">끝까지 연주</option><option value="fine">Fine에서 종료</option><option value="coda">To Coda에서 코다로 이동</option></select></label>}
        {marker.kind === "volta" && <div className={styles.markerRow}>
          <label>마지막 마디<input aria-label={`${index + 1}번 엔딩 마지막 마디`} type="number" min={marker.measure || 1} max={measures.length} step="1" value={marker.end || ""} onChange={event => change(index, { end: Number(event.target.value) })}/></label>
          <label>연주할 회차<input aria-label={`${index + 1}번 엔딩 회차`} type="text" placeholder="예: 1 또는 1,2" value={marker.passes ?? ""} onChange={event => change(index, { passes: event.target.value })}/></label>
        </div>}
      </li>)}</ul>
      <div className={styles.markerActions}>
        <button type="button" className={styles.secondaryButton} onClick={() => { setMarkers(items => [...items, { measure: 1, kind: "repeatStart" }]); setReset(false); setMessage(""); }}>＋ 기호 추가</button>
        <button type="button" className={styles.textButton} onClick={() => { setMarkers(getNavigationMarkers(measures)); setReset(true); setMessage("저장하면 자동 인식 결과로 돌아갑니다."); }}>자동 인식으로 되돌리기</button>
      </div>
      <p className={styles.routePreview} role="status">{inputError || routeError || (jumps.length ? `이동: ${jumps.join(" · ")} / ${route!.order.at(-1)! + 1}마디에서 종료` : "반복 이동 없이 악보 순서대로 재생합니다.")}</p>
      <div className={styles.markerActions}><button type="button" className={styles.primaryButton} disabled={!!inputError || (!reset && !!routeError)} onClick={() => void save()}>{saving ? "저장 중…" : "저장"}</button><span role="status">{message}</span></div>
    </fieldset>
  </details>;
}
