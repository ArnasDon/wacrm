/**
 * Notification chime for new inbound messages — synthesized via the
 * Web Audio API rather than shipping an audio file, so there's no
 * asset to host/license and no network fetch on the hot path.
 *
 * A single shared AudioContext is reused across calls: browsers cap
 * the number of concurrent contexts, and repeatedly creating one per
 * message (e.g. several inbound messages arriving in a burst) risks
 * hitting that cap and silently failing.
 */

let sharedContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedContext) sharedContext = new Ctor();
  return sharedContext;
}

export function playNotificationSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  // Browsers suspend a newly-created (or backgrounded-tab) context
  // until a user gesture resumes it. Resuming is itself gated on a
  // gesture having happened at some point on the page — since this
  // only ever fires after the agent has already been using the inbox
  // (clicking, typing), that requirement is already satisfied.
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  const now = ctx.currentTime;
  // Two quick ascending notes read as a deliberate "message arrived"
  // chime rather than a flat, alarm-like single tone.
  const notes = [
    { freq: 880, start: 0, duration: 0.12 },
    { freq: 1108.73, start: 0.1, duration: 0.16 },
  ];

  for (const note of notes) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = note.freq;
    oscillator.connect(gain);
    gain.connect(ctx.destination);

    const start = now + note.start;
    const end = start + note.duration;
    // Fast attack + exponential decay avoids the click/pop a hard
    // on/off edge produces on the raw oscillator signal.
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.25, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    oscillator.start(start);
    oscillator.stop(end + 0.02);
  }
}
