# Framework de Landing Pages en Astro
### SOP de producción — sistema completo, sin Tailwind, sin React, sin JavaScript innecesario

> **Si eres un agente y no tienes contexto previo, vete a [§21](#21-directrices-para-agentes-de-ia) y vuelve.**
> Ahí está el orden de trabajo, las cinco decisiones que se equivocan siempre y
> los comandos de verificación. Este documento tiene casi 4.000 líneas: leerlo
> de arriba abajo antes de empezar es la forma más rápida de construir lo que no
> es. §21 dice qué se construye y en qué orden; el resto es la referencia que se
> consulta desde ahí.

---

## 0. Qué construye este documento

Un sistema para producir landing pages de alto rendimiento en Astro, orientadas a campañas de búsqueda pagada (SEM), SEO local y clusters de autoridad.

### Qué ES y qué NO es

**Es una biblioteca de secciones terminadas. No es un framework para maquetar.**

Esta distinción decide si el resultado sirve. La misma landing se repite decenas de veces cambiando textos e imágenes; nadie maqueta nada. Se elige una sección del catálogo, se rellena y se pasa a la siguiente.

| Si lo lees como… | Construyes… | Resultado |
|---|---|---|
| Un sistema de utilidades | Tokens, grilla y utilidades, y luego escribes cada sección a mano combinándolas | Un Tailwind casero. **Mal.** |
| Una biblioteca de secciones | Las secciones del catálogo, completas y reutilizables, sobre esos tokens | Una landing que se repite sin volver a maquetar. **Bien.** |

Por eso las secciones 3 a 6 —tokens, layout, utilidades, componentes— son **el sustrato**, no el entregable. El entregable son las 24 secciones que se listan aquí abajo; §10 no es ese listado, sino la API y la anatomía que cada una de ellas implementa.

**Si al terminar tienes un sistema de estilos elegante y tres secciones escritas a mano, has fallado.**

### El catálogo

Toda landing dispone de estas 24 secciones. Constrúyelas todas: son el producto.

`hero-centered` · `hero-split` · `hero-fakeh1` · `stats-strip` · `features` · `text-section` · `video` · `gallery` · `testimonials` · `reviews` · `scroller` · `pricing` · `pricing-table` · `comparison` · `table` · `steps` · `team` · `faq` · `cta` · `form` · `lead-magnet` · `related-pages` · `breadcrumb` · `divider`

Más el cromo del sitio: cabecera con menú y popup, pie, y widget de contacto flotante.

### El resultado esperado de cada página

| Métrica | Objetivo |
|---|---|
| Lighthouse Performance (mobile) | ≥ 98 |
| Lighthouse Accessibility | 100 |
| JavaScript enviado al cliente | < 5 KB comprimido |
| Requests de CSS | 0 (va inline en el `<head>`) |
| Cumulative Layout Shift | 0 |
| Funciona con JavaScript deshabilitado | Sí, incluido el envío de formularios; salvo el reproductor de video |
| Datos estructurados | `@graph` JSON-LD completo, validado |
| Scripts de terceros en la carga inicial | Solo el contenedor de etiquetas |

La velocidad no es estética: en campañas de búsqueda pagada, el Quality Score depende de la experiencia de la página de destino, y el Quality Score determina el costo por clic. **Cada kilobyte que no envías es presupuesto que no quemas.**

Un proyecto = un sitio. Sin monorepos, sin paquetes compartidos, sin dependencias entre clientes. Cada landing es autónoma y se despliega sola.

---

## 1. Principios no negociables

Estos son los criterios con los que se acepta o se rechaza cada línea de código.

**1. Sin frameworks de CSS.** CSS nativo con `@layer`, custom properties y las clases definidas en este documento. Cero dependencias de estilo en `package.json`.

**2. Sin frameworks de UI.** Astro renderiza a HTML. Nada de React, Vue, Svelte, shadcn, Material, Bootstrap o DaisyUI. Si algo requiere interactividad, es un custom element de menos de 30 líneas.

**3. Sin estilos inline… con un matiz que hay que conocer.** Ningún `style="..."` en el markup de una sección del catálogo: si un valor se repite es una clase o un token, y si es específico de un componente va en su `<style>` con scope. Sí se permite pasar **tokens** por atributo —`style="--i: 3"`, `style="--rail-cols: 4"`— porque eso es un dato, no un estilo.

  El matiz: la implementación de referencia en producción (el tema de WordPress) sí usa `style="top:30%;right:0"` para ajustes de una sola vez, porque el dueño edita el marcado a mano. **Para una sección nueva del catálogo, no los uses**: una sección que se va a repetir decenas de veces no puede llevar decisiones sueltas en el marcado. Si estás retocando una landing concreta ya construida, el criterio del dueño manda.

**4. Sin `!important`.** El sistema de capas hace innecesaria la escalada de especificidad. Un `!important` significa que la capa está mal elegida.

**5. `<section>` como raíz de todo bloque.** Nunca un `<div>`. Cada sección lleva su `itemscope`/`itemtype`. Los motores de búsqueda y los modelos de lenguaje segmentan el documento por secciones semánticas; un muro de `<div>` no comunica estructura.

**6. Mobile-first literal, con un solo breakpoint estructural: `900px`.** El caso base —sin ningún media query— es el móvil. Por encima de 900px aparece la grilla. No existe una categoría intermedia de "tablet".

  **Nunca uses `max-width` para layout.** Escribir el escritorio y deshacerlo para móvil es la lógica invertida, y es el error más frecuente al usar este sistema. Si te encuentras escribiendo `@media (max-width: …)` para colocar algo, reescríbelo al revés. Los media queries que no son de grilla —movimiento reducido, área segura, dirección de arte de imágenes— no cuentan.

**7. JavaScript solo donde el CSS no llega.** El comportamiento por defecto de un componente es cero JavaScript. Cualquier `client:*` requiere un comentario que justifique por qué el CSS no resuelve el caso.

**8. Sin valores por defecto silenciosos.** Un campo obligatorio que falta rompe el build. Nunca se publica una página con un placeholder de relleno.

**9. Todo el contenido se resuelve en build time.** Ninguna página consulta una API durante la visita. La única ruta que se ejecuta bajo demanda en todo el sitio es la del formulario: recibe el lead, lo valida y lo entrega. Todo lo demás es HTML estático servido desde CDN.

---

## 2. Setup del proyecto

### 2.1 Estructura

```
proyecto/
├── astro.config.mjs
├── package.json
├── tsconfig.json
├── public/
│   ├── favicon.svg
│   └── robots.txt
└── src/
    ├── config/
    │   └── site.ts              # única fuente de verdad del negocio
    ├── styles/
    │   ├── index.css            # declaración de capas + imports
    │   ├── 01-reset.css
    │   ├── 02-tokens.css
    │   ├── 03-base.css
    │   ├── 04-layout.css
    │   ├── 05-components.css
    │   ├── 06-utilities.css
    │   └── 07-motion.css
    ├── components/              # primitivas reutilizables
    │   ├── ContactForm.astro    # marcado único del formulario
    │   └── ContactLauncher.astro
    ├── modules/                 # bloques de página
    │   └── _registry.ts
    ├── layouts/
    ├── actions/
    │   └── index.ts             # validación, antispam y entrega del lead
    ├── scripts/                 # lo único que llega al navegador
    │   ├── yt-facade.js
    │   ├── attribution.js
    │   ├── form.js
    │   └── track.js
    ├── lib/
    │   ├── schema/
    │   ├── seo.ts
    │   ├── placeholders.ts
    │   └── deliver.ts
    ├── content/
    │   ├── landings/            # .yaml — páginas SEM
    │   └── articulos/           # .mdx — contenido de autoridad
    ├── content.config.ts
    ├── assets/
    └── pages/
        ├── index.astro
        ├── [...slug].astro
        ├── api/
        │   └── lead.ts          # única ruta bajo demanda del sitio
        ├── gracias.astro
        └── 404.astro
```

### 2.2 `package.json`

```json
{
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro check && astro build",
    "preview": "astro preview"
  },
  "dependencies": {
    "astro": "^5",
    "@astrojs/mdx": "^4",
    "@astrojs/sitemap": "^3",
    "@astrojs/cloudflare": "^12"
  },
  "devDependencies": {
    "@astrojs/check": "^0.9",
    "lightningcss": "^1",
    "typescript": "^5"
  }
}
```

Esta lista está completa. **Cualquier dependencia adicional requiere justificación explícita.** Si aparece `tailwindcss`, `@astrojs/react`, `framer-motion`, `swiper`, `lucide-react` o similar, el setup está mal.

El adaptador existe por una sola razón: la ruta del formulario. Se sustituye por el de la plataforma de despliegue —`@astrojs/node`, `@astrojs/netlify`, `@astrojs/vercel`— sin tocar nada más. Las páginas siguen siendo estáticas.

### 2.3 `astro.config.mjs`

```js
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: 'https://dominio-del-cliente.com',
  output: 'static',
  adapter: cloudflare(),
  compressHTML: true,
  build: {
    inlineStylesheets: 'always',
  },
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover',
  },
  integrations: [mdx(), sitemap()],
  vite: {
    build: { cssMinify: 'lightningcss' },
  },
});
```

Qué hace cada opción y por qué está ahí:

- **`inlineStylesheets: 'always'`** — el CSS se inyecta dentro del `<head>` en lugar de servirse como archivo. Cero requests bloqueantes para el estilo crítico. Es viable porque el CSS total del sistema ronda los 12 KB comprimidos.
- **`compressHTML: true`** — minifica el HTML de salida preservando los bloques sensibles a espacios.
- **`prefetch` con estrategia `hover`** — precarga la página destino cuando el cursor se posa sobre un enlace. Elimina la necesidad de escribir código de prefetch.
- **`cssMinify: 'lightningcss'`** — minificador más agresivo y correcto con `calc()` y custom properties.
- **`output: 'static'` con adaptador** — todas las páginas se prerenderizan. Solo los archivos que declaran `export const prerender = false` se ejecutan bajo demanda: en este sistema, únicamente la ruta del formulario.

### 2.4 `src/config/site.ts`

Toda la información del negocio vive aquí. Ningún dato del cliente se escribe dentro de un componente.

```ts
export const site = {
  // Identidad
  name: 'Nombre Comercial',
  legalName: 'Razón Social S.A. de C.V.',
  url: 'https://dominio.com',
  logo: '/logo.svg',
  lang: 'es-MX',

  // Contacto
  phone: '+52 998 000 0000',
  whatsapp: '5219980000000',
  whatsappMessage: 'Hola, quiero información sobre {service}',
  email: 'contacto@dominio.com',

  // Ubicación
  address: {
    street: 'Av. Bonampak 100',
    locality: 'Cancún',
    region: 'Quintana Roo',
    postalCode: '77500',
    country: 'MX',
  },
  areaServed: ['MX', 'US', 'CA'],

  // Negocio
  schemaType: 'MedicalClinic' as const,
  priceRange: '$900-$8500',
  currency: 'USD',
  openingHours: 'Mo-Fr 09:00-19:00, Sa 09:00-14:00',
  languages: ['Spanish', 'English'],
  paymentAccepted: ['Cash', 'Credit Card', 'Wire Transfer'],

  // Autoridad (E-E-A-T)
  author: {
    name: 'Dra. Nombre Apellido',
    url: 'https://dominio.com/equipo/nombre',
    image: '/equipo/nombre.webp',
    sameAs: [
      'https://www.linkedin.com/in/…',
      'https://www.doctoralia.com.mx/…',
    ],
  },
  certifications: ['COFEPRIS', 'Consejo Mexicano de …'],

  // Redes
  social: {
    facebook: 'https://facebook.com/…',
    instagram: 'https://instagram.com/…',
    youtube: 'https://youtube.com/@…',
  },

  // Marca
  theme: {
    primary: '#e7216a',
    primaryDark: '#c2185b',
    accent: '#00a7ce',
  },

  // Medición
  gtmId: 'GTM-XXXXXXX',
  facebookDomainVerification: '',
  thankYouPath: { es: '/gracias/', en: '/thank-you/' } as Record<string, string>,
  leadValue: 120,              // valor estimado de un lead, para puja inteligente
  requireConsentMode: false,   // true solo en jurisdicciones con consentimiento previo

  // Formularios
  challenge: { enabled: true },
  leadWebhook: process.env.LEAD_WEBHOOK ?? '',
  notifyEmail: 'ventas@dominio.com',

  // Widget de contacto flotante
  widget: {
    es: {
      aria: 'Canales de contacto',
      pill: 'Ventas y Soporte',
      online: 'En línea',
      heading: '¿Cómo podemos ayudarte?',
      prompt: 'Elige una opción para continuar:',
      close: 'Cerrar',
      back: 'Volver',
      salesMessage: 'Hola, quiero información sobre {service}',
      sales:   { title: 'Ventas',  text: 'Habla con un asesor por WhatsApp' },
      support: { title: 'Soporte', text: 'Ayuda técnica para clientes con licencia' },
    },
    en: {
      aria: 'Contact channels',
      pill: 'Sales & Support',
      online: 'Online',
      heading: 'How can we help you?',
      prompt: 'Choose an option to continue:',
      close: 'Close',
      back: 'Back',
      salesMessage: 'Hi, I would like information about {service}',
      sales:   { title: 'Sales',   text: 'Talk to an advisor on WhatsApp' },
      support: { title: 'Support', text: 'Technical help for licensed customers' },
    },
  },

  // Catálogo de servicios — alimenta precios y datos estructurados
  services: [
    { name: 'Implantes Dentales', price: '900',  currency: 'USD', compareAt: '3500' },
    { name: 'All-on-4',           price: '8500', currency: 'USD', compareAt: '24000' },
  ],
} as const;
```

---

## 3. Design system

### 3.1 Capas

```css
/* src/styles/index.css */
@layer reset, tokens, base, layout, components, utilities;

@import './01-reset.css'      layer(reset);
@import './02-tokens.css'     layer(tokens);
@import './03-base.css'       layer(base);
@import './04-layout.css'     layer(layout);
@import './05-components.css' layer(components);
@import './06-utilities.css'  layer(utilities);
@import './07-motion.css';
```

Con capas, el orden de la cascada es explícito y deja de depender de la especificidad o del orden de los archivos. Una utilidad siempre gana sobre un componente sin necesidad de `!important`. Los estilos con scope de un componente `.astro` quedan fuera de las capas, por lo que siempre tienen la última palabra.

### 3.2 Tokens

```css
/* src/styles/02-tokens.css */
:root {
  /* ── Superficies y neutrales ── */
  --bg-color: #ffffff;
  --bg-secondary-color: #f7f8fa;
  --surface: #ffffff;
  --border-color: #e5e8ec;
  --color-lightGrey: #e5e8ec;
  --color-grey: #5a5f6a;        /* contraste AA sobre blanco */
  --color-darkGrey: #2a2d34;
  --color-error: #d43939;
  --color-success: #15a34a;
  --color-success-soft: #e8f7ee;
  --color-star: #f59e0b;
  --color-whatsapp: #25d366;

  /* ── Marca — se sobrescriben por sitio ── */
  --color-primary: #e7216a;
  --color-primary-dark: #c2185b;
  --color-accent: #00a7ce;

  /* ── Sobre fondo oscuro ── */
  --color-on-dark: #ffffff;
  --color-on-dark-muted: rgba(255, 255, 255, .82);
  --color-on-dark-subtle: rgba(255, 255, 255, .70);

  /* ── Tipografía ── */
  --font-family-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                      Inter, system-ui, sans-serif;
  --font-color: #15171c;
  --font-size: 1.6rem;

  --text-xs:  1.2rem;
  --text-sm:  1.4rem;
  --text-base:1.6rem;
  --text-lg:  1.8rem;
  --text-xl:  2.1rem;
  --text-2xl: 2.6rem;
  --text-3xl: clamp(2.6rem, 4vw, 3.4rem);
  --text-4xl: clamp(3.2rem, 5vw, 4.4rem);
  --text-5xl: clamp(3.8rem, 6vw, 5.4rem);

  --leading-tight:   1.1;
  --leading-snug:    1.2;
  --leading-normal:  1.6;
  --leading-relaxed: 1.7;

  /* ── Espaciado — base 4px ── */
  --space-1: .4rem;   --space-2: .8rem;   --space-3: 1.2rem;
  --space-4: 1.6rem;  --space-5: 2.4rem;  --space-6: 3.2rem;
  --space-7: 4.8rem;  --space-8: 6.4rem;  --space-9: 9.6rem;

  --section-y: clamp(4rem, 7vw, 7.2rem);   /* ritmo vertical unificado */

  /* ── Medidas de línea ── */
  --measure-xs: 30rem;
  --measure-sm: 42rem;
  --measure-md: 70rem;
  --measure-lg: 80rem;
  --measure-xl: 90rem;

  /* ── Grilla ── */
  --grid-maxWidth: 120rem;
  --grid-gutter: 2rem;

  /* ── Radios ── */
  --radius-sm: 8px;
  --radius: 10px;
  --radius-lg: 16px;
  --radius-pill: 999px;

  /* ── Elevación en capas ── */
  --shadow-sm: 0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.07);
  --shadow-md: 0 4px 16px rgba(16,24,40,.06), 0 2px 6px rgba(16,24,40,.04);
  --shadow-lg: 0 16px 40px rgba(16,24,40,.10);

  /* ── Breakpoints (referencia; los media queries los repiten literal) ── */
  --bp-grid: 900px;
  --bp-art: 768px;
}
```

Los colores de marca se sobrescriben desde `site.ts` en el layout base:

```astro
---
import { site } from '../config/site';
---
<style set:html={`:root{
  --color-primary:${site.theme.primary};
  --color-primary-dark:${site.theme.primaryDark};
  --color-accent:${site.theme.accent};
}`}></style>
```

### 3.3 Reset y base

```css
/* src/styles/01-reset.css */
html { box-sizing: border-box; font-size: 62.5%; }
*, ::before, ::after { box-sizing: inherit; }
body, h1, h2, h3, h4, p, figure, blockquote, dl, dd { margin: 0; }
ul[class], ol[class] { list-style: none; padding: 0; }
img, picture, video, canvas { display: block; max-width: 100%; }
input, button, textarea, select { font: inherit; }
iframe { border: 0; }
```

`font-size: 62.5%` fija la raíz en 10px, de modo que `1.6rem = 16px`. Toda la escala del sistema asume esta base.

```css
/* src/styles/03-base.css */
body {
  background: var(--bg-color);
  color: var(--font-color);
  font-family: var(--font-family-sans);
  font-size: var(--font-size);
  line-height: var(--leading-normal);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

h1, h2, h3, h4, h5, h6 {
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -.02em;
  margin: .35em 0 .7em;
}
h1 { font-size: 2em; }
h2 { font-size: 1.75em; }
h3 { font-size: 1.5em; }
h4 { font-size: 1.25em; }

p { margin-top: 0; }
a { color: var(--color-primary); text-decoration: none; }
a:hover:not(.button) { opacity: .75; }

/* Anillo de foco visible para teclado, invisible para ratón */
:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
:focus:not(:focus-visible) { outline: none; }

/* Controles de formulario */
input:not([type="checkbox"]):not([type="radio"]):not([type="submit"]),
select, textarea {
  width: 100%;
  display: block;
  padding: .8rem 1rem;
  min-height: 48px;                  /* objetivo táctil mínimo */
  font-size: 16px;                   /* evita el zoom automático de iOS */
  border: 1px solid var(--border-color);
  border-radius: var(--radius);
  transition: border-color .2s ease, box-shadow .2s ease;
}
input:focus, select:focus, textarea:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 18%, transparent);
}
label { display: block; margin-bottom: .4rem; font-weight: 500; }
```

Dos detalles que resuelven problemas reales de móvil: `font-size: 16px` en los campos evita que Safari en iOS haga zoom automático al enfocar, y `min-height: 48px` cumple el tamaño mínimo de objetivo táctil de las guías de accesibilidad.

---

## 4. Layout y grilla

```css
/* src/styles/04-layout.css */
.container {
  width: 100%;
  max-width: var(--grid-maxWidth);
  margin-inline: auto;
  padding-inline: calc(var(--grid-gutter) / 2);
}

.row {
  display: flex;
  flex-flow: row wrap;
  margin-inline: calc(var(--grid-gutter) / -2);
}

.col,
[class*="col-"] {
  flex: 0 1 100%;
  max-width: 100%;
  margin: 0 calc(var(--grid-gutter) / 2) var(--grid-gutter);
}

/* Secciones — ritmo vertical fluido único */
.section { padding-block: var(--section-y); }
.section--tight { padding-block: var(--space-6); }
.section--flush-top { padding-top: 0; }
.section--dark {
  background: var(--color-darkGrey);
  color: var(--color-on-dark);
  text-align: center;
}
.section-header { text-align: center; margin-bottom: var(--space-6); }

.bg-secondary { background: var(--bg-secondary-color); }
.bg-primary   { background: var(--color-primary); color: var(--color-on-dark); }
.bg-dark      { background: var(--color-darkGrey); color: var(--color-on-dark); }
.bordered {
  border-top: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
}

/* ── Único breakpoint estructural ── */
@media (min-width: 900px) {
  .col    { flex: 1; }
  .col-4-md { flex: 0 0 calc(33.333% - var(--grid-gutter)); max-width: calc(33.333% - var(--grid-gutter)); }
  .col-5-md { flex: 0 0 calc(41.666% - var(--grid-gutter)); max-width: calc(41.666% - var(--grid-gutter)); }
  .col-6-md { flex: 0 0 calc(50%     - var(--grid-gutter)); max-width: calc(50%     - var(--grid-gutter)); }
  .col-7-md { flex: 0 0 calc(58.333% - var(--grid-gutter)); max-width: calc(58.333% - var(--grid-gutter)); }
  .col-8-md { flex: 0 0 calc(66.666% - var(--grid-gutter)); max-width: calc(66.666% - var(--grid-gutter)); }
}
```

**Solo existen cinco proporciones de columna.** No hay sistema de 12 puntos ni sufijos por breakpoint. En móvil todo es ancho completo; a partir de 900px se activa la proporción indicada. Un layout que no se resuelve con estas cinco proporciones está sobre-diseñado.

### Área segura en iPhone

```css
/* Reserva de espacio para que el botón flotante no tape el último CTA */
main { padding-bottom: calc(.8rem + env(safe-area-inset-bottom)); }
@media (max-width: 767px) {
  main { padding-bottom: calc(80px + env(safe-area-inset-bottom)); }
}
```

Requiere obligatoriamente esta etiqueta en el `<head>`:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

Sin `viewport-fit=cover`, la función `env()` devuelve `0px` y toda la lógica de área segura queda inerte.

---

## 5. Utilidades

El conjunto completo. **No se generan utilidades nuevas de forma preventiva.** Se añade una solo cuando elimina un estilo inline que aparece tres o más veces.

```css
/* src/styles/06-utilities.css */

/* Escala tipográfica — incluye peso y tracking, no solo tamaño */
.t-5xl { font-size: var(--text-5xl); line-height: 1.05; letter-spacing: -.03em; font-weight: 800; }
.t-4xl { font-size: var(--text-4xl); line-height: 1.10; letter-spacing: -.02em; font-weight: 700; }
.t-3xl { font-size: var(--text-3xl); line-height: 1.15; letter-spacing: -.02em; font-weight: 700; }
.t-2xl { font-size: var(--text-2xl); line-height: 1.20; font-weight: 700; }
.t-xl  { font-size: var(--text-xl);  line-height: 1.30; font-weight: 600; }
.t-lg  { font-size: var(--text-lg);  line-height: 1.50; }
.t-sm  { font-size: var(--text-sm); }
.t-xs  { font-size: var(--text-xs); }
.lead  { font-size: var(--text-lg); color: var(--color-grey); line-height: var(--leading-normal); }

/* Peso */
.fw-400 { font-weight: 400; } .fw-500 { font-weight: 500; }
.fw-600 { font-weight: 600; } .fw-700 { font-weight: 700; }
.fw-800 { font-weight: 800; } .fw-900 { font-weight: 900; }

/* Interlineado */
.lh-1       { line-height: 1; }
.lh-tight   { line-height: var(--leading-tight); }
.lh-snug    { line-height: var(--leading-snug); }
.lh-relaxed { line-height: var(--leading-relaxed); }

/* Color de texto */
.text-primary { color: var(--color-primary); }
.text-grey    { color: var(--color-grey); }
.text-dark    { color: var(--color-darkGrey); }
.text-white   { color: var(--color-on-dark); }
.text-body    { font-size: var(--text-base); color: var(--color-grey); line-height: var(--leading-relaxed); }
.text-strike  { text-decoration: line-through; }
.label        { text-transform: uppercase; letter-spacing: .1em; font-size: var(--text-xs); }

/* Alineación */
.text-center { text-align: center; }
.text-left   { text-align: left; }

/* Medidas de línea */
.measure-xs { max-width: var(--measure-xs); }
.measure-sm { max-width: var(--measure-sm); }
.measure-md { max-width: var(--measure-md); }
.measure-lg { max-width: var(--measure-lg); }
.measure-xl { max-width: var(--measure-xl); }

/* Espaciado */
.mx-auto { margin-inline: auto; }
.mb-1 { margin-bottom: var(--space-4); }
.mb-2 { margin-bottom: var(--space-5); }
.mb-3 { margin-bottom: var(--space-6); }
.mt-1 { margin-top: var(--space-4); }
.mt-2 { margin-top: var(--space-5); }
.pb-3 { padding-bottom: var(--space-6); }
.is-marginless  { margin: 0; }
.is-paddingless { padding: 0; }

/* Layout */
.flex-col        { display: flex; flex-direction: column; }
.flex-center     { display: flex; align-items: center; }
.is-vertical-align { display: flex; align-items: center; }
.h-100           { height: 100%; }
.is-full-width   { width: 100%; }
.pos-relative    { position: relative; }
.overflow-hidden { overflow: hidden; }
.obj-cover       { object-fit: cover; }
.is-rounded      { border-radius: 50%; }
.radius-12       { border-radius: 12px; }
.list-unstyled   { list-style: none; padding: 0; }

/* Visibilidad */
.hide-xs { display: none; }
@media (min-width: 900px) { .hide-xs { display: block; } }

/* Solo para lectores de pantalla */
.sr-only {
  position: absolute; width: 1px; height: 1px;
  padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0,0,0,0); white-space: nowrap; border: 0;
}
```

### La regla que evita convertir esto en un framework de utilidades

- **Utilidad:** una sola propiedad, sin estados, usada en tres o más lugares.
- **Componente:** varias propiedades que solo tienen sentido juntas (`.card`, `.button`, `.accordion`).
- **Scoped:** específico de un módulo, va en su `<style>` y no se comparte.

Si estás escribiendo `.mt-7` porque un elemento necesita ese margen exacto una sola vez, va en el `<style>` del componente.

---

## 6. Componentes base

```css
/* src/styles/05-components.css */

/* ── Botones ── */
.button {
  display: inline-block;
  padding: 1.1rem 2.2rem;
  min-height: 44px;
  font-size: var(--font-size);
  font-weight: 600;
  line-height: 1;
  text-align: center;
  text-decoration: none;
  color: var(--color-darkGrey);
  background: var(--bg-secondary-color);
  border: 1px solid var(--border-color);
  border-radius: var(--radius);
  cursor: pointer;
  transition: transform .15s ease, box-shadow .15s ease, background-color .15s ease;
}
.button:hover { transform: translateY(-1px); }
.button.primary {
  color: var(--color-on-dark);
  background: var(--color-primary);
  border-color: transparent;
  box-shadow: var(--shadow-sm);
}
.button.primary:hover { background: var(--color-primary-dark); box-shadow: var(--shadow-md); }
.button.outline {
  background: transparent;
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.button.outline:hover { background: var(--color-primary); color: var(--color-on-dark); }
.button.pill { border-radius: var(--radius-pill); padding: 1.2rem 3rem; }
.button[disabled] { opacity: .6; cursor: not-allowed; transform: none; }
.btn-row { display: flex; justify-content: center; gap: var(--space-3); flex-wrap: wrap; }

/* ── Tarjetas ── */
.card {
  padding: var(--space-5);
  background: var(--surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}
.card--lg { padding: var(--space-6); }
.card--sm { padding: var(--space-4); }
.card--flush { padding: 0; overflow: hidden; }
.card__body { padding: var(--space-4); }
.card__foot { margin-top: auto; padding-top: var(--space-5); }
.card__ribbon {
  position: absolute;
  top: -12px; left: 50%;
  transform: translateX(-50%);
  padding: .4rem 1rem;
  font-size: 1rem;
  font-weight: 700;
  text-transform: uppercase;
  white-space: nowrap;
  color: var(--color-on-dark);
  background: var(--color-primary);
  border-radius: var(--radius-pill);
  z-index: 2;
}

/* ── Insignias y micro-elementos ── */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 1rem;
  padding: .6rem 1.6rem;
  font-size: var(--text-xs);
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-pill);
  box-shadow: var(--shadow-sm);
}
.badge__dot {
  width: 8px; height: 8px;
  background: var(--color-primary);
  border-radius: 50%;
  flex-shrink: 0;
}
.icon-circle {
  display: grid;
  place-items: center;
  width: 64px; height: 64px;
  margin: 0 auto var(--space-4);
  background: var(--bg-secondary-color);
  border-radius: 50%;
}
.icon-badge {
  display: grid;
  place-items: center;
  width: 38px; height: 38px;
  background: var(--color-primary);
  border-radius: var(--radius);
  flex-shrink: 0;
}

/* ── Franja de credibilidad ── */
.proof-strip { display: flex; justify-content: center; align-items: center; flex-wrap: wrap; }
.proof-strip__item {
  display: flex; align-items: center; justify-content: center;
  gap: 1.2rem; padding: 1.5rem 3rem;
  flex: 1; min-width: 180px;
  border-right: 1px solid var(--border-color);
}
.proof-strip__item:last-child { border-right: 0; }
.proof-strip__num   { font-size: 2.4rem; font-weight: 700; color: var(--color-primary); line-height: 1; }
.proof-strip__label { font-size: var(--text-xs); color: var(--color-grey); line-height: 1.3; max-width: 120px; }
@media (max-width: 600px) {
  .proof-strip__item {
    width: 100%; justify-content: flex-start;
    padding: 1.2rem 2rem;
    border-right: 0; border-bottom: 1px solid var(--border-color);
  }
  .proof-strip__item:last-child { border-bottom: 0; }
}

/* ── Lista de pasos ── */
.step-list { display: flex; flex-direction: column; gap: 1.2rem; list-style: none; padding: 0; }
.step-list li { display: flex; align-items: flex-start; gap: 1.2rem; font-size: var(--text-sm); color: var(--color-grey); }
.step-num {
  display: grid; place-items: center;
  width: 32px; height: 32px;
  font-size: var(--text-xs); font-weight: 700;
  color: var(--color-on-dark);
  background: var(--color-primary);
  border-radius: 50%;
  flex-shrink: 0;
}
.step-index { font-size: 4rem; font-weight: 800; color: var(--color-grey); line-height: 1; }

/* ── Estadísticas en línea ── */
.inline-stats { display: flex; gap: var(--space-6); flex-wrap: wrap; }
.inline-stat  { display: flex; align-items: center; gap: 1rem; }
.inline-stat__num   { font-size: 2rem; font-weight: 700; line-height: 1.1; }
.inline-stat__label { font-size: var(--text-xs); color: var(--color-grey); }
.stat-num   { font-size: 3.5rem; font-weight: 800; color: var(--color-primary); line-height: 1; }
.stat-label { font-size: var(--text-sm); color: var(--color-grey); margin-top: .5rem; }

/* ── Tablas ── */
.table { width: 100%; border-collapse: collapse; }
.table th {
  padding: 1.2rem .8rem;
  text-align: left;
  font-size: var(--text-sm);
  border-bottom: 2px solid var(--border-color);
}
.table td {
  padding: 1.2rem .8rem;
  font-size: var(--text-sm);
  border-bottom: 1px solid var(--border-color);
}

.price-table { width: 100%; border-collapse: separate; border-spacing: 0 5px; font-size: var(--text-sm); }
.price-table caption {
  padding: 1rem;
  font-size: var(--text-lg); font-weight: 700;
  color: var(--color-on-dark); background: var(--color-primary);
  border-radius: var(--radius) var(--radius) 0 0;
}
.price-table thead th { padding: .8rem 1rem; text-align: left; color: var(--color-on-dark); background: var(--color-primary); }
.price-table thead th:last-child { text-align: right; }
.price-table tbody tr { background: var(--bg-secondary-color); }
.price-table tbody tr:nth-child(even):not(.price-table__category) {
  background: var(--color-accent);
  color: var(--color-on-dark);
}
.price-table td:last-child { text-align: right; font-weight: 600; }
.price-table__category td {
  background: transparent;
  color: var(--color-primary);
  font-weight: 700;
  padding-top: 1.5rem;
  border-bottom: 1px solid var(--color-primary);
}

/* ── Formulario ── */
.field { margin-bottom: var(--space-3); }

.form__error {
  padding: var(--space-3);
  margin-bottom: var(--space-3);
  font-size: var(--text-sm);
  color: var(--color-error);
  background: color-mix(in srgb, var(--color-error) 8%, transparent);
  border-radius: var(--radius);
}
.form__error[hidden] { display: none; }

.form__trust {
  margin: var(--space-2) 0 0;
  text-align: center;
  color: var(--color-grey);
}

.form .button { width: 100%; }
.form--compact .field { margin-bottom: var(--space-2); }
```

El widget de contacto flotante no vive aquí: su marcado y su CSS completos están en la sección 7.7.

`.form__error` se declara con `[hidden]` explícito porque la capa de componentes puede ganarle al `display` que el navegador aplica por defecto al atributo. Sin esa línea, el mensaje de error queda visible desde la carga.

---

## 7. Patrones de interacción sin JavaScript

Siete patrones que en la mayoría de proyectos se resuelven con librerías. Aquí son CSS y HTML nativo.

### 7.1 Acordeón y preguntas frecuentes

Usa `<details>`/`<summary>`, que ya traen el comportamiento de apertura, el foco de teclado y la semántica correcta.

```css
.accordion details {
  margin-bottom: .5rem;
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: var(--radius);
  overflow: hidden;
}
.accordion summary {
  display: flex; justify-content: space-between; align-items: center;
  padding: 1.5rem;
  font-weight: 600;
  cursor: pointer;
  list-style: none;
}
.accordion summary::-webkit-details-marker { display: none; }
.accordion summary::after {
  content: '+';
  font-size: 1.8rem; line-height: 1;
  color: var(--color-primary);
  flex-shrink: 0;
  transition: transform .2s ease;
}
.accordion details[open] summary::after { transform: rotate(45deg); }
.accordion details > div { padding: 0 1.5rem 1.5rem; }
```

El signo `+` gira 45 grados y se convierte en una `×` sin cambiar de carácter. La primera pregunta se renderiza con el atributo `open` para que nadie llegue a una sección completamente colapsada.

### 7.2 Pestañas

Mismo mecanismo, distinta presentación.

```css
.tabs { display: flex; flex-wrap: wrap; gap: .2rem; border-bottom: 2px solid var(--border-color); margin-bottom: var(--space-5); }
.tabs > details { flex: 1; min-width: 120px; }
.tabs summary {
  padding: 1.2rem;
  text-align: center; font-weight: 600; cursor: pointer;
  background: var(--bg-secondary-color);
  border-radius: var(--radius) var(--radius) 0 0;
  list-style: none;
}
.tabs summary::-webkit-details-marker { display: none; }
.tabs details[open] summary { background: var(--color-primary); color: var(--color-on-dark); }
.tabs details > div { display: none; padding: var(--space-5); border: 1px solid var(--border-color); border-top: 0; }
.tabs details[open] > div { display: block; }
```

### 7.3 Lightbox de galería

Usa el pseudo-selector `:target`, que se activa cuando el fragmento de la URL coincide con el `id` del elemento.

```css
.gallery-3x3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px; }
.gallery-3x3 a { display: block; aspect-ratio: 1; overflow: hidden; }
.gallery-3x3 img { width: 100%; height: 100%; object-fit: cover; transition: transform .3s ease; }
.gallery-3x3 a:hover img { transform: scale(1.05); }

.lightbox {
  position: fixed; inset: 0;
  display: flex; align-items: center; justify-content: center;
  padding: 1rem;
  background: rgba(0,0,0,.92);
  opacity: 0;
  pointer-events: none;
  transition: opacity .2s ease;
  z-index: 9999;
}
.lightbox:target { opacity: 1; pointer-events: auto; }
.lightbox img { max-width: 90vw; max-height: 85vh; object-fit: contain; border-radius: var(--radius); }
.lightbox__close {
  position: absolute; top: 1.5rem; right: 1.5rem;
  display: grid; place-items: center;
  width: 44px; height: 44px;
  font-size: 3rem; line-height: 1;
  color: var(--color-on-dark);
}
```

Se usa `opacity` con `pointer-events` en lugar de `display` para que la transición sea animable.

### 7.4 Navegación móvil

Casilla de verificación oculta que controla el estado abierto/cerrado.

```html
<nav class="nav">
  <div class="container">
    <input type="checkbox" id="nav-toggle" class="nav-toggle">
    <label for="nav-toggle" class="nav-toggle-label" aria-label="Menú"><span></span></label>
    <div class="nav-left">
      <a href="/" class="brand"><img src="/logo.svg" alt="…" width="140" height="28"></a>
    </div>
    <div class="nav-center"> … enlaces … </div>
    <div class="nav-right"> … CTA … </div>
  </div>
</nav>
```

```css
.nav {
  position: sticky; top: 0; z-index: 100;
  height: 56px;
  background: var(--bg-color);
  border-bottom: 1px solid var(--border-color);
}
.nav > .container { display: flex; align-items: center; height: 100%; gap: 1rem; }

.nav-toggle { display: none; }
.nav-toggle-label {
  display: flex; align-items: center; justify-content: center;
  width: 44px; height: 44px;
  margin-left: -.5rem;
  cursor: pointer; flex-shrink: 0;
}
.nav-toggle-label span,
.nav-toggle-label span::before,
.nav-toggle-label span::after {
  display: block; position: relative;
  width: 20px; height: 2px;
  background: var(--font-color);
}
.nav-toggle-label span::before,
.nav-toggle-label span::after { content: ''; position: absolute; left: 0; }
.nav-toggle-label span::before { top: -6px; }
.nav-toggle-label span::after  { top:  6px; }

.nav-left { display: flex; align-items: center; flex: 1; min-width: 0; }
.nav .brand { display: flex; align-items: center; gap: .6rem; overflow: hidden; }
.nav .brand img { height: 28px; width: auto; flex-shrink: 0; }

.nav-center {
  display: none;
  position: absolute; top: 100%; left: 0; right: 0;
  flex-direction: column;
  background: var(--bg-color);
  border-top: 1px solid var(--border-color);
  box-shadow: var(--shadow-md);
}
.nav-toggle:checked ~ .nav-center { display: flex; }
.nav-center a {
  display: block;
  padding: 1.2rem 1.5rem;
  font-size: var(--text-sm);
  color: var(--color-darkGrey);
  border-bottom: 1px solid var(--border-color);
}
.nav-center a:last-child { border-bottom: 0; }

.nav-right { display: flex; align-items: center; gap: .4rem; flex-shrink: 0; }
.nav .button { height: 36px; padding: 0 1.2rem; font-size: var(--text-sm); display: inline-flex; align-items: center; }

@media (min-width: 900px) {
  .nav { height: 68px; }
  .nav-toggle-label { display: none; }
  .nav-left { flex: 0 0 auto; }
  .nav .brand img { height: 40px; }
  .nav-center {
    display: flex; position: static;
    flex-direction: row; flex: 1;
    justify-content: center; align-items: center; gap: .5rem;
    background: transparent; border: 0; box-shadow: none;
  }
  .nav-center a {
    display: inline-block;
    padding: .7rem 1.2rem;
    border: 0; border-radius: var(--radius);
  }
  .nav-center a:hover { background: var(--bg-secondary-color); }
  .nav-right { flex: 0 0 auto; }
  .nav .button { height: 40px; padding: 0 1.6rem; }
}
```

Atención al selector: `.nav .brand` con espacio (descendiente). El logo está dentro del nav, no es el nav.

### 7.5 Carrusel infinito

La técnica habitual duplica el contenido en el HTML y anima al `-50%`. Este sistema no duplica nada: posiciona cada elemento una sola vez y reparte el arranque de la animación con un retraso negativo calculado por índice.

```astro
<div class="marquee" style={`--count:${items.length}; --speed:${speed}; --item-w:${itemWidth}`}>
  {items.map((item, i) => (
    <div class="marquee__item" style={`--i:${i}`}>…</div>
  ))}
</div>
```

```css
.marquee {
  position: relative;
  overflow: hidden;
  height: var(--marquee-h, 100px);
  mask-image: linear-gradient(90deg, transparent, #000 4%, #000 96%, transparent);
}
.marquee__item {
  position: absolute;
  left: max(calc(var(--item-w) * var(--count)), 100%);
  width: var(--item-w);
  animation: marquee-scroll var(--speed) linear infinite;
  animation-delay: calc(var(--speed) / var(--count) * (var(--count) - var(--i)) * -1);
}
@keyframes marquee-scroll {
  to { left: calc(var(--item-w) * -1); }
}
.marquee:hover .marquee__item { animation-play-state: paused; }

@media (prefers-reduced-motion: reduce) {
  .marquee { height: auto; }
  .marquee__item { position: static; animation: none; width: auto; }
}
```

Un `animation-delay` negativo hace que el navegador inicie la animación como si ya llevara ese tiempo corriendo. Con los retrasos repartidos uniformemente en el ciclo, la percepción es de un flujo continuo sin que exista ninguna copia en el DOM. Funciona con cualquier cantidad de elementos sin tocar el CSS.

Bajo movimiento reducido, los elementos vuelven a flujo normal en lugar de simplemente congelarse.

### 7.6 Transiciones entre páginas

```css
/* src/styles/07-motion.css */
@view-transition { navigation: auto; }

@keyframes vt-fade-in  { from { opacity: 0; } }
@keyframes vt-fade-out { to   { opacity: 0; } }

::view-transition-old(root) { animation: vt-fade-out .25s ease; }
::view-transition-new(root) { animation: vt-fade-in  .25s ease; }

@media (prefers-reduced-motion: reduce) {
  ::view-transition-old(root),
  ::view-transition-new(root) { animation: none; }
}
```

Esta es la API nativa del navegador para transiciones entre navegaciones completas. **No se usa el enrutador de cliente de Astro** (`<ClientRouter />`): añade JavaScript para conseguir el mismo efecto que el navegador ya ofrece gratis en un sitio multipágina.

### 7.7 Widget de contacto flotante

Sustituye a los widgets de chat de terceros. Un servicio como Intercom, Tawk.to, Crisp o Tidio añade entre 200 y 600 KB de JavaScript de tercera parte, abre conexiones a dominios ajenos y degrada el LCP en móvil. Este widget pesa **cero JavaScript** y cubre los dos únicos caminos que importan en una landing de captación.

**Comportamiento.** Una píldora flotante en la esquina inferior derecha. Al pulsarla se abre un panel con dos opciones:

- **Ventas** — enlace directo a WhatsApp con mensaje prellenado. Es un `<a href="https://wa.me/…">`, así que funciona sin JavaScript y abre la app nativa en móvil.
- **Soporte** — cambia la vista *dentro del mismo panel* y muestra el formulario. No abre otra ventana ni navega: el usuario no pierde el contexto de la página.

La razón de separar los dos canales es de calificación, no de estética. Quien viene de un anuncio quiere hablar con alguien ya y elige WhatsApp; quien es cliente y tiene un problema no debe contaminar la cola comercial ni tus métricas de conversión. Separarlos en el primer clic clasifica el lead antes de que llegue a nadie.

#### Estado sin JavaScript

Dos casillas de verificación gobiernan las tres vistas posibles:

| Casilla | Estado que controla |
|---|---|
| `#lx-open` | Panel cerrado / abierto |
| `#lx-support` | Vista de menú / vista de formulario |

Se usan casillas y no `:target` de forma deliberada. `:target` escribe en el hash de la URL, lo que ensucia el historial, dispara un salto de scroll y rompe la analítica de página al generar entradas espurias. Las casillas no tocan la URL, son elementos nativos operables con teclado —foco y barra espaciadora— y su estado no interfiere con la navegación.

Las casillas son hermanas previas del panel, lo que permite gobernarlo con el combinador `~`.

#### Marcado

```astro
---
// src/components/ContactLauncher.astro
import { site } from '../config/site';
import ContactForm from './ContactForm.astro';

const { lang = 'es' } = Astro.props;
const t = site.widget[lang];
const waHref = `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(t.salesMessage)}`;
---
<aside class="launcher" aria-label={t.aria}>
  <input type="checkbox" id="lx-open"    class="lx-state" aria-label={t.aria}>
  <input type="checkbox" id="lx-support" class="lx-state" aria-label={t.support.title}>

  <label for="lx-open" class="lx-pill" data-track="contact_widget_open">
    <span class="lx-pill__icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
        <path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/>
      </svg>
    </span>
    <span class="lx-pill__body">
      <span class="lx-pill__status">{t.online}</span>
      <strong class="lx-pill__label">{t.pill}</strong>
    </span>
  </label>

  <div class="lx-panel">
    <header class="lx-head">
      <p class="lx-head__title">{t.heading}</p>
      <label for="lx-open" class="lx-x" data-track="contact_widget_close">
        <span class="sr-only">{t.close}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             width="20" height="20" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </label>
    </header>

    <div class="lx-body">
      <div class="lx-view lx-view--menu">
        <p class="lx-prompt">{t.prompt}</p>

        <label for="lx-support" class="lx-option" data-track="contact_widget_support">
          <span class="lx-option__icon" aria-hidden="true">…</span>
          <span class="lx-option__text">
            <strong>{t.support.title}</strong>
            <span>{t.support.text}</span>
          </span>
          <span class="lx-option__chevron" aria-hidden="true">›</span>
        </label>

        <a href={waHref} class="lx-option" target="_blank" rel="noopener"
           data-track="whatsapp_click" data-track-label="widget_sales">
          <span class="lx-option__icon" aria-hidden="true">…</span>
          <span class="lx-option__text">
            <strong>{t.sales.title}</strong>
            <span>{t.sales.text}</span>
          </span>
          <span class="lx-option__chevron" aria-hidden="true">›</span>
        </a>
      </div>

      <div class="lx-view lx-view--support">
        <label for="lx-support" class="lx-back">← {t.back}</label>
        <ContactForm formId="widget" variant="compact" lang={lang} />
      </div>
    </div>
  </div>
</aside>
```

