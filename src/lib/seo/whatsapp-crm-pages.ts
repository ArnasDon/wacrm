/**
 * Programmatic SEO landing pages: country × industry.
 * URLs: /whatsapp-crm/{industry}/{country}  (~1,000 pages worldwide)
 */

import {
  COMPANY_NAME,
  OFFICIAL_APP_URL,
  PRODUCT_NAME,
  SUPPORT_EMAIL,
} from "@/lib/brand";

export type SeoFaq = { q: string; a: string };

export type SeoPage = {
  slug: string;
  /** Nested path: /whatsapp-crm/{industrySlug}/{countrySlug} */
  path: string;
  industrySlug: string;
  countrySlug: string;
  country: string;
  industry: string;
  title: string;
  description: string;
  keywords: string[];
  headline: string;
  intro: string;
  challenge: string;
  solution: string;
  expertise: string;
  benefits: string[];
  useCases: { title: string; body: string }[];
  steps: { title: string; body: string }[];
  outcomes: string[];
  trustSignals: string[];
  faqs: SeoFaq[];
  datePublished: string;
  dateModified: string;
  authorName: string;
  publisherName: string;
};

type IndustryDef = {
  slug: string;
  name: string;
  angle: string;
  pain: string;
  outcome: string;
  keywords: string[];
};

/** 50 unique WhatsApp Business markets worldwide. */
export const COUNTRIES = [
  "United States",
  "United Kingdom",
  "Canada",
  "Australia",
  "New Zealand",
  "Ireland",
  "Germany",
  "France",
  "Spain",
  "Italy",
  "Netherlands",
  "Belgium",
  "Portugal",
  "Switzerland",
  "Austria",
  "Sweden",
  "Norway",
  "Denmark",
  "Finland",
  "Poland",
  "India",
  "United Arab Emirates",
  "Saudi Arabia",
  "Qatar",
  "Kuwait",
  "Bahrain",
  "Oman",
  "Israel",
  "Turkey",
  "South Africa",
  "Nigeria",
  "Kenya",
  "Ghana",
  "Egypt",
  "Morocco",
  "Brazil",
  "Mexico",
  "Argentina",
  "Chile",
  "Colombia",
  "Peru",
  "Singapore",
  "Malaysia",
  "Indonesia",
  "Philippines",
  "Thailand",
  "Vietnam",
  "Japan",
  "South Korea",
  "Hong Kong",
] as const;

