# Telnyx Inbound PSTN → WebRTC Browser Solution

## Executive Summary

Based on thorough reading of Telnyx documentation, the correct approach is **Pattern 2** from the [WebRTC SDK Commonalities docs](https://developers.telnyx.com/docs/voice/webrtc/sdk-commonalities):

> **Pattern 2:** Telnyx receives a call from outside the Telnyx network (PSTN). Telnyx processes the call via Voice API commands. User's backend service initiates a **second call leg** toward a client-end application. The two call legs are eventually joined via **bridge command**.

This is a **two-leg architecture**: the inbound PSTN call is Leg A, you create a new outbound call to the WebRTC client as Leg B, then bridge them.

---

## Root Cause of Your Issues

### Why `user_busy` (486) on subsequent calls
The WebRTC SDK client was not properly cleaning up the previous call's media session. When a new `POST /v2/calls` hits the SIP URI and the SDK still has an active/zombie `RTCPeerConnection` from the prior call, the SIP registration responds 486 (busy). **The fix:** properly destroy/hangup each call on the browser side AND use the **credential connection's `connection_id`** (not the CCA's) in the `POST /v2/calls` to route the outbound leg to the WebRTC client.

### Why `registration_status="Not Registered"` with JWT/login_token
JWT auth requires a telephony credential as parent. The SDK must show `REGED` state (gateway state) after the `clientReady` event. If it shows "Not Registered", the credential may be expired, or the `connection_id` on the telephony credential is wrong.

---

## Correct Telnyx Configuration

### Step 1: Credential Connection (for WebRTC clients)

Your existing credential connection `<your-credential-connection-id>` is fine. Ensure it has:

```
PATCH /v2/credential_connections/<your-credential-connection-id>
{
  "active": true,
  "anchorsite_override": "Latency",
  "sip_uri_calling_preference": "internal"
}
```

**Important:** Do NOT set `webhook_event_url` on the credential connection unless you want Pattern 1 (client-initiated calls with parking). For Pattern 2, you don't need webhooks on the credential connection.

### Step 2: Call Control Application (for inbound PSTN)

Your CCA `<your-call-control-app-id>` receives the inbound PSTN call and sends webhooks to your server. **The phone number stays on the CCA.** This is correct.

### Step 3: Telephony Credential (for browser auth)

Your telephony credential `<your-telephony-credential-id>` with SIP username `<your-agent-sip-username>` is fine. Ensure:
- `connection_id` points to credential connection `<your-credential-connection-id>`
- `expires_at` is not in the past (or not set)

Check: `GET /v2/telephony_credentials/<your-telephony-credential-id>`

### Architecture Diagram

```
PSTN Caller → +15555550123 (on CCA) → Webhook → Your Server
                                                    ↓
                                          POST /v2/calls (Leg B)
                                          to: sip:gencred...@sip.telnyx.com
                                          connection_id: CREDENTIAL_CONNECTION_ID
                                                    ↓
                                          WebRTC Browser (answers)
                                                    ↓
                                          Bridge Leg A ↔ Leg B
```

---

## Server-Side Code (Webhook Handler)

```typescript
// api/telnyx-webhook.ts (Next.js API route or Express handler)

const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const CREDENTIAL_CONNECTION_ID = '<your-credential-connection-id>'; // WebRTC credential connection
const AGENT_SIP_URI = 'sip:<your-agent-sip-username>@sip.telnyx.com';

// Store active call mappings
const pendingBridges = new Map<string, string>(); // legB_call_control_id → legA_call_control_id

export async function POST(req: Request) {
  const body = await req.json();
  const event = body.data;
  const eventType = event.event_type;
  const payload = event.payload;

  console.log(`[Telnyx] ${eventType}`, payload.call_control_id);

  switch (eventType) {
    case 'call.initiated': {
      // Inbound PSTN call received
      if (payload.direction === 'incoming') {
        // Answer the inbound call (Leg A)
        await telnyxAPI(`/v2/calls/${payload.call_control_id}/actions/answer`, {
          client_state: Buffer.from(JSON.stringify({ type: 'inbound_pstn' })).toString('base64')
        });
      }
      break;
    }

    case 'call.answered': {
      const clientState = parseClientState(payload.client_state);

      if (clientState?.type === 'inbound_pstn') {
        // Leg A answered — now play IVR or go straight to agent
        // Option A: Skip IVR, dial agent immediately
        await dialAgent(payload.call_control_id, payload.from, payload.to);

        // Option B: Play IVR first (uncomment if needed)
        // await telnyxAPI(`/v2/calls/${payload.call_control_id}/actions/speak`, {
        //   payload: 'Thank you for calling. Connecting you to an agent.',
        //   voice: 'female',
        //   language: 'en-US',
        //   client_state: Buffer.from(JSON.stringify({ type: 'ivr_playing' })).toString('base64')
        // });
      }

      if (clientState?.type === 'webrtc_leg') {
        // Leg B (WebRTC agent) answered — BRIDGE the two legs
        const legA_id = pendingBridges.get(payload.call_control_id);
        if (legA_id) {
          console.log(`[Bridge] Bridging Leg A ${legA_id} ↔ Leg B ${payload.call_control_id}`);
          await telnyxAPI(`/v2/calls/${payload.call_control_id}/actions/bridge`, {
            call_control_id: legA_id
          });
          pendingBridges.delete(payload.call_control_id);
        }
      }
      break;
    }

    case 'call.speak.ended': {
      const clientState = parseClientState(payload.client_state);
      if (clientState?.type === 'ivr_playing') {
        // IVR finished, now dial the agent
        await dialAgent(payload.call_control_id, payload.from, payload.to);
      }
      break;
    }

    case 'call.hangup': {
      // Clean up - important for preventing stale state
      console.log(`[Hangup] ${payload.call_control_id} reason: ${payload.hangup_cause}`);
      // Remove from pending bridges if applicable
      for (const [legB, legA] of pendingBridges.entries()) {
        if (legA === payload.call_control_id || legB === payload.call_control_id) {
          pendingBridges.delete(legB);
          // Hang up the other leg
          const otherLeg = legA === payload.call_control_id ? legB : legA;
          try {
            await telnyxAPI(`/v2/calls/${otherLeg}/actions/hangup`, {});
          } catch (e) { /* already hung up */ }
        }
      }
      break;
    }

    case 'call.bridged': {
      console.log(`[Bridged] Calls bridged successfully`);
      break;
    }
  }

  return new Response('OK', { status: 200 });
}

async function dialAgent(legA_call_control_id: string, callerFrom: string, callerTo: string) {
  console.log(`[Dial Agent] Creating Leg B to WebRTC agent`);

  // *** THIS IS THE KEY CALL ***
  // Use the CREDENTIAL CONNECTION's connection_id, NOT the CCA's
  const response = await telnyxAPI('/v2/calls', {
    connection_id: CREDENTIAL_CONNECTION_ID,  // ← CREDENTIAL CONNECTION, not CCA!
    to: AGENT_SIP_URI,
    from: callerTo,  // Show the DID as caller ID  
    from_display_name: `Call from ${callerFrom}`,
    timeout_secs: 30,
    client_state: Buffer.from(JSON.stringify({ type: 'webrtc_leg' })).toString('base64')
  });

  const legB_call_control_id = response.data.call_control_id;
  pendingBridges.set(legB_call_control_id, legA_call_control_id);
  console.log(`[Dial Agent] Leg B created: ${legB_call_control_id}`);
}

async function telnyxAPI(path: string, body: any) {
  const res = await fetch(`https://api.telnyx.com${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TELNYX_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`[Telnyx API Error] ${path}: ${res.status} ${err}`);
    throw new Error(`Telnyx API ${res.status}: ${err}`);
  }
  return res.json();
}

