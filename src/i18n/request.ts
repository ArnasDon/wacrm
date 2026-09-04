import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

export default getRequestConfig(async () => {
  // Locale priority: cookie → env var → 'en'
  // The cookie is set by the LanguageSwitcher component so the
  // user's choice persists across SSR renders without a DB call.
  let locale: string;
  try {
    const cookieStore = await cookies();
    locale = cookieStore.get('NEXT_LOCALE')?.value
      || process.env.NEXT_PUBLIC_APP_LOCALE
      || 'en';
  } catch {
    locale = process.env.NEXT_PUBLIC_APP_LOCALE || 'en';
  }

  let messages;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch (error) {
    // Fallback to English if the dictionary for the requested locale doesn't exist yet
    messages = (await import(`../../messages/en.json`)).default;
  }

  return {
    locale,
    messages
  };
});
