"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../../lib/use-language";
import styles from "./score-sync.module.css";

export default function PlaybackSpeed({ rate, minimum, disabled, onOpen, onChange }: {
  rate: number; minimum: number; disabled: boolean; onOpen: () => void; onChange: (rate: number) => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const slider = useRef<HTMLInputElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };

  useEffect(() => {
    if (disabled) { setOpen(false); return; }
    if (!open) return;
    slider.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, disabled]);

  const step = (direction: number) => onChange(Math.max(minimum, Math.min(1, Math.round(rate * 100 + direction * 5) / 100)));
  return <div className={styles.speedMenu} ref={root}
    onKeyDown={event => { if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); } }}
    onBlurCapture={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} className={styles.speedTrigger} data-analytics-click="score_speed_toggle_click" disabled={disabled}
      aria-label={t("재생 속도")} aria-haspopup="dialog" aria-expanded={open && !disabled} aria-controls="playback-speed-panel" onClick={() => { if (!open) onOpen(); setOpen(value => !value); }}>{rate.toFixed(2)}×</button>
    {open && !disabled && <div id="playback-speed-panel" className={styles.speedPanel} role="dialog" aria-label={t("재생 속도")}>
      <div className={styles.speedHeading}><strong>{t("재생 속도")}</strong><button className={styles.speedClose} aria-label={t("배속 설정 닫기")} onClick={close}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>
      <output className={styles.speedValue}>{rate.toFixed(2)}×</output>
      <div className={styles.speedSliderRow}>
        <button data-analytics-click="score_speed_decrease_click" className={styles.speedStep} aria-label={t("배속 0.05 낮추기")} disabled={rate <= minimum} onClick={() => step(-1)}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M5 12h14"/></svg></button>
        <input ref={slider} data-analytics-change="score_speed_change" className={styles.speedSlider} type="range" min={minimum} max="1" step="0.05" value={rate} aria-label={t("재생 속도")} aria-valuetext={`${rate.toFixed(2)}×`} onChange={event => onChange(Number(event.target.value))}/>
        <button data-analytics-click="score_speed_increase_click" className={styles.speedStep} aria-label={t("배속 0.05 높이기")} disabled={rate >= 1} onClick={() => step(1)}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M5 12h14M12 5v14"/></svg></button>
      </div>
      <p className={styles.speedHint}>{t("0.05 단위로 조절")}</p>
      <div className={styles.speedPresets}>{[.25, .5, .75, 1].filter(value => value >= minimum).map(value => <button key={value} data-analytics-click="score_speed_preset_click" aria-pressed={rate === value} onClick={() => onChange(value)}>{value === 1 ? t("보통") : `${value.toFixed(2)}×`}</button>)}</div>
    </div>}
  </div>;
}
