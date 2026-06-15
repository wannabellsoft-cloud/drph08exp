"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from "react";
import { CheckIcon, AlertIcon, XIcon, TrashIcon } from "./Icons";

// ====================================================================
// Types
// ====================================================================
type Tone = "ok" | "warn" | "err" | "info";

type ToastT = {
  id: number;
  tone: Tone;
  title: string;
  body?: string;
  timeout: number;
};

type ConfirmOpts = {
  title: string;
  message?: string;
  danger?: boolean;
  confirmText?: string;
  cancelText?: string;
};

type PromptOpts = {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmText?: string;
  mono?: boolean;
};

type InfoOpts = {
  title: string;
  message?: string;
  lines?: string[];
  tone?: Tone;
  okText?: string;
};

type UICtxT = {
  toast: (tone: Tone, title: string, body?: string, timeout?: number) => void;
  ok: (title: string, body?: string) => void;
  warn: (title: string, body?: string) => void;
  err: (title: string, body?: string) => void;
  info: (title: string, body?: string) => void;
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  prompt: (opts: PromptOpts) => Promise<string | null>;
  showInfo: (opts: InfoOpts) => Promise<void>;
};

const Ctx = createContext<UICtxT | null>(null);
export const useUI = (): UICtxT => {
  const v = useContext(Ctx);
  if (!v) throw new Error("UIProvider missing");
  return v;
};

// ====================================================================
// Provider
// ====================================================================
export function UIProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastT[]>([]);
  const [confirmState, setConfirmState] = useState<
    (ConfirmOpts & { resolve: (b: boolean) => void }) | null
  >(null);
  const [promptState, setPromptState] = useState<
    (PromptOpts & { resolve: (s: string | null) => void; value: string }) | null
  >(null);
  const [infoState, setInfoState] = useState<
    (InfoOpts & { resolve: () => void }) | null
  >(null);

  const removeToast = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (tone: Tone, title: string, body?: string, timeout = 3500) => {
      const id = Date.now() + Math.random();
      setToasts((ts) => [...ts, { id, tone, title, body, timeout }]);
    },
    [],
  );
  const ok = useCallback((t: string, b?: string) => toast("ok", t, b), [toast]);
  const warn = useCallback((t: string, b?: string) => toast("warn", t, b), [toast]);
  const err = useCallback((t: string, b?: string) => toast("err", t, b, 5000), [toast]);
  const info = useCallback((t: string, b?: string) => toast("info", t, b), [toast]);

  const confirm = useCallback(
    (opts: ConfirmOpts) =>
      new Promise<boolean>((resolve) => {
        setConfirmState({ ...opts, resolve });
      }),
    [],
  );

  const prompt = useCallback(
    (opts: PromptOpts) =>
      new Promise<string | null>((resolve) => {
        setPromptState({ ...opts, value: opts.defaultValue ?? "", resolve });
      }),
    [],
  );

  const showInfo = useCallback(
    (opts: InfoOpts) =>
      new Promise<void>((resolve) => {
        setInfoState({ ...opts, resolve });
      }),
    [],
  );

  const value: UICtxT = { toast, ok, warn, err, info, confirm, prompt, showInfo };

  return (
    <Ctx.Provider value={value}>
      {children}

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 z-[200] flex flex-col-reverse gap-2 max-w-[calc(100vw-2rem)] w-80 pointer-events-none no-print">
        {toasts.map((t) => (
          <ToastItem key={t.id} t={t} onClose={() => removeToast(t.id)} />
        ))}
      </div>

      {/* Confirm */}
      {confirmState && (
        <ConfirmModal
          opts={confirmState}
          onAnswer={(b) => {
            confirmState.resolve(b);
            setConfirmState(null);
          }}
        />
      )}

      {/* Prompt */}
      {promptState && (
        <PromptModal
          opts={promptState}
          onChange={(v) => setPromptState((p) => (p ? { ...p, value: v } : p))}
          onAnswer={(s) => {
            promptState.resolve(s);
            setPromptState(null);
          }}
        />
      )}

      {/* Info */}
      {infoState && (
        <InfoModal
          opts={infoState}
          onClose={() => {
            infoState.resolve();
            setInfoState(null);
          }}
        />
      )}
    </Ctx.Provider>
  );
}

