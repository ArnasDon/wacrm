// Envio de fotos e vídeos do carro para o Cloudinary, igual ao admin do site
// (firebase-init.js, FireStorage): conta e preset públicos, sem senha.
// Roda no navegador.

const NUVEM = "dmxnnadfk";
const PRESET = "ibox-prime-gg";

export async function enviarParaCloudinary(arquivo: File, caminho: string): Promise<string> {
  // Sufixo único: o preset não sobrescreve um arquivo com o mesmo nome.
  const publicId = caminho.replace(/\//g, "_") + "_" + Date.now();
  const fd = new FormData();
  fd.append("file", arquivo);
  fd.append("upload_preset", PRESET);
  fd.append("public_id", publicId);
  const tipo = arquivo.type.startsWith("video/") ? "video" : "image";
  const r = await fetch(`https://api.cloudinary.com/v1_1/${NUVEM}/${tipo}/upload`, { method: "POST", body: fd });
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(e.error?.message || "O envio para o Cloudinary falhou");
  }
  const d = (await r.json()) as { secure_url: string };
  return d.secure_url;
}

/** Id no mesmo formato do admin do site (DB.genId). */
export function novoId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
