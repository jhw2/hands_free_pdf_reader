import { notFound } from "next/navigation";
import { isLanguage } from "../../../lib/locale";
import { pageMetadata } from "../../../lib/seo";

export function generateMetadata({ params }: { params: { lang: string } }) {
  if (!isLanguage(params.lang)) notFound();
  return pageMetadata("/score-sync", params.lang);
}

export default function ScoreSyncLayout({ children }: { children: React.ReactNode }) {
  return children;
}
