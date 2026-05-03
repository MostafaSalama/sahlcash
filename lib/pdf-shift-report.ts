import { jsPDF } from "jspdf";
import arabicPkg from "arabic-persian-reshaper";

const ArabicShaper = arabicPkg.ArabicShaper;

// Try same-origin first (drop the file in /public/fonts/), then fall back to a
// jsDelivr-hosted copy of Noto Naskh Arabic (TTF — required by jsPDF; WOFF2
// from @fontsource is not supported by jsPDF).
const AR_FONT_SOURCES = [
  "/fonts/NotoNaskhArabic-Regular.ttf",
  "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io@main/fonts/NotoNaskhArabic/googlefonts/ttf/NotoNaskhArabic-Regular.ttf",
  "https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-naskh-arabic/NotoNaskhArabic_400Regular.ttf",
];

let cachedArabicFontB64: string | null = null;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const len = bytes.byteLength;
  const chunk = 0x8000;
  for (let i = 0; i < len; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, len)));
  }
  return btoa(binary);
}

async function loadArabicFontBase64(): Promise<string> {
  if (cachedArabicFontB64) return cachedArabicFontB64;
  let lastErr: unknown = null;
  for (const url of AR_FONT_SOURCES) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} for ${url}`);
        continue;
      }
      cachedArabicFontB64 = toBase64(await res.arrayBuffer());
      return cachedArabicFontB64;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `Arabic font fetch failed from all sources: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`
  );
}

function shapeLine(locale: string, line: string): string {
  if (locale !== "ar") return line;
  try {
    return ArabicShaper.convertArabic(line);
  } catch {
    return line;
  }
}

export async function downloadShiftLedgerPdf(input: {
  title: string;
  locale: string;
  lines: string[];
}): Promise<void> {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  const isAr = input.locale === "ar";

  if (isAr) {
    const b64 = await loadArabicFontBase64();
    doc.addFileToVFS("NotoNaskhArabic-Regular.ttf", b64);
    doc.addFont("NotoNaskhArabic-Regular.ttf", "NotoNaskhArabic", "normal");
    doc.setFont("NotoNaskhArabic");
  }

  let y = 16;
  doc.setFontSize(16);
  const titleShaped = shapeLine(input.locale, input.title);
  if (isAr) {
    doc.text(titleShaped, pageWidth - 14, y, { align: "right" });
  } else {
    doc.text(titleShaped, 14, y);
  }
  y += 10;
  doc.setFontSize(10);
  for (const line of input.lines) {
    const shaped = shapeLine(input.locale, line);
    const wrapped = doc.splitTextToSize(shaped, pageWidth - 28);
    if (y > 280) {
      doc.addPage();
      y = 16;
      doc.setFontSize(10);
      if (isAr) doc.setFont("NotoNaskhArabic");
      else doc.setFont("helvetica", "normal");
    }
    if (isAr) {
      doc.text(wrapped, pageWidth - 14, y, { align: "right" });
    } else {
      doc.text(wrapped, 14, y);
    }
    y += wrapped.length * 5 + 2;
  }
  doc.save(`sahl-shift-${Date.now()}.pdf`);
}
