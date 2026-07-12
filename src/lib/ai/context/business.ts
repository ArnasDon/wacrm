import { supabaseAdmin } from "@/lib/automations/admin-client";

export interface BusinessContext {
  spaName: string;
  city: string;
  timezone?: string;
  language?: string;
  currency?: string;
}

export async function getBusinessContext(
  accountId?: string,
): Promise<BusinessContext> {

  // Temporary fallback
  if (!accountId) {
    return {
      spaName: "Relaxio Spa",
      city: "Lucknow",
      timezone: "Asia/Kolkata",
      language: "en",
      currency: "INR",
    };
  }

  const db = supabaseAdmin();

  // Placeholder for future business_settings table
  // We intentionally keep fallback values until the table is added.

  return {
    spaName: "Relaxio Spa",
    city: "Lucknow",
    timezone: "Asia/Kolkata",
    language: "en",
    currency: "INR",
  };
}