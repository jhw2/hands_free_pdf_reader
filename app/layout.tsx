import type { Metadata } from "next";
import { headers } from "next/headers";
import InteractionAnalytics from "./interaction-analytics";
import { siteUrl } from "../lib/seo";
import { LanguageProvider } from "../lib/use-language";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  referrer: "strict-origin-when-cross-origin",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const language = headers().get("x-site-language") === "en" ? "en" : "ko";
  return (
    <html lang={language}>
      <body>
        <LanguageProvider initialLanguage={language}>{children}</LanguageProvider>
        <InteractionAnalytics />
      </body>
    </html>
  );
}
