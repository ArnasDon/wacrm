// ============================================================
// site.ts — única fuente de verdad del negocio (skill §2.4).
//
// Ningún dato del cliente se escribe dentro de un componente: el layout, el
// grafo de datos estructurados y el widget de contacto leen todo de aquí.
//
// TODO dueño: reemplazar los placeholders con los datos reales antes de
// poner `indexable: true`.
// ============================================================

export const site = {
  // ── Identidad ──
  name: "Tu Clínica",
  legalName: "Tu Clínica S.A. de C.V.",
  /** Dominio canónico (mismo dominio que Next para que god.js/forms funcionen) */
  baseUrl: "https://wacrm.tech",
  /** Ruta base de Astro (crítica: assets _astro/* bajo /landing/) */
  landingBase: "/landing",
  logo: "/landing/logo.svg",
  lang: "es-MX",

  // ── Contacto ──
  phone: "+52 55 1234 5678",
  /** Teléfono en formato internacional para wa.me (solo dígitos) */
  whatsappNumber: "5215512345678",
  /** Mensaje pre-rellenado — el ref_code se inyecta al final (wa-ref.ts) */
  whatsappText: "Hola, vengo del sitio web y me gustaría más información.",
  email: "contacto@tuclinica.mx",

  // ── Ubicación ──
  address: {
    street: "Av. Reforma 100",
    locality: "Ciudad de México",
    region: "CDMX",
    postalCode: "06600",
    country: "MX",
  },
  areaServed: ["MX"],

  // ── Negocio (alimenta el nodo principal del grafo, skill §9.2) ──
  schemaType: "MedicalClinic" as const,
  priceRange: "$$",
  currency: "MXN",
  openingHours: "Mo-Fr 09:00-19:00, Sa 09:00-14:00",
  languages: ["Spanish"],
  paymentAccepted: ["Cash", "Credit Card"],

  // ── Autoridad (E-E-A-T) ──
  author: {
    name: "Dra. Nombre Apellido",
    url: "https://wacrm.tech/landing/#autoridad",
    image: "/landing/equipo.webp",
    jobTitle: "Fisioterapeuta",
    knowsAbout: ["Fisioterapia", "Rehabilitación", "Terapia manual"],
    sameAs: [] as string[],
  },
  certifications: [] as string[],

  // ── Redes ──
  social: [] as string[],

  // ── Marca — BaseLayout las vuelca en :root ──
  theme: {
    primary: "#059669",
    primaryDark: "#047857",
    accent: "#0284c7",
  },

  // ── Medición ──
  /** Imagen Open Graph, 1200×630 (skill §20) */
  ogImage: "/landing/og.png",
  /** ID de video testimonial (YouTube, fachada bajo demanda) */
  videoId: "guJLfqTFfIw",
  /** Indexación SEO. Mientras los placeholders de arriba sigan siendo TODOs
   *  del fork, la landing se sirve con noindex + robots.txt Disallow.
   *  Poner en true SOLO cuando se despliegue con datos reales. */
  indexable: false,

  // ── Widget de contacto flotante (skill §7.7) ──
  widget: {
    aria: "Canales de contacto",
    pill: "Atención al paciente",
    online: "En línea",
    heading: "¿Cómo podemos ayudarte?",
    prompt: "Elige una opción para continuar:",
    close: "Cerrar",
    back: "Volver",
    sales: { title: "WhatsApp", text: "Habla con nosotros ahora mismo" },
    support: { title: "Agenda tu valoración", text: "Déjanos tus datos y te llamamos" },
  },

  // ── Catálogo de servicios — alimenta el grafo y la sección de oferta ──
  services: [
    {
      name: "Fisioterapia",
      desc: "Recupera tu movilidad y elimina el dolor con tratamientos personalizados.",
      price: "600",
    },
    {
      name: "Rehabilitación",
      desc: "Programas de recuperación tras lesiones o cirugías, con seguimiento.",
      price: "750",
    },
    {
      name: "Terapia manual",
      desc: "Técnicas de precisión para contracturas y dolencias crónicas.",
      price: "650",
    },
    {
      name: "Ejercicio terapéutico",
      desc: "Fortalece y previene recaídas con un plan a tu medida.",
      price: "550",
    },
  ],

  // ── Cifras de respaldo (franja de credibilidad, skill §15.1 paso 2) ──
  proof: [
    { num: "12", label: "años de experiencia" },
    { num: "4.000+", label: "pacientes atendidos" },
    { num: "24 h", label: "tiempo de respuesta" },
    { num: "95%", label: "continúan su tratamiento" },
  ],

  // ── Proceso (reducción de fricción, skill §15.1 paso 6) ──
  steps: [
    { title: "Nos escribes", text: "Por WhatsApp o dejando tus datos en el formulario." },
    { title: "Te llamamos", text: "En menos de 24 horas, para entender tu caso." },
    { title: "Valoración", text: "45–60 minutos: diagnóstico y plan de tratamiento." },
    { title: "Tratamiento", text: "Sesiones con seguimiento y ajustes según tu avance." },
  ],

  // ── Preguntas frecuentes (acordeón nativo, cero JS) ──
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
      a: "Trabajamos con la mayoría de los seguros. Escríbenos y te confirmamos tu cobertura.",
    },
    {
      q: "¿Qué llevo a la primera cita?",
      a: "Ropa cómoda y, si los tienes, estudios previos como radiografías o resonancias.",
    },
  ],
} as const;

/** Acción principal. Se repite entre 3 y 5 veces con EXACTAMENTE este texto:
 *  variar el texto del botón fragmenta el reconocimiento (skill §15.2). */
export const PRIMARY_CTA = "Agenda tu valoración";

/** Enlace a WhatsApp con el mensaje pre-rellenado. */
export const whatsappHref = `https://wa.me/${site.whatsappNumber}?text=${encodeURIComponent(site.whatsappText)}`;
