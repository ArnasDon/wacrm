// Root layout is a pass-through. The real layout with <html>, <body>,
// and all providers lives in app/[locale]/layout.tsx so it can set
// lang={locale} dynamically.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
