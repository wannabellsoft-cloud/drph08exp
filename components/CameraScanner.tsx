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
  const [err, setErr] = useState<string>("");
  const [status, setStatus] = useState<"starting" | "scanning" | "stopped">("starting");
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([]);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const decodedRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Quick HTTPS / secure-context check (camera access requires it)
        if (typeof window !== "undefined" && !window.isSecureContext) {
          throw new Error("ต้องเปิดผ่าน HTTPS เท่านั้น (Vercel หรือ localhost)");
        }
        const mod = await import("html5-qrcode");
        if (cancelled) return;
        const { Html5Qrcode } = mod;

        const list = await Html5Qrcode.getCameras();
        if (cancelled) return;
        const cams = list.map((c: any) => ({ id: c.id, label: c.label || c.id }));
        setCameras(cams);
        // Prefer back/environment camera if available
        const back = cams.find((c: any) => /back|environment|rear/i.test(c.label));
        const chosen = back?.id ?? cams[0]?.id ?? null;
        setCameraId(chosen);

        const scanner = new Html5Qrcode(REGION_ID, { verbose: false } as any);
        scannerRef.current = scanner;

        const config: any = {
          fps: 12,
          qrbox: (vw: number, vh: number) => {
            const size = Math.min(vw, vh);
            return {
              width: Math.round(size * 0.85),
              height: Math.round(size * 0.45),
            };
          },
          aspectRatio: 1.333,
          rememberLastUsedCamera: true,
        };

        const sourceArg: any = chosen ? chosen : { facingMode: "environment" };

        await scanner.start(
          sourceArg,
          config,
          (decodedText: string) => {
            if (cancelled || decodedRef.current === decodedText) return;
            decodedRef.current = decodedText;
            try {
              if (typeof navigator !== "undefined" && navigator.vibrate)
                navigator.vibrate(80);
            } catch {}
            onResult(decodedText.trim());
          },
          () => {
            // per-frame decode failures — ignore
          },
        );
        if (!cancelled) setStatus("scanning");
      } catch (e: any) {
        if (cancelled) return;
        const msg = String(e?.message ?? e ?? "เปิดกล้องไม่สำเร็จ");
        if (/permission|denied|notallowed/i.test(msg)) {
          setErr("ไม่ได้รับสิทธิ์เข้าถึงกล้อง — กรุณาอนุญาตในเบราว์เซอร์");
        } else if (/notfound|no.*cam/i.test(msg)) {
          setErr("ไม่พบกล้องบนอุปกรณ์นี้");
        } else {
          setErr(msg);
        }
        setStatus("stopped");
      }
    })();
    return () => {
      cancelled = true;
      const s = scannerRef.current;
      if (s) {
        s.stop()
          .catch(() => {})
          .then(() => {
            try {
              s.clear();
            } catch {}
          })
          .catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function switchCamera(newId: string) {
    if (newId === cameraId) return;
    const s = scannerRef.current;
    if (!s) return;
    try {
      await s.stop();
      setCameraId(newId);
      decodedRef.current = null;
      await s.start(
        newId,
        {
          fps: 12,
          qrbox: (vw: number, vh: number) => {
            const size = Math.min(vw, vh);
            return {
              width: Math.round(size * 0.85),
              height: Math.round(size * 0.45),
            };
          },
          aspectRatio: 1.333,
        } as any,
        (decodedText: string) => {
          if (decodedRef.current === decodedText) return;
          decodedRef.current = decodedText;
          try {
            if (navigator.vibrate) navigator.vibrate(80);
          } catch {}
          onResult(decodedText.trim());
        },
        () => {},
      );
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  }

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
                  ? "วางบาร์โค้ดให้อยู่ในกรอบ"
                  : status === "starting"
                  ? "กำลังเปิดกล้อง..."
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

        <div
          id={REGION_ID}
          className="w-full bg-black"
          style={{ minHeight: 320 }}
        />

        {cameras.length > 1 && (
          <div className="px-4 py-2 bg-slate-50 border-t border-slate-200">
            <label className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">
              เลือกกล้อง
            </label>
            <select
              value={cameraId ?? ""}
              onChange={(e) => switchCamera(e.target.value)}
              className="w-full mt-1 px-2 py-1.5 text-sm border border-slate-300 rounded-md"
            >
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {err && (
          <div className="m-3 px-3 py-2 bg-rose-50 text-rose-700 text-xs rounded-lg border border-rose-200 flex items-start gap-2">
            <AlertIcon className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{err}</span>
          </div>
        )}

        <div className="px-4 py-3 text-[11px] text-slate-500 border-t border-slate-100">
          รองรับ EAN-13, Code-128, QR code · iOS / Android · ต้องใช้ HTTPS
        </div>
      </div>
    </div>
  );
}