function parseClientState(encoded?: string): any {
  if (!encoded) return null;
  try {
    return JSON.parse(Buffer.from(encoded, 'base64').toString());
  } catch {
    return null;
  }
}
```

### Critical Detail: `connection_id` in `POST /v2/calls`

When creating Leg B (the call to the WebRTC client), you MUST use the **credential connection's** `connection_id`, NOT the Call Control Application's ID. The credential connection is what the WebRTC client is registered to. The CCA doesn't know how to route to SIP registrations on the credential connection.

```json
POST /v2/calls
{
  "connection_id": "<your-credential-connection-id>",  // ← CREDENTIAL CONNECTION ID
  "to": "sip:<your-agent-sip-username>@sip.telnyx.com",
  "from": "+15555550123",
  "timeout_secs": 30
}
```

**The webhook for Leg B events will go to the credential connection's webhook URL.** So you need EITHER:
1. Set `webhook_event_url` on the credential connection to the same webhook endpoint, OR  
2. Use `webhook_url` parameter in the `POST /v2/calls` request to override per-call:

```json
POST /v2/calls
{
  "connection_id": "<your-credential-connection-id>",
  "to": "sip:<your-agent-sip-username>@sip.telnyx.com",
  "from": "+15555550123",
  "webhook_url": "${process.env.NEXT_PUBLIC_APP_URL}/api/telnyx-webhook",
  "webhook_url_method": "POST",
  "timeout_secs": 30
}
```

This way both Leg A (from CCA) and Leg B (from credential connection) send events to the same webhook handler.

---

## Browser-Side Code (WebRTC Agent Softphone)

```typescript
// webrtc-agent.ts

