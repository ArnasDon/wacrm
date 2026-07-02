"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import { Download, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";

interface ImageLightboxProps {
  src: string;
  alt: string;
  open: boolean;
  onClose: () => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

export function ImageLightbox({ src, alt, open, onClose }: ImageLightboxProps) {
  const t = useTranslations("inbox.imageLightbox");
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragState = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(
    null,
  );

  const reset = useCallback(() => {
    setZoom(MIN_ZOOM);
    setPan({ x: 0, y: 0 });
  }, []);

  // Reset zoom/pan whenever the lightbox transitions from closed to open,
  // without an effect: this component stays mounted (it just renders null
  // while closed), so state would otherwise leak between openings. This is
  // React's endorsed "adjusting state during render" pattern.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setZoom(MIN_ZOOM);
      setPan({ x: 0, y: 0 });
    }
  }

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  const applyZoom = (updater: (current: number) => number) => {
    setZoom((current) => {
      const next = clampZoom(updater(current));
      if (next === MIN_ZOOM) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP / 2 : ZOOM_STEP / 2;
    applyZoom((z) => z + delta);
  };

  const handleDoubleClick = () => {
    if (zoom > MIN_ZOOM) {
      reset();
    } else {
      applyZoom(() => 2);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLImageElement>) => {
    if (zoom <= MIN_ZOOM) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLImageElement>) => {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    setPan({ x: dragState.current.panX + dx, y: dragState.current.panY + dy });
  };

  const handlePointerUp = () => {
    dragState.current = null;
    setIsDragging(false);
  };

  const handleDownload = async () => {
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const ext = blob.type.split("/")[1]?.split("+")[0] || "jpg";
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `image-${Date.now()}.${ext}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(src, "_blank", "noopener,noreferrer");
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={onClose}
    >
      <div
        className="absolute right-4 top-4 z-10 flex items-center gap-1 rounded-full bg-black/70 p-1 shadow-lg backdrop-blur-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => applyZoom((z) => z - ZOOM_STEP)}
          disabled={zoom <= MIN_ZOOM}
          className="rounded-full p-2 text-white transition-colors hover:bg-white/10 disabled:opacity-30"
          aria-label={t("zoomOut")}
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="min-w-10 select-none text-center text-xs text-white">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => applyZoom((z) => z + ZOOM_STEP)}
          disabled={zoom >= MAX_ZOOM}
          className="rounded-full p-2 text-white transition-colors hover:bg-white/10 disabled:opacity-30"
          aria-label={t("zoomIn")}
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={zoom === MIN_ZOOM && pan.x === 0 && pan.y === 0}
          className="rounded-full p-2 text-white transition-colors hover:bg-white/10 disabled:opacity-30"
          aria-label={t("resetZoom")}
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={handleDownload}
          className="rounded-full p-2 text-white transition-colors hover:bg-white/10"
          aria-label={t("download")}
        >
          <Download className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-2 text-white transition-colors hover:bg-white/10"
          aria-label={t("close")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div
        className="relative z-0 flex h-full w-full items-center justify-center overflow-hidden"
        onWheel={handleWheel}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={handleDoubleClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className={cn(
            "max-h-[90vh] max-w-[90vw] select-none object-contain",
            isDragging ? "cursor-grabbing" : zoom > MIN_ZOOM ? "cursor-grab" : "cursor-zoom-out",
          )}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transition: isDragging ? "none" : "transform 150ms ease-out",
          }}
        />
      </div>
    </div>,
    document.body,
  );
}
