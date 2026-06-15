"use client";
import { useEffect, useState } from "react";
import { CalendarIcon } from "./Icons";

// Always-Gregorian date picker. Independent of the device's locale —
// the year shown in the calendar header is always the Christian Era year,
// not the Thai Buddhist year, regardless of how iOS/Android is configured.
//
// Storage / API contract: value is ISO YYYY-MM-DD, onChange emits ISO.
// Display surface: DD/MM/YYYY everywhere (matches BC Item Journal format).
//
// Desktop: hybrid text input + calendar icon. User can type "19/03/2025"
// and press Enter / tab away to save, or click the icon to open the
// calendar.
// Mobile: a single button. Tap to open the calendar — typing on a phone
// keyboard is unpleasant.

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (n: number) => String(n).padStart(2, "0");
const fmtISO = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function parseISO(s?: string): { y: number; m: number; d: number } | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  // Reject impossible dates (e.g., 2026-02-31)
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return { y, m: mo, d };
}

function isoToDDMMYYYY(iso?: string): string {
  const p = parseISO(iso);
  if (!p) return iso || "";
  return `${pad(p.d)}/${pad(p.m)}/${p.y}`;
}

function ddmmyyyyToISO(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{4})$/);
  if (!m) return null;
  const d = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const y = parseInt(m[3], 10);
  if (mo < 1 || mo > 12) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return fmtISO(y, mo, d);
}

type Props = {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
};

