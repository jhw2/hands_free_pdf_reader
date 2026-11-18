import type { MetadataRoute } from "next";
import { siteUrl } from "../lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/score-sync"].flatMap(path => {
    const alternates = { languages: {
      ko: `${siteUrl}/ko${path}`,
      en: `${siteUrl}/en${path}`,
      "x-default": `${siteUrl}${path || "/"}`,
    } };
    return ["ko", "en"].map(language => ({ url: `${siteUrl}/${language}${path}`, alternates }));
  });
}
