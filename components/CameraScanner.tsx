"use client";
import { useEffect, useRef, useState } from "react";
import { ScanIcon, XIcon, AlertIcon } from "./Icons";

let sharedAudioCtx: AudioContext | null = null;

// Short success "beep" via Web Audio API — no asset to load, works on iOS as
// long as we're inside a user-gesture-driven flow (which we are: the modal
// opens after a tap).
function playBeep() {
  try {
    const Ctx =
      (typeof window !== "undefined" && (window.AudioContext || (window as any).webkitAudioContext)) ||
      null;
    if (!Ctx) return;
    if (!sharedAudioCtx) sharedAudioCtx = new Ctx();
    const ctx = sharedAudioCtx;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1320, now);          // E6
    osc.frequency.linearRampToValueAtTime(1760, now + 0.08); // up to A6 — feels like a "success" chirp

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.35, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  } catch {}
}

export function CameraScanner({
  onResult,
  onClose,
}: {
  onResult: (code: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<any>(null);
  const decodedRef = useRef<string | null>(null);
  const [err, setErr] = useState<string>("");
  const [status, setStatus] = useState<"starting" | "scanning" | "stopped">("starting");
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsIOS(/iPhone|iPad|iPod/i.test(navigator.userAgent ?? ""));

    (async () => {
      try {
        if (typeof window !== "undefined" && !window.isSecureContext) {
          throw new Error("ต้องเปิดผ่าน HTTPS เท่านั้น");
        }

        const [browserMod, libMod] = await Promise.all([
          import("@zxing/browser"),
          import("@zxing/library"),
        ]);
        if (cancelled) return;

        const { BrowserMultiFormatReader } = browserMod as any;
        const { DecodeHintType, BarcodeFormat } = libMod as any;

        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.ITF,
          BarcodeFormat.QR_CODE,
        ]);
        hints.set(DecodeHintType.TRY_HARDER, true);

        // Smaller interval = faster decode loop = more frames analyzed
        const reader = new BrowserMultiFormatReader(hints, {
          delayBetweenScanAttempts: 80,
          delayBetweenScanSuccess: 400,
        });

        const videoEl = videoRef.current;
        if (!videoEl) throw new Error("video element not ready");

        const controls = await reader.decodeFromConstraints(
          {
            audio: false,
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
          },
          videoEl,
          (result: any, _error: any, c: any) => {
            if (cancelled) {
              try {
                c?.stop?.();
              } catch {}
              return;
            }
            if (!result) return;
            const txt = String(result.getText?.() ?? "").trim();
            if (!txt || decodedRef.current === txt) return;
            decodedRef.current = txt;
            playBeep();
            try {
              if (navigator.vibrate) navigator.vibrate(80);
            } catch {}
            onResult(txt);
          },
        );

        if (cancelled) {
          try {
            controls.stop();
          } catch {}
          return;
        }
        controlsRef.current = controls;
        setStatus("scanning");
      } catch (e: any) {
        if (cancelled) return;
        const msg = String(e?.message ?? e ?? "เปิดกล้องไม่สำเร็จ");
        if (/permission|denied|notallowed/i.test(msg)) {
          setErr("ไม่ได้รับสิทธิ์เข้าถึงกล้อง — กรุณาอนุญาตในเบราว์เซอร์");
        } else if (/notfound|no.*cam|overconstrained/i.test(msg)) {
          setErr("ไม่พบกล้องบนอุปกรณ์นี้");
        } else {
          setErr(msg);
        }
        setStatus("stopped");
      }
    })();

    return () => {
      cancelled = true;
      try {
        controlsRef.current?.stop?.();
      } catch {}
      // Also kill any leftover MediaStream on the video element
      try {
        const v = videoRef.current as any;
        const s = v?.srcObject as MediaStream | null;
        s?.getTracks?.().forEach((t) => t.stop());
        if (v) v.srcObject = null;
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-3 no-print">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 grid place-items-center">
              <ScanIcon className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">สแกนบาร์โค้ด</div>
              <div className="text-[11px] text-slate-500">
                {status === "scanning"
                  ? "วางบาร์โค้ดให้อยู่ในกรอบเขียว"
                  : status === "starting"
                  ? "กำลังเปิดกล้องหลัง..."
                  : "ปิดอยู่"}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100"
          >
            <XIcon />
          </button>
        </div>

        <div className="relative bg-black" style={{ aspectRatio: "4 / 3" }}>
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="absolute inset-0 w-full h-full object-cover"
          />

          {/* Scan overlay — corners + sweeping line. Pointer-events-none so
              user taps still reach the video for autofocus on iOS Safari. */}
          {status !== "stopped" && (
            <div className="absolute inset-0 pointer-events-none">
              {/* Dim the corners (everything outside the scan box) using a
                  4-layer overlay rather than clip-path so Safari renders it */}
              <div className="absolute inset-0 bg-black/35" />
              <div
                className="absolute bg-transparent ring-1 ring-emerald-400/40"
                style={{ top: "28%", left: "6%", right: "6%", bottom: "28%" }}
              >
                {/* Cutout — use a contrasting box-shadow trick to "punch" through */}
                <div
                  className="absolute inset-0"
                  style={{
                    boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)",
                    background: "transparent",
                  }}
                />
                {/* Corner brackets */}
                <CornerBrackets />
                {/* Sweeping scan line */}
                <div className="absolute left-3 right-3 top-0 h-[3px] rounded-full bg-emerald-400 shadow-[0_0_14px_3px_rgba(16,185,129,0.65)] animate-scan-sweep" />
              </div>

              {/* Bottom hint */}
              <div className="absolute bottom-3 left-0 right-0 text-center">
                <span className="inline-block px-3 py-1 bg-black/55 text-white text-[11px] rounded-full">
                  {status === "scanning" ? "กำลังสแกน..." : "เปิดกล้อง..."}
                </span>
              </div>
            </div>
          )}
        </div>

        {err && (
          <div className="m-3 px-3 py-2 bg-rose-50 text-rose-700 text-xs rounded-lg border border-rose-200 flex items-start gap-2">
            <AlertIcon className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{err}</span>
          </div>
        )}

        {isIOS && (
          <div className="mx-3 mb-3 px-3 py-2 bg-amber-50 text-amber-800 text-[11px] rounded-lg border border-amber-200">
            <span className="font-semibold">iOS Safari:</span> ถ้าไม่อยากกดอนุญาตทุกครั้ง
            ให้กดปุ่ม Share → <span className="font-mono">Add to Home Screen</span> →
            เปิดผ่านไอคอนบนหน้าจอหลัก สิทธิ์กล้องจะค้างไว้ถาวร
          </div>
        )}

        <div className="px-4 py-3 text-[11px] text-slate-500 border-t border-slate-100">
          กล้องหลัง · EAN-13 / Code-128 / QR · ระยะที่ดี 10-20 cm
        </div>
      </div>
    </div>
  );
}

function CornerBrackets() {
  const cls = "absolute w-7 h-7 border-emerald-400 animate-corner-pulse";
  return (
    <>
      <div className={`${cls} top-0 left-0 border-t-[3px] border-l-[3px] rounded-tl-md`} />
      <div className={`${cls} top-0 right-0 border-t-[3px] border-r-[3px] rounded-tr-md`} />
      <div className={`${cls} bottom-0 left-0 border-b-[3px] border-l-[3px] rounded-bl-md`} />
      <div className={`${cls} bottom-0 right-0 border-b-[3px] border-r-[3px] rounded-br-md`} />
    </>
  );
}
