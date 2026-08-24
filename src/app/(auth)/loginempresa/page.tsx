'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { LoginForm } from '@/components/auth/login-form';

// `useSearchParams` (inside LoginForm) opts the tree out of static
// prerendering unless it sits under a Suspense boundary — same
// reasoning as /login's own split.
export default function LoginEmpresaPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm
        icon={<Building2 className="h-6 w-6" />}
        title="Acesso da loja"
        description="Entre com a conta da sua loja para gerenciar contatos, conversas e vendedores."
        footer={
          <p>
            Ainda não tem uma loja cadastrada?{' '}
            <Link href="/signup">Criar conta</Link>
          </p>
        }
      />
    </Suspense>
  );
}
