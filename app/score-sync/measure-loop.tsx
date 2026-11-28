"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../../lib/use-language";
import type { MeasureLoop } from "../../lib/score-loop";
import styles from "./score-sync.module.css";

export default function MeasureLoopControl({ loop, count, current, disabled, onOpen, onApply, onClear }: {
  loop: MeasureLoop | null; count: number; current: number; disabled: boolean;
  onOpen: () => void; onApply: (start: number, end: number) => boolean; onClear: () => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const firstInput = useRef<HTMLInputElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  useEffect(() => {
    if (disabled) { setOpen(false); return; }
    if (!open) return;
    firstInput.current?.focus({ preventScroll: true });
    firstInput.current?.select();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, disabled]);

  return <div ref={root} className={styles.loopMenu}
    onKeyDown={event => { if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); } }}
    onBlurCapture={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} className={`${styles.speedTrigger} ${styles.loopTrigger}`} data-analytics-click="score_loop_toggle_click"
      disabled={disabled} aria-label={loop ? t("구간 반복: {start}–{end}마디", { start: loop.startMeasure, end: loop.endMeasure }) : t("구간 반복")}
      title={t("구간 반복")} aria-pressed={!!loop} aria-haspopup="dialog" aria-expanded={open && !disabled} aria-controls="measure-loop-panel"
      onClick={() => {
        if (!open) {
          onOpen();
          setStart(String(loop?.startMeasure ?? Math.max(1, current)));
          setEnd(String(loop?.endMeasure ?? Math.max(1, current)));
          setError("");
        }
        setOpen(value => !value);
      }}>{loop ? `${loop.startMeasure}–${loop.endMeasure}` : "A–B"}</button>
    {open && !disabled && <form id="measure-loop-panel" className={styles.speedPanel} role="dialog" aria-label={t("구간 반복")} noValidate
      onSubmit={event => {
        event.preventDefault();
        const from = Number(start), to = Number(end);
        if (!start.trim() || !end.trim() || !Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > count) {
          setError(t("1–{count} 사이의 마디를 입력하고, 끝 마디는 시작 마디 이후로 지정해 주세요.", { count }));
          return;
        }
        if (onApply(from, to)) close();
        else setError(t("이 구간을 재생할 수 없어요. 반복 순서, BPM과 영상 길이를 확인해 주세요."));
      }}>
      <div className={styles.speedHeading}><strong>{t("구간 반복")}</strong><button type="button" className={styles.speedClose} aria-label={t("구간 반복 설정 닫기")} onClick={close}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>
      <div className={styles.loopFields}>
        <label>{t("시작 마디")}<input ref={firstInput} type="number" inputMode="numeric" min="1" max={count} step="1" value={start} aria-describedby={error ? "measure-loop-error" : undefined} onChange={event => { setStart(event.target.value); setError(""); }}/></label>
        <span aria-hidden="true">–</span>
        <label>{t("끝 마디")}<input type="number" inputMode="numeric" min="1" max={count} step="1" value={end} aria-describedby={error ? "measure-loop-error" : undefined} onChange={event => { setEnd(event.target.value); setError(""); }}/></label>
      </div>
      {error && <p id="measure-loop-error" className={styles.loopError} role="alert">{error}</p>}
      <div className={styles.loopActions}>
        {loop && <button type="button" data-analytics-click="score_loop_clear_click" onClick={() => { onClear(); close(); }}>{t("반복 해제")}</button>}
        <button type="submit" data-analytics-click="score_loop_apply_click">{t("구간 반복 시작")}</button>
      </div>
    </form>}
  </div>;
}
