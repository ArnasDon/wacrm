// ============================================================
// vitals.ts — Core Web Vitals de la landing (DAD §3.4).
// La landing es HTML estático: el hook useReportWebVitals de Next NO
// corre aquí (verificado). Se usa la lib web-vitals (dep del paquete
// landing) y se envían las métricas al mismo /api/analytics/vitals.
// ============================================================

import { onTTFB, onFCP, onLCP, onCLS, onINP } from "web-vitals";

function report(metric: { name: string; value: number; id: string }): void {
  try {
    const body = {
      name: metric.name,
      value: metric.value,
      id: metric.id,
      path: location.pathname,
      landing: true,
    };
    if (navigator.sendBeacon) {
      navigator.sendBeacon(`${location.origin}/api/analytics/vitals`, new Blob([JSON.stringify(body)], { type: "application/json" }));
    } else {
      fetch(`${location.origin}/api/analytics/vitals`, { method: "POST", body: JSON.stringify(body), keepalive: true });
    }
  } catch {}
}

onTTFB(report);
onFCP(report);
onLCP(report);
onCLS(report);
onINP(report);
