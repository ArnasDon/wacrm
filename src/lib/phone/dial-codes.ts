/**
 * Country calling codes for phone inputs — the common WhatsApp markets.
 * `region` is the ISO 3166 code used to pick a default from the browser
 * locale; `flag` is the regional-indicator emoji.
 */
export const DIAL_CODES: { region: string; name: string; code: string; flag: string }[] = [
  { region: 'IN', name: 'India', code: '+91', flag: '🇮🇳' },
  { region: 'US', name: 'United States / Canada', code: '+1', flag: '🇺🇸' },
  { region: 'GB', name: 'United Kingdom', code: '+44', flag: '🇬🇧' },
  { region: 'AE', name: 'United Arab Emirates', code: '+971', flag: '🇦🇪' },
  { region: 'SA', name: 'Saudi Arabia', code: '+966', flag: '🇸🇦' },
  { region: 'QA', name: 'Qatar', code: '+974', flag: '🇶🇦' },
  { region: 'KW', name: 'Kuwait', code: '+965', flag: '🇰🇼' },
  { region: 'OM', name: 'Oman', code: '+968', flag: '🇴🇲' },
  { region: 'NP', name: 'Nepal', code: '+977', flag: '🇳🇵' },
  { region: 'BD', name: 'Bangladesh', code: '+880', flag: '🇧🇩' },
  { region: 'PK', name: 'Pakistan', code: '+92', flag: '🇵🇰' },
  { region: 'LK', name: 'Sri Lanka', code: '+94', flag: '🇱🇰' },
  { region: 'SG', name: 'Singapore', code: '+65', flag: '🇸🇬' },
  { region: 'MY', name: 'Malaysia', code: '+60', flag: '🇲🇾' },
  { region: 'ID', name: 'Indonesia', code: '+62', flag: '🇮🇩' },
  { region: 'PH', name: 'Philippines', code: '+63', flag: '🇵🇭' },
  { region: 'TH', name: 'Thailand', code: '+66', flag: '🇹🇭' },
  { region: 'VN', name: 'Vietnam', code: '+84', flag: '🇻🇳' },
  { region: 'AU', name: 'Australia', code: '+61', flag: '🇦🇺' },
  { region: 'DE', name: 'Germany', code: '+49', flag: '🇩🇪' },
  { region: 'FR', name: 'France', code: '+33', flag: '🇫🇷' },
  { region: 'ES', name: 'Spain', code: '+34', flag: '🇪🇸' },
  { region: 'IT', name: 'Italy', code: '+39', flag: '🇮🇹' },
  { region: 'NL', name: 'Netherlands', code: '+31', flag: '🇳🇱' },
  { region: 'LT', name: 'Lithuania', code: '+370', flag: '🇱🇹' },
  { region: 'TR', name: 'Turkey', code: '+90', flag: '🇹🇷' },
  { region: 'EG', name: 'Egypt', code: '+20', flag: '🇪🇬' },
  { region: 'NG', name: 'Nigeria', code: '+234', flag: '🇳🇬' },
  { region: 'KE', name: 'Kenya', code: '+254', flag: '🇰🇪' },
  { region: 'ZA', name: 'South Africa', code: '+27', flag: '🇿🇦' },
  { region: 'BR', name: 'Brazil', code: '+55', flag: '🇧🇷' },
  { region: 'MX', name: 'Mexico', code: '+52', flag: '🇲🇽' },
  { region: 'AR', name: 'Argentina', code: '+54', flag: '🇦🇷' },
  { region: 'CO', name: 'Colombia', code: '+57', flag: '🇨🇴' },
  { region: 'KR', name: 'South Korea', code: '+82', flag: '🇰🇷' },
  { region: 'JP', name: 'Japan', code: '+81', flag: '🇯🇵' },
];

/** Split "+919972519911" into its dial code and national number. */
export function splitInternational(full: string): { code: string; national: string } | null {
  const compact = full.replace(/[\s().-]/g, '');
  if (!compact.startsWith('+')) return null;
  // Longest code first so "+971…" doesn't match "+97".
  const match = [...DIAL_CODES]
    .sort((a, b) => b.code.length - a.code.length)
    .find((d) => compact.startsWith(d.code));
  return match ? { code: match.code, national: compact.slice(match.code.length) } : null;
}

/** The dial code for the browser's region, if it is in the list. */
export function dialCodeForLocale(locale: string | undefined): string | null {
  if (!locale) return null;
  try {
    const region = new Intl.Locale(locale).maximize().region;
    return DIAL_CODES.find((d) => d.region === region)?.code ?? null;
  } catch {
    return null;
  }
}
