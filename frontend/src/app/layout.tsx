import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const sourceHanSerif = localFont({
  src: "./fonts/SourceHanSerifSC-VF.ttf.woff2",
  variable: "--font-source-han-serif",
  display: "swap",
  fallback: ["STSong", "Songti SC", "SimSun", "serif"],
  adjustFontFallback: false,
  weight: "200 900",
});

export const metadata: Metadata = {
  title: "贵品风物志",
  description: "从真实材料开始，留下可确认的田野记录。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN">
      {/* Browser grammar extensions inject data-* attributes before hydration. */}
      <body className={sourceHanSerif.variable} suppressHydrationWarning>{children}</body>
    </html>
  );
}
