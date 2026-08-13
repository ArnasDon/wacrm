import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

export default getRequestConfig(async () => {
  let locale = process.env.NEXT_PUBLIC_APP_LOCALE || 'pt-BR';

  try {
    const cookieStore = await cookies();
    const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value || cookieStore.get('locale')?.value;
    if (cookieLocale) {
      locale = cookieLocale;
    }
  } catch {
    /* ignore when cookies() is not available */
  }

  let messages;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch {
    try {
      messages = (await import(`../../messages/pt-BR.json`)).default;
    } catch {
      messages = (await import(`../../messages/en.json`)).default;
    }
  }

  return {
    locale,
    messages
  };
});
