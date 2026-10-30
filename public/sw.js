/* WACRM service worker — Web Push notifications + notification actions.
 *
 * Plain JavaScript (no build step); served from /sw.js with scope "/".
 * Payload contract: see src/lib/push/payload.ts (PushPayload v1).
 *
 * Quick reply: the "Reply" action asks the browser for an inline text box
 * (NotificationAction type "text"). Where the browser supports it (Chrome
 * on Android), typing there sends the reply through the user's own
 * logged-in session via POST /api/whatsapp/send — no app to open. Where it
 * is not supported, tapping "Reply" simply opens the chat.
 */

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

function viewedConversation(client) {
  try {
    var u = new URL(client.url);
    if (u.pathname.replace(/\/+$/, '') === '/inbox') return u.searchParams.get('c');
  } catch {
    /* ignore */
  }
  return null;
}

function replyActions() {
  return [
    { action: 'reply', type: 'text', title: 'Reply', placeholder: 'Type your reply' },
    { action: 'open', title: 'Open chat' },
  ];
}

self.addEventListener('push', function (event) {
  var data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch {
    data = null;
  }
  if (!data || data.v !== 1) {
    // Browsers require every push to show something.
    event.waitUntil(self.registration.showNotification('New message', { tag: 'wacrm-generic' }));
    return;
  }

  event.waitUntil(
    (async function () {
      var windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      var watching = windows.some(function (c) {
        return (
          c.visibilityState === 'visible' &&
          data.conversationId &&
          viewedConversation(c) === data.conversationId
        );
      });
      // The user is already looking at this very chat: the thread is the alert.
      if (watching && !data.test) return;

      var canReply = !!data.conversationId;
      await self.registration.showNotification(data.title || 'New message', {
        body: data.body || '',
        tag: data.tag || data.conversationId || 'wacrm',
        renotify: true,
        icon: '/pwa-icon/192',
        badge: '/pwa-icon/192',
        timestamp: data.ts || Date.now(),
        data: { url: data.url || '/inbox', conversationId: data.conversationId || '' },
        actions: canReply ? replyActions() : [],
      });
    })()
  );
});

async function sendReply(d, text) {
  var ok = false;
  var reason = '';
  try {
    var res = await fetch('/api/whatsapp/send', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: d.conversationId,
        message_type: 'text',
        content_text: text,
      }),
    });
    ok = res.ok;
    if (!ok) {
      if (res.status === 401) {
        reason = 'Session expired - open WACRM and sign in';
      } else {
        var j = null;
        try {
          j = await res.json();
        } catch {
          j = null;
        }
        reason = (j && j.error) || 'Error ' + res.status;
      }
    }
  } catch {
    reason = 'No connection';
  }

  var base = { tag: d.conversationId, data: d, icon: '/pwa-icon/192', badge: '/pwa-icon/192' };
  if (ok) {
    await self.registration.showNotification('Reply sent \u2713', {
      ...base,
      body: text,
      silent: true,
      actions: replyActions(),
    });
  } else {
    await self.registration.showNotification('Reply NOT sent', {
      ...base,
      body: reason + ' \u00b7 tap Retry',
      data: { url: d.url, conversationId: d.conversationId, retryText: text },
      actions: [
        { action: 'retry', title: 'Retry' },
        { action: 'open', title: 'Open chat' },
      ],
    });
  }
}

async function openChat(url) {
  var abs = new URL(url || '/inbox', self.location.origin).href;
  var windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (var i = 0; i < windows.length; i++) {
    var c = windows[i];
    try {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus();
        if ('navigate' in c) await c.navigate(abs);
        return;
      }
    } catch {
      /* try next */
    }
  }
  await self.clients.openWindow(abs);
}

self.addEventListener('notificationclick', function (event) {
  var n = event.notification;
  var d = n.data || {};
  n.close();

  if (event.action === 'reply' && d.conversationId) {
    var text = typeof event.reply === 'string' ? event.reply.trim() : '';
    if (text) {
      event.waitUntil(sendReply(d, text));
      return;
    }
    // Browser has no inline text box: fall through and open the chat.
  }
  if (event.action === 'retry' && d.conversationId && d.retryText) {
    event.waitUntil(sendReply(d, d.retryText));
    return;
  }
  event.waitUntil(openChat(d.url));
});
