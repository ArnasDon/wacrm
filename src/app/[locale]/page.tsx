import { redirect } from "next/navigation";

export default async function LocaleRootPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // Redirect to the dashboard in the same locale.
  redirect(`/${locale}/dashboard`);
}
