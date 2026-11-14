import type { MetadataRoute } from "next";
import { siteUrl } from "../lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/ko", "/ko/score-sync", "/en", "/en/score-sync"].map(path => ({ url: `${siteUrl}${path}` }));
}
