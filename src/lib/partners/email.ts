// ============================================================
// Partner invitation email — content only; delivery is
// `sendEmail` in src/lib/email/send.ts.
// ============================================================

import { escapeHtml, type EmailMessage } from "@/lib/email/send";

export const PARTNER_INVITATION_SUBJECT = "You've been invited to join WSCRM";

export interface PartnerInvitationEmailInput {
  to: string;
  companyName: string;
  inviterName: string;
  inviterEmail: string;
  signupUrl: string;
  expiryHours: number;
}

function expiryPhrase(hours: number): string {
  return hours % 24 === 0 && hours >= 48 ? `${hours} hours (${hours / 24} days)` : `${hours} hours`;
}

export function buildPartnerInvitationEmail(input: PartnerInvitationEmailInput): EmailMessage {
  const inviter = input.inviterName.trim() || input.inviterEmail;
  const expiry = expiryPhrase(input.expiryHours);

  const text = [
    `You have been invited to join WSCRM by ${inviter}${input.inviterName.trim() ? ` (${input.inviterEmail})` : ""}.`,
    "",
    "Company:",
    input.companyName,
    "",
    "Click the link below to complete your account setup. You'll choose your name and a password; your company, email and phone are already filled in.",
    "",
    `Complete Signup: ${input.signupUrl}`,
    "",
    `This invitation will expire in ${expiry}.`,
    "",
    "If you did not expect this invitation, you can safely ignore this email.",
  ].join("\n");

  const e = escapeHtml;
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f5f3ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f1d2b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;border:1px solid #e9e5ff;padding:32px;">
            <tr><td style="font-size:20px;font-weight:700;padding-bottom:16px;">You've been invited to join WSCRM</td></tr>
            <tr><td style="font-size:15px;line-height:1.6;padding-bottom:16px;">
              You have been invited to join WSCRM by <strong>${e(inviter)}</strong>${
                input.inviterName.trim() ? ` (${e(input.inviterEmail)})` : ""
              }.
            </td></tr>
            <tr><td style="padding-bottom:16px;">
              <div style="font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#6b6780;">Company</div>
              <div style="font-size:16px;font-weight:600;">${e(input.companyName)}</div>
            </td></tr>
            <tr><td style="font-size:15px;line-height:1.6;padding-bottom:24px;">
              Click below to complete your account setup. You'll choose your name and a password; your company, email and phone are already filled in.
            </td></tr>
            <tr><td align="center" style="padding-bottom:24px;">
              <a href="${e(input.signupUrl)}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 28px;border-radius:10px;">Complete Signup</a>
            </td></tr>
            <tr><td style="font-size:13px;line-height:1.6;color:#6b6780;padding-bottom:8px;">
              This invitation will expire in ${e(expiry)}.
            </td></tr>
            <tr><td style="font-size:13px;line-height:1.6;color:#6b6780;">
              If you did not expect this invitation, you can safely ignore this email.
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { to: input.to, subject: PARTNER_INVITATION_SUBJECT, html, text };
}