El componente se monta una sola vez, en el layout base, después de `<main>`. La raíz es `<aside>` y no `<section>` porque es cromo del sitio, no un bloque de contenido: no debe aparecer en el esquema semántico de la página ni recibir `itemtype`.

#### Estilos

```css
/* src/styles/05-components.css */

/* ── Contenedor ── */
.launcher {
  position: fixed;
  right: 16px;
  bottom: max(16px, env(safe-area-inset-bottom));
  z-index: 120;
}

/* Casillas: invisibles pero enfocables con teclado */
.lx-state {
  position: absolute;
  width: 1px; height: 1px;
  opacity: 0;
  pointer-events: none;
}

/* ── Píldora ── */
.lx-pill {
  display: flex;
  align-items: center;
  gap: .75rem;
  padding: .5rem 1.25rem .5rem .5rem;
  background: var(--surface);
  border-radius: 999px;
  box-shadow: var(--shadow-lg);
  cursor: pointer;
  transition: transform .18s ease, opacity .18s ease;
}
.lx-pill:hover { transform: translateY(-2px); }

.lx-pill__icon {
  position: relative;
  display: grid; place-items: center;
  width: 48px; height: 48px;
  flex-shrink: 0;
  color: #fff;
  background: var(--color-whatsapp);
  border-radius: 50%;
}
/* Punto de aviso */
.lx-pill__icon::after {
  content: '';
  position: absolute;
  top: 2px; right: 2px;
  width: 10px; height: 10px;
  background: var(--color-error);
  border: 2px solid var(--surface);
  border-radius: 50%;
}

.lx-pill__body { display: grid; gap: .1rem; }
.lx-pill__status {
  display: flex; align-items: center; gap: .35rem;
  font-size: var(--text-xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .04em;
  color: var(--color-success);
}
.lx-pill__status::before {
  content: '';
  width: 7px; height: 7px;
  background: currentColor;
  border-radius: 50%;
  animation: lx-pulse 2.4s ease-in-out infinite;
}
.lx-pill__label { font-size: var(--text-sm); color: var(--font-color); }

@keyframes lx-pulse {
  50% { opacity: .35; }
}

/* ── Panel ── */
.lx-panel {
  position: fixed;
  right: 8px; left: 8px;
  bottom: max(8px, env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  max-height: min(640px, calc(100dvh - 5rem));
  background: var(--bg-secondary-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;

  opacity: 0;
  visibility: hidden;
  transform: translateY(10px) scale(.98);
  transition: opacity .18s ease, transform .18s ease, visibility 0s .18s;
}

.lx-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.25rem;
  background: var(--color-whatsapp);
  color: var(--color-on-dark);
}
.lx-head__title { margin: 0; font-size: var(--text-lg); font-weight: 700; }
.lx-x {
  display: grid; place-items: center;
  width: 44px; height: 44px;
  margin: -.5rem -.75rem -.5rem 0;
  color: inherit;
  cursor: pointer;
  border-radius: var(--radius);
}
.lx-x:hover { background: rgb(0 0 0 / .12); }

.lx-body {
  padding: 1.5rem 1.25rem;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.lx-prompt {
  margin: 0 0 1.25rem;
  text-align: center;
  font-size: var(--text-sm);
  color: var(--color-grey);
}

/* ── Opciones ── */
.lx-option {
  display: flex;
  align-items: center;
  gap: 1rem;
  width: 100%;
  padding: 1rem;
  margin-bottom: .75rem;
  min-height: 48px;
  background: var(--surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius);
  cursor: pointer;
  transition: border-color .15s ease, background .15s ease;
}
.lx-option:hover {
  border-color: var(--color-success);
  background: var(--color-success-soft);
}
.lx-option__icon {
  display: grid; place-items: center;
  width: 42px; height: 42px;
  flex-shrink: 0;
  color: var(--color-success);
  background: var(--color-success-soft);
  border-radius: var(--radius);
}
.lx-option__text { display: grid; gap: .15rem; min-width: 0; }
.lx-option__text strong { font-size: var(--text-sm); color: var(--font-color); }
.lx-option__text span   { font-size: var(--text-xs); color: var(--color-grey); }
.lx-option__chevron { margin-left: auto; color: var(--color-grey); }

.lx-back {
  display: inline-block;
  margin-bottom: 1rem;
  font-size: var(--text-sm);
  color: var(--color-grey);
  cursor: pointer;
}

/* ── Máquina de estados ── */
.lx-view--support { display: none; }

#lx-open:checked ~ .lx-pill {
  opacity: 0;
  transform: scale(.9);
  pointer-events: none;
}
#lx-open:checked ~ .lx-panel {
  opacity: 1;
  visibility: visible;
  transform: none;
  transition: opacity .18s ease, transform .18s ease, visibility 0s;
}
#lx-support:checked ~ .lx-panel .lx-view--menu    { display: none; }
#lx-support:checked ~ .lx-panel .lx-view--support { display: block; }

/* Foco visible sobre el control real, no sobre la casilla oculta */
#lx-open:focus-visible ~ .lx-pill,
#lx-support:focus-visible ~ .lx-panel .lx-option:first-of-type {
  outline: 3px solid var(--color-accent);
  outline-offset: 2px;
}

@media (min-width: 900px) {
  .launcher { right: 24px; bottom: 24px; }
  .lx-panel {
    position: absolute;
    right: 0; left: auto; bottom: 0;
    width: 400px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .lx-pill,
  .lx-panel { transition: none; }
  .lx-pill__status::before { animation: none; }
}
```

