import { redirect } from "next/navigation";
import { defaultLocale } from "@/i18n/config";

// Root page — redirect to the localized dashboard.
export default function RootPage() {
  redirect(`/${defaultLocale}/dashboard`);
}
