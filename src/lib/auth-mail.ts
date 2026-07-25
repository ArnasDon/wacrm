import nodemailer from "nodemailer";

import {
  buildTransactionalEmailHtml,
  formatEmailTimestamp,
  maskEmail,
} from "@/lib/email-template";

function getSmtpTransporter() {
  const smtpPort = Number(process.env.SMTP_PORT) || 587;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "",
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: process.env.SMTP_USER || "",
      pass: process.env.SMTP_PASSWORD || "",
    },
  });
}

function buildAuthLink(redirectTo: string, token: string): string {
  const url = new URL(redirectTo);
  url.searchParams.set("token", token);
  return url.toString();
}

function buildPasswordResetLink(redirectTo: string, token: string): string {
  return buildAuthLink(redirectTo, token);
}

function buildVerificationLink(redirectTo: string, token: string): string {
  return buildAuthLink(redirectTo, token);
}

/** User-facing hint when Brevo (or similar) rejects the server IP. */
export function smtpErrorMessage(err: unknown): string {
  const response =
    typeof err === "object" &&
    err !== null &&
    "response" in err &&
    typeof (err as { response?: unknown }).response === "string"
      ? (err as { response: string }).response
      : "";

  if (response.includes("Unauthorized IP")) {
    return "Email could not be sent: the mail provider has not authorized this server's IP address. Ask your admin to whitelist the server IP in Brevo (SMTP → Authorized IPs).";
  }

  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "EAUTH"
  ) {
    return "Email could not be sent: SMTP login failed. Check SMTP_USER and SMTP_PASSWORD in the server configuration.";
  }

  return "Could not send email. Please try again later or contact support.";
}

export async function sendVerificationEmail(
  email: string,
  redirectTo: string,
  token: string,
): Promise<void> {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    throw new Error("SMTP is not configured (SMTP_HOST / SMTP_USER missing).");
  }

  const transporter = getSmtpTransporter();
  const verifyLink = buildVerificationLink(redirectTo, token);
  const sentAt = formatEmailTimestamp();

  await transporter.sendMail({
    from: process.env.SMTP_FROM || "no-reply@vedmint.com",
    to: email,
    subject: "Confirm your email address",
    html: buildTransactionalEmailHtml({
      heading: "Confirm your email address",
      intro:
        "Thanks for signing up. Confirm your email address to finish setting up your account. If you did not create an account, you can safely ignore this email.",
      cardTitle: "Email verification",
      details: [
        { label: "When", value: sentAt },
        { label: "Account", value: maskEmail(email) },
        { label: "Link expires", value: "24 hours" },
      ],
      actionUrl: verifyLink,
      actionLabel: "Confirm email address",
      securityHeading: "Didn't create an account?",
      securityText:
        "No action is needed. Your email address will not be used unless you confirm it with the button above.",
      footerNote:
        "This is an automated message. If you did not sign up, you can delete this email.",
    }),
  });
}

export async function sendLoginOtpEmail(
  email: string,
  code: string,
): Promise<void> {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    throw new Error("SMTP is not configured (SMTP_HOST / SMTP_USER missing).");
  }

  const transporter = getSmtpTransporter();
  const sentAt = formatEmailTimestamp();

  await transporter.sendMail({
    from: process.env.SMTP_FROM || "no-reply@vedmint.com",
    to: email,
    subject: "Your sign-in verification code",
    html: buildTransactionalEmailHtml({
      heading: "Your verification code",
      intro:
        "We received a sign-in attempt for your account. Enter this code to finish signing in. If this was not you, change your password and ignore this email.",
      cardTitle: "Two-factor authentication",
      details: [
        { label: "When", value: sentAt },
        { label: "Account", value: maskEmail(email) },
        { label: "Code", value: code },
        { label: "Expires", value: "10 minutes" },
      ],
      securityHeading: "Didn't try to sign in?",
      securityText:
        "Someone may have entered your email by mistake. Your account is still secure — do not share this code with anyone.",
      footerNote:
        "This is an automated security message. Never share your verification code.",
    }),
  });
}

export async function sendPasswordResetEmail(
  email: string,
  redirectTo: string,
  token: string,
): Promise<void> {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    throw new Error("SMTP is not configured (SMTP_HOST / SMTP_USER missing).");
  }

  const transporter = getSmtpTransporter();
  const resetLink = buildPasswordResetLink(redirectTo, token);
  const sentAt = formatEmailTimestamp();

  await transporter.sendMail({
    from: process.env.SMTP_FROM || "no-reply@vedmint.com",
    to: email,
    subject: "Reset your password",
    html: buildTransactionalEmailHtml({
      heading: "Did you request a password reset?",
      intro:
        "We received a request to reset the password for your account. If this was you, use the button below to choose a new password. If not, you can safely disregard this email.",
      cardTitle: "Password reset",
      details: [
        { label: "When", value: sentAt },
        { label: "Account", value: maskEmail(email) },
        { label: "Link expires", value: "1 hour" },
      ],
      actionUrl: resetLink,
      actionLabel: "Reset my password",
      securityHeading: "Didn't request a password reset?",
      securityText:
        "Your password has not been changed. You can ignore this email and your account will stay secure.",
      footerNote:
        "This is an automated security message. If you did not request a reset, no action is required.",
    }),
  });
}

export { buildAuthLink, buildPasswordResetLink, buildVerificationLink };
