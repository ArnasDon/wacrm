'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuthProvider } from '@/hooks/use-auth';
import { SignupWizard } from '@/components/auth/signup-wizard';

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageInner />
    </Suspense>
  );
}

function SignupPageInner() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get('invite');

  return (
    <AuthProvider>
      <SignupWizard inviteToken={inviteToken} />
    </AuthProvider>
  );
}
