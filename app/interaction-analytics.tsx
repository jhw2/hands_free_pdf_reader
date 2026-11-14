"use client";

import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";
import { useEffect, useState } from "react";
import { gaMeasurementId, isAnalyticsEnabled, recordInteraction } from "../lib/analytics";

export default function InteractionAnalytics() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!isAnalyticsEnabled()) return;
    setEnabled(true);
    // Capture the action before React changes a play button into a pause button.
    document.addEventListener("click", recordInteraction, true);
    document.addEventListener("change", recordInteraction, true);
    return () => {
      document.removeEventListener("click", recordInteraction, true);
      document.removeEventListener("change", recordInteraction, true);
    };
  }, []);

  if (!enabled) return null;
  return <>
    <Analytics />
    <Script id="ga-interactions-init" strategy="afterInteractive">{`
      window.dataLayer = window.dataLayer || [];
      window.gtag = window.gtag || function(){window.dataLayer.push(arguments);};
      window.gtag('js', new Date());
      window.gtag('config', ${JSON.stringify(gaMeasurementId)}, {send_page_view: false});
    `}</Script>
    <Script src={`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`} strategy="afterInteractive"/>
  </>;
}
