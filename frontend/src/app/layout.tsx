import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "山风风物志｜采风",
  description: "从真实材料开始，留下可确认的田野记录。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
