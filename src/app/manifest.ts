import type { MetadataRoute } from 'next'

// Makes the dashboard installable on a phone ("Add to Home screen"), which
// gives Android a proper app icon and makes push notifications more
// reliable. Served at /manifest.webmanifest.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'WACRM',
    short_name: 'WACRM',
    description: 'Shared WhatsApp inbox',
    start_url: '/inbox',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#7c3aed',
    icons: [
      { src: '/pwa-icon/192', sizes: '192x192', type: 'image/png' },
      { src: '/pwa-icon/512', sizes: '512x512', type: 'image/png' },
      { src: '/pwa-icon/512', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
