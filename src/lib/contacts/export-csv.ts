import { normalizePhone } from "@/lib/whatsapp/phone-utils";
import type { Tag } from "@/types";

/**
 * CSV export for the Contacts page — the write-side counterpart to
 * `parse-contact-csv.ts`. Column headers are Portuguese (`Nome`,
 * `Telefone`, ...) per the product spec for this feature, which is a
 * deliberate mismatch with `parse-contact-csv.ts`'s English headers
 * (`phone`, `name`, ...): a file exported here won't re-import cleanly
 * through this app's own Import modal today. That's a known gap, not
 * an oversight — flag it before adding English-header support, since
 * it'd need product input on which header set wins.
 */

export interface ExportableContact {
  name?: string;
  phone: string;
  email?: string;
  company?: string;
  created_at: string;
  tags?: Tag[];
}

const CSV_HEADERS = ["Nome", "Telefone", "Email", "Empresa", "Tags", "CriadoEm"];

/** Field delimiter. `;`, not the RFC 4180 default `,` — Excel/Sheets
 *  under a pt-BR (or any comma-as-decimal-separator) locale ignore `,`
 *  as a column boundary when a `.csv` is opened directly (double-click,
 *  not an explicit "Import" with a delimiter picker) and instead read
 *  the whole row into a single cell, since that locale's list separator
 *  is `;`. This is the standard fix for CSVs meant to be double-clicked
 *  open in Excel PT-BR/EU-locale installs. */
const DELIMITER = ";";

/** RFC 4180 field escaping: quote + double-up embedded quotes whenever
 *  the value contains the delimiter, a quote, or a newline — the
 *  characters that would otherwise break the column boundary or
 *  truncate the row. */
function escapeCsvField(value: string): string {
  if (new RegExp(`["\\n\\r${DELIMITER}]`).test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatRow(values: string[]): string {
  return values.map(escapeCsvField).join(DELIMITER);
}

/** Builds a CSV string from contacts, UTF-8 BOM prefixed so Excel and
 *  Google Sheets detect the encoding and render accented characters
 *  correctly instead of mangling them. Phone is normalized to digits
 *  only (same form as `contacts.phone_normalized` and what the
 *  WhatsApp Cloud API / Transmissões broadcast filters expect) rather
 *  than whatever punctuation the contact happened to be saved with. */
export function contactsToCsv(contacts: ExportableContact[]): string {
  const lines = [formatRow(CSV_HEADERS)];

  for (const contact of contacts) {
    const phone = normalizePhone(contact.phone) || contact.phone;
    // Comma, not `;`, joins multiple tag names within their one cell —
    // `;` is now the *column* delimiter above, so using it here too
    // would force that cell to always be quoted. Still fully readable:
    // "VIP, Lead" is an unambiguous single field either way.
    const tags = (contact.tags ?? []).map((tag) => tag.name).join(", ");
    const createdAt = new Date(contact.created_at).toISOString().slice(0, 10);

    lines.push(
      formatRow([
        contact.name ?? "",
        phone,
        contact.email ?? "",
        contact.company ?? "",
        tags,
        createdAt,
      ]),
    );
  }

  return "﻿" + lines.join("\r\n");
}

/** Triggers a browser download of `content` as `filename` — purely
 *  client-side, no server round trip, since the caller already has the
 *  full row set in memory by the time this runs. */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
