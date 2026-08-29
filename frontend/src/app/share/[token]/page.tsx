"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type ShareSnapshot = {
  label?: string;
  created_at: string;
  manual_version: { version: number; content: Record<string, unknown> };
  assets: Array<{ id: string; kind: string; url?: string }>;
};

export default function SharedManualPage() {
  const params = useParams<{ token: string }>();
  const [snapshot, setSnapshot] = useState<ShareSnapshot | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void api<{ data: ShareSnapshot }>(`/shares/${params.token}`)
      .then((response) => setSnapshot(response.data))
      .catch(() => setError("这份分享已撤销、已失效或不存在。"));
  }, [params.token]);

  if (error) return <main className="shared-manual"><p>{error}</p></main>;
  if (!snapshot) return <main className="shared-manual"><p>正在翻开品牌手册…</p></main>;
  const content = snapshot.manual_version.content;
  return <main className="shared-manual"><header><p className="eyebrow">贵品风物志 · 不可变分享快照</p><h1>{String(content.brand_name ?? snapshot.label ?? "品牌视觉手册")}</h1><p>v{snapshot.manual_version.version} · {new Date(snapshot.created_at).toLocaleString("zh-CN")}</p></header><article><h2>{String(content.slogan ?? "")}</h2><p>{String(content.brand_introduction ?? "")}</p><pre>{JSON.stringify(content, null, 2)}</pre></article><section>{snapshot.assets.map((asset) => asset.url && <figure key={asset.id}><img src={asset.url} alt={asset.kind} /><figcaption>{asset.kind} · AI 概念资产</figcaption></figure>)}</section></main>;
}
