"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Lands here from a Supabase email link (password recovery today;
 * email-change / invite-accept later, same mechanism). Handles both
 * auth response shapes Supabase can hand back, because this project
 * has been observed emitting BOTH depending on how the link was
 * issued:
 *
 *   - PKCE: `?code=...` in the query string. Exchanged via
 *     `exchangeCodeForSession`.
 *   - Implicit: `#access_token=...&refresh_token=...` in the URL
 *     *fragment*. Fragments never reach the server — a Route Handler
 *     physically cannot see them — so this has to be a client
 *     component that reads `window.location.hash` and calls
 *     `setSession` directly. (Confirmed live: an admin-generated
 *     recovery link came back in this shape, not `?code=`.)
 *
 * `next` rides in the query string of a public email link, so it's
 * treated as untrusted input — only ever redirected to if it's a
 * same-app path.
 */
export default function AuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <AuthCallbackInner />
    </Suspense>
  );
}

function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";
}

function AuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    const next = safeNext(searchParams.get("next"));

    async function run() {
      const code = searchParams.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (cancelled) return;
        if (!error) {
          router.replace(next);
          return;
        }
      }

      // No code, or the exchange failed — fall back to the implicit-flow
      // shape: tokens in the fragment, which only the browser can read.
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (cancelled) return;
        if (!error) {
          router.replace(next);
          return;
        }
      }

      if (!cancelled) {
        setError("This link is invalid or has expired.");
        setTimeout(() => {
          if (!cancelled) router.replace("/login?error=auth_callback_failed");
        }, 2000);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-center text-muted-foreground">
      {error ?? "Signing you in…"}
    </div>
  );
}
