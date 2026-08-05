// ============================================================
// copy-dist.mjs — copia el output de Astro (dist/) a public/landing/
// del paquete raíz (Next), para que Next sirva la landing en /landing/...
// (DAD §3.1: "Build: astro build → copia dist/ a public/landing/").
// ============================================================

import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const dist = join(root, "dist");
const target = resolve(root, "..", "public", "landing");

if (!existsSync(dist)) {
  console.error("landing: dist/ no existe — corre `astro build` antes.");
  process.exit(1);
}

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(dist, target, { recursive: true });

console.log(`landing: copiado ${dist} → ${target}`);