#### Detalles que importan

**El panel usa `visibility`, no solo `opacity`.** Con `opacity: 0` a secas el formulario sigue siendo enfocable con tabulador y sigue anunciándose a los lectores de pantalla aunque esté invisible. `visibility: hidden` lo retira del árbol de accesibilidad y del orden de tabulación, y su transición retrasada a `0s` permite que la animación de salida se complete antes de ocultarlo.

**`100dvh` y no `100vh`.** En móvil la barra de direcciones cambia de tamaño al hacer scroll; `100vh` mide el viewport expandido y recorta el panel por debajo del borde visible.

**Cerrar no reinicia la vista.** Si el usuario abrió el formulario, lo cerró y vuelve a abrir el widget, encuentra el formulario donde lo dejó, con lo que ya había escrito. Restablecer la vista al menú exigiría JavaScript y perdería el trabajo del usuario.

**El área táctil de cada control llega a 44 píxeles**, incluida la aspa de cierre, que compensa su tamaño visual con márgenes negativos.

**Un solo breakpoint.** Base: panel anclado al ancho de la pantalla, como una hoja inferior. A partir de `900px`: panel de 400 px anclado a la píldora.

Los atributos `data-track` no ejecutan nada por sí mismos. Un único escuchador delegado los recoge; se describe en la sección 14.

---

### 7.8 Carril: columnas en escritorio, deslizamiento horizontal en móvil

**El problema.** Cuatro reseñas en columnas quedan bien en escritorio. Apiladas en móvil son cuatro pantallas de scroll antes del CTA, en una sección que casi nunca es crítica.

**La regla.** Toda sección de tres o más tarjetas equivalentes —reseñas, testimonios, logotipos, tarjetas de servicio, equipo, páginas relacionadas— usa carril. **El carril es el caso base; las columnas son la excepción a 900px.**

```css
.rail {
  display: flex;
  gap: var(--grid-gutter);
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scroll-padding-inline: calc(var(--grid-gutter) / 2);

  /* Sangrado a los bordes: las tarjetas nacen y mueren en el borde de la
     pantalla. Sin esto el carril se ve metido en una caja. */
  padding-inline: calc(var(--grid-gutter) / 2);
  margin-inline: calc(var(--grid-gutter) / -2);

  overscroll-behavior-x: contain;   /* que el gesto no dispare el "atrás" */
  scrollbar-width: none;            /* Firefox */
  -ms-overflow-style: none;         /* Edge antiguo */
}
.rail::-webkit-scrollbar { display: none; }

.rail > * {
  /* MENOS del 100% a propósito: que asome la siguiente tarjeta es lo ÚNICO
     que le dice al usuario que hay más. A pantalla completa nadie desliza. */
  flex: 0 0 var(--rail-item, 78%);
  scroll-snap-align: start;
}

@media (min-width: 900px) {
  .rail {
    display: grid;                                            /* grid, no flex-wrap: */
    grid-template-columns: repeat(var(--rail-cols, 4), 1fr);  /* así quedan del mismo */
    overflow: visible;                                        /* alto — efecto tabla  */
    padding-inline: 0;
    margin-inline: 0;
  }
  .rail > * { flex: none; }
}
```

El contenedor lleva `tabindex="0"`, `role="group"` y `aria-label`: una región que se desplaza tiene que poder recorrerse con teclado, o quien no usa gestos no llega a las tarjetas de la derecha.

Se configura con `--rail-cols` y `--rail-item`. **No se crean clases nuevas por cada variante.**

#### Por qué `grid` y no `flex-wrap` en escritorio

Con `flex-wrap` cada tarjeta se estira a su propio contenido y quedan de alturas distintas. Con `grid` y columnas `1fr` todas comparten alto, que es el "efecto tabla" que hace que una fila de tarjetas se lea como una comparación y no como un collage.

---

### 7.9 Tablas en móvil: se desplazan, no se rompen

La tentación es convertir una tabla en tarjetas apiladas en móvil. **No lo hagas en tablas de precios ni de datos comparables.** Una tabla existe para comparar filas entre sí; partirla en tarjetas destruye justo eso.

La clase es `.table-wrap`, **una sola para las dos tablas del catálogo** —precios y datos—, no una por sección. El `min-width` vive en la tabla, no en el envoltorio: es la tabla la que se niega a encogerse.

```css
.table-wrap  { margin-bottom: var(--space-5); overflow-x: auto; }
.table-wrap > table { min-width: 420px; }
```

#### Aquí la barra de desplazamiento NO se oculta

Es la diferencia con el carril, y es deliberada. El carril puede permitirse `scrollbar-width: none` porque la tarjeta siguiente asoma al 78% y el `scroll-snap` la encuadra: el propio contenido anuncia que hay más, y además lleva su `.rail-hint` debajo.

Una tabla no asoma nada. Si le ocultas la barra, el usuario ve cinco columnas cortadas a la mitad de la sexta y nada le dice que existan la séptima y la octava — que es exactamente la comparación que la tabla existía para permitir. Copiar el `scrollbar-width: none` del carril sin copiar el mecanismo que lo hace seguro es cambiar un problema de maquetación por uno de información.

Si la barra nativa molesta visualmente, la salida es un degradado en el borde derecho o una pista de texto, **no** esconder el único indicador que queda.

---

## 8. Sistema de imágenes

### 8.1 Dirección de arte frente a cambio de resolución

Son dos técnicas distintas y no son intercambiables.

| | `srcset` + `sizes` | `<picture>` + `<source media>` |
|---|---|---|
| Resuelve | La misma imagen en distintos tamaños | Imágenes **distintas** según viewport |
| Quién decide | El navegador, según densidad y ancho | El `media`, de forma determinista |
| Relación de aspecto | Constante | **Puede cambiar** |

Cuando la versión móvil de una imagen es un recorte diferente —por ejemplo una miniatura vertical 9:16 en móvil y horizontal 16:9 en escritorio— `srcset` no sirve. Solo `<picture>` con `media` puede hacerlo.

```html
<picture>
  <source media="(min-width: 768px)"
          srcset="/thumb-desktop.webp"
          width="960" height="540">
  <img src="/thumb-mobile.webp"
       width="390" height="693"
       loading="lazy" decoding="async"
       alt="Descripción específica de lo que muestra la imagen">
</picture>
```

Tres decisiones en seis líneas:

1. **El `<img>` contiene la versión móvil.** No es un respaldo de emergencia: es el caso por defecto. El `<source>` es la excepción que se activa en escritorio. Esto es mobile-first en el propio HTML.
2. **`width` y `height` también van en el `<source>`.** El elemento `<source>` acepta estos atributos y son obligatorios aquí: sin ellos, al cruzar el breakpoint el navegador desconoce la nueva relación de aspecto hasta descargar la imagen, y el layout salta.
3. **El breakpoint de dirección de arte es independiente del de la grilla.** El cambio de recorte de una imagen no tiene por qué coincidir con el cambio de columnas.

### 8.2 Componente

```astro
---
// src/components/ArtImage.astro
import { getImage } from 'astro:assets';

interface Props {
  mobile: ImageMetadata;
  desktop: ImageMetadata;
  alt: string;
  breakpoint?: number;
  priority?: boolean;
  class?: string;
}

const { mobile, desktop, alt, breakpoint = 768, priority = false, class: cls } = Astro.props;

const m = await getImage({ src: mobile,  format: 'webp' });
const d = await getImage({ src: desktop, format: 'webp' });
---
<picture>
  <source
    media={`(min-width: ${breakpoint}px)`}
    srcset={d.src}
    width={d.attributes.width}
    height={d.attributes.height}
  />
  <img
    src={m.src}
    width={m.attributes.width}
    height={m.attributes.height}
    alt={alt}
    class={cls}
    loading={priority ? 'eager' : 'lazy'}
    fetchpriority={priority ? 'high' : 'auto'}
    decoding={priority ? 'sync' : 'async'}
  />
</picture>
```

**Nota importante:** el componente `<Picture>` de Astro genera variantes de **formato** (`avif`, `webp`), no de recorte. Para dirección de arte hay que construir el `<picture>` manualmente como arriba. Para imágenes que solo cambian de tamaño, `<Image>` de Astro es la opción correcta.

### 8.3 Matriz de carga

Sin excepciones:

| Caso | `loading` | `fetchpriority` | `decoding` | Precarga |
|---|---|---|---|---|
| Imagen del hero / elemento LCP | `eager` | `high` | `sync` | Sí |
| Primera pantalla, no es LCP | `eager` | `auto` | `async` | No |
| Resto de la página | `lazy` | `auto` | `async` | No |

**Toda imagen lleva `width` y `height` explícitos**, incluyendo las declaradas dentro de un `<source>`. Es la única forma de garantizar un CLS de cero.

### 8.4 Precarga y pistas de recursos

La sintaxis de la precarga **debe coincidir** con la del elemento al que apunta. Cruzarlas provoca una descarga doble.

```
<img> simple            →  <link rel="preload" as="image" href="…">
<picture> con media     →  <link rel="preload" as="image" href="…" media="…">   (uno por variante)
srcset + sizes          →  <link rel="preload" as="image" imagesrcset="…" imagesizes="…">
```

```html
<!-- Imagen única -->
<link rel="preload" as="image" href="/hero.webp" fetchpriority="high">

<!-- Con dirección de arte -->
<link rel="preload" as="image" href="/hero-mobile.webp"  media="(max-width: 767px)" fetchpriority="high">
<link rel="preload" as="image" href="/hero-desktop.webp" media="(min-width: 768px)" fetchpriority="high">
```

