import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "贵品风物志｜贵州品牌工作台",
  description: "以采风、编志、观潮和出山，整理贵州风物的品牌材料。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
