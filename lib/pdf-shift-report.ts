import { jsPDF } from "jspdf";

export function downloadShiftLedgerPdf(input: {
  title: string;
  locale: string;
  lines: string[];
}) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 16;
  doc.setFontSize(16);
  doc.text(input.title, 14, y);
  y += 10;
  doc.setFontSize(10);
  for (const line of input.lines) {
    const wrapped = doc.splitTextToSize(line, pageWidth - 28);
    if (y > 280) {
      doc.addPage();
      y = 16;
    }
    doc.text(wrapped, 14, y);
    y += wrapped.length * 5 + 2;
  }
  doc.save(`sahl-shift-${Date.now()}.pdf`);
}
