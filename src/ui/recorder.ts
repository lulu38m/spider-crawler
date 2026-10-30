/** Records the canvas (everything you see is drawn there, HUD and finale included). */
export class Recorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mime = '';
  startedAt = 0;

  static supported(): boolean {
    return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;
  }

  get recording(): boolean {
    return this.rec?.state === 'recording';
  }

  /** Prefer MP4 (what TikTok, Reels and Shorts want); fall back to WebM. */
  private pickMime(): string {
    const candidates = [
      'video/mp4;codecs=avc1.640028',
      'video/mp4;codecs=avc1.4d002a',
      'video/mp4;codecs=avc1.42E01E',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
  }

  start(canvas: HTMLCanvasElement, fps = 60): void {
    if (this.recording) return;
    const stream = canvas.captureStream(fps);
    this.mime = this.pickMime();
    const pixels = canvas.width * canvas.height;
    const bitrate = Math.round(Math.min(24_000_000, Math.max(6_000_000, pixels * 6)));
    this.rec = new MediaRecorder(stream, this.mime ? { mimeType: this.mime, videoBitsPerSecond: bitrate } : { videoBitsPerSecond: bitrate });
    this.chunks = [];
    this.rec.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.rec.start(250);
    this.startedAt = performance.now();
  }

  stop(): Promise<{ blob: Blob; extension: string }> {
    return new Promise((resolve, reject) => {
      const rec = this.rec;
      if (!rec) return reject(new Error('Not recording'));
      rec.onstop = () => {
        const type = this.mime || rec.mimeType || 'video/webm';
        const blob = new Blob(this.chunks, { type: type.split(';')[0] });
        this.rec = null;
        resolve({ blob, extension: type.includes('mp4') ? 'mp4' : 'webm' });
      };
      rec.stop();
      rec.stream.getTracks().forEach((t) => t.stop());
    });
  }
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
