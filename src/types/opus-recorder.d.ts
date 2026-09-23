// `opus-recorder` ships no type declarations. We use a small subset of its
// API: construct a Recorder, start()/stop(), and receive the encoded
// Ogg/Opus file via `ondataavailable`. See https://github.com/chris-rudmin/opus-recorder
declare module 'opus-recorder' {
  interface RecorderConfig {
    /** URL of the encoder worker (served from /public). */
    encoderPath?: string;
    /** Media track constraints, or `true` for default audio. */
    mediaTrackConstraints?: MediaTrackConstraints | boolean;
    /** 1 = mono, 2 = stereo. */
    numberOfChannels?: number;
    /** 2048 = Voice, 2049 = Full Band Audio, 2051 = Restricted Low Delay. */
    encoderApplication?: number;
    /** 8000 | 12000 | 16000 | 24000 | 48000. */
    encoderSampleRate?: number;
    /** Target bitrate in bits/sec. */
    encoderBitRate?: number;
    /** When false (default), ondataavailable fires once with the full file. */
    streamPages?: boolean;
  }

  export default class Recorder {
    constructor(config?: RecorderConfig);
    /** Fired with the encoded audio bytes (full Ogg/Opus file when streamPages is false). */
    ondataavailable: ((data: Uint8Array) => void) | null;
    start(): Promise<void>;
    stop(): Promise<void>;
    /** Browser support probe exposed as a static on the class. */
    static isRecordingSupported(): boolean;
  }
}