Pistas de conexión que debe emitir el layout:

```html
<link rel="preconnect" href="https://www.googletagmanager.com">
<link rel="dns-prefetch" href="https://www.google.com">
```

Y de forma condicional, solo en las páginas que los usan:

```html
<!-- Solo si la página contiene un video: intervienen LOS DOS dominios —
     la API sale de youtube.com y el reproductor embebe en nocookie (§12.1) -->
<link rel="preconnect" href="https://www.youtube.com">
<link rel="preconnect" href="https://www.youtube-nocookie.com">
<!-- Solo si la página contiene un formulario protegido -->
<link rel="preconnect" href="https://challenges.cloudflare.com">
```

Emitir `preconnect` hacia dominios que la página no usa desperdicia conexiones y compite con los recursos reales. Ojo con el caso contrario, que es el que pasa desapercibido: precargar `youtube-nocookie.com` y **no** `youtube.com` deja una conexión muerta abierta y la que de verdad hace falta sin abrir, y no lo delata nada más que la cascada de red.

---

## 9. Motor de SEO y datos estructurados

### 9.1 Etiquetas que emite cada página

```html
<!-- Identidad y control de indexación -->
<meta name="theme-color" content="…">
<link rel="canonical" href="…">
<meta name="description" content="…">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
<meta name="author" content="…">

<!-- Open Graph -->
<meta property="og:locale" content="es_MX">
<meta property="og:type" content="article">
<meta property="og:site_name" content="…">
<meta property="og:url" content="…">
<meta property="og:title" content="…">
<meta property="og:description" content="…">
<meta property="og:image" content="…">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/webp">
<meta property="article:publisher" content="…">
<meta property="article:author" content="…">
<meta property="article:published_time" content="…">
<meta property="article:modified_time" content="…">

<!-- Twitter / X -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="…">
<meta name="twitter:description" content="…">
<meta name="twitter:image" content="…">
<meta name="twitter:label1" content="Escrito por">
<meta name="twitter:data1" content="…">
```

Los modificadores `max-image-preview:large`, `max-snippet:-1` y `max-video-preview:-1` autorizan a Google a mostrar vistas previas grandes y fragmentos sin límite de longitud. Omitirlos deja las decisiones de presentación al criterio conservador por defecto del buscador.

### 9.2 El grafo de datos estructurados

Cada página emite **un solo** bloque JSON-LD con un `@graph`, donde los nodos se referencian entre sí por `@id` en lugar de duplicarse.

```json
{ "@context": "https://schema.org", "@graph": [ … ] }
```

#### Nodos base

**`WebPage`** — el documento actual.
```json
{
  "@type": "WebPage",
  "@id": "{url}#webpage",
  "url": "{url}",
  "name": "{título SEO}",
  "description": "{meta description}",
  "isPartOf": { "@id": "{siteUrl}#website" },
  "author": { "@id": "{siteUrl}#author" },
  "primaryImageOfPage": { "@id": "{url}#primaryimage" },
  "breadcrumb": { "@id": "{url}#breadcrumb" },
  "datePublished": "{ISO-8601}",
  "dateModified": "{ISO-8601}"
}
```

**`BreadcrumbList`** — la ruta jerárquica. Todos los niveles salvo el último llevan `item` con su URL.
```json
{
  "@type": "BreadcrumbList",
  "@id": "{url}#breadcrumb",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "{empresa}", "item": "{siteUrl}" },
    { "@type": "ListItem", "position": 2, "name": "{categoría}", "item": "{urlCategoría}" },
    { "@type": "ListItem", "position": 3, "name": "{título}", "item": "{url}" }
  ]
}
```

**`ImageObject`** — la imagen principal, referenciable.
```json
{
  "@type": "ImageObject",
  "@id": "{url}#primaryimage",
  "url": "{ogImage}",
  "contentUrl": "{ogImage}",
  "width": 1200,
  "height": 630
}
```

**`WebSite`** — el sitio como entidad.
```json
{
  "@type": "WebSite",
  "@id": "{siteUrl}#website",
  "url": "{siteUrl}",
  "name": "{empresa}",
  "inLanguage": "es-MX",
  "sameAs": ["{facebook}", "{instagram}", "{youtube}"]
}
```

**`Person`** — el autor o profesional responsable. Es la señal de experiencia y autoridad más importante en verticales reguladas.
```json
{
  "@type": "Person",
  "@id": "{siteUrl}#author",
  "name": "{nombre}",
  "url": "{perfil}",
  "image": "{foto}",
  "jobTitle": "{especialidad}",
  "memberOf": { "@type": "Organization", "name": "{organismo certificador}" },
  "knowsAbout": ["{tema 1}", "{tema 2}"],
  "sameAs": ["{linkedin}", "{directorio profesional}"]
}
```

**Entidad principal del negocio** — el tipo se elige según la naturaleza del sitio: `MedicalClinic`, `Physician`, `Dentist`, `Hospital`, `LocalBusiness`, `ProfessionalService`, `Product`, `Organization`.

```json
{
  "@type": "{tipo}",
  "@id": "{siteUrl}#business",
  "name": "{empresa}",
  "url": "{siteUrl}",
  "telephone": "{teléfono}",
  "priceRange": "{rango}",
  "image": "{logo}",
  "logo": "{logo}",
  "description": "{descripción}",
  "sameAs": ["…"],
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "…",
    "addressLocality": "…",
    "addressRegion": "…",
    "postalCode": "…",
    "addressCountry": "MX"
  },
  "areaServed": [
    { "@type": "Country", "name": "MX" },
    { "@type": "Country", "name": "US" }
  ],
  "openingHours": "Mo-Fr 09:00-19:00",
  "knowsLanguage": ["Spanish", "English"],
  "paymentAccepted": ["Cash", "Credit Card"],
  "currenciesAccepted": "USD",
  "medicalSpecialty": ["{especialidad}"],
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.9",
    "reviewCount": "312",
    "bestRating": "5"
  },
  "availableService": [
    {
      "@type": "{tipoProcedimiento}",
      "name": "{servicio}",
      "offers": { "@type": "Offer", "price": "900", "priceCurrency": "USD" }
    }
  ]
}
```

**El tipo de procedimiento se deriva del tipo de negocio.** Esta es la diferencia entre datos estructurados genéricos y datos estructurados correctos:

| Tipo de negocio | Tipo de servicio |
|---|---|
| `MedicalClinic`, `Physician`, `Hospital` | `MedicalProcedure` |
| `Dentist` | `DentalProcedure` |
| `Product` | `Product` |
| Cualquier otro | `Service` |

`areaServed` se emite como **array** de nodos `Country`, uno por país. Agrupar varios países en un solo nodo es incorrecto.

`priceCurrency` se toma de la configuración del sitio, nunca se escribe fijo.

#### Nodos que aporta cada bloque de la página

Cada módulo contribuye su propio nodo al grafo. El resultado describe **lo que la página realmente muestra**, no una plantilla genérica.

| Módulo | Nodo emitido | Condición |
|---|---|---|
| `Faq` | `FAQPage` con `Question` / `acceptedAnswer` | Mínimo 2 preguntas |
| `Reviews` | `ItemList` de `Review` + `AggregateRating` calculado | Al menos 1 reseña |
| `VideoTestimonials` | `ItemList` de `Review` sin calificación | — |
| `Features` | `ItemList` de `Service` | — |
| `PriceCards` / `PriceTable` | `ItemList` de `Offer` | — |
| `Team` | `Person` con `jobTitle`, `image`, `url` | — |
| `Gallery` | `ImageGallery` con `ImageObject` | — |
| `Steps` | `HowTo` con `HowToStep` | Mínimo 2 pasos |
| `VideoBlock` | `VideoObject` con `name`, `thumbnailUrl`, `uploadDate`, `embedUrl` | — |
| `Comparison` | `CreativeWork` | — |

`Reviews` calcula el promedio a partir de las calificaciones realmente mostradas en la página. Nunca se escribe un valor fijo que no corresponda al contenido visible.

`VideoTestimonials` emite `Review` **sin** `reviewRating`: declarar una calificación que el usuario no otorgó es un dato estructurado falso.

`HowTo` y `VideoObject` son los dos que producen resultados enriquecidos visibles en la página de resultados. Merecen atención especial.

### 9.3 Implementación

```ts
// src/lib/schema/types.ts
export type SchemaNode = Record<string, unknown> & { '@type': string; '@id'?: string };

export interface PageContext {
  url: string;
  siteUrl: string;
  title: string;
  description?: string;
  cluster?: string;
  service?: string;
  publishedAt?: Date;
  updatedAt?: Date;
}

export type JsonLdFn<T> = (data: T, ctx: PageContext) => SchemaNode[];
```

```ts
// src/lib/schema/index.ts
import { site } from '../../config/site';
import { registry } from '../../modules/_registry';

export function buildGraph(ctx: PageContext, modules: AnyModule[]): object {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      webPage(ctx),
      breadcrumb(ctx),
      ...(ctx.ogImage ? [imageObject(ctx)] : []),
      webSite(),
      ...(site.author ? [author()] : []),
      business(ctx),
      ...modules.flatMap(m => registry[m.type].jsonld(m, ctx)),
    ],
  };
}
```

**Serialización segura.** El contenido de una pregunta frecuente puede incluir caracteres que rompan el bloque de script. `JSON.stringify` no los escapa por defecto:

```ts
export function serializeJsonLd(graph: object): string {
  return JSON.stringify(graph)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}
```

Sin este escapado, un texto que contenga `</script>` termina la etiqueta antes de tiempo y puede permitir inyección de código.

### 9.4 Microdatos en el marcado

Además del grafo JSON-LD, cada sección lleva atributos `itemscope` / `itemprop` en su HTML. Esto refuerza la asociación entre el dato estructurado y el contenido visible.

**Regla para evitar entidades duplicadas:** los microdatos se conservan donde **aportan** información que el JSON-LD no expresa (por ejemplo la miniatura de un video dentro de una tarjeta, o el precio de una oferta concreta), y se omiten donde serían un espejo exacto del grafo. Ninguna entidad debe aparecer dos veces en el informe de resultados enriquecidos.

---

## 10. Catálogo de módulos

Veintidós bloques. Cada uno vive en su propia carpeta con tres archivos y se registra en una línea.

```
src/modules/{nombre}/
├── {Nombre}.astro     # marcado + <style> con scope
├── schema.ts          # contrato Zod
└── jsonld.ts          # aporte al @graph
```

### 10.1 API de cada módulo

#### `Hero`
Apertura centrada, sin imagen. Para páginas donde el mensaje es el protagonista.

| Prop | Tipo | Req. | Descripción |
|---|---|:---:|---|
| `bg` | `'white' \| 'secondary' \| 'primary' \| 'dark'` | | Fondo de la sección |
| `badge` | `string` | | Texto de la insignia superior |
| `showDot` | `boolean` | | Punto de disponibilidad animado |
| `title` | `string` | ● | H1. Admite `<strong>`, `<em>`, `<br>` |
| `subtitle` | `string` | | Párrafo de apoyo |
| `buttons` | `Button[]` | | `{ text, url, style: 'primary' \| 'outline' }` |
| `stats` | `Stat[]` | | `{ number, label }` |

#### `HeroSplit`
Apertura a dos columnas: contenido e imagen de persona. El formato de mayor conversión en servicios profesionales.

| Prop | Tipo | Req. | Descripción |
|---|---|:---:|---|
| `bg` | `BgOption` | | |
| `imagePosition` | `'left' \| 'right'` | | Por defecto `right` |
| `badge` | `string` | | |
| `showDot` | `boolean` | | |
| `title` | `string` | ● | H1 visible |
| `seoTitle` | `string` | | **Activa el patrón de H1 diferenciado.** Ver nota |
| `subtitle` | `string` | | |
| `buttons` | `Button[]` | | |
| `stats` | `Stat[]` | | |
| `image` | `ImageMetadata` | ● | Imagen del profesional |
| `alt` | `string` | ● | Descripción de la imagen |
| `showBlob` | `boolean` | | Forma decorativa de fondo |
| `floatingCards` | `Card[]` | | `{ number, label }` superpuestas |

**Patrón de H1 diferenciado.** Cuando se define `seoTitle`, el módulo emite el `H1` real con ese texto en tamaño reducido —optimizado para la consulta de búsqueda— y presenta `title` como párrafo con tratamiento tipográfico de titular. Sirve cuando el encabezado que mejor posiciona no es el que mejor convierte. La jerarquía semántica se mantiene correcta; solo cambia la jerarquía visual.

#### `TextBlock`
Prosa con o sin imagen lateral.

| Prop | Tipo | Req. |
|---|---|:---:|
| `bg` | `BgOption` | |
| `layout` | `'centered' \| 'split'` | |
| `imagePosition` | `'left' \| 'right'` | |
| `title` | `string` | |
| `subtitle` | `string` | |
| `content` | `string` (HTML limitado) | ● |
| `image` | `ImageMetadata` | |
| `buttons` | `Button[]` | |

#### `Features`
Rejilla de tres columnas con icono, título y descripción. Para argumentos diferenciadores.

| Prop | Tipo | Req. |
|---|---|:---:|
| `bg` | `BgOption` | |
| `title` | `string` | ● |
| `subtitle` | `string` | |
| `items` | `{ icon, title, text }[]` | ● |

Iconos disponibles: `shield` `building` `dollar` `heart` `clock` `users` `star` `check` `medal` `none`.

#### `StatsStrip`
Franja horizontal de cifras. Se coloca inmediatamente después del hero para establecer credibilidad antes de cualquier argumento.

| Prop | Tipo | Req. |
|---|---|:---:|
| `bg` | `BgOption` | |
| `title` | `string` | |
| `showIcons` | `boolean` | |
| `showSeparator` | `boolean` | |
| `items` | `{ icon, number, label }[]` | ● |

#### `Comparison`
Dos tarjetas enfrentadas. Maneja la objeción de precio o de alternativa.

| Prop | Tipo | Req. |
|---|---|:---:|
| `variant` | `'list' \| 'price'` | |
| `title` | `string` | ● |
| `subtitle` | `string` | |
| `left` | `{ title, color, price?, items[] }` | ● |
| `right` | `{ title, color, price?, badge?, items[], cta? }` | ● |

`variant: 'price'` resalta la columna derecha con borde de marca y precio destacado; `variant: 'list'` presenta ambas columnas con el mismo peso visual.

#### `PriceCards`
Tarjetas de precio en rejilla de tres.

| Prop | Tipo | Req. |
|---|---|:---:|
| `bg` | `BgOption` | |
| `title` | `string` | ● |
| `subtitle` | `string` | |
| `items` | `{ service, amount, per?, compareAt?, featured?, ctaText?, ctaUrl? }[]` | ● |

#### `PriceTable`
Listado extenso de precios agrupado por categorías.

| Prop | Tipo | Req. |
|---|---|:---:|
| `title` | `string` | ● |
| `subtitle` | `string` | |
| `tables` | `{ caption, col1Header, col2Header, rows[] }[]` | ● |

Cada fila: `{ col1, col2, isCategory? }`.

#### `DataTable`
Comparativa numérica de tres columnas.

| Prop | Tipo | Req. |
|---|---|:---:|
| `title` | `string` | ● |
| `subtitle` | `string` | |
| `headers` | `[string, string, string]` | ● |
| `rows` | `{ metric, value, benchmark }[]` | ● |

#### `Faq`
Acordeón de preguntas. Emite `FAQPage`.

| Prop | Tipo | Req. |
|---|---|:---:|
| `bg` | `BgOption` | |
| `title` | `string` | |
| `subtitle` | `string` | |
| `items` | `{ question, answer }[]` | ● (mín. 2) |

#### `Reviews`
Reseñas con calificación en estrellas. Emite `AggregateRating`.

| Prop | Tipo | Req. |
|---|---|:---:|
| `bg` | `BgOption` | |
| `title` | `string` | |
| `items` | `{ name, origin?, stars, quote, avatar? }[]` | ● |

Las reseñas se transcriben literalmente de la fuente original. No se editan ni se resumen.

#### `VideoTestimonials`
Testimonios en video con carga bajo demanda.

| Prop | Tipo | Req. |
|---|---|:---:|
| `bg` | `BgOption` | |
| `title` | `string` | |
| `subtitle` | `string` | |
| `items` | `{ name, origin?, ytId, quote, result?, thumb }[]` | ● |

`ytId` es obligatorio. Un testimonio sin identificador de video rompe el build en lugar de renderizar un reproductor vacío.

#### `Team`
Perfil profesional. Emite `Person`.

| Prop | Tipo | Req. |
|---|---|:---:|
| `bg` | `BgOption` | |
| `name` | `string` | ● |
| `jobTitle` | `string` | ● |
| `image` | `ImageMetadata` | ● |
| `bio` | `string[]` | ● |
| `credentials` | `string[]` | |
| `profileUrl` | `string` | |

#### `Gallery`
Rejilla con lightbox. Emite `ImageGallery`.

| Prop | Tipo | Req. |
|---|---|:---:|
| `bg` | `BgOption` | |
| `title` | `string` | |
| `subtitle` | `string` | |
| `images` | `{ src: ImageMetadata, alt: string }[]` | ● |
| `disclaimer` | `string` | |
| `cta` | `{ text, url }` | |

#### `Marquee`
Desplazamiento continuo sin JavaScript.

| Prop | Tipo | Req. |
|---|---|:---:|
| `bg` | `BgOption` | |
| `title` | `string` | |
| `mode` | `'logos' \| 'cards' \| 'text'` | ● |
| `direction` | `'h' \| 'v'` | |
| `speed` | `'fast' \| 'normal' \| 'slow'` | |
| `items` | según `mode` | ● |

#### `Steps`
Proceso numerado. Emite `HowTo`.

| Prop | Tipo | Req. |
|---|---|:---:|
| `bg` | `BgOption` | |
| `title` | `string` | ● |
| `subtitle` | `string` | |
| `items` | `{ title, text? }[]` | ● (mín. 2) |

#### `VideoBlock`
Video con texto. Emite `VideoObject`.

| Prop | Tipo | Req. |
|---|---|:---:|
| `bg` | `BgOption` | |
| `videoPosition` | `'left' \| 'right'` | |
| `ytId` | `string` | ● |
| `ytIdDesktop` | `string` | |
| `thumbMobile` | `ImageMetadata` | ● |
| `thumbDesktop` | `ImageMetadata` | |
| `title` | `string` | ● |
| `text` | `string` | |
| `uploadDate` | `string` (ISO) | ● |
| `cta` | `{ text, url }` | |

#### `Cta`
Cierre sobre fondo oscuro.

| Prop | Tipo | Req. |
|---|---|:---:|
| `title` | `string` | ● |
| `text` | `string` | |
| `button` | `{ text, url }` | ● |
| `whatsapp` | `{ text, number }` | |
| `trustLine` | `string` | |

#### `LeadForm`
Envoltorio de sección alrededor de `ContactForm.astro`. No define marcado de formulario propio: la definición vive en un único componente, descrita en la sección 13.

| Prop | Tipo | Req. |
|---|---|:---:|
| `bg` | `BgOption` | |
| `title` | `string` | ● |
| `text` | `string` | |
| `benefits` | `string[]` | |
| `formId` | `string` | ● |
| `submitText` | `string` | |
| `trustText` | `string` | |

#### `LeadMagnet`
Intercambio de un documento descargable por los datos de contacto. La portada se representa como un objeto tridimensional animado. Implementación completa en la sección 10.3.

| Prop | Tipo | Req. | Descripción |
|---|---|:---:|---|
| `bg` | `BgOption` | | |
| `eyebrow` | `string` | | Antetítulo corto: `Guía gratuita` |
| `title` | `string` | ● | |
| `text` | `string` | | |
| `cover` | `ImageMetadata` | ● | Portada, vertical |
| `coverAlt` | `string` | ● | |
| `bullets` | `string[]` | | Contenido del documento, de 3 a 5 líneas |
| `meta` | `{ pages, format, readTime }` | | Se muestra como franja bajo el título |
| `formId` | `string` | ● | Identificador propio, distinto del formulario comercial |
| `submitText` | `string` | | |
| `trustText` | `string` | | |

#### `Divider`

| Prop | Tipo |
|---|---|
| `spacing` | `'sm' \| 'md' \| 'lg'` |

#### `RawHtml`
Escotilla de escape para incrustaciones de terceros. Su contenido se sanea en build.

| Prop | Tipo | Req. |
|---|---|:---:|
| `code` | `string` | ● |

### 10.2 Anatomía de un módulo