import { TelnyxRTC } from '@telnyx/webrtc';

class AgentSoftphone {
  private client: TelnyxRTC | null = null;
  private currentCall: any = null;

  async connect() {
    // Authenticate with telephony credential's SIP username + password
    this.client = new TelnyxRTC({
      login: '<your-agent-sip-username>',
      password: 'YOUR_SIP_PASSWORD_HERE',  // The sip_password from the telephony credential
      // Optional: set ring/ringback files
      // ringtoneFile: '/sounds/ring.mp3',
    });

    // === EVENT HANDLERS ===

    // Connection state
    this.client.on('telnyx.ready', () => {
      console.log('[Agent] ✅ Registered and ready to receive calls');
      // At this point gateway state is REGED
    });

    this.client.on('telnyx.error', (error: any) => {
      console.error('[Agent] ❌ Error:', error);
    });

    this.client.on('telnyx.socket.close', () => {
      console.log('[Agent] Socket closed, reconnecting...');
      // Auto-reconnect after a delay
      setTimeout(() => this.connect(), 3000);
    });

    // === INBOUND CALL HANDLING ===
    this.client.on('telnyx.notification', (notification: any) => {
      console.log('[Agent] Notification:', notification.type);

      if (notification.type === 'callUpdate') {
        const call = notification.call;

        switch (call.state) {
          case 'ringing':
            console.log(`[Agent] 📞 Incoming call from ${call.options.callerName || call.options.callerNumber}`);
            this.currentCall = call;
            this.onIncomingCall(call);
            break;

          case 'active':
            console.log('[Agent] 🟢 Call active - two-way audio flowing');
            break;

          case 'hangup':
          case 'destroy':
            console.log('[Agent] 📴 Call ended');
            this.cleanupCall();
            break;
        }
      }
    });

    // Connect!
    this.client.connect();
  }

  private onIncomingCall(call: any) {
    // Auto-answer (for agent softphone, answer immediately)
    // Or show UI and let agent click "Answer"
    console.log('[Agent] Auto-answering...');
    call.answer();
  }

  // *** CRITICAL: Proper cleanup to prevent 486 on next call ***
  private cleanupCall() {
    if (this.currentCall) {
      try {
        // Ensure the call is fully hung up on our side
        if (this.currentCall.state !== 'hangup' && this.currentCall.state !== 'destroy') {
          this.currentCall.hangup();
        }
      } catch (e) {
        console.log('[Agent] Call already cleaned up');
      }
      this.currentCall = null;
    }
    console.log('[Agent] ✅ Ready for next call');
  }

  // Manual hangup (agent clicks "End Call")
  hangup() {
    if (this.currentCall) {
      this.currentCall.hangup();
      this.cleanupCall();
    }
  }

  // Disconnect entirely
  disconnect() {
    this.cleanupCall();
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
  }
}

