"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { ImagePlus, Loader2, Star, Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { thumbUrl } from "@/lib/media/urls";

export interface ProductImage {
  id: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
}

const MAX_PHOTOS = 8;

/**
 * Photo manager for one product. Uploads go to our API (which
 * validates and forwards to the business's own storage — Cloudinary
 * or S3); the first photo is the cover
 * the sales rep sends first.
 */
export function ProductPhotos<T extends { _id: string; images?: ProductImage[] }>({
  product,
  enabled,
  onChange,
}: {
  product: T;
  enabled: boolean;
  onChange: (updated: T) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const images = product.images ?? [];

  const upload = async (files: FileList) => {
    const room = MAX_PHOTOS - images.length;
    const list = Array.from(files).slice(0, room);
    if (files.length > room) toast.warning(`Only ${room} more photo${room === 1 ? "" : "s"} allowed`);
    let latest: T | null = null;
    for (const file of list) {
      if (file.size > 4 * 1024 * 1024) {
        toast.error(`${file.name} is larger than 4 MB`);
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const form = new FormData();
        form.append("file", file);
        const r = await api<{ product: T }>(`/api/products/${product._id}/images`, { form });
        latest = r.product;
        onChange(r.product);
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (latest) toast.success("Photos added");
    if (inputRef.current) inputRef.current.value = "";
  };

  const act = async (imageId: string, method: "PATCH" | "DELETE") => {
    try {
      const r = await api<{ product: T }>(`/api/products/${product._id}/images/${imageId}`, { method });
      onChange(r.product);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (!enabled) {
    return (
      <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
        Connect photo storage first —{" "}
        <a href="/settings?tab=storage" className="underline">Settings → Storage</a> (Cloudinary, Amazon S3, Cloudflare R2 and more).
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {images.map((img, i) => (
          <div key={img.id} className="group relative size-20 overflow-hidden rounded-lg border border-slate-700 bg-slate-800">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumbUrl(img.url)} alt="" className="size-full object-cover" />
            {i === 0 && (
              <span className="absolute top-1 left-1 rounded bg-black/70 px-1 text-[9px] font-medium text-white">Cover</span>
            )}
            <div className="absolute inset-0 flex items-end justify-center gap-1 bg-gradient-to-t from-black/80 to-transparent p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              {i !== 0 && (
                <button type="button" aria-label="Make cover photo" onClick={() => act(img.id, "PATCH")} className="rounded bg-white/15 p-1 text-white hover:bg-white/30">
                  <Star className="size-3.5" />
                </button>
              )}
              <button type="button" aria-label="Delete photo" onClick={() => act(img.id, "DELETE")} className="rounded bg-white/15 p-1 text-white hover:bg-red-500/80">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
        ))}
        {Array.from({ length: uploading }).map((_, i) => (
          <div key={`u${i}`} className="flex size-20 items-center justify-center rounded-lg border border-dashed border-slate-700">
            <Loader2 className="size-5 animate-spin text-slate-400" />
          </div>
        ))}
        {images.length + uploading < MAX_PHOTOS && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex size-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-600 text-[11px] text-slate-400 transition-colors hover:border-primary hover:text-primary"
          >
            <ImagePlus className="size-5" />
            Add photo
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => e.target.files?.length && upload(e.target.files)}
      />
      <p className="mt-1.5 text-[11px] text-slate-500">
        JPEG or PNG (WebP on Cloudinary) up to 4 MB, max {MAX_PHOTOS}. The first photo is the cover — the sales rep sends it when a customer asks to see the product.
      </p>
    </div>
  );
}
