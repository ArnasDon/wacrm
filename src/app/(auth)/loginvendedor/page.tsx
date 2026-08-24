'use client';

import { Suspense } from 'react';
import { UsersRound } from 'lucide-react';
import { LoginForm } from '@/components/auth/login-form';

// `useSearchParams` (inside LoginForm) opts the tree out of static
// prerendering unless it sits under a Suspense boundary — same
// reasoning as /login's own split.
//
// No "create account" footer here on purpose: a vendedor's login is
// created by the store owner (Configurações → Organização → convidar
// vendedor), never by self-signup — /signup always creates a NEW
// store, which is the wrong outcome for someone who was just invited
// to join an existing one.
export default function LoginVendedorPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm
        icon={<UsersRound className="h-6 w-6" />}
        title="Acesso do vendedor"
        description="Entre com o e-mail e senha que a loja cadastrou para você."
        footer={<p>Ainda não recebeu um acesso? Peça ao responsável pela loja para te cadastrar.</p>}
      />
    </Suspense>
  );
}
