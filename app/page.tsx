"use client";
import dynamic from "next/dynamic";
import { Tabs } from "@/components/Tabs";

// Dexie needs window — load all data components client-only
const Scan = dynamic(() => import("@/components/Scan").then((m) => m.Scan), { ssr: false });
const Upload = dynamic(() => import("@/components/Upload").then((m) => m.Upload), { ssr: false });
const Transfers = dynamic(() => import("@/components/Transfers").then((m) => m.Transfers), {
  ssr: false,
});

export default function Home() {
  return (
    <main className="max-w-7xl mx-auto p-4 lg:p-6">
      <header className="mb-4 flex items-baseline justify-between no-print">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Short EXP Manager</h1>
          <p className="text-sm text-slate-500">
            จัดการสินค้า Short EXP — โอนระหว่าง 60008 ⇄ 60008-EXP
          </p>
        </div>
        <div className="text-xs text-slate-400">ข้อมูลเก็บใน Browser (IndexedDB)</div>
      </header>

      <Tabs
        tabs={[
          { key: "scan", label: "1. Scan & Build TO", content: <Scan /> },
          { key: "transfers", label: "2. Transfers (พิมพ์/Export)", content: <Transfers /> },
          { key: "upload", label: "3. Upload Data", content: <Upload /> },
        ]}
      />
    </main>
  );
}
