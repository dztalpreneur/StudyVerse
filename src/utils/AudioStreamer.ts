// AudioStreamer.ts
// Decoupled raw Web Audio API handling for browser microphone (PCM16 16kHz) and response speaker queue (24kHz)

export class AudioStreamer {
  private micCtx: AudioContext | null = null;
  private playbackCtx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private micStream: MediaStream | null = null;
  private playbackAnalyser: AnalyserNode | null = null;
  
  private activeSources: AudioBufferSourceNode[] = [];
  private nextStartTime = 0;
  private userVolSmoothed = 0;
  private playbackVolSmoothed = 0;
  private onUserVolumeChange: ((vol: number) => void) | null = null;

  constructor() {}

  // Lazily initialize playback context at 24000Hz (for response audio streaming)
  public async initPlaybackContext(): Promise<AudioContext> {
    if (!this.playbackCtx || this.playbackCtx.state === "closed") {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      this.playbackCtx = new AudioCtxClass();
    }
    if (this.playbackCtx.state === "suspended") {
      await this.playbackCtx.resume();
    }
    if (!this.playbackAnalyser) {
      this.playbackAnalyser = this.playbackCtx.createAnalyser();
      this.playbackAnalyser.fftSize = 256;
      this.playbackAnalyser.connect(this.playbackCtx.destination);
    }
    return this.playbackCtx;
  }

  // Decodes raw base64 PCM16 data and schedules it for chunk-by-chunk low-latency gapless playback
  public async playAudioChunk(base64PCM: string, onEnded?: () => void) {
    try {
      const ctx = await this.initPlaybackContext();
      
      const binary = atob(base64PCM);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      
      const float32Data = this.pcm16ToFloat32(bytes.buffer);
      
      // The model responds at exactly 24000Hz
      const audioBuffer = ctx.createBuffer(1, float32Data.length, 24000);
      audioBuffer.getChannelData(0).set(float32Data);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      
      if (this.playbackAnalyser) {
        source.connect(this.playbackAnalyser);
      } else {
        source.connect(ctx.destination);
      }

      const currentTime = ctx.currentTime;
      if (this.nextStartTime < currentTime) {
        this.nextStartTime = currentTime + 0.05; // 50ms smoothing buffer
      }

      source.start(this.nextStartTime);
      this.activeSources.push(source);

      source.onended = () => {
        this.activeSources = this.activeSources.filter((s) => s !== source);
        if (onEnded) {
          onEnded();
        }
      };

      this.nextStartTime += audioBuffer.duration;
    } catch (err) {
      console.error("[AudioStreamer] Error playing audio chunk:", err);
    }
  }

  // Instantly halts playback and clears active buffer schedules
  public stopPlayback() {
    this.activeSources.forEach((src) => {
      try {
        src.stop();
      } catch (e) {
        // Safe check
      }
    });
    this.activeSources = [];
    this.nextStartTime = 0;
    this.playbackVolSmoothed = 0;
  }

  // Initialize and begin capturing microphone input resampled to PCM16 at 16000Hz
  public async startRecording(
    onAudioChunk: (base64PCM: string) => void,
    onUserVolume?: (vol: number) => void
  ): Promise<void> {
    this.stopRecording();
    this.onUserVolumeChange = onUserVolume || null;

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      // Setup recording Context at 16000Hz corresponding to Gemini Live requirement
      this.micCtx = new AudioCtxClass({ sampleRate: 16000 });
      if (this.micCtx.state === "suspended") {
        await this.micCtx.resume();
      }

      const sourceNode = this.micCtx.createMediaStreamSource(this.micStream);
      this.processor = this.micCtx.createScriptProcessor(2048, 1, 1);
      sourceNode.connect(this.processor);
      this.processor.connect(this.micCtx.destination);

      this.processor.onaudioprocess = (e) => {
        const floatData = e.inputBuffer.getChannelData(0);

        // Measure Mic dynamic RMS volume
        let sum = 0;
        for (let i = 0; i < floatData.length; i++) {
          sum += floatData[i] * floatData[i];
        }
        const rms = Math.sqrt(sum / floatData.length);
        this.userVolSmoothed = this.userVolSmoothed * 0.75 + rms * 0.25;
        if (this.onUserVolumeChange) {
          this.onUserVolumeChange(this.userVolSmoothed);
        }

        // Convert standard Float32 to Int16 PCM array buffer
        const pcm16Buffer = new Int16Array(floatData.length);
        for (let i = 0; i < floatData.length; i++) {
          const sample = Math.max(-1, Math.min(1, floatData[i]));
          pcm16Buffer[i] = sample < 0 ? sample * 32768 : sample * 32767;
        }

        // Send base64 back as chunks
        const base64Str = this.arrayBufferToBase64(pcm16Buffer.buffer);
        onAudioChunk(base64Str);
      };
    } catch (err) {
      this.stopRecording();
      throw err;
    }
  }

  // Halts microphone recording and destroys context
  public stopRecording() {
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop());
      this.micStream = null;
    }
    if (this.processor) {
      try {
        this.processor.disconnect();
      } catch (e) {}
      this.processor = null;
    }
    if (this.micCtx) {
      try {
        this.micCtx.close();
      } catch (e) {}
      this.micCtx = null;
    }
    this.userVolSmoothed = 0;
    if (this.onUserVolumeChange) {
      this.onUserVolumeChange(0);
    }
  }

  // Inspect real-time speaking speaker node spectral volume via AnalyserNode
  public getPlaybackVolume(): number {
    if (!this.playbackAnalyser || this.activeSources.length === 0) {
      return 0;
    }
    const bufferLength = 128;
    const dataArray = new Uint8Array(bufferLength);
    this.playbackAnalyser.getByteTimeDomainData(dataArray);

    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      const v = (dataArray[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / bufferLength);
    this.playbackVolSmoothed = this.playbackVolSmoothed * 0.75 + rms * 0.25;
    return this.playbackVolSmoothed > 0.002 ? this.playbackVolSmoothed : 0;
  }

  // Helper conversions
  private pcm16ToFloat32(buffer: ArrayBuffer): Float32Array {
    const view = new DataView(buffer);
    const length = buffer.byteLength / 2;
    const result = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const val = view.getInt16(i * 2, true);
      result[i] = val / 32768.0;
    }
    return result;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  // Completely shutdown and clean up AudioStreamer references
  public destroy() {
    this.stopPlayback();
    this.stopRecording();
    if (this.playbackCtx) {
      try {
        this.playbackCtx.close();
      } catch (e) {}
      this.playbackCtx = null;
    }
    this.playbackAnalyser = null;
  }
}
