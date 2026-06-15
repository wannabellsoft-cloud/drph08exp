"use client";
import { useState, ReactNode } from "react";

export function Tabs({
  tabs,
  initial = 0,
}: {
  tabs: { key: string; label: string; content: ReactNode }[];
  initial?: number;
}) {
  const [i, setI] = useState(initial);
  return (
    <div>
      <div className="flex gap-1 border-b border-slate-200 mb-4 no-print">
        {tabs.map((t, idx) => (
          <button
            key={t.key}
            onClick={() => setI(idx)}
            className={`px-4 py-2 text-sm font-medium rounded-t-md ${
              i === idx
                ? "bg-white border border-b-white border-slate-200 text-slate-900"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div>{tabs[i].content}</div>
    </div>
  );
}
