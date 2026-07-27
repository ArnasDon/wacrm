import { redirect } from "next/navigation";

export default function LocaleRootPage() {
  // Redirect to the dashboard — the middleware handles locale detection.
  redirect("/dashboard");
}
