"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import { ScanIcon, BoxIcon, UploadIcon, PillIcon } from "@/components/Icons";
import { SetupBanner } from "@/components/SetupBanner";
import { isConfigured } from "@/lib/supabase";

const Scan = dynamic(() => import("@/components/Scan").then((m) => m.Scan), { ssr: false });
const Upload = dynamic(() => import("@/components/Upload").then((m) => m.Upload), { ssr: false });
const Transfers = dynamic(() => import("@/components/Transfers").then((m) => m.Transfers), {
  ssr: false,
});

const TABS = [
  { key: "scan", label: "สแกน & สร้างลัง", Icon: ScanIcon },
  { key: "transfers", label: "Transfers", Icon: BoxIcon },
  { key: "upload", label: "Upload Data", Icon: UploadIcon },
] as const;

export default function Home() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("scan");

  if (!isConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <SetupBanner />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-slate-200/80 no-print">
        <div className="max-w-7xl mx-auto px-4 lg:px-6 py-3 flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white grid place-items-center shadow-sm">
              <PillIcon className="w-5 h-5" />
            </div>
            <div className="leading-tight">
              <div className="font-extrabold text-slate-900 text-[15px]">Short EXP Manager</div>
              <div className="text-[11px] text-slate-500">
                60008 <span className="text-emerald-600">⇄</span> 60008-EXP
              </div>
            </div>
          </div>

          <nav className="ml-auto flex gap-1 bg-slate-100 p-1 rounded-xl">
            {TABS.map(({ key, label, Icon }) => {
              const on = tab === key;
              return (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                    on
                      ? "bg-white shadow-sm text-slate-900"
                      : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="hidden md:inline">{label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 lg:px-6 py-6">
        {tab === "scan" && <Scan />}
        {tab === "transfers" && <Transfers />}
        {tab === "upload" && <Upload />}
      </main>

      <footer className="max-w-7xl mx-auto px-4 lg:px-6 py-6 text-xs text-slate-400 no-print">
        ข้อมูลทั้งหมดเก็บใน Browser (IndexedDB) — Export Excel ก่อนเพื่อนำไป Import เข้า Microsoft Dynamics 365
      </footer>
    </div>
  );
}
