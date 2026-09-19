import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Payment', robots: { index: false, follow: false } }

const COPY: Record<string, { icon: string; title: string; body: string }> = {
  paid: {
    icon: '✅',
    title: 'Payment received',
    body: 'Thank you! Your receipt has been sent to you on WhatsApp. You can close this page.',
  },
  failed: {
    icon: '⚠️',
    title: 'Payment not completed',
    body: 'The payment did not go through. You can try again from the link on WhatsApp, or reply there for help.',
  },
  pending: {
    icon: '⏳',
    title: 'Confirming your payment',
    body: "We're confirming your payment with the bank. You'll get your receipt on WhatsApp as soon as it's confirmed.",
  },
  invalid: {
    icon: '❔',
    title: 'Link not recognised',
    body: 'Please return to WhatsApp and use the payment link we sent you.',
  },
}

export default async function PaymentCompletePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams
  const c = COPY[status ?? ''] ?? COPY.pending
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6">
      <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
        <div className="mb-3 text-4xl">{c.icon}</div>
        <h1 className="mb-2 text-xl font-semibold text-white">{c.title}</h1>
        <p className="text-sm text-slate-400">{c.body}</p>
      </div>
    </main>
  )
}
