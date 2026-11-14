import { notFound } from "next/navigation";
import { isLanguage } from "../../lib/locale";
import { pageMetadata } from "../../lib/seo";

export function generateMetadata({ params }: { params: { lang: string } }) {
  if (!isLanguage(params.lang)) notFound();
  return pageMetadata("/", params.lang);
}

export default function LanguageLayout({ children, params }: { children: React.ReactNode; params: { lang: string } }) {
  if (!isLanguage(params.lang)) notFound();
  return children;
}
