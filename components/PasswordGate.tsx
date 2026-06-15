"use client";
import { useEffect, useState } from "react";
import { LockIcon, UnlockIcon, CheckIcon, AlertIcon } from "./Icons";

const AUTH_KEY = "upload_auth_v1";
const ADMIN_USER = "Admin";
const ADMIN_PASS = "82402525";

export function PasswordGate({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    setHydrated(true);
    if (sessionStorage.getItem(AUTH_KEY) === "1") setAuthed(true);
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (user.trim() === ADMIN_USER && pass === ADMIN_PASS) {
      sessionStorage.setItem(AUTH_KEY, "1");
      setAuthed(true);
      setErr("");
    } else {
      setErr("Username หรือ Password ไม่ถูกต้อง");
    }
  }

  function logout() {
    sessionStorage.removeItem(AUTH_KEY);
    setAuthed(false);
    setUser("");
    setPass("");
  }

  if (!hydrated) return null;

  if (authed) {
    return (
      <div>
        <div className="flex justify-end mb-3 no-print">
          <button
            onClick={logout}
            className="flex items-center gap-1 px-3 py-1.5 text-xs text-slate-500 hover:text-slate-900 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            <UnlockIcon className="w-3.5 h-3.5" /> ออกจากระบบ Admin
          </button>
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-8">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-slate-900 text-white grid place-items-center">
            <LockIcon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-slate-900">Admin Required</h2>
            <p className="text-xs text-slate-500">
              ต้องใส่รหัสผ่านเพื่อเข้าถึงหน้า Upload Data
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 mb-1">
              Username
            </div>
            <input
              autoFocus
              value={user}
              onChange={(e) => setUser(e.target.value)}
              autoComplete="username"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
          </label>
          <label className="block">
            <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 mb-1">
              Password
            </div>
            <input
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              autoComplete="current-password"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
          </label>

          {err && (
            <div className="flex items-center gap-2 px-3 py-2 bg-rose-50 text-rose-700 text-sm rounded-lg border border-rose-200">
              <AlertIcon className="w-4 h-4" />
              {err}
            </div>
          )}

          <button
            type="submit"
            className="w-full flex items-center justify-center gap-1.5 px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800"
          >
            <CheckIcon /> เข้าสู่ระบบ
          </button>
        </form>

        <div className="text-[11px] text-slate-400 mt-3 text-center">
          Session จะหมดอายุเมื่อปิด browser
        </div>
      </div>
    </div>
  );
}
