"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type AttachmentThumbnailProps = {
  /** Thumbnails shown in the cell (usually one URL) */
  urls: string[];
  /** Optional larger list for prev/next in the lightbox (e.g. all photos in tab) */
  lightboxUrls?: string[];
  /** Index into lightboxUrls when opening the dialog */
  lightboxIndex?: number;
  title: string;
  className?: string;
  emptyLabel?: string;
  prevLabel: string;
  nextLabel: string;
};

export function AttachmentThumbnail({
  urls,
  lightboxUrls,
  lightboxIndex = 0,
  title,
  className,
  emptyLabel = "—",
  prevLabel,
  nextLabel,
}: AttachmentThumbnailProps) {
  const displayUrls = urls.filter(Boolean);
  const navList =
    lightboxUrls && lightboxUrls.length > 0
      ? lightboxUrls.filter(Boolean)
      : displayUrls;
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);

  const safeIdx = navList.length ? Math.min(idx, navList.length - 1) : 0;
  const current = navList[safeIdx] ?? null;

  const goPrev = useCallback(() => {
    setIdx((i) => (navList.length ? (i - 1 + navList.length) % navList.length : 0));
  }, [navList.length]);

  const goNext = useCallback(() => {
    setIdx((i) => (navList.length ? (i + 1) % navList.length : 0));
  }, [navList.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, goPrev, goNext]);

  function openDialog() {
    const start =
      lightboxUrls && lightboxUrls.length > 0
        ? Math.max(0, Math.min(lightboxIndex ?? 0, navList.length - 1))
        : 0;
    setIdx(start);
    setOpen(true);
  }

  if (!displayUrls.length) {
    return (
      <span className={`text-muted-foreground ${className ?? ""}`}>
        {emptyLabel}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        className={`focus-visible:ring-ring rounded-md border bg-muted/30 focus-visible:outline-none focus-visible:ring-2 ${className ?? ""}`}
        onClick={openDialog}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={displayUrls[0]}
          alt=""
          className="h-9 w-9 object-cover"
        />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          {current ? (
            <div className="space-y-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={current}
                alt=""
                className="max-h-[70vh] w-full object-contain"
              />
              {navList.length > 1 ? (
                <div className="flex items-center justify-between gap-2">
                  <Button type="button" variant="outline" onClick={goPrev}>
                    {prevLabel}
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {safeIdx + 1} / {navList.length}
                  </span>
                  <Button type="button" variant="outline" onClick={goNext}>
                    {nextLabel}
                  </Button>
                </div>
              ) : null}
              <a
                href={current}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-primary underline"
              >
                {title}
              </a>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
