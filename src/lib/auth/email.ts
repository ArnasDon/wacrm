import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';

interface MailOptions {
  directory?: string;
  production?: boolean;
  smtpURL?: string;
  purpose?: 'reset-password' | 'verify-email';
}

export async function sendAuthEmail(
  email: string,
  url: string,
  options: MailOptions = {}
) {
  const production =
    options.production ?? process.env.NODE_ENV === 'production';
  const smtpURL = options.smtpURL ?? process.env.SMTP_URL;
  const message = {
    from: process.env.SMTP_FROM ?? 'WACRM <noreply@localhost>',
    to: email,
    subject:
      options.purpose === 'verify-email'
        ? 'Confirm your WACRM email address'
        : 'Reset your WACRM password',
    text: `Use this link to ${options.purpose === 'verify-email' ? 'confirm your email change' : 'reset your password'}:\n\n${url}\n\nIf you did not request this, ignore this message.`,
  };
  if (smtpURL) {
    await nodemailer.createTransport(smtpURL).sendMail(message);
    return;
  }
  if (production)
    throw new Error(
      'SMTP_URL is required to send authentication mail in production.'
    );
  const directory = options.directory ?? resolve('local-data/mail');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    join(directory, `${Date.now()}-${randomUUID()}.json`),
    JSON.stringify(message, null, 2),
    { flag: 'wx', mode: 0o600 }
  );
  // Reset links are credentials; never put them in shared server logs.
  console.info('[auth] Development email saved in local-data/mail.');
}
