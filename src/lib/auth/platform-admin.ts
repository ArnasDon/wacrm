export function isPlatformAdmin(
  email?: string | null,
  systemRole?: string | null,
): boolean {
  if (systemRole === 'superadmin') return true;

  const adminEmails = (process.env.PLATFORM_ADMIN_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return !!email && adminEmails.includes(email.toLowerCase());
}
