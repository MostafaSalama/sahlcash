import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 p-4">
      <div className="mb-8 text-center">
        <p className="text-2xl font-bold text-primary">SahlCash</p>
        <p className="text-sm text-muted-foreground">سهل كاش</p>
      </div>
      {children}
    </div>
  );
}