// ====================================================================
// Toast
// ====================================================================
const tones = {
  ok: {
    accent: "bg-emerald-500",
    text: "text-emerald-50",
    bar: "bg-emerald-200",
    icon: <CheckIcon className="w-5 h-5" />,
  },
  warn: {
    accent: "bg-amber-500",
    text: "text-amber-50",
    bar: "bg-amber-200",
    icon: <AlertIcon className="w-5 h-5" />,
  },
  err: {
    accent: "bg-rose-600",
    text: "text-rose-50",
    bar: "bg-rose-200",
    icon: <AlertIcon className="w-5 h-5" />,
  },
  info: {
    accent: "bg-indigo-600",
    text: "text-indigo-50",
    bar: "bg-indigo-200",
    icon: <AlertIcon className="w-5 h-5" />,
  },
};

function ToastItem({ t, onClose }: { t: ToastT; onClose: () => void }) {
  const timerRef = useRef<number | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    timerRef.current = window.setTimeout(onClose, t.timeout);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [paused, onClose, t.timeout]);

  const p = tones[t.tone];
  return (
    <div
      className={`animate-toast-in relative pointer-events-auto flex items-start gap-3 px-4 py-3 pr-8 rounded-xl shadow-lg overflow-hidden ${p.accent}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
    >
      <div className={`shrink-0 mt-0.5 ${p.text}`}>{p.icon}</div>
      <div className={`flex-1 min-w-0 ${p.text}`}>
        <div className="font-semibold text-sm leading-tight">{t.title}</div>
        {t.body && (
          <div className="text-xs mt-0.5 opacity-90 whitespace-pre-line break-words">
            {t.body}
          </div>
        )}
      </div>
      <button
        onClick={onClose}
        className={`absolute top-2 right-2 ${p.text} opacity-70 hover:opacity-100`}
      >
        <XIcon className="w-3.5 h-3.5" />
      </button>
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/15">
        <div
          className={`h-full ${p.bar} animate-toast-bar`}
          style={{
            animationDuration: `${t.timeout}ms`,
            animationPlayState: paused ? "paused" : "running",
          }}
        />
      </div>
    </div>
  );
}

// ====================================================================
// Backdrop wrapper
// ====================================================================
function ModalShell({
  children,
  onBackdropClick,
}: {
  children: ReactNode;
  onBackdropClick?: () => void;
}) {
  return (
    <div
      onClick={onBackdropClick}
      className="fixed inset-0 z-[180] flex items-center justify-center bg-slate-900/45 backdrop-blur-sm p-4 animate-backdrop-in no-print"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl max-w-sm w-full shadow-2xl animate-modal-in overflow-hidden"
      >
        {children}
      </div>
    </div>
  );
}

// ====================================================================
// Confirm modal
// ====================================================================
function ConfirmModal({
  opts,
  onAnswer,
}: {
  opts: ConfirmOpts;
  onAnswer: (b: boolean) => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onAnswer(false);
      if (e.key === "Enter") onAnswer(true);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onAnswer]);

  const ic = opts.danger ? (
    <TrashIcon className="w-5 h-5" />
  ) : (
    <AlertIcon className="w-5 h-5" />
  );
  return (
    <ModalShell onBackdropClick={() => onAnswer(false)}>
      <div className="px-5 pt-5 pb-3">
        <div className="flex items-start gap-3">
          <div
            className={`w-10 h-10 rounded-full grid place-items-center shrink-0 ${
              opts.danger ? "bg-rose-100 text-rose-600" : "bg-indigo-100 text-indigo-600"
            }`}
          >
            {ic}
          </div>
          <div className="flex-1 min-w-0 pt-1">
            <h2 className="font-bold text-slate-900 text-base leading-tight">{opts.title}</h2>
            {opts.message && (
              <p className="text-sm text-slate-600 mt-1.5 whitespace-pre-line">
                {opts.message}
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
        <button
          onClick={() => onAnswer(false)}
          className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition"
        >
          {opts.cancelText ?? "ยกเลิก"}
        </button>
        <button
          onClick={() => onAnswer(true)}
          className={`px-4 py-2 text-sm text-white font-semibold rounded-lg shadow-sm active:scale-95 transition ${
            opts.danger
              ? "bg-gradient-to-br from-rose-500 to-rose-700 hover:from-rose-600 hover:to-rose-800"
              : "bg-gradient-to-br from-indigo-500 to-indigo-700 hover:from-indigo-600 hover:to-indigo-800"
          }`}
        >
          {opts.confirmText ?? "ยืนยัน"}
        </button>
      </div>
    </ModalShell>
  );
}

// ====================================================================
// Prompt modal
// ====================================================================
function PromptModal({
  opts,
  onChange,
  onAnswer,
}: {
  opts: PromptOpts & { value: string };
  onChange: (v: string) => void;
  onAnswer: (s: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 60);
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onAnswer(null);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onAnswer]);

  return (
    <ModalShell onBackdropClick={() => onAnswer(null)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onAnswer(opts.value);
        }}
      >
        <div className="px-5 pt-5 pb-3">
          <h2 className="font-bold text-slate-900 text-base leading-tight">{opts.title}</h2>
          {opts.message && (
            <p className="text-sm text-slate-600 mt-1.5 whitespace-pre-line">{opts.message}</p>
          )}
          <input
            ref={inputRef}
            value={opts.value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={opts.placeholder}
            className={`w-full mt-3 px-3 py-2 text-sm border-2 border-slate-200 rounded-lg focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 ${
              opts.mono ? "font-mono" : ""
            }`}
          />
        </div>
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onAnswer(null)}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition"
          >
            ยกเลิก
          </button>
          <button
            type="submit"
            className="px-4 py-2 text-sm text-white font-semibold rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-700 hover:from-indigo-600 hover:to-indigo-800 active:scale-95 shadow-sm transition"
          >
            {opts.confirmText ?? "ตกลง"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ====================================================================
// Info modal
// ====================================================================
function InfoModal({
  opts,
  onClose,
}: {
  opts: InfoOpts;
  onClose: () => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const tone = opts.tone ?? "ok";
  const palettes: Record<Tone, string> = {
    ok: "bg-emerald-100 text-emerald-600",
    warn: "bg-amber-100 text-amber-600",
    err: "bg-rose-100 text-rose-600",
    info: "bg-indigo-100 text-indigo-600",
  };
  const ic = tone === "ok" ? <CheckIcon className="w-5 h-5" /> : <AlertIcon className="w-5 h-5" />;
  return (
    <ModalShell onBackdropClick={onClose}>
      <div className="px-5 pt-5 pb-3">
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-full grid place-items-center shrink-0 ${palettes[tone]}`}>
            {ic}
          </div>
          <div className="flex-1 min-w-0 pt-1">
            <h2 className="font-bold text-slate-900 text-base leading-tight">{opts.title}</h2>
            {opts.message && (
              <p className="text-sm text-slate-600 mt-1.5 whitespace-pre-line">{opts.message}</p>
            )}
            {opts.lines && opts.lines.length > 0 && (
              <ul className="text-sm text-slate-700 mt-2 space-y-1">
                {opts.lines.map((l, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-slate-400 mt-1">•</span>
                    <span className="flex-1">{l}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
      <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
        <button
          onClick={onClose}
          className="px-5 py-2 text-sm text-white font-semibold rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-700 hover:from-indigo-600 hover:to-indigo-800 active:scale-95 shadow-sm transition"
        >
          {opts.okText ?? "ตกลง"}
        </button>
      </div>
    </ModalShell>
  );
}
