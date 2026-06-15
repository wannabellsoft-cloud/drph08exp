"use client";
import { useEffect, useRef, useState } from "react";
import { CameraIcon, XIcon, AlertIcon } from "./Icons";

const REGION_ID = "camera-scan-region";

export function CameraScanner({
  onResult,
  onClose,
}: {
  onResult: (code: string) => void;
  onClose: () => void;
}) {
  const scannerRef = useRef<any>(null);
  const startedRef = useRef(false);
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
          throw new Error("ต้องเปิดผ่าน HTTPS เท่านั้น (Vercel หรือ localhost)");
        }
        const mod = await import("html5-qrcode");
        if (cancelled) return;
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = mod as any;

        const scanner = new Html5Qrcode(REGION_ID, {
          verbose: false,
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.ITF,
            Html5QrcodeSupportedFormats.QR_CODE,
          ],
        } as any);
        scannerRef.current = scanner;

        const scanConfig: any = {
          fps: 20,
          qrbox: (vw: number, vh: number) => {
            const w = Math.min(Math.round(vw * 0.92), 520);
            const h = Math.min(Math.round(vh * 0.35), 200);
            return { width: w, height: h };
          },
          aspectRatio: window.innerHeight > window.innerWidth ? 1.3333 : 1.7777,
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
          // Detailed MediaTrackConstraints belong here, not in the first
          // argument of start() — html5-qrcode requires that arg to have
          // exactly one of facingMode / deviceId.
          videoConstraints: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        };

        const onDecode = (decodedText: string) => {
          if (cancelled) return;
          const txt = (decodedText || "").trim();
          if (!txt || decodedRef.current === txt) return;
          decodedRef.current = txt;
          try {
            if (navigator.vibrate) navigator.vibrate(80);
          } catch {}
          onResult(txt);
        };

        // Single start call. The first arg must have exactly 1 key
        // (facingMode OR deviceId). The full constraints (resolution etc.)
        // are handed in via scanConfig.videoConstraints above.
        await scanner.start(
          { facingMode: "environment" } as any,
          scanConfig,
          onDecode,
          () => {},
        );

        if (cancelled) {
          // Modal was closed before start resolved — tear down now
          try {
            await scanner.stop();
            scanner.clear();
          } catch {}
          return;
        }
        startedRef.current = true;
        setStatus("scanning");
      } catch (e: any) {
        if (cancelled) return;
        const msg = String(e?.message ?? e ?? "เปิดกล้องไม่สำเร็จ");
        if (/permission|denied|notallowed/i.test(msg)) {
          setErr("ไม่ได้รับสิทธิ์เข้าถึงกล้อง — กรุณาอนุญาตในเบราว์เซอร์");
        } else if (/notfound|no.*cam|overconstrained/i.test(msg)) {
          setErr("ไม่พบกล้องบนอุปกรณ์นี้");
        } else if (/transition/i.test(msg)) {
          setErr("กล้องยังกำลังเริ่มทำงาน — ลองปิดและเปิดใหม่อีกครั้ง");
        } else {
          setErr(msg);
        }
        setStatus("stopped");
      }
    })();

    return () => {
      cancelled = true;
      const s = scannerRef.current;
      if (!s) return;
      // Only stop if we successfully started — calling stop() during the
      // start transition is what triggers "Cannot Transition" errors.
      if (!startedRef.current) return;
      try {
        const state = typeof s.getState === "function" ? s.getState() : 2;
        // Html5QrcodeScannerState: NOT_STARTED=1, SCANNING=2, PAUSED=3
        if (state === 2 || state === 3) {
          s.stop()
            .catch(() => {})
            .then(() => {
              try {
                s.clear();
              } catch {}
            })
            .catch(() => {});
        }
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
              <CameraIcon className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">สแกนบาร์โค้ด</div>
              <div className="text-[11px] text-slate-500">
                {status === "scanning"
                  ? "วางบาร์โค้ดให้อยู่ในกรอบแนวนอน"
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

        <div id={REGION_ID} className="w-full bg-black" style={{ minHeight: 320 }} />

        {err && (
          <div className="m-3 px-3 py-2 bg-rose-50 text-rose-700 text-xs rounded-lg border border-rose-200 flex items-start gap-2">
            <AlertIcon className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{err}</span>
          </div>
        )}

        {isIOS && (
          <div className="mx-3 mb-3 px-3 py-2 bg-amber-50 text-amber-800 text-[11px] rounded-lg border border-amber-200">
            <span className="font-semibold">iOS Safari:</span> ถ้าไม่อยากกดอนุญาตทุกครั้ง
            ให้กดปุ่ม Share <span className="font-mono">⤴</span> →{" "}
            <span className="font-mono">"Add to Home Screen"</span> →
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
