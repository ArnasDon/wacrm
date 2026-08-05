// ============================================================
// wa-ref.ts — inyecta el ref_code persistido por god.js en los CTAs
// click-to-WhatsApp (DAD §2.2): el código viaja en el texto pre-rellenado
// para el puente offline. Se bundlea desde 'self' (respeta CSP).
// ============================================================

function readRefCode(): string | null {
  try {
    const raw = localStorage.getItem("_exp_ref_code");
    if (raw && Date.now() > parseInt(raw, 10)) {
      localStorage.removeItem("_exp_ref_code");
      localStorage.removeItem("ref_code");
      return null;
    }
    return localStorage.getItem("ref_code");
  } catch {
    return null;
  }
}

const ref = readRefCode();

if (ref) {
  document.querySelectorAll<HTMLAnchorElement>("a[data-wa-cta]").forEach((a) => {
    try {
      const url = new URL(a.href);
      const text = url.searchParams.get("text") ?? "";
      url.searchParams.set("text", `${text} (código ${ref})`);
      a.href = url.toString();
    } catch {}
  });
}
