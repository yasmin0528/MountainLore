import WorkbenchApp from "@/components/workbench-app";

const demoViews = new Set(["archive", "assets", "directions", "manual", "tide", "launch"]);

export default async function Home({ searchParams }: { searchParams: Promise<{ demo?: string; view?: string; preview?: string }> }) {
  const params = await searchParams;
  const isDemo = params.demo === "1";
  const initialManual = isDemo && params.view === "manual";
  const initialDirectionDraft = isDemo && params.view === "draft";
  const initialFieldwork = isDemo && params.view === "fieldwork";
  const initialScreen = initialFieldwork ? "interview" : demoViews.has(params.view ?? "") ? params.view as "archive" | "assets" | "directions" | "manual" | "tide" | "launch" : "archive";
  const previewKey = `${params.demo ?? "live"}:${params.view ?? "default"}:${params.preview ?? "default"}`;
  return <WorkbenchApp key={previewKey} initialDemo={isDemo} initialScreen={initialScreen} initialManual={initialManual} initialDirectionDraft={initialDirectionDraft} initialFieldwork={initialFieldwork} />;
}