```ts
// src/modules/faq/schema.ts
import { z } from 'astro:content';

export const faqSchema = z.object({
  type: z.literal('faq'),
  bg: z.enum(['white', 'secondary', 'primary', 'dark']).default('white'),
  title: z.string().default('Preguntas frecuentes'),
  subtitle: z.string().optional(),
  items: z.array(z.object({
    question: z.string().min(1),
    answer: z.string().min(1),
  })).min(2, 'Un bloque de preguntas frecuentes requiere al menos 2 entradas'),
});

export type FaqData = z.infer<typeof faqSchema>;
```

```ts
// src/modules/faq/jsonld.ts
import type { FaqData } from './schema';
import type { PageContext, SchemaNode } from '../../lib/schema/types';

export function faqJsonLd(data: FaqData, ctx: PageContext): SchemaNode[] {
  return [{
    '@type': 'FAQPage',
    '@id': `${ctx.url}#faq`,
    mainEntity: data.items.map(item => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  }];
}
```

```astro
---
// src/modules/faq/Faq.astro
import type { FaqData } from './schema';
import SectionHeader from '../../components/SectionHeader.astro';

const { bg, title, subtitle, items } = Astro.props as FaqData;
---
<section
  class:list={['section', bg !== 'white' && `bg-${bg}`]}
  itemscope
  itemtype="https://schema.org/FAQPage"
>
  <div class="container measure-lg mx-auto">
    <SectionHeader {title} {subtitle} />

    <div class="accordion">
      {items.map((item, i) => (
        <details
          open={i === 0}
          itemscope
          itemprop="mainEntity"
          itemtype="https://schema.org/Question"
        >
          <summary itemprop="name">{item.question}</summary>
          <div itemprop="acceptedAnswer" itemscope itemtype="https://schema.org/Answer">
            <p class="text-grey t-sm" itemprop="text">{item.answer}</p>
          </div>
        </details>
      ))}
    </div>
  </div>
</section>
```

```ts
// src/modules/_registry.ts — único archivo central
import Faq from './faq/Faq.astro';
import { faqSchema } from './faq/schema';
import { faqJsonLd } from './faq/jsonld';
// … resto de módulos

export const registry = {
  faq: { component: Faq, schema: faqSchema, jsonld: faqJsonLd },
  // una línea por módulo
} as const;

export const moduleSchema = z.discriminatedUnion('type', [
  faqSchema,
  // …
]);
```

Añadir un módulo consiste en crear una carpeta y agregar una línea al registro. Si un módulo nuevo obliga a modificar cualquier otro archivo, el diseño está mal planteado.

### 10.3 `LeadMagnet`: objeto tridimensional sin JavaScript

Un documento descargable convierte mejor cuando se ve como un objeto físico. La diferencia entre mostrar un rectángulo plano y mostrar un libro con volumen, peso y luz reflejada es medible: lo segundo se percibe como algo que existe y que tiene valor. Todo el efecto es CSS.

#### Marcado

```astro
---
// src/modules/lead-magnet/LeadMagnet.astro
import { Image } from 'astro:assets';
import ContactForm from '../../components/ContactForm.astro';
import type { LeadMagnetProps } from './schema';

const { bg, eyebrow, title, text, cover, coverAlt, bullets = [], meta,
        formId, submitText, trustText } = Astro.props as LeadMagnetProps;
---
<section class:list={['section', 'lead-magnet', bg !== 'white' && `bg-${bg}`]}>
  <div class="container">
    <div class="row">

      <div class="col col-5-md">
        <figure class="book-stage">
          <!-- La sombra va primero: se pinta debajo del libro sin recurrir a z-index -->
          <span class="book__shadow" aria-hidden="true"></span>

          <div class="book">
            <div class="book__face">
              <Image src={cover} alt={coverAlt} widths={[280, 560]}
                     sizes="(min-width: 900px) 280px, 70vw" loading="lazy" />
              <span class="book__binding" aria-hidden="true"></span>
              <span class="book__sheen"   aria-hidden="true"></span>
            </div>
            <span class="book__edge" aria-hidden="true"></span>
          </div>
        </figure>
      </div>

      <div class="col col-7-md">
        {eyebrow && <p class="label text-primary">{eyebrow}</p>}
        <h2 class="t-3xl">{title}</h2>
        {text && <p class="text-grey measure">{text}</p>}

        {meta && (
          <ul class="magnet-meta">
            {meta.pages    && <li>{meta.pages} páginas</li>}
            {meta.format   && <li>{meta.format}</li>}
            {meta.readTime && <li>{meta.readTime}</li>}
          </ul>
        )}

        {bullets.length > 0 && (
          <ul class="magnet-list">
            {bullets.map(b => <li>{b}</li>)}
          </ul>
        )}

        <ContactForm {formId} variant="compact" {submitText} />
        {trustText && <p class="form__trust t-xs">{trustText}</p>}
      </div>

    </div>
  </div>
</section>
```

#### Estilos

Van en el `<style>` del módulo. No son compartidos: ningún otro bloque de la página necesita perspectiva tridimensional.

```css
/* ── Escenario ── */
/* La perspectiva vive en el padre. Aplicarla sobre el propio libro
   lo haría girar sobre su propio punto de fuga en lugar de sobre el de la escena. */
.book-stage {
  position: relative;
  display: grid;
  place-items: center;
  margin: 0;
  padding-block: var(--space-7);
  perspective: 1600px;
  perspective-origin: 50% 40%;
}

/* ── El libro ── */
.book {
  --book-w: min(280px, 62vw);
  --book-depth: 26px;

  position: relative;
  width: var(--book-w);
  aspect-ratio: 3 / 4;
  transform-style: preserve-3d;
  will-change: transform, translate;

  /* La inclinación vive en `transform`; el flotado en `translate` y `rotate`,
     que son propiedades independientes. Si el flotado también animara
     `transform`, sobrescribiría la inclinación en el primer fotograma. */
  transform: rotateX(6deg) rotateY(-22deg);
  transition: transform .7s cubic-bezier(.22, 1, .36, 1);

  /* Dos ciclos de duración distinta y no múltiple: nunca coinciden
     en el mismo punto, y el movimiento deja de parecer un bucle. */
  animation:
    book-float 7s   ease-in-out infinite,
    book-tilt  11s  ease-in-out infinite;
}

/* ── Cara frontal: plana dentro de la escena tridimensional ── */
/* El brillo usa `mix-blend-mode`, que agrupa y aplana su contenedor.
   Por eso vive aquí y no dentro del elemento con `preserve-3d`:
   de lo contrario destruiría el volumen del libro. */
.book__face {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: 2px 6px 6px 2px;
  box-shadow:
    0 2px 6px rgb(16 24 40 / .18),
    0 24px 48px rgb(16 24 40 / .22);
}
.book__face img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* Lomo: sombra de encuadernación sobre el borde izquierdo */
.book__binding {
  position: absolute;
  inset: 0 auto 0 0;
  width: 13%;
  background: linear-gradient(
    90deg,
    rgb(0 0 0 / .38) 0,
    rgb(0 0 0 / .10) 42%,
    rgb(255 255 255 / .16) 72%,
    rgb(0 0 0 / .06) 100%
  );
}

/* ── Canto de páginas ── */
/* Bisagra en el borde derecho y giro de -90°: la cara se hunde
   hacia el fondo de la escena y forma el grosor del libro. */
.book__edge {
  position: absolute;
  top: 1.2%;
  right: 0;
  width: var(--book-depth);
  height: 97.6%;
  transform-origin: right center;
  transform: rotateY(-90deg);
  background:
    repeating-linear-gradient(90deg,
      #f4f4f0 0 1px,
      #d9d9d2 1px 2.5px);
  border-radius: 0 2px 2px 0;
}

/* ── Brillo ── */
.book__sheen {
  position: absolute;
  top: -20%;
  left: 0;
  width: 35%;
  height: 140%;
  mix-blend-mode: screen;
  filter: blur(2px);
  rotate: 12deg;
  background: linear-gradient(
    100deg,
    #0000,
    #ffffff14 35%,
    #ffffff8c 50%,
    #ffffff14 65%,
    #0000
  );
  animation: book-sheen 5s linear infinite;
}

/* ── Sombra proyectada ── */
/* Fuera del libro: no debe inclinarse con él. Se sincroniza con el
   flotado usando la misma duración y la misma curva. */
.book__shadow {
  position: absolute;
  left: 15%;
  bottom: var(--space-5);
  width: 70%;
  height: 20px;
  background: radial-gradient(ellipse at center, rgb(16 24 40 / .34), #0000 70%);
  filter: blur(10px);
  animation: book-shadow 7s ease-in-out infinite;
}

/* ── Ciclos ── */
@keyframes book-float {
  0%, 100% { translate: 0 -7px; }
  50%      { translate: 0  7px; }
}
@keyframes book-tilt {
  0%, 100% { rotate: y  0deg; }
  50%      { rotate: y  3deg; }
}
@keyframes book-sheen {
  0%       { translate: -180% 0; }
  55%,100% { translate:  420% 0; }
}
@keyframes book-shadow {
  0%, 100% { scale: .90; opacity: .45; }
  50%      { scale: 1.06; opacity: .80; }
}

/* Al acercar el cursor el libro se endereza: gesto de entrega. */
@media (hover: hover) {
  .book-stage:hover .book {
    transform: rotateX(2deg) rotateY(-7deg) scale(1.03);
  }
}

@media (prefers-reduced-motion: reduce) {
  .book,
  .book__sheen,
  .book__shadow { animation: none; }
  .book { transform: rotateY(-10deg); transition: none; }
  .book__sheen { display: none; }
}

/* ── Contenido lateral ── */
.magnet-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  padding: 0;
  margin: 0 0 var(--space-4);
  list-style: none;
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--color-grey);
}
.magnet-meta li + li::before {
  content: '·';
  margin-right: var(--space-3);
}

.magnet-list {
  padding: 0;
  margin: 0 0 var(--space-5);
  list-style: none;
}
.magnet-list li {
  position: relative;
  padding-left: var(--space-5);
  margin-bottom: var(--space-2);
  font-size: var(--text-sm);
}
.magnet-list li::before {
  content: '';
  position: absolute;
  left: 0;
  top: .55em;
  width: 8px;
  height: 8px;
  background: var(--color-primary);
  border-radius: 50%;
}

@media (min-width: 900px) {
  .book { --book-w: 280px; }
  .book-stage { padding-block: var(--space-8); }
}
```

#### Por qué cada decisión

**La perspectiva está en el contenedor, no en el libro.** `perspective` sobre el propio elemento transformado hace que cada objeto tenga su punto de fuga individual. En el padre, todos comparten el punto de fuga de la escena, que es como funciona la visión real. Con un solo objeto la diferencia es sutil; con dos, aplicarla mal se nota de inmediato.

**El giro fijo va en `transform` y el movimiento en `translate` y `rotate`.** Esta es la trampa clásica de las animaciones tridimensionales: si una animación de flotado tiene fotogramas que declaran `transform: translateY(…)`, en el primer fotograma sustituye por completo al `transform: rotateX() rotateY()` del elemento y el objeto se aplana de golpe. `translate`, `rotate` y `scale` son propiedades independientes que el navegador compone con `transform`, así que conviven sin pisarse. Es también lo que permite que el enderezado al pasar el cursor siga funcionando mientras el libro flota.

**Dos ciclos de duración no múltiple.** 7 y 11 segundos no coinciden hasta los 77. El ojo detecta un bucle corto en pocos segundos; con dos frecuencias primas entre sí, el movimiento se percibe orgánico. El mismo criterio se aplica al brillo, con su ciclo de 5 segundos.

**El brillo vive en la cara plana, no en el elemento con `preserve-3d`.** Cualquier propiedad que agrupe el contenido —`mix-blend-mode`, `filter`, `opacity` menor que 1— fuerza al navegador a aplanar sus descendientes tridimensionales. Colocar el brillo directamente dentro del libro destruiría el grosor del canto. La cara frontal es un elemento plano dentro de la escena, así que puede mezclar sin efectos colaterales.

**`mix-blend-mode: screen` y no `opacity`.** `screen` solo puede aclarar: sobre las zonas claras de la portada apenas se nota y sobre las oscuras produce el destello. Es el comportamiento físico de la luz reflejada. Una capa blanca con opacidad lava la imagen entera por igual y parece niebla.

**El canto se construye con una rotación de -90° con bisagra en el borde derecho.** Con la inclinación negativa en Y, ese es el lado que queda de cara al espectador. El degradado repetido de dos tonos a intervalos de 2,5 píxeles simula las hojas; a resolución real se lee como papel, no como rayas.

**La sombra es hermana del libro, no hija.** Como hija se inclinaría y flotaría con él, lo que delata inmediatamente el truco. Como hermana con la misma duración y curva, crece y se oscurece cuando el libro baja: la sombra reacciona a la altura del objeto, que es lo que hace creíble el peso.

**El brillo desaparece por completo con movimiento reducido.** Detenerlo a mitad de recorrido dejaría una banda blanca fija sobre la portada, peor que no tenerlo. La inclinación se conserva porque no es movimiento: es la forma del objeto.

**`will-change` se declara solo en el libro.** Promueve una capa de composición para las dos propiedades que realmente cambian. Aplicarlo a los cuatro elementos consumiría memoria de vídeo sin ganar nada.

#### Entrega del documento

El archivo **no se enlaza en la página**. Si la URL es pública y adivinable, el documento circula sin dejar un solo dato y el bloque deja de tener sentido.

| Regla | Motivo |
|---|---|
| El documento se entrega tras la confirmación del servidor | Es la contraprestación del dato, no un adorno |
| La URL incluye un componente no adivinable | Impide compartir el enlace directo |
| El directorio se excluye en `robots.txt` y responde con `X-Robots-Tag: noindex` | Evita que el buscador lo indexe y lo sirva sin formulario |
| El enlace se envía también por correo | Confirma que la dirección es real y abre el canal de seguimiento |

Este módulo usa un `formId` propio. En los informes, los leads de descarga y los leads comerciales no se mezclan: tienen intención distinta y valor distinto. Su valor en la configuración de conversión debe ser menor que el de una solicitud de presupuesto, o la puja automática optimizará hacia el tráfico más barato y menos comprometido.

---

## 11. Arquitectura de contenido

### 11.1 Dos colecciones, dos propósitos

```ts
// src/content.config.ts
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { moduleSchema } from './modules/_registry';
import { seoSchema } from './lib/seo';

const landings = defineCollection({
  loader: glob({ pattern: '**/*.yaml', base: './src/content/landings' }),
  schema: z.object({
    title: z.string(),
    cluster: z.enum(['transaccional', 'seo', 'brand', 'trust', 'comercial']),
    service: z.string().optional(),
    cost: z.string().optional(),
    seo: seoSchema,
    modules: z.array(moduleSchema).min(1),
  }),
});

const articulos = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/articulos' }),
  schema: ({ image }) => z.object({
    title: z.string(),
    description: z.string().min(80).max(160),
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),
    cover: image().optional(),
    cluster: z.string().optional(),
    faq: z.array(z.object({ question: z.string(), answer: z.string() })).optional(),
  }),
});

export const collections = { landings, articulos };
```

El helper `image()` en el schema valida que el archivo referenciado exista y lo pasa por el optimizador. Si la imagen se borra, el build falla en lugar de publicar un enlace roto.

La restricción `.min(80).max(160)` en la descripción impide publicar meta descripciones truncadas o vacías.

### 11.2 Landings en YAML

Una landing de campaña es una secuencia de bloques configurados. No hay prosa libre, por lo que el formato natural es datos:

```yaml
# src/content/landings/implantes-dentales-cancun.yaml
title: Implantes Dentales en Cancún
cluster: transaccional
service: Implantes Dentales
cost: $900 USD

seo:
  title: "{service} en {locality} desde {cost} | {company}"
  description: "Implantes dentales en Cancún desde $900 USD con especialista certificado. Consulta virtual gratuita y presupuesto cerrado en 24 horas."
  schemaType: Dentist
  ogImage: /og/implantes.webp
  ratingValue: "4.9"
  ratingCount: "312"

modules:
  - type: hero-split
    badge: Consulta virtual sin costo
    showDot: true
    title: "{service} en {locality}"
    subtitle: "Desde **{cost}** todo incluido: valoración, cirugía, corona y seguimiento."
    image: ./assets/especialista.webp
    alt: Especialista en implantología en su consultorio de Cancún
    buttons:
      - { text: Cotizar ahora, url: "#contacto", style: primary }
      - { text: WhatsApp, url: "https://wa.me/{whatsapp}", style: outline }
    stats:
      - { number: "3,500+", label: Implantes colocados }
      - { number: "4.9★",   label: 312 reseñas verificadas }

  - type: stats-strip
    showIcons: true
    showSeparator: true
    items:
      - { icon: medal,  number: "15 años", label: De experiencia clínica }
      - { icon: shield, number: "Certificado", label: Por el consejo mexicano }
      - { icon: clock,  number: "3 días", label: Estancia promedio }

  - type: faq
    items:
      - question: "¿Cuánto cuesta un implante dental en Cancún?"
        answer: "El implante unitario inicia en 900 USD e incluye valoración, tomografía, cirugía, tornillo de titanio y corona definitiva."
```

Ventajas de este formato: permite generación programática, el grafo completo se conoce antes de renderizar, y un agente de IA puede escribirlo sin ambigüedad.

### 11.3 Contenido de autoridad en MDX

Para artículos donde la prosa es lo principal:

```mdx
---
title: "Guía completa de implantes dentales en México 2026"
description: "Costos reales por tipo de implante, tiempos de recuperación y qué incluye cada presupuesto en clínicas certificadas."
publishedAt: 2026-08-10
cluster: implantes
cover: ./portada.webp
faq:
  - question: "¿Cuánto dura un implante dental?"
    answer: "Con higiene adecuada y revisiones anuales, la vida útil supera los veinte años."
---

Un implante dental en México cuesta entre un 60 % y un 70 % menos que en
Estados Unidos, sin diferencia en el material del tornillo ni en la
certificación del especialista.

<PriceCards
  title="Costo por tipo de implante"
  items={[
    { service: "Implante unitario", amount: "$900",   per: "USD" },
    { service: "All-on-4 completo", amount: "$8,500", per: "USD", featured: true },
  ]}
/>

## Qué incluye realmente el precio

La diferencia no está en el implante sino en el costo operativo de la clínica…

<Faq items={frontmatter.faq} />
```

**Regla sobre datos estructurados en MDX.** El `<head>` se renderiza antes que el cuerpo del documento, por lo que un componente colocado en el cuerpo no puede aportar información al grafo. Por eso, cualquier dato que deba aparecer en los datos estructurados —preguntas frecuentes, pasos de un proceso— se declara en el frontmatter y el componente lo consume desde ahí. Una sola fuente de verdad, sin duplicación.

### 11.4 Componentes disponibles sin importar en cada archivo

```astro
---
// src/pages/articulos/[...slug].astro
import { getCollection, render } from 'astro:content';
import { mdxComponents } from '../../lib/mdx-components';
import Article from '../../layouts/Article.astro';

export async function getStaticPaths() {
  const posts = await getCollection('articulos');
  return posts.map(post => ({ params: { slug: post.id }, props: { post } }));
}

const { post } = Astro.props;
const { Content } = await render(post);
---
<Article entry={post}>
  <Content components={mdxComponents} />
</Article>
```

`mdxComponents` exporta los módulos más el mapeo de elementos (`h2`, `a`, `img`, `table`) a versiones con las clases del sistema.

### 11.5 Generación programática

La cobertura por ciudad y servicio se resuelve con una sola ruta:

```astro
---
// src/pages/[...slug].astro
import { getCollection } from 'astro:content';
import { site } from '../config/site';
import Landing from '../layouts/Landing.astro';

