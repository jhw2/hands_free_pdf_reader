"use client";

import { createContext, createElement, useContext, useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { saveLanguage, translate, type Language } from "./i18n";
import { isLanguage, languageCookie, languageFromPathname, localizedPath } from "./locale";

type LanguageValue = {
  language: Language;
  chooseLanguage: (language: Language) => void;
  t: (text: string, values?: Record<string, string | number>) => string;
};
const LanguageContext = createContext<LanguageValue>({
  language: "ko", chooseLanguage: () => {}, t: (text, values) => translate("ko", text, values),
});

export function LanguageProvider({ initialLanguage, children }: { initialLanguage: Language; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const language = languageFromPathname(pathname) ?? initialLanguage;

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const chooseLanguage = (next: Language) => {
    if (!isLanguage(next)) return;
    try {
      saveLanguage(next, window.localStorage);
    } catch { /* Language navigation still works when browser storage is blocked. */ }
    try {
      document.cookie = `${languageCookie}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
    } catch { /* A blocked cookie must not prevent changing the page language. */ }
    router.replace(`${localizedPath(pathname ?? "/", next)}${window.location.search}${window.location.hash}`, { scroll: false });
  };

  const t = (text: string, values?: Record<string, string | number>) => translate(language, text, values);
  return createElement(LanguageContext.Provider, { value: { language, chooseLanguage, t } }, children);
}

export const useLanguage = () => useContext(LanguageContext);
