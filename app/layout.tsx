import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import InteractionAnalytics from "./interaction-analytics";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hands-Free Score Reader",
  description: "A hands-free PDF score reader. Turn pages with mouth gestures or on-screen controls.",
  referrer: "strict-origin-when-cross-origin",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
        <InteractionAnalytics />
      </body>
    </html>
  );
}
