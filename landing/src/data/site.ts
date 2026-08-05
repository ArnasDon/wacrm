// ============================================================
// site.ts — configuración central de la landing (DAD §3.5 machote).
// TODO dueño: reemplazar placeholders con los datos reales de la clínica
// (teléfono WhatsApp, dominio, nombre, especialidades, testimonios).
// El ref_code viaja en el texto pre-rellenado (DAD §2.2 puente offline).
// ============================================================

export const site = {
  /** Dominio canónico (mismo dominio que Next para que god.js/forms funcionen) */
  baseUrl: "https://wacrm.tech",
  /** Ruta base de Astro (crítica: assets _astro/* bajo /landing/) */
  landingBase: "/landing",
  /** Nombre / marca de la clínica */
  clinicName: "Tu Clínica",
  /** Teléfono en formato internacional para wa.me (solo dígitos) */
  whatsappNumber: "5215512345678",
  /** Mensaje pre-rellenado — el ref_code se inyecta al final (DAD §2.2) */
  whatsappText: "Hola, vengo del sitio web y me gustaría más información.",
  /** ID de video testimonial (YouTube, facade on-demand) */
  videoId: "guJLfqTFfIw",
  /** Indexación SEO. Mientras los placeholders de arriba (clinicName,
   *  whatsappNumber, baseUrl) sigan siendo TODOs del fork, la landing
   *  se sirve con noindex + robots.txt Disallow (ver BaseLayout.astro
   *  y landing/public/robots.txt). Poner en true SOLO cuando el fork
   *  se despliegue con datos reales. */
  indexable: false,
  /** Preguntas frecuentes (FAQ con <details> nativo, cero JS) */
  faq: [
    {
      q: "¿Cómo agendo una cita?",
      a: "Escríbenos por WhatsApp con el botón de abajo y coordinamos el horario que mejor te convenga.",
    },
    {
      q: "¿Cuánto dura la primera sesión?",
      a: "La primera valoración dura entre 45 y 60 minutos e incluye el diagnóstico y el plan de tratamiento.",
    },
    {
      q: "¿Aceptan seguros?",
      a: "Sí, trabajamos con la mayoría de los seguros. Escríbenos y te confirmamos tu cobertura.",
    },
  ],
} as const;

/** Especialidades — grid con micro-CTA WhatsApp (DAD §3.5) */
export const specialties = [
  { name: "Fisioterapia", desc: "Recupera tu movilidad y elimina el dolor con tratamientos personalizados." },
  { name: "Rehabilitación", desc: "Programas de recuperación tras lesiones o cirugías, con seguimiento." },
  { name: "Terapia manual", desc: "Técnicas de precisión para contracturas y dolencias crónicas." },
  { name: "Ejercicio terapéutico", desc: "Fortalece y previene recaídas con un plan a tu medida." },
] as const;
