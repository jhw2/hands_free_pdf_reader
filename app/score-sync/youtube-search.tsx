"use client";

import { useEffect, useState } from "react";
import { trackInteraction } from "../../lib/analytics";
import styles from "./score-sync.module.css";

type Video = { id: string; title: string; channel: string };

export default function YoutubeSearch({ value, disabled, isLink, onChange, onConnect }: {
  value: string; disabled: boolean; isLink: boolean;
  onChange: (value: string) => void; onConnect: (value: string) => void;
}) {
  const [result, setResult] = useState<{ query: string; videos: Video[]; error: string } | null>(null);
  const [composing, setComposing] = useState(false);
  const [retry, setRetry] = useState(0);
  const query = value.trim();
  const searchable = !disabled && !isLink && !!query && !composing;
  useEffect(() => {
    setResult(null);
    if (!searchable) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/youtube/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "검색에 실패했어요.");
        if (!controller.signal.aborted) setResult({ query, videos: data.videos, error: "" });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ query, videos: [], error: error instanceof Error ? error.message : "검색에 실패했어요." });
      }
    }, 700);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, searchable, retry]);
  const current = result?.query === query ? result : null;
  const submit = () => {
    if (disabled || !query) return;
    trackInteraction(isLink ? "score_youtube_connect_click" : "score_youtube_search_click");
    if (isLink) onConnect(value); else setRetry(value => value + 1);
  };
  const decode = (text: string) => {
    const document = new DOMParser().parseFromString(text, "text/html");
    return document.documentElement.textContent || text;
  };
  return <>
    <div className={styles.youtubeInput}>
      <input id="youtube-link" type="search" autoComplete="off" autoCapitalize="none" spellCheck={false} value={value} disabled={disabled} maxLength={500}
        onChange={event => onChange(event.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
        onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }}
        placeholder="노래 제목 검색 또는 YouTube 링크 붙여넣기" aria-label="노래 제목 검색 또는 YouTube 링크" aria-controls={searchable ? "youtube-results" : undefined}/>
      <button onClick={submit} disabled={disabled || !query}>{isLink ? "연결" : "검색"}</button>
    </div>
    {searchable && <div id="youtube-results" className={styles.searchResults}>
      <p role="status">{!current ? "YouTube 검색 중…" : current.error || (current.videos.length ? "YouTube · 연결할 영상을 선택하세요" : "검색 결과가 없어요. 다른 제목으로 검색해 주세요.")}</p>
      {current?.videos.length ? <ul>{current.videos.map(video => <li key={video.id}><button data-analytics-click="score_youtube_result_click" onClick={() => onConnect(`https://www.youtube.com/watch?v=${video.id}`)}>
        <img src={`https://i.ytimg.com/vi/${video.id}/default.jpg`} alt="" width="80" height="60"/>
        <span><strong>{decode(video.title)}</strong><small>{decode(video.channel)}</small></span>
      </button></li>)}</ul> : null}
    </div>}
  </>;
}
