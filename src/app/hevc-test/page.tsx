"use client";

/**
 * ISOLATED PROTOTYPE PAGE — deliberately outside (dashboard), so it's
 * reachable without login (middleware.ts's protectedPaths only gates
 * /dashboard, /inbox, /contacts, /pipelines, /broadcasts, /automations,
 * /settings). Not linked from anywhere in the app's own navigation.
 *
 * Purpose: let a real iPhone test whether native WebCodecs (via
 * `mediabunny`) can transcode a freshly-recorded HEVC/.mov video to
 * H.264/AAC .mp4 reliably and fast — WITHOUT touching the real
 * composer/upload/send flow at all. See hevc-prototype.ts.
 *
 * Temporary by design — meant to be removed once validated (or kept
 * gated) once a decision is made on integrating this into production.
 */

import { useCallback, useRef, useState } from "react";
import {
  looksLikeHevcOrMov,
  inspectSource,
  convertViaWebCodecs,
  type SourceInspection,
} from "@/lib/media/hevc-prototype";

type Status = "idle" | "inspecting" | "converting" | "done" | "error";

export default function HevcTestPage() {
  const [status, setStatus] = useState<Status>("idle");
  const [inspection, setInspection] = useState<SourceInspection | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultInfo, setResultInfo] = useState<{
    ms: number;
    outputSizeBytes: number;
  } | null>(null);
  const prevUrlRef = useRef<string | null>(null);

  const reset = useCallback(() => {
    if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
    prevUrlRef.current = null;
    setInspection(null);
    setProgress(0);
    setError(null);
    setResultUrl(null);
    setResultInfo(null);
    setStatus("idle");
  }, []);

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      reset();
      setStatus("inspecting");
      try {
        const info = await inspectSource(file);
        setInspection(info);
        setStatus("idle");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
        return;
      }

      // Kick off conversion automatically for HEVC/.mov, mirroring the
      // real flow's "detect -> convert" decision (isQuickTimeVideo).
      if (looksLikeHevcOrMov(file)) {
        setStatus("converting");
        try {
          const result = await convertViaWebCodecs(file, setProgress);
          const url = URL.createObjectURL(result.blob);
          prevUrlRef.current = url;
          setResultUrl(url);
          setResultInfo({ ms: result.ms, outputSizeBytes: result.outputSizeBytes });
          setStatus("done");
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          setStatus("error");
        }
      }
    },
    [reset],
  );

  return (
    <div
      style={{
        maxWidth: 640,
        margin: "0 auto",
        padding: 24,
        fontFamily: "system-ui, sans-serif",
        color: "#e5e5e5",
        background: "#0a0a0a",
        minHeight: "100vh",
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>
        Protótipo isolado — HEVC/MOV via WebCodecs
      </h1>
      <p style={{ fontSize: 13, opacity: 0.7, marginTop: 4 }}>
        Não usa o composer, não faz upload, não envia nada. Só testa se este
        navegador consegue converter um vídeo HEVC/.mov pra H.264/AAC .mp4
        usando WebCodecs nativo (via mediabunny), sem servidor e sem custo.
      </p>

      <div
        style={{
          marginTop: 16,
          padding: 12,
          borderRadius: 8,
          background: "#171717",
          fontSize: 13,
        }}
      >
        <strong>WebCodecs neste navegador:</strong>{" "}
        {typeof globalThis !== "undefined" &&
        typeof (globalThis as unknown as { VideoEncoder?: unknown }).VideoEncoder !==
          "undefined"
          ? "✅ presente"
          : "❌ ausente"}
      </div>

      {/* accept idêntico ao PICKER_ACCEPT.video do composer real
          (message-composer.tsx) — de propósito. accept="video/*"
          genérico levou o iOS a entregar o vídeo já convertido pra
          H.264 antes mesmo de chegar no JS (visto pela diferença de
          tamanho vs. o original no Fotos), mascarando o cenário real. */}
      <input
        type="file"
        accept="video/mp4,video/3gpp,video/quicktime,.mov"
        style={{ marginTop: 16, display: "block" }}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      {status === "inspecting" && <p style={{ marginTop: 16 }}>Inspecionando arquivo…</p>}

      {inspection && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 8,
            background: "#171717",
            fontSize: 13,
            lineHeight: 1.7,
          }}
        >
          <div>
            <strong>Arquivo:</strong> {inspection.fileName} (
            {(inspection.fileSizeBytes / 1024 / 1024).toFixed(1)} MB,{" "}
            {inspection.fileType || "sem MIME"})
          </div>
          <div>
            <strong>Faixa de vídeo:</strong>{" "}
            {inspection.hasVideoTrack ? "sim" : "não encontrada"}
          </div>
          <div>
            <strong>Codec detectado:</strong> {inspection.videoCodec ?? "—"}
          </div>
          <div>
            <strong>canDecode() neste navegador:</strong>{" "}
            {inspection.canDecode === null
              ? "—"
              : inspection.canDecode
                ? "✅ sim"
                : "❌ não"}
          </div>
          <div>
            <strong>Rotação:</strong> {inspection.rotation ?? "—"}°
          </div>
          <div>
            <strong>Dimensões:</strong> {inspection.width ?? "—"}×
            {inspection.height ?? "—"}
          </div>
          <div>
            <strong>Duração:</strong>{" "}
            {inspection.durationSeconds?.toFixed(1) ?? "—"}s
          </div>
        </div>
      )}

      {status === "converting" && (
        <div style={{ marginTop: 16 }}>
          <p>Convertendo… {(progress * 100).toFixed(0)}%</p>
          <div
            style={{
              height: 8,
              borderRadius: 4,
              background: "#262626",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${progress * 100}%`,
                background: "#7c3aed",
                transition: "width 150ms linear",
              }}
            />
          </div>
        </div>
      )}

      {status === "error" && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 8,
            background: "#3f1d1d",
            color: "#fecaca",
            fontSize: 13,
          }}
        >
          <strong>Erro:</strong> {error}
        </div>
      )}

      {status === "done" && resultUrl && resultInfo && (
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              padding: 12,
              borderRadius: 8,
              background: "#0f2e1a",
              color: "#bbf7d0",
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            <strong>Conversão concluída em {(resultInfo.ms / 1000).toFixed(1)}s</strong>
            <br />
            Tamanho de saída: {(resultInfo.outputSizeBytes / 1024 / 1024).toFixed(1)} MB
          </div>
          <video
            src={resultUrl}
            controls
            playsInline
            style={{ width: "100%", borderRadius: 8, background: "#000" }}
          />
          <a
            href={resultUrl}
            download="converted.mp4"
            style={{
              display: "inline-block",
              marginTop: 12,
              padding: "8px 16px",
              borderRadius: 6,
              background: "#7c3aed",
              color: "#fff",
              textDecoration: "none",
              fontSize: 13,
            }}
          >
            Baixar .mp4 convertido
          </a>
        </div>
      )}
    </div>
  );
}
