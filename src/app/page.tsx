import type { Metadata } from "next";
import { HomePageContent } from "@/components/marketing/home-page";
import {
  COMPANY_NAME,
  META_DESCRIPTION,
  OFFICIAL_APP_URL,
  PRODUCT_NAME,
  logoUrl,
} from "@/lib/brand";

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} — WhatsApp & Email CRM`,
  description: META_DESCRIPTION,
  metadataBase: new URL(OFFICIAL_APP_URL),
  alternates: { canonical: OFFICIAL_APP_URL },
  robots: { index: true, follow: true },
  keywords: [
    "whatsapp crm",
    "email marketing crm",
    "whatsapp business api",
    "smtp email campaigns",
    "vedmint crm",
    "shared inbox",
  ],
  openGraph: {
    title: `${PRODUCT_NAME} — WhatsApp & Email CRM`,
    description: META_DESCRIPTION,
    url: OFFICIAL_APP_URL,
    siteName: COMPANY_NAME,
    type: "website",
    images: [{ url: logoUrl(), width: 820, height: 304, alt: COMPANY_NAME }],
  },
};

export default function HomePage() {
  return <HomePageContent />;
}
