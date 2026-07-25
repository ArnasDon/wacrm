import { OFFICIAL_APP_URL, logoUrl } from "@/lib/brand";

export type EmailDetailRow = {
  label: string;
  value: string;
};

export type TransactionalEmailOptions = {
  heading: string;
  intro: string;
  cardTitle: string;
  details: EmailDetailRow[];
  /** When omitted, the CTA button is hidden (e.g. OTP emails). */
  actionUrl?: string;
  actionLabel?: string;
  securityHeading?: string;
  securityText?: string;
  securityLinkUrl?: string;
  securityLinkLabel?: string;
  footerNote?: string;
};

const CTA_COLOR = "#FF385C";
const TEXT_PRIMARY = "#222222";
const TEXT_SECONDARY = "#717171";
const BORDER_COLOR = "#DDDDDD";
const PAGE_BG = "#F7F7F7";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderDetailRows(details: EmailDetailRow[]): string {
  return details
    .map(
      (row) => `
        <tr>
          <td style="padding:0 0 12px;font-size:16px;line-height:1.5;color:${TEXT_PRIMARY};">
            <strong style="font-weight:600;">${escapeHtml(row.label)}:</strong>
            ${escapeHtml(row.value)}
          </td>
        </tr>`,
    )
    .join("");
}

/** Transactional email with VedMint wordmark header. */
export function buildTransactionalEmailHtml(
  options: TransactionalEmailOptions,
): string {
  const {
    heading,
    intro,
    cardTitle,
    details,
    actionUrl,
    actionLabel,
    securityHeading,
    securityText,
    securityLinkUrl,
    securityLinkLabel,
    footerNote = "If you did not request this email, you can safely ignore it.",
  } = options;

  const securityBlock =
    securityHeading && securityText
      ? `
        <tr>
          <td style="padding:32px 0 0;border-top:1px solid ${BORDER_COLOR};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="40" valign="top" style="padding-right:12px;font-size:24px;line-height:1;">
                  &#128737;
                </td>
                <td valign="top" style="font-size:16px;line-height:1.5;color:${TEXT_PRIMARY};">
                  <p style="margin:0 0 8px;font-weight:600;">${escapeHtml(securityHeading)}</p>
                  <p style="margin:0;color:${TEXT_SECONDARY};">${escapeHtml(securityText)}${
                    securityLinkUrl && securityLinkLabel
                      ? ` <a href="${escapeHtml(securityLinkUrl)}" style="color:${CTA_COLOR};text-decoration:underline;">${escapeHtml(securityLinkLabel)}</a>`
                      : ""
                  }</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${PAGE_BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE_BG};">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
          <tr>
            <td style="padding:0 0 28px;text-align:center;">
              <a href="${escapeHtml(OFFICIAL_APP_URL)}" style="text-decoration:none;">
                <img src="${escapeHtml(logoUrl())}" alt="VedMint" width="220" style="display:inline-block;max-width:220px;height:auto;border:0;" />
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 24px;">
              <h1 style="margin:0 0 16px;font-size:26px;line-height:1.25;font-weight:700;color:${TEXT_PRIMARY};">${escapeHtml(heading)}</h1>
              <p style="margin:0;font-size:16px;line-height:1.6;color:${TEXT_PRIMARY};">${escapeHtml(intro)}</p>
            </td>
          </tr>
          <tr>
            <td style="border:1px solid ${BORDER_COLOR};border-radius:12px;background:#ffffff;overflow:hidden;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:20px 24px;border-bottom:1px solid ${BORDER_COLOR};font-size:18px;font-weight:700;color:${TEXT_PRIMARY};">
                    ${escapeHtml(cardTitle)}
                  </td>
                </tr>
                <tr>
                  <td style="padding:24px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      ${renderDetailRows(details)}
                    </table>
                  </td>
                </tr>
                ${
                  actionUrl && actionLabel
                    ? `<tr>
                  <td style="padding:0 24px 24px;">
                    <a href="${escapeHtml(actionUrl)}" style="display:block;width:100%;box-sizing:border-box;background:${CTA_COLOR};color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;line-height:1.2;text-align:center;padding:16px 20px;border-radius:8px;">
                      ${escapeHtml(actionLabel)}
                    </a>
                  </td>
                </tr>`
                    : ""
                }
              </table>
            </td>
          </tr>
          ${securityBlock}
          <tr>
            <td style="padding:32px 0 0;font-size:13px;line-height:1.6;color:${TEXT_SECONDARY};">
              ${escapeHtml(footerNote)}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function formatEmailTimestamp(date = new Date()): string {
  return date.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}
