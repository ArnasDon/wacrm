import { notFound } from 'next/navigation';

import { requirePlatformAdmin } from '@/lib/auth/platform';
import { AuthProvider } from '@/hooks/use-auth';
import { StoreDetailPanel } from '@/components/platform/store-detail-panel';

/**
 * /painel-a17c94fe2b6d/lojas/[id] — platform admin only, same gate as
 * /painel-a17c94fe2b6d itself (requirePlatformAdmin() + notFound() for
 * anyone else). Full read+write detail for one store: rename it,
 * edit the owner/sellers' data, reset passwords, remove sellers,
 * suspend/reactivate, or delete the whole store.
 */
export default async function StoreDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  try {
    await requirePlatformAdmin();
  } catch {
    notFound();
  }

  const { id } = await params;

  return (
    <AuthProvider>
      <StoreDetailPanel organizationId={id} />
    </AuthProvider>
  );
}