export async function getStaticPaths() {
  const landings = await getCollection('landings');

  const manuales = landings.map(entry => ({
    params: { slug: entry.id },
    props: { entry },
  }));

  const ciudades = ['cancun', 'playa-del-carmen', 'tulum', 'merida'];
  const generadas = ciudades.flatMap(ciudad =>
    site.services.map(servicio => ({
      params: { slug: `${slugify(servicio.name)}-en-${ciudad}` },
      props: { generated: { servicio, ciudad } },
    }))
  );

  return [...manuales, ...generadas];
}
---
```

Cuatro ciudades por doce servicios producen cuarenta y ocho páginas con grafo completo, migas de pan correctas y variables resueltas, desde un solo archivo.

### 11.6 Variables de plantilla

Se resuelven en build, dentro de cualquier campo de texto:

```
{company}   {locality}  {region}   {country}
{phone}     {whatsapp}  {service}  {cost}
{year}
```

Ejemplo: `"Implantes dentales en {locality} desde {cost}"` produce `"Implantes dentales en Cancún desde $900 USD"`.

La sustitución ocurre **sobre los datos**, antes de renderizar, no sobre el HTML resultante.

---

## 12. JavaScript permitido

Presupuesto total del sitio: **cinco scripts, menos de 5 KB comprimidos**. Ninguno es obligatorio para que la página funcione; todos son mejoras sobre una base que ya opera sin JavaScript.

| Script | Función | Sin él |
|---|---|---|
| Fachada de video | Carga bajo demanda, vertical/horizontal | El enlace al video sigue funcionando |
| `attribution.js` | Captura de origen de campaña | El lead llega sin datos de campaña |
| `form.js` | Envío sin recarga y estados | El formulario envía con POST nativo |
| `track.js` | Eventos de interacción | Solo se miden vistas de página y la conversión |
| Verificación diferida | Antispam de terceros | El honeypot y la validación de servidor siguen activos |

### 12.1 Video: vertical por defecto, horizontal solo cuando toca

Dos reglas, y la primera es la que más se incumple.

#### Regla 1 — En móvil el video es VERTICAL 9:16. Siempre.

El horizontal es la excepción, no al revés. Un video vertical junto a un formulario, o dentro de una tarjeta, ocupa la columna entera y se lee; un 16:9 en ese hueco queda aplastado y desperdicia el espacio. La única sección que exige horizontal a pantalla completa en escritorio es la VSL.

```css
/* MOBILE FIRST: vertical por defecto */
.youtube-video { position: relative; overflow: hidden; aspect-ratio: 9 / 16; }

/* Forzados, cuando la sección lo pide */
.youtube-video.ratio-vertical   { aspect-ratio: 9 / 16; }  /* junto a un form, en card */
.youtube-video.ratio-horizontal { aspect-ratio: 16 / 9; }  /* VSL */

/* Vertical SIN RECORTE: se ve el encuadre completo en vez de comerse los
   bordes. Un video vertical recortado pierde justo lo que lo hace vertical. */
.youtube-video.ratio-vertical img {
  object-fit: contain;
  background: var(--color-darkGrey);
}

/* Solo el que NO declara proporción pasa a horizontal en escritorio */
@media (min-width: 900px) {
  .youtube-video:not(.ratio-vertical):not(.ratio-horizontal) { aspect-ratio: 16 / 9; }
}
```

#### Regla 2 — Dos ids de YouTube, no uno

| Atributo | Contenido | Obligatorio |
|---|---|---|
| `data-video-id` | El video **vertical** (móvil) | Sí |
| `data-desktop-video-id` | El **horizontal** (escritorio) | No — si falta, se reutiliza el vertical |

Si existe versión horizontal se usa en escritorio; si no, el vertical sirve para los dos. **La elección se hace en el clic, no al cargar**, para que girar el móvil no sirva el video equivocado.

**El umbral es `min-width: 900px`, el mismo del CSS, y se escribe igual en JavaScript:**

```js
const isDesktop = window.matchMedia('(min-width:900px)').matches;
const videoId = isDesktop
  ? wrap.dataset.desktopVideoId || wrap.dataset.videoId
  : wrap.dataset.videoId;
```

No es una preferencia de estilo. Si el JavaScript usa otro umbral —el clásico `max-width: 767px` heredado de Bootstrap— se abre una franja entre 768px y 899px en la que el CSS sigue aplicando `aspect-ratio: 9 / 16` mientras el JavaScript ya sirve el id horizontal: la tablet recibe un 16:9 embutido en un marco vertical, con dos tercios del hueco en negro. Es un fallo que no se ve en el móvil ni en el escritorio del que lo escribe, y que el grep de `@media (max-width` de §20 **no detecta**, porque la violación es una llamada a `matchMedia`. Por eso la lista lleva un grep aparte para ella.

La miniatura también es mobile-first: el `<img>` lleva la vertical y el `<source media="(min-width: 900px)">` la horizontal.

```html
<div class="youtube-video" data-video-id="VERTICAL" data-desktop-video-id="HORIZONTAL">
  <picture>
    <source media="(min-width: 900px)" srcset="/thumb-desktop.webp" width="960" height="540">
    <img src="/thumb-mobile.webp" width="1080" height="1920" alt="…" loading="lazy">
  </picture>
  <button type="button" class="play-button" aria-label="Ver video">…</button>
  <div class="youtube-iframe"></div>
</div>
```

#### El disparador es el botón, no el bloque

```js
const wrap = e.target.closest('.youtube-video');
const btn  = e.target.closest('.play-button');
if (!wrap || !btn) return;          // hacen falta LOS DOS
```

Sin exigir `.play-button`, **cualquier** clic dentro del bloque arranca el video: el que cae en el pie de foto, el que se da para cerrar un desplegable que quedaba encima, o el que suelta un arrastre que empezó fuera. El botón es lo que separa "quiero ver el video" de "he tocado por aquí".

Dos precisiones, porque es fácil deducir de más:

- **El foco no dispara clics.** Ningún navegador sintetiza un `click` al enfocar un elemento. Si aparecen reproductores fantasma, la causa está en el delegado o en la ausencia de guardia de reentrada, no en el foco.
- **La guardia contra la doble inicialización es el `WeakMap`, no el selector.** El `.play-button` del catálogo se pinta con `position: absolute; inset: 0`, así que cubre el bloque entero y en la práctica casi todo clic real lo alcanza. Lo que impide instanciar dos veces el mismo video es comprobar el mapa antes de crear el reproductor.

El `.play-button` es un `<button>`, no un `<div>`: así se activa con teclado sin añadir `role` ni manejadores.

#### El envoltorio no puede ser un `<button>`

Al reproducir se inserta un `<iframe>` dentro. Un `<iframe>` dentro de un `<button>` es marcado inválido y, peor, el botón se traga los clics: los controles de YouTube quedan inutilizables. El envoltorio es un `<div>`.

#### Dónde vive esta lógica

**En el script único del sitio, no en un script por componente.** Una landing con seis videos no debe cargar seis copias del mismo escuchador. El delegado va en el mismo archivo que la atribución y los beacons.

Se carga la API de YouTube bajo demanda (`YT.Player`) en lugar de insertar un iframe suelto, para poder arrancar la reproducción sin exigir un segundo gesto al usuario. Orden que evita un reflow doble: retirar miniatura y botón primero, marcar el estado, crear el contenedor y solo entonces —dentro de `requestAnimationFrame`— cargar el reproductor.

#### Sin cookies: `host`, no el dominio del script

Usar la API tiene un precio que hay que pagar a mano. `YT.Player` embebe en `youtube.com` por defecto, así que planta cookies de seguimiento en cuanto alguien le da al play. Se corrige con una opción:

```js
new YT.Player(container, {
  videoId,
  host: 'https://www.youtube-nocookie.com',   // el embed, sin cookies
  playerVars: { autoplay: 1, controls: 1, rel: 0, playsinline: 1 },
});
```

El script de la API sí sale de `youtube.com` —no hay copia en el dominio nocookie—, de modo que **intervienen dos dominios y hay que precargar los dos**:

```html
<link rel="preconnect" href="https://www.youtube.com">
<link rel="preconnect" href="https://www.youtube-nocookie.com">
```

Precargar solo `nocookie`, que es lo que pide el instinto, deja sin conexión abierta al dominio del que cuelga la primera petición de la cascada, y encima incumple la regla de §8.4: un `preconnect` hacia un dominio que la página no usa desperdicia una conexión.

Un `WeakMap` de instancias evita inicializar dos veces el mismo bloque.

### 12.2 Atribución de campaña

Captura el origen del visitante y lo transporta hasta el formulario.

```js
// src/lib/attribution.js
const KEYS = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content',
              'gclid','fbclid','msclkid'];
const TTL = 90 * 24 * 60 * 60 * 1000;   // 90 días

function persist(data) {
  localStorage.setItem('attr', JSON.stringify({ data, exp: Date.now() + TTL }));
}

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem('attr') || 'null');
    if (!raw || raw.exp < Date.now()) return null;
    return raw.data;
  } catch { return null; }
}

function capture() {
  const params = new URLSearchParams(location.search);
  const found = {};
  for (const k of KEYS) { const v = params.get(k); if (v) found[k] = v; }

  // Inferencia por plataforma cuando falta el UTM explícito
  if (params.has('gclid') || params.has('gad_source')) {
    found.utm_source ||= 'google'; found.utm_medium ||= 'cpc';
  } else if (params.has('msclkid')) {
    found.utm_source ||= 'bing';   found.utm_medium ||= 'cpc';
  } else if (params.has('fbclid')) {
    found.utm_source ||= 'facebook'; found.utm_medium ||= 'paid_social';
  }

  // Primer contacto: no se sobrescribe una atribución previa
  const existing = read();
  const merged = existing ? { ...found, ...existing } : found;

  // Origen orgánico o referido, solo si no hay nada
  if (!merged.utm_source && document.referrer) {
    const ref = document.referrer.toLowerCase();
    const host = new URL(document.referrer).host;
    if (!host.includes(location.host)) {
      if (ref.includes('google.'))         { merged.utm_source = 'google';    merged.utm_medium = 'organic'; }
      else if (ref.includes('bing.'))      { merged.utm_source = 'bing';      merged.utm_medium = 'organic'; }
      else if (ref.includes('facebook.'))  { merged.utm_source = 'facebook';  merged.utm_medium = 'social'; }
      else if (ref.includes('instagram.')) { merged.utm_source = 'instagram'; merged.utm_medium = 'social'; }
      else                                 { merged.utm_source = host;        merged.utm_medium = 'referral'; }
    }
  }

  if (Object.keys(merged).length) persist(merged);
  return merged;
}

function hydrateForms(data) {
  for (const [k, v] of Object.entries(data)) {
    document.querySelectorAll(`input[name="${k}"]`).forEach(i => { i.value = v; });
  }
  const landing = document.querySelector('input[name="landing_slug"]');
  if (landing && !landing.value) {
    landing.value = location.pathname.replace(/^\/|\/$/g, '') || 'home';
  }
}

const run = () => hydrateForms(capture());
'requestIdleCallback' in window
  ? requestIdleCallback(run, { timeout: 2000 })
  : setTimeout(run, 500);
```

Dos decisiones importantes: la atribución es de **primer contacto** —una visita posterior desde otro canal no reescribe el origen que trajo al usuario— y persiste noventa días, que cubre el ciclo de decisión típico de un servicio de alto valor.

### 12.3 Mejora del envío de formulario

Este script **no crea** el envío: el formulario ya funciona con un POST nativo del navegador. Lo único que aporta es evitar la recarga y dar estados visibles. Si falla o no carga, el formulario recupera su comportamiento nativo sin perder un solo lead.

```js
// src/scripts/form.js
import { push } from './track.js';

export function initForm(form) {
  let sending = false;

  form.addEventListener('submit', async e => {
    if (sending) { e.preventDefault(); return; }
    e.preventDefault();
    sending = true;

    const btn = form.querySelector('[type="submit"]');
    const original = btn.textContent;
    const errorBox = form.querySelector('[data-form-error]');

    btn.disabled = true;
    btn.textContent = btn.dataset.sending || 'Enviando…';
    errorBox?.setAttribute('hidden', '');

    try {
      const res = await fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { Accept: 'application/json' },
      });
      const body = await res.json().catch(() => null);

      // El servidor manda: cualquier cosa que no sea confirmación es fallo
      if (!res.ok || !body?.leadId) throw new Error(body?.message || `HTTP ${res.status}`);

      push('form_submit', { form_id: form.dataset.form });
      btn.textContent = btn.dataset.sent || 'Enviado ✓';
      location.href = `${form.dataset.thankYou}?lead=${encodeURIComponent(body.leadId)}`;

    } catch (err) {
      sending = false;
      btn.disabled = false;
      btn.textContent = original;
      push('form_error', { form_id: form.dataset.form, message: String(err.message).slice(0, 80) });
      if (errorBox) {
        errorBox.removeAttribute('hidden');
        errorBox.focus();
      }
    }
  });
}
```

Tres decisiones deliberadas. **El identificador de lead viaja en la URL de destino**, porque la conversión se contabiliza en la página de agradecimiento y no aquí. **El error devuelve el foco al mensaje**, no al principio del formulario: quien usa lector de pantalla debe enterarse de que falló. **El botón no se rehabilita hasta que hay una respuesta**, lo que elimina los envíos duplicados por doble clic.

### 12.4 Registro de interacciones

Un único escuchador delegado para todo el sitio. No hay un `addEventListener` por elemento ni handlers en el marcado.

```js
// src/scripts/track.js
export function push(event, params = {}) {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event, page_path: location.pathname, ...params });
}

// Clics: elementos marcados, teléfonos y WhatsApp
document.addEventListener('click', e => {
  const el = e.target.closest('[data-track], a[href^="tel:"], a[href*="wa.me"]');
  if (!el) return;

  const href = el.getAttribute('href') || '';
  const name = el.dataset.track
    || (href.startsWith('tel:') ? 'call_click' : 'whatsapp_click');

  push(name, {
    label: el.dataset.trackLabel || el.textContent.trim().slice(0, 60),
  });
}, { passive: true, capture: true });

// Primer contacto con un formulario, una sola vez por formulario
document.addEventListener('focusin', e => {
  const form = e.target.closest('form[data-form]');
  if (!form || form.dataset.started) return;
  form.dataset.started = '1';
  push('form_start', { form_id: form.dataset.form });
}, { passive: true });
```

Se escucha en fase de captura para que el evento se registre aunque el elemento provoque una navegación inmediata. Los escuchadores son pasivos: no bloquean el desplazamiento.

**Nunca se usan atributos `onclick` en el marcado.** Un handler inline no se puede reutilizar, no se minifica, obliga a relajar la política de seguridad de contenido con `unsafe-inline` y multiplica el mismo fragmento en cada elemento. El atributo `data-track` declara *qué* se mide; el escuchador decide *cómo*.

### 12.5 Protección de formularios diferida

```js
// Solo si el proyecto usa un servicio de verificación
let loaded = false;
const load = () => {
  if (loaded) return;
  loaded = true;
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
  s.async = true; s.defer = true;
  document.head.appendChild(s);
};

document.addEventListener('focusin', e => {
  if (e.target.closest('form')) load();
}, { passive: true });
```

El script de verificación se carga en la primera interacción real con un formulario, no en la carga de la página.

### 12.6 Tres trampas de Astro que rompen el JavaScript en silencio

Las tres producen código que **no llega al navegador** sin dar ningún error de build. Se detectan solo mirando el HTML emitido.

#### 1. Un `import` en el frontmatter NO llega al navegador

```astro
---
import "../scripts/wa-ref";   // ❌ se ejecuta en BUILD, no en el cliente
---
```

El frontmatter corre en el servidor durante la generación. Si el script toca `document` o `localStorage`, o falla en build, o —si tiene `try/catch`— no hace nada y desaparece sin rastro. Para que llegue al cliente tiene que ir en un `<script>` del marcado:

```astro
<script>
  import "../scripts/wa-ref";   // ✅ Astro lo compila y lo empaqueta
</script>
```

#### 2. `define:vars` convierte el script en `is:inline`

```astro
<script define:vars={{ base }}>
  function leer(form: HTMLFormElement) { … }   // ❌ TypeScript literal al navegador
