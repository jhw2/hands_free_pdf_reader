import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hands-Free Score Reader",
  description: "A hands-free PDF score reader. Turn pages with mouth gestures or on-screen controls.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