// Usage
const softphone = new AgentSoftphone();
softphone.connect();
```

---

## Preventing 486 `user_busy` on Subsequent Calls

The 486 error occurs because the WebRTC client's SIP registration is seen as "busy" (already in a call). Causes and fixes:

### 1. Browser not cleaning up previous call
The `RTCPeerConnection` from the previous call lingers. Ensure `call.hangup()` is called AND the call object is dereferenced. The SDK should handle `BYE` automatically, but verify in browser console that no stale peer connections exist.

### 2. Server not hanging up Leg B properly
When Leg A (PSTN caller) hangs up, your webhook handler MUST also hang up Leg B:
```typescript
case 'call.hangup': {
  // Find and hang up the paired leg
  // (see server code above)
}
```

### 3. Race condition with rapid calls
Add a small delay (1-2 seconds) between detecting hangup and allowing the next `POST /v2/calls`. The SIP deregistration of the old session takes a moment.

### 4. Multiple browser tabs
If you have multiple tabs open with the same SIP credential, only the LAST one to register will receive calls (per the docs). Close all other tabs.

### 5. Use `call.hangup()` not `call.reject()`
`reject()` sends a 486 busy. For cleanup of completed calls, always use `hangup()`.

---

## Webhook Configuration Checklist

1. **CCA webhook** (`<your-call-control-app-id>`): `${process.env.NEXT_PUBLIC_APP_URL}/api/telnyx-webhook` — receives Leg A events
2. **Credential Connection** (`<your-credential-connection-id>`): EITHER set `webhook_event_url` to the same URL, OR always pass `webhook_url` in `POST /v2/calls`
3. Both legs' events should hit the SAME handler so you can correlate and bridge them

---

## Complete Flow (Step by Step)

1. **Browser agent** opens softphone page → `TelnyxRTC` connects with SIP credentials → gateway state = `REGED` → ready
2. **PSTN caller** dials `+15555550123`
3. **Telnyx** routes to CCA → webhook `call.initiated` (direction: incoming) to your server
4. **Server** answers Leg A → webhook `call.answered`
5. **Server** optionally plays IVR audio on Leg A
6. **Server** creates Leg B: `POST /v2/calls` with `connection_id` = credential connection, `to` = `sip:gencred...@sip.telnyx.com`
7. **Browser** receives inbound call notification → auto-answers
8. **Telnyx** sends `call.answered` webhook for Leg B
9. **Server** bridges: `POST /v2/calls/{legB}/actions/bridge` with `{ call_control_id: legA_id }`
10. **Two-way audio** flows between PSTN caller and browser agent
11. **Either party** hangs up → server receives `call.hangup` → hangs up the other leg
12. **Browser** cleans up call state → ready for next call

---

## Things I Could NOT Confirm from Docs

1. **Whether `POST /v2/calls` with a credential connection's `connection_id` actually routes to registered WebRTC clients** — The docs show Pattern 2 as the intended flow and show dialing `gencred...@sip.telnyx.com`, but the exact `POST /v2/calls` payload is not shown with a credential connection as `connection_id`. The demo app shows dialing between two WebRTC clients using the SIP URI. The API should work the same way.

2. **Whether `webhook_url` override works on `POST /v2/calls`** — Most Telnyx Call Control endpoints support this, but double-check the [Dial API reference](https://developers.telnyx.com/api-reference/call-control/call-commands/dial).

3. **Exact cause of your "Not Registered" issue** — Could be: expired telephony credential, wrong `connection_id` on the credential, network/firewall blocking WSS to `rtc.telnyx.com`, or browser not granting microphone permissions (SDK may wait for getUserMedia before completing registration).

---

## Debugging Tips

1. **Test registration first:** Open `https://webrtc.telnyx.com`, enter your SIP username/password, click Connect. Check that it shows `registered` in the log. If not, your credential is the problem.

2. **Test WebRTC-to-WebRTC first:** Open two tabs at `webrtc.telnyx.com` with two different telephony credentials on the same credential connection. Dial `gencredXXX@sip.telnyx.com` from one to the other. This isolates WebRTC from PSTN.

3. **Check credential expiry:** `GET /v2/telephony_credentials/<your-telephony-credential-id>` — verify `status` is not `expired`.

4. **Monitor browser console** for the WebSocket messages (especially `telnyx_rtc.clientReady` and gateway state `REGED`).

5. **Log all webhook events** with full payloads to debug the call flow.

---

## Alternative Approach: Phone Number on Credential Connection

If `POST /v2/calls` with the credential connection doesn't work as expected, there's a simpler approach documented in the [JS SDK Demo App](https://developers.telnyx.com/docs/voice/webrtc/js-sdk/demo-app):

> "Place an order with the desired phone number and the `connection_id` from [the credential connection]."

And from [SDK Commonalities](https://developers.telnyx.com/docs/voice/webrtc/sdk-commonalities):

> "Dialing registered client using phone number on the connection requires 'Destination Number Format' to be set as 'SIP Username' on the 'Inbound' setting of the same connection."

This means you could:
1. Move the phone number FROM the CCA TO the credential connection
2. Set the credential connection's inbound "Destination Number Format" to "SIP Username"  
3. When someone calls the number, it rings the registered WebRTC client directly

**However**, this removes your ability to do IVR/Call Control on the inbound call since the credential connection doesn't have CCA-style call control. You'd need to use Pattern 1 (client-driven with call parking) for any server-side logic.

For your use case (IVR → agent), **Pattern 2 with two legs and bridging is the correct approach.**
