import { describe, expect, it } from 'vitest';

import {
  describeMicError,
  extensionForMimeType,
  isWhatsAppReadyOgg,
  pickRecorderMimeType,
} from './voice-recording';

describe('pickRecorderMimeType', () => {
  it('prefers native Ogg/Opus when the browser supports it (Firefox)', () => {
    const picked = pickRecorderMimeType((mime) =>
      ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus'].includes(mime)
    );
    expect(picked).toBe('audio/ogg;codecs=opus');
  });

  it('falls back to WebM/Opus on the Chrome family', () => {
    const picked = pickRecorderMimeType((mime) =>
      ['audio/webm;codecs=opus', 'audio/mp4'].includes(mime)
    );
    expect(picked).toBe('audio/webm;codecs=opus');
  });

  it('falls back to MP4/AAC on Safari', () => {
    const picked = pickRecorderMimeType((mime) => mime === 'audio/mp4');
    expect(picked).toBe('audio/mp4');
  });

  it('returns null when nothing is supported', () => {
    expect(pickerNeverSupported()).toBeNull();
  });

  function pickerNeverSupported() {
    return pickRecorderMimeType(() => false);
  }
});

describe('extensionForMimeType', () => {
  it.each([
    ['audio/ogg;codecs=opus', 'ogg'],
    ['audio/ogg', 'ogg'],
    ['audio/webm;codecs=opus', 'webm'],
    ['audio/webm', 'webm'],
    ['audio/mp4', 'm4a'],
    ['audio/aac', 'm4a'],
    ['audio/mpeg', 'mp3'],
    ['audio/wav', 'wav'],
    ['audio/amr', 'amr'],
    ['application/octet-stream', 'bin'],
  ])('maps %s to %s', (mime, expected) => {
    expect(extensionForMimeType(mime)).toBe(expected);
  });
});

describe('isWhatsAppReadyOgg', () => {
  it('accepts Ogg variants regardless of codec parameters', () => {
    expect(isWhatsAppReadyOgg('audio/ogg')).toBe(true);
    expect(isWhatsAppReadyOgg('audio/ogg;codecs=opus')).toBe(true);
  });

  it('rejects containers that need a server transcode', () => {
    expect(isWhatsAppReadyOgg('audio/webm;codecs=opus')).toBe(false);
    expect(isWhatsAppReadyOgg('audio/mp4')).toBe(false);
    expect(isWhatsAppReadyOgg('video/webm')).toBe(false);
    expect(isWhatsAppReadyOgg('')).toBe(false);
  });
});

describe('describeMicError', () => {
  it.each([
    ['NotAllowedError', 'Microphone permission was denied'],
    ['PermissionDeniedError', 'Microphone permission was denied'],
    ['NotFoundError', 'No microphone was found'],
    ['NotReadableError', "busy or can't be started"],
    ['TrackStartError', "busy or can't be started"],
    ['OverconstrainedError', "doesn't support the requested recording mode"],
    ['AbortError', 'interrupted'],
    ['SecurityError', 'HTTPS'],
  ])('maps %s to an actionable message', (name, fragment) => {
    const error = new DOMException(`mock ${name}`, name);
    expect(describeMicError(error)).toContain(fragment);
  });

  it('surfaces plain Error messages verbatim', () => {
    expect(describeMicError(new Error('boom'))).toBe('Recording failed: boom');
  });

  it('has a generic fallback for non-Error throwables', () => {
    expect(describeMicError('weird')).toContain('Voice recording failed');
    expect(describeMicError(undefined)).toContain('Voice recording failed');
    // An object with a name we don't recognize falls through too.
    expect(describeMicError({ name: 'SomeNewError' })).toContain(
      'Voice recording failed'
    );
  });
});
