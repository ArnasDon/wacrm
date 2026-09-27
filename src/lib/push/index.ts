import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

if (
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
  process.env.VAPID_PRIVATE_KEY
) {
  webpush.setVapidDetails(
    'mailto:admin@wacrm.example.com',
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function sendPushToUser(
  userId: string,
  payload: { title: string; body: string; url?: string }
) {
  if (!process.env.VAPID_PRIVATE_KEY) return;
  
  const supabase = getAdminSupabase();
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', userId);

  if (error || !subs || subs.length === 0) return;

  const notifications = subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        },
        JSON.stringify(payload)
      );
    } catch (err) {
      if (err && typeof err === 'object' && 'statusCode' in err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await supabase
            .from('push_subscriptions')
            .delete()
            .eq('endpoint', sub.endpoint);
        } else {
          console.error('Push error:', err);
        }
      } else {
        console.error('Push error:', err);
      }
    }
  });

  await Promise.allSettled(notifications);
}

export async function sendPushToAccount(
  accountId: string,
  payload: { title: string; body: string; url?: string }
) {
  if (!process.env.VAPID_PRIVATE_KEY) return;
  
  const supabase = getAdminSupabase();
  const { data: members } = await supabase
    .from('profiles')
    .select('user_id')
    .eq('account_id', accountId);
    
  if (!members || members.length === 0) return;
  
  const userIds = members.map(m => m.user_id);
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('*')
    .in('user_id', userIds);

  if (error || !subs || subs.length === 0) return;

  const notifications = subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        },
        JSON.stringify(payload)
      );
    } catch (err) {
      if (err && typeof err === 'object' && 'statusCode' in err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await supabase
            .from('push_subscriptions')
            .delete()
            .eq('endpoint', sub.endpoint);
        } else {
          console.error('Push error:', err);
        }
      } else {
        console.error('Push error:', err);
      }
    }
  });

  await Promise.allSettled(notifications);
}
