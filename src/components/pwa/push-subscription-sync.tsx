"use client";

import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { pushConfigured, subscribeToPush } from "@/lib/push/client";

/**
 * Headless. Mounted in the dashboard shell next to `BrowserNotifications`.
 *
 * When the user has ALREADY granted notification permission (via the
 * Settings toggle, on this or another device/session), this keeps the
 * server's copy of the push subscription current on every load — the
 * browser can rotate the endpoint, and a fresh install of the PWA
 * starts with permission granted but no server row.
 *
 * It never *asks* for permission — that must be a deliberate user
 * gesture (`PushNotificationsCard`).
 */
export function PushSubscriptionSync() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    if (!pushConfigured()) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;

    void subscribeToPush();
  }, [user]);

  return null;
}
