import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import LandingPage from "@/components/landing/landing-page";

export const metadata = {
  title: "Solus — All-in-one social selling for digital product creators",
};

export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Already logged in — skip the marketing page, go straight to the app.
  if (user) {
    redirect("/dashboard");
  }

  return <LandingPage />;
}