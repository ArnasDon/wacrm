export interface ManualRecipient {
  nome: string | null;
  telefone: string;
}

/**
 * Normalizes a phone number to digits only, prepending Brazil's DDI (55)
 * when a 10 or 11 digit Brazilian local number is supplied without country code.
 */
export function normalizePhoneWithCountry(phoneStr: string): string | null {
  const digits = phoneStr.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) {
    return null;
  }
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
    return `55${digits}`;
  }
  return digits;
}

/**
 * Parses user-entered recipient text which can be:
 * - A single phone number: "83988887777" or "(83) 98888-7777"
 * - A list of phone numbers (one per line or comma/semicolon separated)
 * - Name and phone pairs: "Carlos, 83988887775", "Maria - (83) 98888-7776", "11988887777, João"
 */
export function parseManualRecipients(raw: string): ManualRecipient[] {
  if (!raw || !raw.trim()) return [];

  const rawLines = raw.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
  const items: string[] = [];

  for (const rawLine of rawLines) {
    // If the line consists only of digits/spaces/punctuation without letters and has commas/semicolons,
    // treat each segment as a separate number (e.g. "83988887777, 83999998888")
    if (/^[\d\s+()\-–—,;]+$/.test(rawLine) && /[,;]/.test(rawLine)) {
      const parts = rawLine.split(/[,;]+/).map((p) => p.trim()).filter(Boolean);
      for (const p of parts) items.push(p);
    } else {
      items.push(rawLine);
    }
  }

  const results: ManualRecipient[] = [];
  const seenPhones = new Set<string>();

  for (const item of items) {
    let name: string | null = null;
    let phoneStr = item;

    // "Name, Phone" or "Name - Phone" or "Name: Phone"
    const matchNamePhone = item.match(/^([^\d,:\-–—]+)[,:\-–—]\s*([\d\s+()\-–—]+)$/);
    if (matchNamePhone) {
      name = matchNamePhone[1].trim();
      phoneStr = matchNamePhone[2].trim();
    } else {
      // "Phone, Name" or "Phone - Name"
      const matchPhoneName = item.match(/^([\d\s+()\-–—]+)[,:\-–—]\s*([^\d,:\-–—]+)$/);
      if (matchPhoneName) {
        phoneStr = matchPhoneName[1].trim();
        name = matchPhoneName[2].trim();
      }
    }

    const normalized = normalizePhoneWithCountry(phoneStr);
    if (normalized && !seenPhones.has(normalized)) {
      seenPhones.add(normalized);
      results.push({
        nome: name || null,
        telefone: normalized,
      });
    }
  }

  return results;
}
