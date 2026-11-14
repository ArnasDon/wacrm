'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { MessageSquare, Loader2 } from 'lucide-react';

interface WhatsAppEmbeddedButtonProps {
  onSuccess: () => void;
  disabled?: boolean;
}

declare global {
  interface Window {
    FB?: {
      init: (options: Record<string, unknown>) => void;
      login: (
        callback: (response: { authResponse?: { code?: string } }) => void,
        options: Record<string, unknown>
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

export function WhatsAppEmbeddedButton({
  onSuccess,
  disabled,
}: WhatsAppEmbeddedButtonProps) {
  const [connecting, setConnecting] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);

  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const configId = process.env.NEXT_PUBLIC_META_CONFIG_ID; // Optional Meta Configuration ID for Embedded Signup

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const initFacebookSdk = () => {
      if (!appId || !window.FB) return;
      try {
        window.FB.init({
          appId,
          cookie: true,
          xfbml: true,
          version: 'v21.0',
        });
        setSdkReady(true);
      } catch (e) {
        console.error('FB.init error:', e);
      }
    };

    // If FB is already on window, initialize it immediately
    if (window.FB) {
      initFacebookSdk();
      return;
    }

    window.fbAsyncInit = initFacebookSdk;

    // Avoid duplicate script tag if already added
    if (!document.getElementById('facebook-jssdk')) {
      const script = document.createElement('script');
      script.id = 'facebook-jssdk';
      script.src = 'https://connect.facebook.net/en_US/sdk.js';
      script.async = true;
      script.defer = true;
      script.onload = () => {
        if (window.FB) initFacebookSdk();
      };
      document.body.appendChild(script);
    } else if (window.FB) {
      initFacebookSdk();
    }

    // Meta postMessage listener for Embedded Signup session info
    const messageListener = async (event: MessageEvent) => {
      if (
        event.origin !== 'https://www.facebook.com' &&
        event.origin !== 'https://web.facebook.com'
      ) {
        return;
      }

      try {
        const data =
          typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data.type === 'WA_EMBEDDED_SIGNUP') {
          if (data.event === 'FINISH') {
            const { phone_number_id, waba_id } = data.data;
            sessionStorage.setItem('wa_embedded_phone_id', phone_number_id);
            sessionStorage.setItem('wa_embedded_waba_id', waba_id);
          }
        }
      } catch {
        // Not a JSON message from Meta
      }
    };

    window.addEventListener('message', messageListener);
    return () => {
      window.removeEventListener('message', messageListener);
    };
  }, [appId]);

  const handleLaunchEmbedded = () => {
    if (!appId) {
      toast.error(
        'NEXT_PUBLIC_META_APP_ID is not configured in your environment.'
      );
      return;
    }

    if (!window.FB) {
      toast.error(
        'Facebook SDK is still loading. Please try again in a few seconds.'
      );
      return;
    }

    setConnecting(true);

    // Timeout safety: if Meta dialog is blocked by browser popup blocker or closed silently
    const safetyTimer = setTimeout(() => {
      setConnecting(false);
    }, 15000);

    const loginOptions: Record<string, unknown> = {
      scope: 'whatsapp_business_management,whatsapp_business_messaging',
      response_type: 'code',
      extras: {
        feature: 'whatsapp_embedded_signup',
        ...(configId ? { setup: { config_id: configId } } : {}),
      },
    };

    const handleResponse = async (response: { authResponse?: { code?: string } }) => {
      clearTimeout(safetyTimer);
      console.log('FB.login response:', response);
      if (response.authResponse?.code) {
        const code = response.authResponse.code;
        const phoneNumberId = sessionStorage.getItem('wa_embedded_phone_id');
        const wabaId = sessionStorage.getItem('wa_embedded_waba_id');

        sessionStorage.removeItem('wa_embedded_phone_id');
        sessionStorage.removeItem('wa_embedded_waba_id');

        try {
          const res = await fetch('/api/whatsapp/embedded-signup/callback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code,
              phoneNumberId,
              wabaId,
            }),
          });

          const result = await res.json();
          if (!res.ok) {
            throw new Error(
              result.error || 'Failed to complete WhatsApp connection'
            );
          }

          toast.success('WhatsApp connected successfully!');
          onSuccess();
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : 'Error connecting WhatsApp'
          );
        } finally {
          setConnecting(false);
        }
      } else {
        setConnecting(false);
        const status = (response as { status?: string }).status;
        const errorMessage = (response as { error_message?: string }).error_message;
        if (errorMessage) {
          toast.error(`Meta Error: ${errorMessage}`);
        } else if (status === 'unknown' || !response.authResponse) {
          toast.info('Popup closed or blocked by browser. Please allow popups for localhost.');
        } else {
          toast.info(`Connection status: ${status}`);
        }
      }
    };

    try {
      window.FB.login((response) => {
        void handleResponse(response);
      }, loginOptions);
    } catch (err) {
    clearTimeout(safetyTimer);
    setConnecting(false);
    console.error('FB.login exception:', err);
    toast.error(`Meta popup error: ${err instanceof Error ? err.message : String(err)}`);
  }
  };

  return (
    <Button
      onClick={handleLaunchEmbedded}
      disabled={disabled || connecting || !sdkReady}
      className="flex items-center gap-2 bg-[#25D366] font-medium text-white shadow-sm transition-all hover:bg-[#20ba59]"
    >
      {connecting ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <MessageSquare className="h-4 w-4" />
      )}
      <span>
        {connecting
          ? 'Connecting with Meta...'
          : 'Connect WhatsApp in 2 Clicks'}
      </span>
    </Button>
  );
}