export const INDUSTRIES: readonly IndustryDef[] = [
  {
    slug: "real-estate",
    name: "Real Estate",
    angle: "property enquiries, site-visit booking, and broker follow-ups",
    pain: "Leads get lost across agents’ personal phones, site visits slip, and follow-ups are inconsistent.",
    outcome: "Faster lead response, tracked site visits, and a shared pipeline from enquiry to closing.",
    keywords: ["whatsapp crm real estate", "property lead management", "broker whatsapp inbox"],
  },
  {
    slug: "education",
    name: "Education",
    angle: "admissions counselling, fee reminders, and parent updates",
    pain: "Admissions teams juggle WhatsApp threads without a CRM trail for counsellors or parents.",
    outcome: "Structured admissions conversations, timely fee reminders, and clearer parent communication.",
    keywords: ["whatsapp crm education", "admissions whatsapp", "school parent messaging"],
  },
  {
    slug: "healthcare",
    name: "Healthcare",
    angle: "appointment reminders, patient queries, and clinic outreach",
    pain: "Clinics miss appointments and bury patient queries in unassigned chat threads.",
    outcome: "Reliable reminders, assigned patient chats, and compliant team collaboration on one number.",
    keywords: ["whatsapp crm healthcare", "clinic appointment reminders", "patient whatsapp inbox"],
  },
  {
    slug: "ecommerce",
    name: "Ecommerce",
    angle: "order updates, abandoned-cart nudges, and support replies",
    pain: "Order questions pile up while cart recovery and support live in disconnected tools.",
    outcome: "Faster order support, recoverable carts, and a single WhatsApp CRM for shoppers.",
    keywords: ["whatsapp crm ecommerce", "abandoned cart whatsapp", "order support whatsapp"],
  },
  {
    slug: "retail",
    name: "Retail",
    angle: "store promotions, loyalty offers, and customer care",
    pain: "Stores blast offers without segmentation and lose context on repeat customers.",
    outcome: "Segmented outreach, tagged customer history, and coordinated in-store + WhatsApp care.",
    keywords: ["whatsapp crm retail", "retail customer whatsapp", "loyalty whatsapp campaigns"],
  },
  {
    slug: "hospitality",
    name: "Hospitality",
    angle: "booking confirmations, guest requests, and review follow-ups",
    pain: "Front desks miss guest requests when chats live on individual phones overnight.",
    outcome: "Shared guest inbox, booking confirmations, and timely post-stay follow-ups.",
    keywords: ["whatsapp crm hospitality", "hotel guest messaging", "booking confirmation whatsapp"],
  },
  {
    slug: "travel",
    name: "Travel Agencies",
    angle: "itinerary sharing, package quotes, and trip reminders",
    pain: "Quotes and itineraries scatter across chats with no deal stage visibility.",
    outcome: "Quoted packages tracked in pipelines, itineraries shared cleanly, and trip reminders automated.",
    keywords: ["whatsapp crm travel agency", "tour package quotes whatsapp", "itinerary whatsapp crm"],
  },
  {
    slug: "automotive",
    name: "Automotive",
    angle: "test-drive booking, service reminders, and lead qualification",
    pain: "Showroom leads and service reminders fall through without assignment rules.",
    outcome: "Qualified test-drive bookings, service nudges, and a clear sales pipeline on WhatsApp.",
    keywords: ["whatsapp crm automotive", "test drive booking whatsapp", "car dealership crm"],
  },
  {
    slug: "finance",
    name: "Finance & Insurance",
    angle: "lead nurturing, policy renewals, and document collection",
    pain: "Advisors chase renewals and documents with no shared audit-friendly trail.",
    outcome: "Nurtured leads, renewal reminders, and organised document collection on WhatsApp CRM.",
    keywords: ["whatsapp crm insurance", "finance lead nurturing whatsapp", "policy renewal reminders"],
  },
  {
    slug: "saas",
    name: "SaaS & Tech",
    angle: "demo scheduling, onboarding tips, and renewal outreach",
    pain: "Sales and CS handoffs break when demos and onboarding chats are personal-only.",
    outcome: "Booked demos, guided onboarding sequences, and renewal outreach from one workspace.",
    keywords: ["whatsapp crm saas", "demo scheduling whatsapp", "customer success whatsapp"],
  },
  {
    slug: "logistics",
    name: "Logistics",
    angle: "shipment updates, delivery coordination, and COD confirmations",
    pain: "Delivery exceptions flood inboxes without routing to the right operations owner.",
    outcome: "Clear shipment updates, assigned exception handling, and COD confirmation workflows.",
    keywords: ["whatsapp crm logistics", "shipment updates whatsapp", "delivery coordination crm"],
  },
  {
    slug: "restaurants",
    name: "Restaurants",
    angle: "table reservations, offers, and feedback collection",
    pain: "Reservation and feedback chats get buried during peak service hours.",
    outcome: "Organised reservations, timed offers, and structured feedback collection after dining.",
    keywords: ["whatsapp crm restaurant", "table reservation whatsapp", "restaurant guest messaging"],
  },
  {
    slug: "beauty-salons",
    name: "Beauty & Salons",
    angle: "appointment booking, package upsells, and rebooking nudges",
    pain: "No-shows and missed rebooking opportunities hurt salon utilisation.",
    outcome: "Confirmed appointments, package upsells, and automated rebooking nudges.",
    keywords: ["whatsapp crm salon", "beauty appointment whatsapp", "salon rebooking automation"],
  },
  {
    slug: "fitness",
    name: "Fitness & Gyms",
    angle: "membership renewals, class reminders, and trial conversions",
    pain: "Trials and renewals stall when trainers manage chats separately from membership ops.",
    outcome: "Converted trials, class reminders, and membership renewals from a shared inbox.",
    keywords: ["whatsapp crm gym", "fitness membership renewals", "class reminder whatsapp"],
  },
  {
    slug: "legal",
    name: "Legal Services",
    angle: "consultation booking, case updates, and document requests",
    pain: "Clients expect updates while firms need controlled, assignable communication.",
    outcome: "Booked consultations, clearer case updates, and organised document requests.",
    keywords: ["whatsapp crm law firm", "legal consultation whatsapp", "client updates whatsapp crm"],
  },
  {
    slug: "manufacturing",
    name: "Manufacturing",
    angle: "B2B enquiries, dealer support, and order status updates",
    pain: "Dealer and distributor chats lack CRM context for order status and SLAs.",
    outcome: "Tracked B2B enquiries, dealer support assignment, and proactive order updates.",
    keywords: ["whatsapp crm manufacturing", "dealer support whatsapp", "b2b order updates"],
  },
  {
    slug: "agencies",
    name: "Marketing Agencies",
    angle: "client reporting, campaign approvals, and lead handoff",
    pain: "Approvals and lead handoffs stall across messy WhatsApp groups.",
    outcome: "Faster campaign approvals, clean lead handoff, and client-ready conversation trails.",
    keywords: ["whatsapp crm agency", "campaign approval whatsapp", "agency lead handoff"],
  },
  {
    slug: "ngos",
    name: "NGOs & Nonprofits",
    angle: "donor updates, volunteer coordination, and campaign outreach",
    pain: "Donor and volunteer threads are hard to segment without a lightweight CRM layer.",
    outcome: "Segmented outreach, volunteer coordination, and transparent campaign updates.",
    keywords: ["whatsapp crm nonprofit", "donor updates whatsapp", "volunteer coordination crm"],
  },
  {
    slug: "coaching",
    name: "Coaching Institutes",
    angle: "batch enquiries, fee follow-ups, and result announcements",
    pain: "Counsellors lose batch intent signals when chats are not tagged or assigned.",
    outcome: "Qualified batch enquiries, fee follow-ups, and organised result announcements.",
    keywords: ["whatsapp crm coaching", "institute admissions whatsapp", "batch enquiry crm"],
  },
  {
    slug: "home-services",
    name: "Home Services",
    angle: "quote requests, job scheduling, and technician updates",
    pain: "Quote requests stall and technicians lack a shared schedule conversation trail.",
    outcome: "Faster quotes, scheduled jobs, and live technician updates for customers.",
    keywords: ["whatsapp crm home services", "job scheduling whatsapp", "technician updates crm"],
  },
] as const;

