import type { Metadata } from "next";
import type { Language } from "./i18n";

export const siteUrl = "https://musicup.space";
const siteName = "Hands-Free PDF Reader";

const copy = {
  ko: {
    "/": ["입으로 넘기는 PDF 악보 | Hands-Free PDF Reader", "연주 중 손을 떼지 않고 PDF 악보를 넘겨보세요. 카메라로 입 움직임을 감지해 페이지를 넘기고, 고개 움직임으로 확대된 악보를 스크롤합니다. 악보 저장과 YouTube 마디 연습도 지원합니다."],
    "/score-sync": ["YouTube 악보 싱크·마디 연습 | Hands-Free PDF Reader", "PDF 악보와 YouTube 음악을 연결해 현재 연주할 마디를 확인하세요. BPM과 시작 시간을 조절하고, 원하는 마디를 눌러 4초 카운트 후 연습할 수 있어요. 악보와 연결한 영상을 함께 저장합니다."],
  },
  en: {
    "/": ["Hands-Free Sheet Music & PDF Reader", "Turn PDF sheet music pages with mouth gestures while you play. Use head movements to scroll enlarged scores, save your music in your browser, and practice along with YouTube."],
    "/score-sync": ["YouTube Sheet Music Sync & Measure Practice | Hands-Free PDF Reader", "Follow your PDF sheet music while YouTube plays. Adjust tempo and timing, start from any measure after a four-second count-in, and save your score with its video."],
  },
};

export function pageMetadata(path: "/" | "/score-sync", language: Language): Metadata {
  const suffix = path === "/" ? "" : path;
  const url = `${siteUrl}/${language}${suffix}`;
  const [title, description] = copy[language][path];
  const image = { url: `${siteUrl}/og-image.png`, width: 1200, height: 630, alt: language === "ko"
    ? "Hands-Free PDF Reader — 악보 넘기기와 YouTube 마디 연습"
    : "Hands-Free PDF Reader — hands-free sheet music and YouTube practice" };
  return {
    title,
    description,
    alternates: { canonical: url, languages: { ko: `${siteUrl}/ko${suffix}`, en: `${siteUrl}/en${suffix}`, "x-default": `${siteUrl}${path}` } },
    openGraph: { type: "website", locale: language === "ko" ? "ko_KR" : "en_US", alternateLocale: language === "ko" ? "en_US" : "ko_KR", siteName, title, description, url, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}
