import type { Viewport } from 'next';
import { CalculatorView } from '@/components/calculator/calculator-view';

// Page-level `viewport` export — only supported in Server Components,
// which is also why the redundant `'use client'` this file used to have
// (CalculatorView already declares its own) got dropped: it was blocking
// this export from being usable at all. Scoped to this one route only —
// every other page keeps inheriting the root layout's `viewport`
// (layout.tsx) untouched, pinch-zoom included. `maximumScale`/
// `userScalable` block the pinch/double-tap *zoom gesture* specifically;
// they don't affect focus, typing, or the virtual keyboard, which are a
// separate code path. Every other field here is copied from the root
// layout's `viewport` rather than left to inherit, since it's unclear
// whether a segment-level `viewport` merges with the parent's or fully
// replaces it — copying removes the ambiguity (losing `viewportFit:
// 'cover'` here specifically would break safe-area padding on this page).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#020617',
  colorScheme: 'dark light',
};

export default function CalculadoraPage() {
  return <CalculatorView />;
}
