import { notFound } from 'next/navigation';

import { requirePlatformAdmin } from '@/lib/auth/platform';
import { AuthProvider } from '@/hooks/use-auth';
import { PlatformPanel } from '@/components/platform/platform-panel';

/**
 * /painel-a17c94fe2b6d — platform admin only. Deliberately not named
 * /admin (see migration 042's own comment on why). Anyone who isn't
 * in `platform_admins` gets a plain 404 here — never a "you don't
 * have permission" screen that would confirm the route exists.
 *
 * This check is server-side and runs before any client code — the
 * API routes underneath (/api/platform/*) independently re-check via
 * requirePlatformAdmin() too, so this page-level gate is defense in
 * depth, not the only guard.
 */
export default async function PainelPlataformaPage() {
  try {
    await requirePlatformAdmin();
  } catch {
    notFound();
  }

  return (
    <AuthProvider>
      <PlatformPanel />
    </AuthProvider>
  );
}
