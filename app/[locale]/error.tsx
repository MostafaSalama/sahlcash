"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const tc = useTranslations("common");
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 p-8">
      <p className="text-center text-muted-foreground">{tc("error")}</p>
      {process.env.NODE_ENV === "development" ? (
        <pre className="max-w-lg overflow-auto rounded-md bg-muted p-3 text-xs">
          {error.message}
        </pre>
      ) : null}
      <Button type="button" onClick={() => reset()}>
        {tc("retry")}
      </Button>
    </div>
  );
}
