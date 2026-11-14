'use client';

import { useEffect, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';

export function usePlatformAdmin() {
  const { profile, profileLoading } = useAuth();
  const profileEmail = profile?.email ?? null;
  const profileRole = profile?.role ?? null;
  const [lookupResult, setLookupResult] = useState<{
    email: string;
    isPlatformAdmin: boolean;
  } | null>(null);

  useEffect(() => {
    if (profileLoading || !profileEmail) return;

    let cancelled = false;

    void fetch('/api/auth/platform-role', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Platform role lookup failed (${response.status})`);
        }

        const result: unknown = await response.json();
        if (
          !result ||
          typeof result !== 'object' ||
          !('isPlatformAdmin' in result) ||
          typeof result.isPlatformAdmin !== 'boolean'
        ) {
          throw new Error('Platform role lookup returned an invalid response');
        }

        if (!cancelled) {
          setLookupResult({
            email: profileEmail,
            isPlatformAdmin: result.isPlatformAdmin,
          });
        }
      })
      .catch((error: unknown) => {
        console.error('[usePlatformAdmin] role lookup failed:', error);
        if (!cancelled) {
          setLookupResult({
            email: profileEmail,
            isPlatformAdmin: profileRole === 'superadmin',
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [profileEmail, profileLoading, profileRole]);

  return (
    profileRole === 'superadmin' ||
    (lookupResult?.email === profileEmail && lookupResult.isPlatformAdmin)
  );
}
