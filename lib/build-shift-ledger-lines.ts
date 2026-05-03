import type { ShiftDoc } from "@/types/firestore";

/** Plain-text lines for shift handover PDF / printouts. */
export function buildShiftLedgerLines(
  s: ShiftDoc & { id: string },
  walletLabel: (id: string) => string,
  fmtMoney: (n: number) => string
): string[] {
  const lines: string[] = [
    `Shift ${s.id}`,
    `Cashier: ${s.cashierEmail ?? s.cashierId}`,
    `Total fees (profit): ${fmtMoney(s.summary?.totalFees ?? 0)}`,
    `Transaction volume: ${fmtMoney(s.summary?.totalVolume ?? 0)}`,
    `Expenses: ${fmtMoney(s.summary?.totalExpenses ?? 0)}`,
    `Transactions: ${s.summary?.transactionCount ?? 0}`,
    `Wallet recharges: ${s.summary?.rechargeCount ?? 0}`,
  ];
  if (s.handoverNote?.trim()) {
    lines.push(`Handover: ${s.handoverNote.trim()}`);
  }
  const opening = s.openingBalances ?? {};
  if (Object.keys(opening).length) {
    lines.push("Opening balances:");
    for (const [id, v] of Object.entries(opening)) {
      lines.push(`  ${walletLabel(id)}: ${fmtMoney(v)}`);
    }
  }
  if (s.expectedBalances && Object.keys(s.expectedBalances).length) {
    lines.push("Expected closing balances:");
    for (const [id, v] of Object.entries(s.expectedBalances)) {
      lines.push(`  ${walletLabel(id)}: ${fmtMoney(v)}`);
    }
  }
  if (s.declaredBalances && Object.keys(s.declaredBalances).length) {
    lines.push("Declared closing balances:");
    for (const [id, v] of Object.entries(s.declaredBalances)) {
      lines.push(`  ${walletLabel(id)}: ${fmtMoney(v)}`);
    }
  }
  if (s.summary?.countsByType) {
    lines.push("Transactions by type:");
    for (const [ty, n] of Object.entries(s.summary.countsByType)) {
      lines.push(`  ${ty}: ${n}`);
    }
  }
  if (s.discrepancies && Object.keys(s.discrepancies).length) {
    lines.push("Discrepancies (declared - expected):");
    for (const [k, v] of Object.entries(s.discrepancies)) {
      lines.push(`${walletLabel(k)}: ${fmtMoney(v)}`);
    }
  }
  return lines;
}
