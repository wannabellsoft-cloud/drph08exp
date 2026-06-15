// Lightweight inline SVG icons (lucide-style, no extra dependency).
type P = { className?: string };
const base = "stroke-current fill-none";
const sw = "1.75";

export const ScanIcon = ({ className = "w-5 h-5" }: P) => (
  <svg viewBox="0 0 24 24" className={`${base} ${className}`} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
    <path d="M7 12h10" />
  </svg>
);

export const BoxIcon = ({ className = "w-5 h-5" }: P) => (
  <svg viewBox="0 0 24 24" className={`${base} ${className}`} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 8 12 3 3 8l9 5 9-5Z" />
    <path d="M3 8v8l9 5 9-5V8" />
    <path d="M12 13v8" />
  </svg>
);

export const UploadIcon = ({ className = "w-5 h-5" }: P) => (
  <svg viewBox="0 0 24 24" className={`${base} ${className}`} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m17 8-5-5-5 5" />
    <path d="M12 3v12" />
  </svg>
);

export const PrintIcon = ({ className = "w-4 h-4" }: P) => (
  <svg viewBox="0 0 24 24" className={`${base} ${className}`} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9V3h12v6" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <path d="M6 14h12v8H6z" />
  </svg>
);

export const DownloadIcon = ({ className = "w-4 h-4" }: P) => (
  <svg viewBox="0 0 24 24" className={`${base} ${className}`} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m7 10 5 5 5-5" />
    <path d="M12 15V3" />
  </svg>
);

export const PlusIcon = ({ className = "w-4 h-4" }: P) => (
  <svg viewBox="0 0 24 24" className={`${base} ${className}`} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const TrashIcon = ({ className = "w-4 h-4" }: P) => (
  <svg viewBox="0 0 24 24" className={`${base} ${className}`} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

export const LockIcon = ({ className = "w-4 h-4" }: P) => (
  <svg viewBox="0 0 24 24" className={`${base} ${className}`} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

export const UnlockIcon = ({ className = "w-4 h-4" }: P) => (
  <svg viewBox="0 0 24 24" className={`${base} ${className}`} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 9.9-1" />
  </svg>
);

export const PillIcon = ({ className = "w-5 h-5" }: P) => (
  <svg viewBox="0 0 24 24" className={`${base} ${className}`} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.5 20.5a7.78 7.78 0 0 1-11-11l11 11Z" />
    <path d="m8.5 8.5 7 7" />
    <path d="M13.5 3.5a7.78 7.78 0 0 1 11 11l-11-11Z" />
  </svg>
);

export const CheckIcon = ({ className = "w-4 h-4" }: P) => (
  <svg viewBox="0 0 24 24" className={`${base} ${className}`} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const AlertIcon = ({ className = "w-4 h-4" }: P) => (
  <svg viewBox="0 0 24 24" className={`${base} ${className}`} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
  </svg>
);

export const DatabaseIcon = ({ className = "w-5 h-5" }: P) => (
  <svg viewBox="0 0 24 24" className={`${base} ${className}`} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
    <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6" />
  </svg>
);

export const EditIcon = ({ className = "w-4 h-4" }: P) => (
  <svg viewBox="0 0 24 24" className={`${base} ${className}`} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
  </svg>
);

export const JournalIcon = ({ className = "w-5 h-5" }: P) => (
  <svg viewBox="0 0 24 24" className={`${base} ${className}`} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    <path d="M8 7h7M8 11h7" />
  </svg>
);

export const ArrowRightIcon = ({ className = "w-4 h-4" }: P) => (
  <svg viewBox="0 0 24 24" className={`${base} ${className}`} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14M13 5l7 7-7 7" />
  </svg>
);
