"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, Loader2, Smartphone } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  disablePush,
  enablePush,
  getSubscriptionState,
  isIosNeedsInstall,
  isPushSupported,
  sendTestPush,
} from "@/lib/push/client";
import { SettingsPanelHead } from "./settings-panel-head";

/**
 * Push notifications panel. Lets the logged-in user enable web push on
 * this device, see the current permission/subscription status, and fire
 * a test notification. The actual alerts are sent automatically by the
 * server when a customer message arrives (assigned agent, or every
 * owner/admin/agent of the account when the conversation is unassigned).
 */
export function NotificationsPanel() {
  const [supported, setSupported] = useState(true);
  const [needsIosInstall, setNeedsIosInstall] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [testing, setTesting] = useState(false);

  const refresh = useCallback(async () => {
    const ok = isPushSupported();
    setSupported(ok);
    setNeedsIosInstall(isIosNeedsInstall());
    if (!ok) {
      setLoading(false);
      return;
    }
    setPermission(Notification.permission);
    setSubscribed(await getSubscriptionState());
    setLoading(false);
  }, []);

  useEffect(() => {
    // refresh reads navigator/Notification inside, not in the effect body.
    void refresh();
  }, [refresh]);

  const handleEnable = useCallback(async () => {
    setWorking(true);
    try {
      await enablePush();
      toast.success("Notifications enabled on this device");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not enable notifications");
      await refresh();
    } finally {
      setWorking(false);
    }
  }, [refresh]);

  const handleDisable = useCallback(async () => {
    setWorking(true);
    try {
      await disablePush();
      toast.success("Notifications disabled on this device");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not disable notifications");
      await refresh();
    } finally {
      setWorking(false);
    }
  }, [refresh]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    try {
      await sendTestPush();
      toast.success("Test notification sent");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send test");
    } finally {
      setTesting(false);
    }
  }, []);

  return (
    <section className="max-w-3xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Push notifications"
        description="Get notified on this device when a customer sends a new message. You're notified about conversations assigned to you, plus any unassigned conversation in your workspace."
      />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Checking notification status…
        </div>
      ) : !supported ? (
        <Card>
          <CardContent className="flex items-start gap-3 py-4 text-sm text-muted-foreground">
            <BellOff className="mt-0.5 size-4 shrink-0" />
            <p>
              This browser doesn&apos;t support web push notifications. Try a recent
              version of Chrome, Edge, Firefox, or Safari.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Status row */}
          <Card>
            <CardContent className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Smartphone className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">This device</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {subscribed ? (
                      <Badge variant="default">Enabled</Badge>
                    ) : (
                      <Badge variant="secondary">Not enabled</Badge>
                    )}
                    {permission === "denied" && (
                      <Badge variant="destructive">Permission blocked</Badge>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {subscribed && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTest}
                    disabled={testing}
                  >
                    {testing ? <Loader2 className="size-4 animate-spin" /> : null}
                    Send test
                  </Button>
                )}
                {subscribed ? (
                  <Button variant="outline" size="sm" onClick={handleDisable} disabled={working}>
                    {working ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <BellOff className="size-4" />
                    )}
                    Disable
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={handleEnable}
                    disabled={working || permission === "denied"}
                  >
                    {working ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Bell className="size-4" />
                    )}
                    Enable notifications
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Permission blocked hint */}
          {permission === "denied" && (
            <p className="text-xs text-muted-foreground">
              Notifications are blocked for this site. Re-enable them in your browser&apos;s
              site settings, then come back and click “Enable notifications”.
            </p>
          )}

          {/* iOS install hint */}
          {needsIosInstall && (
            <Card>
              <CardContent className="py-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">On iPhone / iPad</p>
                <p className="mt-1">
                  Web push only works after you install the app: tap the Share button, then
                  “Add to Home Screen”, open it from the home screen, and enable notifications
                  there. (Requires iOS 16.4 or newer.)
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </section>
  );
}
