"use client";

// Render an in-DOM element to a single-page A4 PDF via html2canvas + jsPDF.
// Both libs are lazy-loaded so they don't bloat the initial bundle.
export async function elementToPdfBlob(element: HTMLElement): Promise<Blob> {
  const [{ default: html2canvas }, jspdfMod] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);
  const jsPDF = (jspdfMod as any).jsPDF ?? (jspdfMod as any).default;

  const canvas = await html2canvas(element, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
    logging: false,
  });

  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const availW = pageW - margin * 2;
  const availH = pageH - margin * 2;
  const imgRatio = canvas.width / canvas.height;
  let drawW = availW;
  let drawH = drawW / imgRatio;
  if (drawH > availH) {
    drawH = availH;
    drawW = drawH * imgRatio;
  }
  const x = (pageW - drawW) / 2;
  const y = margin;
  pdf.addImage(imgData, "PNG", x, y, drawW, drawH);
  return pdf.output("blob");
}

// Try to use the Web Share API to send the file (so the user can pick Line,
// Mail, etc.). Falls back to a download if the browser can't share files.
export async function shareOrDownloadBlob(
  blob: Blob,
  filename: string,
  title?: string,
): Promise<{ shared: boolean; cancelled: boolean }> {
  const file = new File([blob], filename, { type: blob.type || "application/pdf" });
  const nav = navigator as any;
  if (typeof nav.share === "function") {
    const canShareFiles =
      typeof nav.canShare === "function" ? nav.canShare({ files: [file] }) : true;
    if (canShareFiles) {
      try {
        await nav.share({ files: [file], title: title ?? filename });
        return { shared: true, cancelled: false };
      } catch (e: any) {
        if (e?.name === "AbortError") {
          return { shared: false, cancelled: true };
        }
        // else fall through to download
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return { shared: false, cancelled: false };
}
