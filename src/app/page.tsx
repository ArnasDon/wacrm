// La raíz sirve la landing estática (Astro → public/landing) vía
// rewrites() en next.config.ts (DAD §3.1). Sin redirect a /dashboard:
// la home pública del deploy es la landing del Revenue Engine.
export default function RootPage() {
  return null;
}