export const SEO_CONTENT_DATES = {
  published: "2026-01-15",
  modified: "2026-07-25",
} as const;

export function toCountrySlug(country: string): string {
  return country
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function seoPagePath(industrySlug: string, countrySlug: string): string {
  return `/whatsapp-crm/${industrySlug}/${countrySlug}`;
}

function buildPage(
  country: (typeof COUNTRIES)[number],
  industry: IndustryDef,
): SeoPage {
  const cSlug = toCountrySlug(country);
  const path = seoPagePath(industry.slug, cSlug);
  const slug = `${industry.slug}/${cSlug}`;

  const title = `WhatsApp & Email CRM for ${industry.name} in ${country} | ${PRODUCT_NAME}`;
  const description = `Best WhatsApp Business + Email CRM for ${industry.name.toLowerCase()} teams in ${country}. Shared inbox, pipelines, Meta template broadcasts, BYO SMTP email marketing & automations by ${COMPANY_NAME}. Official WhatsApp Business API — start today.`;
  const headline = `WhatsApp & Email CRM for ${industry.name} in ${country}`;
  const intro = `${PRODUCT_NAME} by ${COMPANY_NAME} helps ${industry.name.toLowerCase()} organisations in ${country} run WhatsApp Business and email marketing side by side — shared team inbox, CRM contacts, sales pipelines, Meta template broadcasts, BYO SMTP campaigns on Business+, and no-code automations purpose-built for ${industry.angle}.`;

  const challenge = `In ${country}, ${industry.name.toLowerCase()} teams often struggle because ${industry.pain} ${PRODUCT_NAME} replaces fragmented personal chats and disconnected email tools with one accountable workspace on the official WhatsApp Business API plus BYO SMTP email.`;
  const solution = `With ${PRODUCT_NAME}, your ${country} team centralises every WhatsApp thread and email campaign, tags leads, assigns owners, moves deals through pipelines, and automates ${industry.angle} — so customers get faster replies on both channels and managers get visibility.`;
  const expertise = `${COMPANY_NAME} builds WhatsApp Business and email CRM workflows used by sales, support, and operations teams worldwide. ${PRODUCT_NAME} combines Meta-approved messaging, BYO SMTP email marketing, encrypted credential handling, role-based access, and practical automations so ${industry.name.toLowerCase()} companies in ${country} can adopt both channels without custom engineering.`;

  const benefits = [
    `Shared WhatsApp Business inbox for ${industry.name.toLowerCase()} teams in ${country}`,
    `CRM contacts, tags, and history tied to every conversation`,
    `Pipelines that track ${industry.angle} from first message to close`,
    `Meta-approved template broadcasts with delivery & read visibility`,
    `Email marketing with BYO SMTP, lists, starter templates & campaigns (Business+)`,
    `No-code automations and conversation flows for 24/7 follow-ups`,
    `Owner / Admin / Agent / Viewer roles for secure collaboration`,
    `Works worldwide on the official WhatsApp Business API`,
    industry.outcome,
  ];

  const useCases = [
    {
      title: `Qualify inbound demand in ${country}`,
      body: `Capture WhatsApp enquiries for ${industry.name.toLowerCase()}, tag intent, and assign the right teammate before leads go cold.`,
    },
    {
      title: `Automate ${industry.angle}`,
      body: `Use templates and flows to confirm next steps, send reminders, and keep prospects informed without manual copy-paste.`,
    },
    {
      title: "Run campaigns with accountability",
      body: `Broadcast approved WhatsApp templates to segments, send email campaigns over your SMTP, then continue replies in the shared inbox with full CRM context.`,
    },
    {
      title: "Hand off sales and support cleanly",
      body: `Keep one business number while owners, admins, and agents collaborate with assignment filters and conversation status.`,
    },
  ];

  const steps = [
    {
      title: "Create your VedMint CRM workspace",
      body: `Sign up, verify email, and invite your ${country} team with the right roles.`,
    },
    {
      title: "Connect WhatsApp Business API",
      body: "Add Phone Number ID, WABA ID, access token, and webhook settings — then verify with Meta.",
    },
    {
      title: "Connect Email (BYO SMTP)",
      body: "Save and verify your SMTP settings, create lists, pick starter templates, and prepare campaigns on Business+.",
    },
    {
      title: `Configure ${industry.name.toLowerCase()} workflows`,
      body: `Import contacts, set pipeline stages for ${industry.angle}, and sync approved WhatsApp message templates.`,
    },
    {
      title: "Launch inbox, broadcasts, email & automations",
      body: "Answer in the shared WhatsApp inbox, send email campaigns, schedule template broadcasts, and turn on flows for repeatable follow-ups.",
    },
  ];

  const outcomes = [
    `Faster first response on WhatsApp for ${industry.name.toLowerCase()} leads in ${country}`,
    "Email campaigns from your own SMTP with lists and unsubscribe-ready sends",
    "Fewer lost conversations across personal devices",
    "Clear ownership with role-based access",
    "Measurable outreach via WhatsApp delivery/read tracking and email sends",
    industry.outcome,
  ];

  const trustSignals = [
    "Built on the official Meta WhatsApp Business API",
    "Email marketing with bring-your-own SMTP (Business+)",
    "Encrypted storage for sensitive WhatsApp credentials",
    `Support via ${SUPPORT_EMAIL}`,
    `Published by ${COMPANY_NAME}`,
    "Role-based access for multi-agent workspaces",
    `Canonical guide: ${OFFICIAL_APP_URL}${path}`,
  ];

  const faqs: SeoFaq[] = [
    {
      q: `Is ${PRODUCT_NAME} available for ${industry.name} companies in ${country}?`,
      a: `Yes. ${PRODUCT_NAME} is available worldwide, including ${country}. ${industry.name} teams use it for ${industry.angle} on WhatsApp and email with a shared inbox, CRM records, pipelines, and automations.`,
    },
    {
      q: `What makes a WhatsApp CRM useful for ${industry.name}?`,
      a: `A WhatsApp CRM keeps customer chats, contact data, and deal stages together. For ${industry.name.toLowerCase()}, that means you can manage ${industry.angle} without losing context across personal phones.`,
    },
    {
      q: "Do we need the official WhatsApp Business API?",
      a: `Yes. ${PRODUCT_NAME} connects through Meta’s official WhatsApp Business API (WABA). You bring your credentials; we provide inbox, CRM, broadcasts, email marketing (Business+), flows, and team collaboration.`,
    },
    {
      q: "Does VedMint support email marketing as well as WhatsApp?",
      a: `Yes. WhatsApp and Email are both first-class channels. On Business and Enterprise plans you connect your own SMTP, manage lists and templates, and send campaigns alongside WhatsApp template broadcasts.`,
    },
    {
      q: `How long does setup take for a team in ${country}?`,
      a: "Most teams create an account, connect WhatsApp credentials (and SMTP for email), invite members, and start using the shared inbox the same day. Template approval timelines depend on Meta.",
    },
    {
      q: "Can multiple agents use one WhatsApp Business number?",
      a: `Yes. ${PRODUCT_NAME} is built for shared inboxes with Owner, Admin, Agent, and Viewer roles so ${industry.name.toLowerCase()} teams in ${country} can collaborate on one business number.`,
    },
    {
      q: "Is this guide written by a real product team?",
      a: `Yes. This page is maintained by ${COMPANY_NAME}, the team behind ${PRODUCT_NAME}. Content is reviewed for accuracy against current product capabilities, Meta WhatsApp Business API practices, and email marketing features.`,
    },
    {
      q: "Where can I see pricing?",
      a: `See live plan options on our pricing page, then create an account to checkout securely through VedMint Billing.`,
    },
  ];

  return {
    slug,
    path,
    industrySlug: industry.slug,
    countrySlug: cSlug,
    country,
    industry: industry.name,
    title,
    description,
    keywords: [
      ...industry.keywords,
      `whatsapp crm ${country.toLowerCase()}`,
      `${industry.name.toLowerCase()} whatsapp business ${country.toLowerCase()}`,
      `email marketing crm ${country.toLowerCase()}`,
      "vedmint crm",
      "whatsapp business api crm",
      "whatsapp and email crm",
      "smtp email marketing crm",
    ],
    headline,
    intro,
    challenge,
    solution,
    expertise,
    benefits,
    useCases,
    steps,
    outcomes,
    trustSignals,
    faqs,
    datePublished: SEO_CONTENT_DATES.published,
    dateModified: SEO_CONTENT_DATES.modified,
    authorName: COMPANY_NAME,
    publisherName: COMPANY_NAME,
  };
}

let cachedPages: SeoPage[] | null = null;
let cachedByPath: Map<string, SeoPage> | null = null;

export function getAllSeoPages(): SeoPage[] {
  if (cachedPages) return cachedPages;
  const pages: SeoPage[] = [];
  const seen = new Set<string>();
  for (const country of COUNTRIES) {
    for (const industry of INDUSTRIES) {
      const page = buildPage(country, industry);
      if (seen.has(page.path)) continue;
      seen.add(page.path);
      pages.push(page);
    }
  }
  cachedPages = pages;
  return pages;
}

function pathIndex(): Map<string, SeoPage> {
  if (cachedByPath) return cachedByPath;
  cachedByPath = new Map(getAllSeoPages().map((p) => [p.path, p]));
  return cachedByPath;
}

export function getSeoPageByPath(
  industrySlug: string,
  countrySlug: string,
): SeoPage | undefined {
  return pathIndex().get(seoPagePath(industrySlug, countrySlug));
}

/** @deprecated Prefer getSeoPageByPath */
export function getSeoPageBySlug(slug: string): SeoPage | undefined {
  const normalized = slug.startsWith("/")
    ? slug
    : slug.includes("/")
      ? `/whatsapp-crm/${slug}`
      : null;
  if (normalized) return pathIndex().get(normalized);
  return getAllSeoPages().find((p) => p.slug === slug || p.path.endsWith(slug));
}

export function getSeoPageCount(): number {
  return getAllSeoPages().length;
}

export function getSeoStaticParams(): Array<{
  industry: string;
  country: string;
}> {
  return getAllSeoPages().map((p) => ({
    industry: p.industrySlug,
    country: p.countrySlug,
  }));
}

export function getFeaturedSeoPages(limit = 24): SeoPage[] {
  return getAllSeoPages().slice(0, limit);
}

export function getRelatedSeoPages(page: SeoPage, limit = 6): SeoPage[] {
  const sameCountry: SeoPage[] = [];
  const sameIndustry: SeoPage[] = [];
  for (const p of getAllSeoPages()) {
    if (p.path === page.path) continue;
    if (p.country === page.country && sameCountry.length < limit) {
      sameCountry.push(p);
    } else if (p.industry === page.industry && sameIndustry.length < limit) {
      sameIndustry.push(p);
    }
    if (sameCountry.length + sameIndustry.length >= limit * 2) break;
  }
  return [...sameCountry, ...sameIndustry].slice(0, limit);
}
