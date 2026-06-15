"use client";
import { AlertIcon } from "./Icons";

export function SetupBanner() {
  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="bg-amber-50 border border-amber-300 rounded-2xl p-6">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 grid place-items-center shrink-0">
            <AlertIcon className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h2 className="font-bold text-amber-900 text-lg">ตั้งค่า Database (Supabase)</h2>
            <p className="text-sm text-amber-800 mt-1">
              แอปยังไม่เชื่อม cloud database — ทำตามขั้นตอนนี้ครั้งเดียว
              เพื่อให้ทุกเครื่องเห็นข้อมูลเดียวกัน
            </p>

            <ol className="list-decimal list-inside space-y-2 mt-4 text-sm text-amber-900">
              <li>
                สมัคร{" "}
                <a
                  href="https://supabase.com"
                  target="_blank"
                  rel="noreferrer"
                  className="underline font-semibold"
                >
                  Supabase
                </a>{" "}
                (ฟรี) → สร้าง project ใหม่
              </li>
              <li>
                ไปที่ <b>SQL Editor</b> → ก๊อปไฟล์{" "}
                <code className="bg-amber-100 px-1 rounded">supabase-schema.sql</code>{" "}
                จาก repo มาวาง → กด Run
              </li>
              <li>
                ไปที่ <b>Project Settings → API</b> → จดค่า{" "}
                <code className="bg-amber-100 px-1 rounded">Project URL</code> และ{" "}
                <code className="bg-amber-100 px-1 rounded">anon public</code> key
              </li>
              <li>
                ไปที่ <b>Vercel Project → Settings → Environment Variables</b> → เพิ่ม:
                <pre className="bg-white border border-amber-200 rounded mt-2 p-2 text-xs font-mono whitespace-pre-wrap">
{`NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...`}
                </pre>
              </li>
              <li>
                ไปที่ <b>Vercel Deployments</b> → กด Redeploy เพื่อให้ env vars มีผล
              </li>
            </ol>

            <div className="mt-4 text-xs text-amber-700">
              💡 หลัง deploy ใหม่: รีเฟรชหน้านี้ ระบบจะเชื่อม Supabase อัตโนมัติ —
              ทุกเครื่อง/ทุกคนที่เปิด URL เดียวกันจะเห็นข้อมูลเดียวกัน
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
