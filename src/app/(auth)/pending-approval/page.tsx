"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Clock, LogOut, RefreshCw, ShieldAlert, CheckCircle2 } from "lucide-react";

export default function PendingApprovalPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");

  const checkStatus = async () => {
    setChecking(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }
      setUserEmail(user.email ?? null);

      let { data: profile, error } = await supabase
        .from("profiles")
        .select("full_name, approval_status, account_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (
        error &&
        (error.code === "42703" || error.message?.includes("approval_status"))
      ) {
        const fallback = await supabase
          .from("profiles")
          .select("full_name, account_id")
          .eq("user_id", user.id)
          .maybeSingle();
        profile = fallback.data as any;
      }

      if (profile) {
        setUserName(profile.full_name || null);
        const currentStatus =
          profile.approval_status ?? (profile.account_id ? "approved" : "pending");
        setStatus(currentStatus as "pending" | "approved" | "rejected");

        if (currentStatus === "approved") {
          router.push("/dashboard");
          return;
        }
      }
    } catch (err) {
      console.error("[PendingApproval] error checking status:", err);
    } finally {
      setLoading(false);
      setChecking(false);
    }
  };

  useEffect(() => {
    checkStatus();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Checking account status...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <Card className="w-full max-w-md border-border bg-card shadow-lg">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-amber-500/10 text-amber-500">
            {status === "rejected" ? (
              <ShieldAlert className="size-8 text-destructive" />
            ) : status === "approved" ? (
              <CheckCircle2 className="size-8 text-primary" />
            ) : (
              <Clock className="size-8 text-amber-500 animate-pulse" />
            )}
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight text-foreground">
            {status === "rejected"
              ? "Registration Declined"
              : status === "approved"
                ? "Account Approved!"
                : "Approval Required"}
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground mt-2">
            {status === "rejected"
              ? "Your registration request was not approved by the administrator. Please contact your company administrator for access."
              : status === "approved"
                ? "Your account has been approved! Redirecting you to the dashboard..."
                : "Your account request is currently awaiting review by an administrator. Once approved, you will have access to the CRM workspace."}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6 pt-4">
          <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Registered Name:</span>
              <span className="font-medium text-foreground">{userName || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Email:</span>
              <span className="font-medium text-foreground">{userEmail || "—"}</span>
            </div>
            <div className="flex justify-between pt-1 border-t border-border/50">
              <span className="text-muted-foreground">Status:</span>
              <span
                className={`font-semibold capitalize ${
                  status === "rejected"
                    ? "text-destructive"
                    : status === "approved"
                      ? "text-primary"
                      : "text-amber-500"
                }`}
              >
                {status === "pending" ? "Pending Approval" : status}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            {status !== "approved" && (
              <Button
                variant="outline"
                onClick={checkStatus}
                disabled={checking}
                className="w-full gap-2 border-border"
              >
                <RefreshCw className={`size-4 ${checking ? "animate-spin" : ""}`} />
                {checking ? "Checking Status..." : "Refresh Status"}
              </Button>
            )}

            <Button
              variant="ghost"
              onClick={handleSignOut}
              className="w-full gap-2 text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <LogOut className="size-4" />
              Sign Out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
