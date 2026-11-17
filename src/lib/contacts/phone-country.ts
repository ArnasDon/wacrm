import { normalizePhone } from '@/lib/whatsapp/phone-utils';

export interface PhoneCountry {
  callingCode: string;
  regions: readonly string[];
}

export const PHONE_COUNTRIES: readonly PhoneCountry[] = [
  { callingCode: '1', regions: ['US', 'CA'] },
  { callingCode: '7', regions: ['RU', 'KZ'] },
  { callingCode: '20', regions: ['EG'] },
  { callingCode: '27', regions: ['ZA'] },
  { callingCode: '30', regions: ['GR'] },
  { callingCode: '31', regions: ['NL'] },
  { callingCode: '32', regions: ['BE'] },
  { callingCode: '33', regions: ['FR'] },
  { callingCode: '34', regions: ['ES'] },
  { callingCode: '36', regions: ['HU'] },
  { callingCode: '39', regions: ['IT'] },
  { callingCode: '40', regions: ['RO'] },
  { callingCode: '41', regions: ['CH'] },
  { callingCode: '43', regions: ['AT'] },
  { callingCode: '44', regions: ['GB'] },
  { callingCode: '45', regions: ['DK'] },
  { callingCode: '46', regions: ['SE'] },
  { callingCode: '47', regions: ['NO'] },
  { callingCode: '48', regions: ['PL'] },
  { callingCode: '49', regions: ['DE'] },
  { callingCode: '51', regions: ['PE'] },
  { callingCode: '52', regions: ['MX'] },
  { callingCode: '54', regions: ['AR'] },
  { callingCode: '55', regions: ['BR'] },
  { callingCode: '56', regions: ['CL'] },
  { callingCode: '57', regions: ['CO'] },
  { callingCode: '58', regions: ['VE'] },
  { callingCode: '60', regions: ['MY'] },
  { callingCode: '61', regions: ['AU'] },
  { callingCode: '62', regions: ['ID'] },
  { callingCode: '63', regions: ['PH'] },
  { callingCode: '64', regions: ['NZ'] },
  { callingCode: '65', regions: ['SG'] },
  { callingCode: '66', regions: ['TH'] },
  { callingCode: '81', regions: ['JP'] },
  { callingCode: '82', regions: ['KR'] },
  { callingCode: '84', regions: ['VN'] },
  { callingCode: '86', regions: ['CN'] },
  { callingCode: '90', regions: ['TR'] },
  { callingCode: '91', regions: ['IN'] },
  { callingCode: '92', regions: ['PK'] },
  { callingCode: '94', regions: ['LK'] },
  { callingCode: '212', regions: ['MA'] },
  { callingCode: '213', regions: ['DZ'] },
  { callingCode: '233', regions: ['GH'] },
  { callingCode: '234', regions: ['NG'] },
  { callingCode: '254', regions: ['KE'] },
  { callingCode: '255', regions: ['TZ'] },
  { callingCode: '256', regions: ['UG'] },
  { callingCode: '351', regions: ['PT'] },
  { callingCode: '353', regions: ['IE'] },
  { callingCode: '358', regions: ['FI'] },
  { callingCode: '359', regions: ['BG'] },
  { callingCode: '370', regions: ['LT'] },
  { callingCode: '371', regions: ['LV'] },
  { callingCode: '372', regions: ['EE'] },
  { callingCode: '380', regions: ['UA'] },
  { callingCode: '381', regions: ['RS'] },
  { callingCode: '385', regions: ['HR'] },
  { callingCode: '386', regions: ['SI'] },
  { callingCode: '420', regions: ['CZ'] },
  { callingCode: '421', regions: ['SK'] },
  { callingCode: '852', regions: ['HK'] },
  { callingCode: '880', regions: ['BD'] },
  { callingCode: '886', regions: ['TW'] },
  { callingCode: '962', regions: ['JO'] },
  { callingCode: '965', regions: ['KW'] },
  { callingCode: '966', regions: ['SA'] },
  { callingCode: '971', regions: ['AE'] },
  { callingCode: '972', regions: ['IL'] },
  { callingCode: '974', regions: ['QA'] },
  { callingCode: '977', regions: ['NP'] },
];

export function findPhoneCountry(
  callingCode: string | null | undefined,
): PhoneCountry | null {
  if (!callingCode) return null;
  return PHONE_COUNTRIES.find((c) => c.callingCode === callingCode) ?? null;
}

export function phoneCountryLikePattern(
  callingCode: string | null | undefined,
): string | null {
  const country = findPhoneCountry(callingCode);
  return country ? `${country.callingCode}%` : null;
}

export function phoneMatchesCountry(phone: string, callingCode: string): boolean {
  const country = findPhoneCountry(callingCode);
  if (!country) return false;
  return normalizePhone(phone).startsWith(country.callingCode);
}

function regionName(region: string, displayNames: Intl.DisplayNames | null): string {
  return displayNames?.of(region) ?? region;
}

function createRegionNames(locale: string): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' });
  } catch {
    return null;
  }
}

export interface PhoneCountryOption {
  callingCode: string;
  label: string;
}

export function phoneCountryOptions(locale: string): PhoneCountryOption[] {
  const displayNames = createRegionNames(locale);
  return PHONE_COUNTRIES.map((country) => ({
    callingCode: country.callingCode,
    label: `${country.regions
      .map((region) => regionName(region, displayNames))
      .join(' / ')} (+${country.callingCode})`,
  })).sort((a, b) => a.label.localeCompare(b.label, locale));
}
