import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async () => {
  // Read the locale from the environment, defaulting to 'es' — this
  // instance serves Guatemalan businesses, so Spanish is the native
  // language, not a translation layered on top. Override with
  // NEXT_PUBLIC_APP_LOCALE for a future fork that needs a different
  // default (e.g. 'en', 'ko').
  const locale = process.env.NEXT_PUBLIC_APP_LOCALE || 'es';

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
