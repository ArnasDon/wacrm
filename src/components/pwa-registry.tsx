'use client';

import { useEffect } from 'react';

export function PwaRegistry() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js').then(
          function (registration) {
            console.log(
              'ServiceWorker registration successful with scope: ',
              registration.scope
            );
          },
          function (err) {
            console.log('ServiceWorker registration failed: ', err);
          }
        );
      });
    }
  }, []);

  return null;
}