export function ADDatePicker({
  value,
  onChange,
  className = "",
  placeholder = "DD/MM/YYYY",
}: Props) {
  const [hydrated, setHydrated] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [open, setOpen] = useState(false);
  const [textValue, setTextValue] = useState(isoToDDMMYYYY(value));
  const [editing, setEditing] = useState(false);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setHydrated(true);
    try {
      const ua = navigator.userAgent || "";
      const m =
        /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ||
        (typeof window.matchMedia === "function" &&
          window.matchMedia("(pointer: coarse)").matches);
      setIsMobile(m);
    } catch {}
  }, []);

  // Mirror external value into the text field when the user isn't editing.
  useEffect(() => {
    if (!editing) {
      setTextValue(isoToDDMMYYYY(value));
      setInvalid(false);
    }
  }, [value, editing]);

  const now = new Date();
  const parsed = parseISO(value);
  const [viewY, setViewY] = useState(parsed?.y ?? now.getFullYear());
  const [viewM, setViewM] = useState(parsed?.m ?? now.getMonth() + 1);

  useEffect(() => {
    const p = parseISO(value);
    if (p) {
      setViewY(p.y);
      setViewM(p.m);
    }
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);

  const firstDay = new Date(viewY, viewM - 1, 1).getDay();
  const daysInMonth = new Date(viewY, viewM, 0).getDate();
  const todayY = now.getFullYear();
  const todayM = now.getMonth() + 1;
  const todayD = now.getDate();
  const todayDDMM = `${pad(todayD)}/${pad(todayM)}/${todayY}`;

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length < 42) cells.push(null);
  const rows: (number | null)[][] = [];
  for (let i = 0; i < 6; i++) rows.push(cells.slice(i * 7, (i + 1) * 7));
  while (rows.length > 4 && rows[rows.length - 1].every((c) => c === null)) rows.pop();

  function pick(d: number) {
    onChange(fmtISO(viewY, viewM, d));
    setOpen(false);
  }
  function prevMonth() {
    if (viewM === 1) {
      setViewY(viewY - 1);
      setViewM(12);
    } else setViewM(viewM - 1);
  }
  function nextMonth() {
    if (viewM === 12) {
      setViewY(viewY + 1);
      setViewM(1);
    } else setViewM(viewM + 1);
  }

  const yearStart = todayY - 5;
  const yearEnd = todayY + 14;

  function commitText() {
    const iso = ddmmyyyyToISO(textValue);
    if (iso) {
      onChange(iso);
      setTextValue(isoToDDMMYYYY(iso));
      setInvalid(false);
    } else if (textValue.trim() === "") {
      onChange("");
      setInvalid(false);
    } else {
      // Invalid — revert to last valid value
      setTextValue(isoToDDMMYYYY(value));
      setInvalid(false);
    }
  }

  function onTextChange(s: string) {
    setTextValue(s);
    // Only flip the "invalid" flag once the user has typed enough to evaluate.
    const t = s.trim();
    if (!t) {
      setInvalid(false);
      return;
    }
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) {
      setInvalid(ddmmyyyyToISO(t) === null);
    } else {
      setInvalid(false);
    }
  }

  // The trigger control — mobile button vs desktop input
  const renderTrigger = () => {
    if (!hydrated || isMobile) {
      const display = isoToDDMMYYYY(value);
      return (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`w-full text-left truncate ${className}`}
        >
          {display || <span className="text-slate-400">{placeholder}</span>}
        </button>
      );
    }
    return (
      <div className="relative w-full">
        <input
          type="text"
          value={textValue}
          placeholder={placeholder}
          onFocus={() => setEditing(true)}
          onChange={(e) => onTextChange(e.target.value)}
          onBlur={() => {
            setEditing(false);
            commitText();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          inputMode="numeric"
          className={`w-full pr-8 ${className} ${
            invalid ? "ring-2 ring-rose-300 border-rose-300" : ""
          }`}
        />
        <button
          type="button"
          onClick={() => setOpen(true)}
          tabIndex={-1}
          title="เปิดปฏิทิน"
          className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-slate-100 transition"
        >
          <CalendarIcon className="w-4 h-4" />
        </button>
      </div>
    );
  };

  return (
    <>
      {renderTrigger()}

      {open && (
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center bg-black/45 backdrop-blur-sm p-4 animate-backdrop-in no-print"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-xs animate-modal-in overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-gradient-to-br from-indigo-500 to-indigo-700 text-white px-3 py-3 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={prevMonth}
                className="w-8 h-8 grid place-items-center rounded-lg hover:bg-white/20 active:scale-90 text-xl font-light shrink-0"
              >
                ‹
              </button>
              <div className="flex items-center gap-1 flex-1 justify-center">
                <select
                  value={viewM}
                  onChange={(e) => setViewM(parseInt(e.target.value, 10))}
                  className="bg-white/15 text-white text-sm font-semibold px-1.5 py-1 rounded-md border-0 focus:outline-none focus:ring-2 focus:ring-white/40 appearance-none cursor-pointer"
                >
                  {MONTHS.map((mn, i) => (
                    <option key={i + 1} value={i + 1} className="text-slate-900">
                      {mn}
                    </option>
                  ))}
                </select>
                <select
                  value={viewY}
                  onChange={(e) => setViewY(parseInt(e.target.value, 10))}
                  className="bg-white/15 text-white text-sm font-semibold px-1.5 py-1 rounded-md border-0 focus:outline-none focus:ring-2 focus:ring-white/40 appearance-none cursor-pointer"
                >
                  {Array.from({ length: yearEnd - yearStart + 1 }, (_, i) => yearStart + i).map(
                    (yr) => (
                      <option key={yr} value={yr} className="text-slate-900">
                        {yr}
                      </option>
                    ),
                  )}
                </select>
              </div>
              <button
                type="button"
                onClick={nextMonth}
                className="w-8 h-8 grid place-items-center rounded-lg hover:bg-white/20 active:scale-90 text-xl font-light shrink-0"
              >
                ›
              </button>
            </div>

            <div className="grid grid-cols-7 gap-0.5 px-2 pt-3 text-center text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
              {DOW.map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>

            <div className="px-2 pb-2 pt-1">
              {rows.map((row, i) => (
                <div key={i} className="grid grid-cols-7 gap-0.5">
                  {row.map((d, j) => {
                    if (d === null) return <div key={j} className="aspect-square" />;
                    const isToday = viewY === todayY && viewM === todayM && d === todayD;
                    const isSelected =
                      parsed && parsed.y === viewY && parsed.m === viewM && parsed.d === d;
                    return (
                      <button
                        key={j}
                        type="button"
                        onClick={() => pick(d)}
                        className={`aspect-square text-sm rounded-md transition active:scale-90 ${
                          isSelected
                            ? "bg-indigo-600 text-white font-bold shadow"
                            : isToday
                            ? "bg-indigo-50 text-indigo-700 font-semibold hover:bg-indigo-100"
                            : "text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 flex justify-between items-center">
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className="text-xs text-slate-500 hover:text-slate-900 px-2 py-1"
              >
                ล้าง
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange(fmtISO(todayY, todayM, todayD));
                  setOpen(false);
                }}
                className="text-xs text-indigo-600 font-semibold hover:text-indigo-800 px-2 py-1"
              >
                วันนี้ ({todayDDMM})
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
