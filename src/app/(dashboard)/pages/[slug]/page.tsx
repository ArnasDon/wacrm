'use client';

import * as React from 'react';
import { PageEditor } from '@/components/pages/page-editor';

export default function PageEditPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = React.use(params);
  return <PageEditor slug={slug} />;
}