"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AttachmentFieldProps = {
  file: File | null;
  onChange: (file: File | null) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
  removeLabel: string;
};

export function AttachmentField({
  file,
  onChange,
  label,
  hint,
  disabled,
  removeLabel,
}: AttachmentFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function clear() {
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <Input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        disabled={disabled}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      {previewUrl ? (
        <div className="flex flex-wrap items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt=""
            className="h-16 w-16 rounded-md border object-cover"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={clear}
            disabled={disabled}
          >
            {removeLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
