"use client";

import { useEffect, useState } from "react";
import { readLanguage, resolveLanguage, saveLanguage, translate, type Language } from "./i18n";

export function useLanguage() {
  // Match server markup; browser preferences are applied immediately after hydration.
  const [language, setLanguage] = useState<Language>("en");

  useEffect(() => {
    // Accessing localStorage itself can throw in restricted browser contexts.
    try {
      setLanguage(readLanguage(navigator.language, window.localStorage));
    } catch {
      setLanguage(resolveLanguage(null, navigator.language));
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = "Hands-Free Score Reader";
    document.querySelector('meta[name="description"]')?.setAttribute("content",
      translate(language, "입모양과 버튼으로 페이지를 넘길 수 있는 핸즈프리 PDF 리더"));
  }, [language]);

  const chooseLanguage = (next: Language) => {
    setLanguage(next);
    try {
      saveLanguage(next, window.localStorage);
    } catch {
      // Keep the user's choice for this session when storage is unavailable.
    }
  };

  const t = (text: string, values?: Record<string, string | number>) => translate(language, text, values);
  return { language, chooseLanguage, t };
}
