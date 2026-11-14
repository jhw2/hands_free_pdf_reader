import type { Language } from "./i18n";

export const languageCookie = "reader-language";
export const isLanguage = (value: unknown): value is Language => value === "ko" || value === "en";

export function languageFromPathname(pathname: string | null): Language | null {
  const match = pathname?.match(/^\/(ko|en)(?:\/|$)/);
  return match ? match[1] as Language : null;
}

export function localizedPath(pathname: string, language: Language): string {
  const page = pathname.replace(/^\/(?:ko|en)(?=\/|$)/, "");
  return `/${language}${page === "/" ? "" : page}`;
}

export function preferredLanguage(saved: string | undefined, acceptLanguage: string | null): Language {
  if (isLanguage(saved)) return saved;
  const preferred = (acceptLanguage ?? "").split(",").map(value => {
    const [tag, ...parameters] = value.trim().split(";");
    const quality = parameters.find(parameter => /^\s*q=/i.test(parameter));
    return { tag, quality: quality ? Number(quality.split("=")[1]) : 1 };
  }).filter(item => item.tag && Number.isFinite(item.quality) && item.quality > 0 && item.quality <= 1)
    .sort((a, b) => b.quality - a.quality)[0];
  return /^ko(?:-|$)/i.test(preferred?.tag ?? "") ? "ko" : "en";
}
