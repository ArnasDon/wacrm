import { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'wacrm',
    short_name: 'wacrm',
    description: 'WhatsApp CRM for Real Estate',
    start_url: '/',
    display: 'standalone',
    background_color: '#020617', // slate-950
    theme_color: '#7c3aed', // primary (violet-600)
    icons: [
      {
        src: '/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  };
}