</script>
```

`define:vars` implica `is:inline`, y **Astro no procesa los scripts inline**: no los compila, no les quita los tipos y no los empaqueta. El navegador recibe TypeScript y lanza `SyntaxError` antes de ejecutar la primera línea. El listener nunca se registra y el formulario hace su submit nativo por GET.

La forma correcta: el script va en un módulo aparte y los datos viajan por `data-*`.

```astro
<form data-base={base}>…</form>
<script>import "../scripts/lead-form";</script>
```

#### 3. `input[name="…"]` no encuentra `<textarea>` ni `<select>`

```js
form.querySelector(`input[name="${n}"]`)   // ❌ el mensaje llega siempre vacío
form.querySelector(`[name="${n}"]`)        // ✅
```

Es el bug más silencioso de los tres: el formulario envía, el lead se crea, y solo falta un campo.

#### Cómo verificarlo

No basta con que el build pase. Sobre el HTML emitido, y **desde la raíz del
repositorio** — la landing vive en `landing/`, así que un `src/` a secas apunta
a la aplicación Next y todas las comprobaciones pasan sin haber mirado nada:

```bash
# 1. Todo módulo que Astro empaquetó tiene que parsear. Si un `define:vars`
#    coló TypeScript, el archivo ni siquiera es JavaScript válido.
for f in landing/dist/_astro/*.js; do node --check "$f" || echo "FALLA: $f"; done

# 2. Iframes antes del clic. `grep -o | wc -l` cuenta OCURRENCIAS; `grep -c`
#    cuenta LÍNEAS, y con `compressHTML: true` el HTML entero es una sola
#    línea, así que diría "1" igual para un iframe que para veinte — y saldría
#    con código 1 en el caso bueno (cero), que un runner lee como fallo.
grep -o '<iframe' landing/dist/index.html | wc -l   # 0 antes del clic

# 3. Anotaciones de tipo sobrevivientes en un script inline. Se busca la forma
#    `(nombre: Tipo`, no la palabra `function`: al minificar los nombres
#    cambian, pero una anotación de tipo no debería estar ahí en absoluto.
grep -oE '\([a-zA-Z_$]+ *: *[A-Z][A-Za-z]+' landing/dist/index.html
```

---

### 12.7 Qué no se implementa

| Necesidad | Solución |
|---|---|
| Precarga al pasar el cursor | Opción `prefetch` de la configuración |
| Transiciones entre páginas | `@view-transition` nativo |
| Menú móvil | Casilla de verificación en CSS |
| Acordeón, pestañas | `<details>` nativo |
| Lightbox | `:target` en CSS |
| Carrusel | Animación CSS con retraso por índice |
| Ventana modal | `<dialog>` nativo |
| Widget de contacto o chat | Casillas de verificación en CSS (sección 7.7) |
| Validación de campos | Atributos nativos `required`, `type`, `pattern` más validación de servidor |
| Animación al hacer scroll | No se implementa: perjudica el LCP y la percepción de velocidad |

---

## 12-bis. Requisitos del sitio que se olvidan siempre

Tres cosas que no son de ninguna sección y que, si faltan, se detectan tarde.

### Las páginas de gracias cuelgan de la raíz, no de la base de Astro

Si Astro se monta con `base: '/landing'`, sus páginas salen en `/landing/thank-you`. **Eso está mal para una página de gracias.** Es una URL de conversión: se comparte, se pega en la plataforma de anuncios y se mide. Tiene que ser `/thank-you`, colgando del dominio.

La base de Astro existe para que los assets hasheados resuelvan; no debe filtrarse a las URLs que ve el usuario. Se resuelve con una reescritura en el servidor que sirva `/thank-you` desde el archivo generado, y el redirect del formulario apunta a la URL limpia.

**Una página de gracias por tipo de conversión**, no una compartida:

| Formulario | Destino | Por qué |
|---|---|---|
| Contacto / presupuesto | `/thank-you` | Conversión comercial |
| Descarga de documento | `/thank-you-download` | Intención y valor distintos; además ahí se entrega el archivo |

Mezclarlas hace que la puja automática optimice hacia la conversión más barata, que es siempre la descarga.

**La entrega del documento ocurre en la página de gracias**, disparada al cargar, nunca como enlace público en la landing.

Conviene ser honesto sobre hasta dónde llega eso. Un PDF en `public/` es un archivo estático: quien acierte la URL se lo lleva sin dejar un dato, y no hay `noindex` ni página de gracias que lo impida. Lo que se consigue no publicándolo en la landing es que **el camino normal** pase por el formulario, no que el archivo esté protegido. Si el documento de verdad no puede circular libre, un archivo estático es el sitio equivocado: hace falta una ruta de servidor que verifique antes de servir.

De ahí salen dos reglas sobre el nombre del archivo, que tiran en direcciones opuestas y hay que resolver a la vez:

| Regla | Por qué |
|---|---|
| Sin fecha ni versión en el nombre | La URL acaba en historiales de descarga, en informes y en enlaces compartidos. Un `guia-2026.pdf` caduca en enero y obliga a renombrar justo lo que no debe cambiar. |
| Tampoco un nombre tan corto que se adivine al primer intento | `guide.pdf` en la raíz de la landing es el primer sitio donde mira cualquiera. |

Y una que no se negocia: **renombrar un archivo público exige su redirect**. El destino de `copy-dist.mjs` se borra entero en cada build, así que el nombre viejo desaparece del disco en el siguiente despliegue y toda descarga ya compartida pasa a 404. El redirect va en `next.config.ts`, que se evalúa antes del sistema de archivos y por eso cubre rutas que ya no existen.

### Sitemap

Se genera en build con las URLs reales —las limpias, no las de la base de Astro— y excluye las páginas de gracias, que van con `noindex`. Sin sitemap, un sitio de varias landings depende de que el buscador las descubra por enlaces internos.

### Favicon

Un `<link rel="icon">` que apunta a un archivo que no existe es un 404 en cada carga de cada página. Es el error más barato de arreglar y el que más tiempo sobrevive.

---

## 13. Formularios y captación de leads

Un formulario de landing tiene un solo trabajo: convertir una intención en un registro fiable, sin perder ninguno y sin admitir basura. Todo lo demás es decoración.

### 13.1 Arquitectura

Existe **una sola definición del formulario en todo el proyecto**: una acción de servidor tipada. La misma acción atiende los dos caminos posibles.

| Camino | Qué ocurre |
|---|---|
| Con JavaScript | El script intercepta el envío, hace `fetch` a la acción y redirige a la página de agradecimiento |
| Sin JavaScript | El navegador hace un POST nativo al endpoint, que invoca la misma acción y responde con una redirección 303 |

Ambos caminos ejecutan el mismo validador, el mismo antispam y la misma entrega. No hay dos verdades.

Las páginas siguen siendo estáticas y se sirven desde CDN. Lo único que se ejecuta bajo demanda es la ruta del formulario. Esto requiere un adaptador en la configuración; es la única dependencia adicional autorizada por este documento.

```
src/
├── actions/
│   └── index.ts          # la acción: validación, antispam, entrega
├── pages/
│   └── api/
│       └── lead.ts       # respaldo sin JavaScript: invoca la acción y redirige
└── components/
    └── ContactForm.astro # marcado único, reutilizado en las tres ubicaciones
```

`ContactForm.astro` se usa en tres sitios sin duplicar una línea: dentro de un módulo `LeadForm`, dentro del panel del widget flotante y en la página de contacto.

### 13.2 La acción

```ts
// src/actions/index.ts
import { defineAction, ActionError } from 'astro:actions';
import { z } from 'astro:schema';
import { site } from '../config/site';
import { deliverLead } from '../lib/deliver';
import { verifyChallenge } from '../lib/challenge';

const attribution = z.object({
  utm_source:   z.string().max(120).optional(),
  utm_medium:   z.string().max(120).optional(),
  utm_campaign: z.string().max(200).optional(),
  utm_term:     z.string().max(200).optional(),
  utm_content:  z.string().max(200).optional(),
  gclid:        z.string().max(200).optional(),
  fbclid:       z.string().max(200).optional(),
  msclkid:      z.string().max(200).optional(),
});

export const server = {
  lead: defineAction({
    accept: 'form',
    input: attribution.extend({
      name:    z.string().trim().min(2).max(80),
      phone:   z.string().trim().min(7).max(25),
      email:   z.string().trim().email(),
      service: z.string().max(120).optional(),
      message: z.string().max(1000).optional(),

      // Contexto de origen
      formId:  z.string().max(40).default('main'),
      landing: z.string().max(200).default('/'),
      lang:    z.string().max(5).default('es'),

      // Trampa: un campo que ningún humano ve ni rellena
      website: z.string().max(0).optional(),

      token: z.string().optional(),
    }),

    handler: async (input, ctx) => {
      if (input.website) {
        throw new ActionError({ code: 'BAD_REQUEST', message: 'Solicitud no válida.' });
      }

      const ip = ctx.clientAddress;

      if (site.challenge.enabled && !(await verifyChallenge(input.token, ip))) {
        throw new ActionError({ code: 'FORBIDDEN', message: 'Verificación fallida.' });
      }

      const leadId = crypto.randomUUID();

      await deliverLead({
        ...input,
        leadId,
        ip,
        userAgent: ctx.request.headers.get('user-agent') ?? '',
        receivedAt: new Date().toISOString(),
      });

      return { leadId };
    },
  }),
};
```

Reglas de la validación, todas consecuencia del principio de no admitir valores por defecto silenciosos:

- **Ningún campo obligatorio tiene valor de relleno.** Un nombre vacío no se convierte en `"Sin nombre"`: se rechaza.
- **Los límites máximos son parte de la validación**, no un detalle cosmético. Un campo sin `max` es una invitación a inyectar carga útil en el correo de notificación o en el CRM.
- **La trampa se llama `website`**, no `honeypot`. Los bots que leen nombres de campo evitan lo obvio.
- **La verificación de terceros valida en el servidor**, con la IP del cliente. Un token comprobado solo en el navegador no verifica nada.

### 13.3 El respaldo sin JavaScript

```ts
// src/pages/api/lead.ts
export const prerender = false;

import type { APIContext } from 'astro';
import { actions } from 'astro:actions';
import { site } from '../../config/site';

export async function POST(context: APIContext) {
  const formData = await context.request.formData();
  const { data, error } = await context.callAction(actions.lead, formData);

  const lang = String(formData.get('lang') || 'es');
  const wantsJson = context.request.headers.get('accept')?.includes('application/json');

  if (error) {
    if (wantsJson) {
      return Response.json({ message: error.message }, { status: error.status });
    }
    const back = String(formData.get('landing') || '/');
    return context.redirect(`${back}?error=1#form`, 303);
  }

  if (wantsJson) return Response.json(data);

  const thankYou = site.thankYouPath[lang] ?? site.thankYouPath.es;
  return context.redirect(`${thankYou}?lead=${data.leadId}`, 303);
}
```

`callAction` ejecuta exactamente la misma acción de la sección anterior. Este archivo solo traduce su resultado a una respuesta HTTP: JSON cuando lo pide el script, redirección 303 cuando lo pide el navegador.

El código 303 es obligatorio. Con 302 el navegador puede repetir el POST al recargar y duplicar el lead; 303 fuerza un GET sobre el destino.

### 13.4 El componente

```astro
---
// src/components/ContactForm.astro
import { actions } from 'astro:actions';
import { site } from '../config/site';

interface Props {
  formId: string;
  variant?: 'full' | 'compact';
  lang?: string;
  submitText?: string;
}
const { formId, variant = 'full', lang = 'es', submitText = 'Solicitar información' } = Astro.props;
const thankYou = site.thankYouPath[lang] ?? site.thankYouPath.es;
---
<form
  method="POST"
  action={actions.lead}
  class:list={['form', `form--${variant}`]}
  data-form={formId}
  data-thank-you={thankYou}
>
  <input type="hidden" name="formId"  value={formId}>
  <input type="hidden" name="lang"    value={lang}>
  <input type="hidden" name="landing" value={Astro.url.pathname}>

  <!-- Rellenados por attribution.js; vacíos si no hay JavaScript -->
  <input type="hidden" name="utm_source"   value="">
  <input type="hidden" name="utm_medium"   value="">
  <input type="hidden" name="utm_campaign" value="">
  <input type="hidden" name="gclid"        value="">

  <!-- Trampa: fuera de la vista y fuera del orden de tabulación -->
  <p class="sr-only" aria-hidden="true">
    <label>No rellenar<input type="text" name="website" tabindex="-1" autocomplete="off"></label>
  </p>

  <div class="field">
    <label for={`${formId}-name`}>Nombre</label>
    <input id={`${formId}-name`} name="name" type="text"
           required minlength="2" autocomplete="name">
  </div>

  <div class="field">
    <label for={`${formId}-phone`}>Teléfono</label>
    <input id={`${formId}-phone`} name="phone" type="tel"
           required inputmode="tel" autocomplete="tel">
  </div>

  <div class="field">
    <label for={`${formId}-email`}>Correo electrónico</label>
    <input id={`${formId}-email`} name="email" type="email"
           required inputmode="email" autocomplete="email">
  </div>

  <p class="form__error" data-form-error hidden tabindex="-1" role="alert">
    No pudimos enviar tu solicitud. Revisa los datos e inténtalo de nuevo.
  </p>

  <button type="submit" class="button primary" data-sending="Enviando…" data-sent="Enviado ✓">
    {submitText}
  </button>

  <p class="form__trust t-xs">Respondemos en menos de 24 horas hábiles.</p>
</form>
```

Puntos que no son negociables en este marcado:

- **Toda etiqueta tiene `for` y todo campo tiene `id` único**, derivado de `formId`. Como el mismo componente aparece varias veces en una misma página —módulo y widget flotante—, unos `id` fijos producirían duplicados y romperían la asociación entre etiqueta y campo.
- **`autocomplete` con los valores estándar.** El autorrelleno del navegador es la mejora de conversión más barata que existe en móvil.
- **`inputmode`** hace que el teclado del móvil aparezca con el juego de teclas correcto.
- **`type="tel"` y no `type="number"`** para el teléfono: `number` rechaza el signo más, los espacios y los prefijos internacionales.
- **El mensaje de error es `role="alert"` y enfocable**, para que se anuncie al aparecer.
- **Sin atributo `novalidate`.** La validación nativa del navegador es la primera barrera y funciona sin JavaScript.

### 13.5 Cuántos campos

Cada campo adicional reduce la tasa de envío. La regla es pedir el mínimo que permite dar seguimiento y nada más:

| Campos | Uso |
|---|---|
| Nombre, teléfono | Landing de búsqueda pagada con llamada como objetivo |
| Nombre, teléfono, correo | Estándar para servicios de alto valor |
| Añadir servicio de interés | Solo si el catálogo condiciona a quién se asigna el lead |
| Añadir mensaje libre | Solo en páginas de contacto, nunca en una landing de campaña |

Lo que no se pregunta nunca en el primer contacto: dirección postal, fecha de nacimiento, presupuesto, cómo nos conoció. Eso ya lo sabes por la atribución, o se pregunta en la llamada.

### 13.6 Entrega del lead

`deliverLead` es el único punto donde el lead sale del sistema. Su implementación depende del proyecto —correo transaccional, webhook a un CRM, hoja de cálculo— pero el contrato es fijo:

1. **Entrega con reintento.** Si el destino falla, se reintenta antes de devolver el error. Un lead perdido cuesta lo que costó el clic que lo trajo.
2. **Si la entrega falla definitivamente, la acción falla.** Nunca se devuelve confirmación por un lead que no llegó a ninguna parte.
3. **La notificación incluye la atribución completa.** Quien contesta el teléfono debe saber de qué campaña viene la persona.
4. **Nunca se registran los datos personales en los logs del servidor.**

---

## 14. Medición, analítica y conversiones

Las decisiones de puja de una campaña se toman con estos datos. Un evento mal disparado no es un error cosmético: entrena al algoritmo publicitario contra ti y quema presupuesto durante semanas antes de que alguien lo note.

### 14.1 La regla que gobierna todo

**Una conversión se cuenta cuando el servidor confirma el lead. Nunca antes, y una sola vez.**

De ahí se derivan las tres decisiones del sistema:

- El evento de conversión **no se dispara en el envío del formulario**. Un fallo de red contado como lead infla la tasa de conversión y baja el coste por adquisición aparente, con lo que la plataforma sube la puja por tráfico que no convierte.
- El evento de conversión **se dispara en la página de agradecimiento**, que solo es alcanzable con un identificador de lead emitido por el servidor. Es el único punto por el que pasan tanto el camino con JavaScript como el camino sin él.
- El evento **se deduplica por identificador**, para que recargar la página de agradecimiento o volver a ella desde el historial no genere una segunda conversión.

### 14.2 Taxonomía de eventos

Nombres en inglés, en `snake_case`, estables entre proyectos. Un nombre inventado por página hace inservible cualquier informe comparativo.

| Evento | Cuándo se dispara | Tipo | Origen |
|---|---|---|---|
| `page_view` | Carga de página | — | Contenedor de etiquetas |
| `contact_widget_open` | Se abre el widget flotante | Micro | `data-track` |
| `contact_widget_support` | Se elige el canal de soporte | Micro | `data-track` |
| `whatsapp_click` | Clic en cualquier enlace a WhatsApp | Micro | Delegado |
| `call_click` | Clic en cualquier enlace `tel:` | **Macro** | Delegado |
| `form_start` | Primer foco en un campo | Micro | Delegado |
| `form_submit` | Envío aceptado por el cliente | Micro | `form.js` |
| `form_error` | Envío rechazado | Diagnóstico | `form.js` |
| `video_play` | Se carga un reproductor | Micro | `yt-facade.js` |
| `generate_lead` | **Servidor confirmó el lead** | **Macro** | Página de agradecimiento |

Solo `generate_lead` y `call_click` se importan como conversión en las plataformas publicitarias. Todo lo demás son señales de comportamiento: sirven para diagnosticar dónde se cae la gente, no para optimizar pujas.

`whatsapp_click` merece una advertencia. Es tentador contarlo como conversión porque el volumen es alto, pero un clic a WhatsApp no garantiza que la conversación ocurra. Si se importa como conversión, se hace con un valor menor que el del lead confirmado.

### 14.3 Contrato de la capa de datos

Todo evento lleva la misma envoltura. Los parámetros específicos se añaden encima.

```js
{
  event: 'nombre_del_evento',
  page_path: '/servicio-ciudad/',
  // parámetros propios del evento
}
```

| Parámetro | Presente en | Contenido |
|---|---|---|
| `form_id` | Eventos de formulario | Identificador de la ubicación: `main`, `widget`, `contact` |
| `label` | Eventos de clic | Texto del control o `data-track-label` |
| `lead_id` | `generate_lead` | Identificador emitido por el servidor |
| `value` | `generate_lead` | Valor económico estimado del lead |
| `currency` | `generate_lead` | Divisa del valor |

### 14.4 La página de agradecimiento

Es el único lugar del sitio donde se emite una conversión.

```astro
---
// src/pages/gracias.astro
import { site } from '../config/site';
---
<script is:inline define:vars={{ value: site.leadValue, currency: site.currency }}>
  const id = new URLSearchParams(location.search).get('lead');
  const key = 'lead:' + id;

  if (id && !sessionStorage.getItem(key)) {
    sessionStorage.setItem(key, '1');
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: 'generate_lead',
      lead_id: id,
      value,
      currency,
    });
  }

  // El identificador no debe quedar en el historial ni filtrarse por referer
  if (id) history.replaceState(null, '', location.pathname);
</script>
```

Tres detalles con consecuencias reales:

**La deduplicación usa `sessionStorage`, no una variable.** Recargar la página reinicia las variables pero no el almacenamiento de sesión.

**El identificador se borra de la URL.** Si permanece, aparece en los informes de analítica como cientos de URLs distintas y se filtra en la cabecera `referer` hacia cualquier tercero.

**La página lleva `noindex`.** Una página de agradecimiento indexada recibe visitas directas desde búsqueda que, sin identificador, no disparan nada —correcto— pero ensucian las métricas de la página.

### 14.5 Atribución del lado del servidor

El bloqueo de rastreadores, las restricciones de cookies de terceros y las pérdidas de red hacen que una parte de las conversiones medidas en el navegador nunca lleguen. La acción del formulario ya tiene el `gclid` y el `fbclid` en el servidor, junto con la confirmación de que el lead es real.

Enviar la conversión también desde el servidor —API de conversiones de la plataforma correspondiente— cierra ese hueco. Reglas al hacerlo:

- **Se envía el mismo identificador de lead** que se usó en el navegador, como clave de deduplicación. Sin él, la plataforma cuenta dos conversiones por cada lead.
- **La marca de tiempo es la de recepción en el servidor.**
- **Los datos personales viajan con hash**, nunca en claro.
- **El envío no bloquea la respuesta al usuario.** Si la plataforma tarda, el usuario no debe esperar.

Esta es también la vía para reportar conversiones *cualificadas*: cuando el CRM marca un lead como cita agendada o venta cerrada, esa señal se envía con el `gclid` original. Optimizar por leads cualificados en lugar de por formularios enviados es la diferencia entre una campaña rentable y una que compra volumen.

### 14.6 Consentimiento

En jurisdicciones con requisito de consentimiento previo, el modo de consentimiento se declara **antes** del contenedor de etiquetas, con todo denegado por defecto, y se actualiza cuando el usuario decide.

```html
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    wait_for_update: 500,
  });
</script>
<!-- Aquí va el contenedor de etiquetas -->
```

El orden importa: si el contenedor carga primero, dispara etiquetas antes de conocer el estado de consentimiento.

Si el sitio no opera en esas jurisdicciones, este bloque se omite por completo. No se añade un aviso de cookies porque sí: un banner innecesario cuesta conversiones.

### 14.7 Verificación de la medición

Antes de dar por buena una campaña:

1. Enviar un formulario de prueba y confirmar que aparece **una** sola conversión.
2. Recargar la página de agradecimiento y confirmar que **no** aparece una segunda.
3. Volver atrás y adelante en el historial y confirmar lo mismo.
4. Desactivar JavaScript, enviar el formulario y confirmar que el lead llega y que se aterriza en la página de agradecimiento.
5. Enviar con un campo obligatorio vacío y confirmar que no se registra nada.
6. Rellenar el campo trampa mediante las herramientas del navegador y confirmar el rechazo.
7. Entrar con `?gclid=prueba123`, navegar a otra página, enviar y confirmar que el identificador llega al destino del lead.
8. Comprobar que el valor y la divisa del evento coinciden con lo configurado en la plataforma.

Los pasos 4 y 7 son los que casi nadie hace y los que más leads recuperan.

---

## 15. Anatomía de una landing que convierte

El orden de los bloques no es una decisión estética. Responde a la secuencia en que una persona evalúa una oferta.

### 15.1 La secuencia

**1. Hero — contexto y promesa (3 segundos).**
El visitante llega desde un anuncio con una intención concreta. El H1 debe confirmar que llegó al lugar correcto, usando el mismo lenguaje de la consulta que originó el clic. Si el anuncio dice "implantes dentales en Cancún", el H1 dice eso. Cualquier desalineación entre anuncio y encabezado se paga en tasa de rebote y en Quality Score.

Elementos: insignia de disponibilidad, H1 con la consulta, subtítulo con la oferta concreta (precio o diferenciador), dos botones (acción principal y canal alternativo), dos o tres cifras de respaldo.

**2. Franja de credibilidad — permiso para seguir leyendo.**
Inmediatamente después del hero, antes de cualquier argumento. Años de operación, volumen de casos, certificación, calificación. Responde a la pregunta implícita: *¿por qué debería creerte?*

**3. Prueba visual — evidencia antes que discurso.**
Video, galería de resultados o testimonios. El contenido audiovisual convierte mejor que el texto en decisiones de alta implicación porque transfiere confianza más rápido.

**4. Manejo de objeciones — la comparativa.**
La objeción dominante casi siempre es el precio o la alternativa ("¿por qué no lo hago donde vivo?"). El bloque de comparación la aborda de frente en lugar de esperar a que la resuelva el usuario por su cuenta.

**5. Oferta y precio — transparencia.**
Ocultar el precio no elimina la objeción, la pospone hasta la llamada y desperdicia el presupuesto de medios en leads no calificados. Un precio visible filtra tráfico y mejora la calidad del lead.

**6. Proceso — reducción de fricción.**
"Qué pasa después de que envío el formulario." La incertidumbre sobre el siguiente paso es una de las principales causas de abandono en formularios de servicios profesionales.

**7. Autoridad — quién lo hace.**
El perfil del profesional con credenciales verificables. En verticales reguladas —salud, legal, financiero— este bloque es el que sostiene la señal de experiencia y confiabilidad que evalúan tanto el usuario como el buscador.

**8. Preguntas frecuentes — objeciones residuales.**
Cada pregunta debe corresponder a una objeción real detectada en llamadas o conversaciones. Además de convertir, este bloque captura consultas de cola larga y es elegible para resultados enriquecidos.

**9. Cierre — última acción.**
Repetición de la acción principal con una línea de refuerzo de confianza (tiempo de respuesta, garantía, volumen atendido).

### 15.2 Reglas de ejecución

**Un solo objetivo por página.** Si la página tiene dos objetivos de conversión distintos, tiene cero.

**La acción principal se repite entre tres y cinco veces**, siempre con el mismo texto. Variar el texto del botón fragmenta el reconocimiento.

**Un solo H1 por documento.** Los bloques posteriores usan H2; sus subdivisiones, H3. Nunca se salta un nivel.

**Cada bloque debe justificar su presencia.** Si un bloque no aporta credibilidad, no resuelve una objeción ni impulsa hacia la acción, se elimina. La longitud no persuade; la relevancia sí.

**El formulario pide el mínimo indispensable.** Cada campo adicional reduce la tasa de envío. Nombre, teléfono y un campo de contexto suelen bastar; el resto se obtiene en la llamada.

---

## 16. Tipos de página

Cinco arquetipos. La elección determina la secuencia de bloques y el enfoque del contenido.

### `transaccional` — tráfico de pago con intención de compra

Destino de campañas de búsqueda. El visitante ya sabe lo que quiere y compara proveedores.

```
hero-split → stats-strip → features → video-block → lead-form
→ price-cards → comparison → video-testimonials → reviews
→ team → gallery → faq → cta → lead-form
```

Prioridades: precio visible, prueba social densa, formulario duplicado (arriba y abajo), fricción mínima.

### `seo` — tráfico orgánico informativo

Destino de búsquedas informativas o comparativas. El visitante está investigando.

```
hero → stats-strip → comparison → data-table → price-cards
→ comparison → features → team → faq → cta
```

Prioridades: profundidad de información, datos verificables, enlazado interno hacia páginas transaccionales, cobertura amplia de preguntas frecuentes.

### `brand` — página principal o institucional

```
hero → stats-strip → video-block → video-testimonials → gallery
→ comparison → price-cards → features → team → steps
→ reviews → faq → cta
```

Prioridades: narrativa completa, todas las señales de confianza, presentación amplia del catálogo.

### `trust` — respaldo de autoridad

Perfil profesional, certificaciones, instalaciones. Sirve de destino para enlaces internos que necesitan reforzar credibilidad.

```
hero → features → features → team → gallery → cta → faq → cta
```

### `comercial` — página de servicio individual

Versión reducida para servicios secundarios que no justifican una landing completa.

```
hero → features → text-block → price-cards → faq → cta
```

---

## 17. Reglas de contenido

### 17.1 Título SEO y meta descripción

**Título:** entre 50 y 60 caracteres. Consulta principal al inicio. Marca al final, separada por barra vertical.

```
Implantes Dentales en Cancún desde $900 USD | Clínica Nombre
```

**Descripción:** entre 140 y 160 caracteres. Debe contener la consulta, el diferenciador concreto y una invitación a la acción. No es un resumen del contenido: es texto publicitario que compite en la página de resultados.

```
Implantes dentales en Cancún desde $900 USD con especialista certificado.
Presupuesto cerrado en 24 horas y consulta virtual sin costo.
```

### 17.2 Encabezados

El H1 contiene la consulta principal en su forma natural. Cuando el encabezado que mejor posiciona resulta demasiado técnico o poco atractivo visualmente, se emplea el patrón de H1 diferenciado descrito en la ficha de `HeroSplit`: el H1 real conserva la consulta y el titular visible se optimiza para la conversión.

Los H2 corresponden a preguntas o temas que las personas efectivamente buscan, no a categorías internas del negocio.

### 17.3 Texto alternativo de imágenes

Describe lo que la imagen muestra, con lenguaje natural. No es un espacio para acumular palabras clave.

```
Correcto:   "Especialista en implantología revisando una tomografía en su consultorio de Cancún"
Incorrecto: "implantes dentales cancun mexico precio barato clinica dental"
```

Las imágenes puramente decorativas llevan `alt=""` y `aria-hidden="true"`.

### 17.4 Verticales reguladas

En salud, servicios legales, financieros y cualquier categoría sujeta a restricciones publicitarias, el contenido debe cumplir simultáneamente con las políticas de la plataforma de anuncios y con la normativa local.

**Prohibido en el texto:**
- Garantías de resultado ("curación garantizada", "resultados asegurados")
- Superlativos no verificables ("el mejor", "el número uno") sin fuente citable
- Afirmaciones de aprobación regulatoria que no correspondan a la jurisdicción
- Comparaciones que denigren a competidores identificables
- Testimonios que presenten un resultado atípico como esperable

**Obligatorio:**
- Aviso de variabilidad de resultados visible junto a cualquier afirmación de resultado y en las galerías de antes y después
- Consentimiento documentado para toda imagen o testimonio de paciente o cliente
- Identificación del profesional responsable con su número de registro cuando la normativa lo exija
- Lenguaje basado en evidencia: "estudios clínicos indican", "resultados documentados en", en lugar de afirmaciones absolutas

Formulación tipo del aviso:

> Los resultados individuales pueden variar. Este procedimiento no garantiza la resolución de ninguna condición específica. Consulte con un profesional para evaluar su caso particular.

Una landing rechazada por política publicitaria no genera tráfico. La revisión de cumplimiento se hace antes de publicar, no después del rechazo.

---

## 18. Procedimiento: crear una landing

### Paso 1 — Definir el objetivo

Antes de escribir código, tres respuestas por escrito:

1. ¿Qué consulta de búsqueda trae a esta persona?
2. ¿Cuál es la única acción que debe realizar?
3. ¿Cuál es la objeción principal que impide esa acción?

Sin estas tres respuestas, la página no se construye.

### Paso 2 — Elegir el arquetipo

Según el origen del tráfico y la intención, se selecciona uno de los cinco tipos de la sección 16. La secuencia de bloques se toma de ahí; no se improvisa.

### Paso 3 — Crear el archivo

`src/content/landings/{slug}.yaml`. El slug refleja la consulta, en minúsculas, con guiones, sin artículos ni preposiciones innecesarias.

```
implantes-dentales-cancun          ✓
todo-sobre-los-implantes-dentales  ✗
```

### Paso 4 — Redactar el bloque `seo`

```yaml
seo:
  title: "…"          # 50-60 caracteres
  description: "…"    # 140-160 caracteres
  schemaType: …       # tipo de negocio
  ogImage: /og/….webp # 1200×630
  ratingValue: "…"    # solo si hay reseñas reales verificables
  ratingCount: "…"
```

Las calificaciones se transcriben de la fuente real. Un valor inventado en datos estructurados constituye una infracción de las directrices de calidad y puede acarrear una acción manual.

### Paso 5 — Componer los bloques

Se toma la secuencia del arquetipo y se rellena cada bloque con contenido específico. Se emplean las variables de plantilla para todo dato que ya viva en la configuración del sitio.

### Paso 6 — Preparar los recursos

Imágenes en `src/assets/`, en formato WebP. La imagen del hero se marca con `priority`. Las que cambian de recorte entre móvil y escritorio se sirven con `ArtImage`.

### Paso 7 — Verificar

Se ejecuta la lista de comprobación de la sección 20 en su totalidad. Ningún elemento es opcional.

---

## 19. Crear un módulo nuevo

Solo cuando ningún módulo del catálogo resuelve la necesidad. Antes de crearlo, se verifica que el caso no se cubra con una variante de uno existente.

```
1. src/modules/{nombre}/schema.ts
   → Zod con `type: z.literal('{nombre}')`
   → Sin campos opcionales que en realidad sean obligatorios
   → Mensajes de error explicativos en las validaciones

2. src/modules/{nombre}/jsonld.ts
   → Devuelve SchemaNode[]
   → Devuelve [] explícito si el bloque no aporta datos estructurados

3. src/modules/{nombre}/{Nombre}.astro
   → <section> como raíz, con itemscope/itemtype
   → Cero estilos inline
   → <style> con scope para lo específico del bloque
   → Cero client:* salvo justificación en comentario

4. src/modules/_registry.ts
   → Una línea
```

Si el módulo nuevo obliga a modificar cualquier archivo fuera de esta lista, el diseño está mal planteado.

---

## 20. Lista de comprobación

**Las rutas de los comandos son `landing/src/` y `landing/dist/`, desde la raíz del repositorio.** Un `src/` a secas apunta a la aplicación Next y hace que toda la lista pase en verde sin comprobar nada.

### Marcado y estilo
- [ ] `grep -rn '@media (max-width' landing/src/` no devuelve nada de layout
- [ ] `grep -rn 'matchMedia("(max-width' landing/src/ src/` no devuelve nada — el umbral en JavaScript es el mismo `min-width: 900px` que el del CSS
- [ ] Ningún elemento interactivo dentro de otro (`button button`, `button a`, `a button`)
- [ ] Toda sección de 3+ tarjetas equivalentes usa carril, no apilado
- [ ] Las tablas se desplazan en móvil, no se rompen en tarjetas, y **conservan su barra de desplazamiento**
- [ ] Toda sección tiene `<section>` como raíz, con `itemscope` e `itemtype`
- [ ] `grep -r 'style="' landing/src/` devuelve únicamente propiedades personalizadas: `--i`, `--count`, `--rail-cols`, `--rail-item`
- [ ] `grep -r '!important' landing/src/` no devuelve resultados
- [ ] Un solo `<h1>` por página
- [ ] Jerarquía de encabezados sin saltos de nivel

### Imágenes y video
- [ ] El video es vertical 9:16 en móvil salvo que la sección exija lo contrario
- [ ] `.ratio-vertical` usa `object-fit: contain` (no recorta el encuadre)
- [ ] Hay id vertical; el horizontal es opcional y cae al vertical
- [ ] El envoltorio del video es un `<div>`, no un `<button>`
- [ ] El disparador exige clic en `.play-button`, no en todo el bloque
- [ ] Toda `<img>` tiene `width` y `height`
- [ ] Todo `<source>` tiene `width` y `height`
- [ ] La imagen LCP tiene `loading="eager"`, `fetchpriority="high"` y precarga
- [ ] El resto tiene `loading="lazy"` y `decoding="async"`
- [ ] La sintaxis de la precarga coincide con la del elemento
- [ ] Todo `alt` describe el contenido, sin acumulación de palabras clave

### JavaScript
- [ ] Ningún `import` de script de cliente en el frontmatter (no llega al navegador)
- [ ] Ningún `<script define:vars>` con TypeScript dentro
- [ ] Todo `landing/dist/_astro/*.js` pasa `node --check`
- [ ] Los selectores de formulario usan `[name="…"]`, no `input[name="…"]`
- [ ] Un solo escuchador delegado por comportamiento, no uno por componente
- [ ] El reproductor de video se ancla a `youtube-nocookie.com` (`host`), y se precargan los dos dominios: la API sale de `youtube.com`
- [ ] La página funciona con JavaScript deshabilitado
- [ ] El formulario envía y entrega el lead con JavaScript deshabilitado
- [ ] El total transferido es inferior a 5 KB comprimidos
- [ ] Ningún `client:*` sin comentario justificativo
- [ ] Ningún video carga antes de la interacción
- [ ] `grep -r 'onclick=' landing/src/` no devuelve resultados
- [ ] Ningún widget de chat de terceros

### Formularios
- [ ] Toda etiqueta tiene `for` y todo campo un `id` único derivado del `formId`
- [ ] `autocomplete` e `inputmode` presentes en todos los campos
- [ ] Campo trampa presente, oculto y fuera del orden de tabulación
- [ ] Validación de servidor con límites máximos en todos los campos
- [ ] La redirección tras el envío usa código 303
- [ ] El mensaje de error es `role="alert"` y recibe el foco

### SEO y datos estructurados
- [ ] Existe sitemap con las URLs limpias, y excluye las páginas de gracias
- [ ] El favicon existe (no es un 404 en cada carga)
- [ ] **Todo asset referenciado desde `site.ts` existe en `landing/public/`** — el logotipo, la imagen Open Graph y el retrato de autoridad se emiten en cada página y en el grafo, y un 404 ahí no rompe nada visible: solo deja todas las comparticiones sin imagen
- [ ] Renombrar un archivo público (PDF, imagen compartida) lleva su redirect en `next.config.ts`
- [ ] Las páginas de gracias cuelgan de la raíz, no de la base de Astro
- [ ] Hay una página de gracias por tipo de conversión
- [ ] Título entre 50 y 60 caracteres
- [ ] Descripción entre 140 y 160 caracteres
- [ ] Canónica correcta
- [ ] `robots` con los tres modificadores de vista previa
- [ ] Imagen de Open Graph de 1200×630 presente
- [ ] Grafo válido en la prueba de resultados enriquecidos, sin errores
- [ ] Ninguna entidad duplicada entre JSON-LD y microdatos
- [ ] Toda calificación corresponde a datos reales y verificables

### Rendimiento
- [ ] Lighthouse móvil: Rendimiento ≥ 98
- [ ] Lighthouse: Accesibilidad 100
- [ ] CLS igual a 0
- [ ] Cero requests bloqueantes de CSS

### Conversión
- [ ] La acción principal aparece entre 3 y 5 veces con el mismo texto
- [ ] El formulario captura los parámetros de atribución
- [ ] La conversión se registra solo tras confirmación del servidor
- [ ] La página de agradecimiento existe en todos los idiomas del sitio

### Medición
- [ ] Un envío de prueba genera exactamente una conversión
- [ ] Recargar la página de agradecimiento no genera una segunda
- [ ] El identificador de lead se retira de la URL tras registrarse
- [ ] La página de agradecimiento lleva `noindex`
- [ ] Los nombres de evento coinciden con la taxonomía de la sección 14.2
- [ ] Valor y divisa del evento coinciden con la configuración de la plataforma
- [ ] Un `gclid` de prueba llega hasta el destino del lead

### Dispositivo real
- [ ] Probado en iPhone: área segura, widget flotante, menú, logotipo
- [ ] El widget abierto no queda tapado por la barra de direcciones
- [ ] Objetivos táctiles de 44 píxeles como mínimo
- [ ] Los campos de formulario no provocan zoom automático

### Cumplimiento
- [ ] Sin garantías de resultado
- [ ] Aviso de variabilidad presente donde corresponde
- [ ] Consentimiento documentado para imágenes de terceros
- [ ] Sin afirmaciones regulatorias fuera de jurisdicción

---

## 21. Directrices para agentes de IA

Empieza aquí si no tienes contexto previo. Estas reglas son absolutas.

### Orden de trabajo

Sigue esta secuencia. No la reordenes.

| # | Haz esto | Termina cuando |
|---|---|---|
| 1 | Lee §0 y confirma que vas a construir **secciones**, no un sistema de utilidades | Puedes nombrar las 24 secciones del catálogo |
| 2 | Copia el sustrato de §3–§6 tal cual: capas, tokens, layout, utilidades, componentes | `@layer` declarado y los tokens en `:root` |
| 3 | Construye el cromo: cabecera con menú y popup, pie, widget flotante (§7.7) | El menú abre con `input:checked`, el popup con `:target` |
| 4 | Construye las 24 secciones listadas en §0, cada una con la API y la anatomía de §10 | Cada una existe como archivo propio y se monta sin tocar CSS global |
| 5 | Monta la página con el arquetipo que toque (§16) y la anatomía de §15 | Un solo `<h1>`, la acción principal 3–5 veces con el mismo texto |
| 6 | Cablea formulario, atribución y medición (§12–§14) | Un envío de prueba genera exactamente una conversión |
| 7 | Pasa la lista de §20 **ejecutando los comandos**, no leyéndolos | Cero fallos |

### Las cinco decisiones que se equivocan siempre

Contrástalas antes de escribir cada sección.

| Decisión | Correcto | Incorrecto |
|---|---|---|
| Punto de partida del CSS | Móvil, sin media query | Escritorio, deshecho con `max-width` |
| 3+ tarjetas equivalentes | Carril horizontal en móvil (§7.8) | Apiladas, cuatro pantallas de scroll |
| Proporción de video | Vertical 9:16 en móvil (§12.1) | 16:9 aplastado en una columna |
| Tabla en móvil | Se desplaza dentro de su envoltorio (§7.9) | Se rompe en tarjetas |
| Página de gracias | Cuelga de la raíz, una por conversión (§12-bis) | Bajo la base de Astro, compartida |

### Antes de dar nada por hecho

Que el build pase no prueba que el JavaScript llegue al navegador. Verifica sobre el HTML emitido, no sobre el código fuente.

**Las rutas son `landing/src/` y `landing/dist/`, desde la raíz del repositorio.** Un `src/` a secas es la aplicación Next: los greps no encuentran nada, todo sale en verde y no se ha comprobado ni una línea de la landing.

```bash
grep -o '<iframe' landing/dist/index.html | wc -l        # 0 antes del clic
grep -rn '@media (max-width' landing/src/                # vacío, salvo no-layout
grep -rn 'matchMedia("(max-width' landing/src/ src/      # vacío: el umbral es min-width:900
grep -rn 'style="' landing/src/ | grep -v '\-\-'         # vacío
for f in landing/dist/_astro/*.js; do node --check "$f" || echo "FALLA: $f"; done
```

Las tres trampas de Astro de §12.6 no dan error de build y solo se ven así.

El grep de `matchMedia` no es un extra: el único breakpoint del sistema es `min-width: 900px`, y un `matchMedia("(max-width:767px)")` en el JavaScript **no lo ve** el grep de `@media`. Cuando los dos umbrales se separan aparece una franja —768px a 899px— donde el CSS cree que es móvil y el JavaScript cree que es escritorio. Es exactamente el fallo que sirvió el vídeo horizontal dentro de un marco vertical en tablet.

### Si algo no encaja con este documento

Para y pregunta. No inventes una sección nueva ni instales una dependencia para esquivar el problema: §19 explica cuándo se crea un módulo y cuándo no.

### Prohibido

```
✗ Tailwind CSS o cualquier framework de utilidades
✗ Clases del tipo `flex items-center gap-4 px-6 py-3`
✗ React, Vue, Svelte, Solid o cualquier framework de UI
✗ shadcn, Material UI, Bootstrap, DaisyUI, Chakra
✗ Instalar librerías de iconos, animación o carruseles
✗ Widgets de chat de terceros (Intercom, Tawk.to, Crisp, Tidio, Drift)
✗ `style="…"` en el marcado (excepto `--i` y `--count`)
✗ Atributos `onclick`, `onsubmit` o cualquier handler en el marcado
✗ `!important`
✗ `<div>` como raíz de una sección
✗ `client:*` sin comentario que justifique por qué el CSS no basta
✗ Breakpoints adicionales
✗ El enrutador de cliente de Astro
✗ Animaciones activadas por scroll
✗ Valores inventados en datos estructurados
✗ Contar la conversión en el envío del formulario en vez de en la confirmación
✗ Un formulario que deje de funcionar sin JavaScript
✗ Duplicar el marcado del formulario en más de un componente
```

### Obligatorio

```
✓ <section> como raíz, con itemscope e itemtype
✓ Las clases definidas en las secciones 4, 5 y 6 de este documento
✓ Mobile-first: estilo base sin media query; @media (min-width: 900px) para escritorio
✓ width y height en toda imagen, incluidos los <source>
✓ Zod para todo dato de entrada, sin valores de relleno
✓ Un módulo del catálogo si existe uno que resuelva el caso
✓ data-track para declarar qué se mide; el escuchador delegado decide cómo
✓ Los nombres de evento de la taxonomía de la sección 14.2, sin inventar variantes
✓ Verificar la lista de comprobación de la sección 20 antes de entregar
```

### Procedimiento ante una solicitud

1. Identificar el arquetipo de página según origen de tráfico e intención (sección 16).
2. Tomar la secuencia de bloques del arquetipo. No improvisar el orden.
3. Para cada necesidad de contenido, seleccionar el módulo correspondiente:

| Necesidad | Módulo |
|---|---|
| Apertura con imagen de persona | `HeroSplit` |
| Apertura centrada, sin imagen | `Hero` |
| H1 de búsqueda distinto del titular visible | `HeroSplit` con `seoTitle` |
| Cifras de credibilidad en franja | `StatsStrip` |
| Razones diferenciadoras con icono | `Features` |
| Manejo de objeción de precio o alternativa | `Comparison` |
| Precios en tarjetas | `PriceCards` |
| Listado extenso de precios | `PriceTable` |
| Comparativa numérica | `DataTable` |
| Preguntas frecuentes | `Faq` |
| Reseñas con calificación | `Reviews` |
| Testimonios en video | `VideoTestimonials` |
| Perfil profesional | `Team` |
| Resultados en imágenes | `Gallery` |
| Logotipos o certificaciones en movimiento | `Marquee` |
| Proceso paso a paso | `Steps` |
| Video explicativo con texto | `VideoBlock` |
| Cierre con llamada a la acción | `Cta` |
| Captación de datos | `LeadForm` |
| Descarga de guía, ebook o documento a cambio de datos | `LeadMagnet` |
| Prosa extensa | `TextBlock` |
| Contacto permanente, chat o soporte | `ContactLauncher` en el layout (sección 7.7) |

4. Escribir un único archivo YAML en `src/content/landings/`.
5. Emplear variables de plantilla para todo dato que ya exista en la configuración.
6. Verificar la lista de comprobación completa.

### Si algo no encaja

Antes de escribir un módulo nuevo o de introducir una dependencia:

1. ¿Algún módulo del catálogo resuelve el caso con otra configuración?
2. ¿El navegador lo resuelve de forma nativa?
3. ¿Se puede lograr con CSS?

Solo si las tres respuestas son negativas se justifica añadir algo. En ese caso, se sigue el procedimiento de la sección 19.
