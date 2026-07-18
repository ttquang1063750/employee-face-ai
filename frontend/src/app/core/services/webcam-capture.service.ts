import { Injectable } from '@angular/core';

export interface WebcamStartOptions {
  width?: number;
  height?: number;
  facingMode?: string;
  audio?: boolean;
}

export interface WebcamCaptureOptions {
  width?: number;
  height?: number;
  quality?: number;
}

/**
 * Owns a single MediaStream for a component's webcam capture flow (start /
 * stop / mirrored snapshot). Provide this per-component (`providers: [...]`
 * in `@Component`), never `providedIn: 'root'` — each active webcam session
 * needs its own stream, not one shared across every page that uses a camera.
 */
@Injectable()
export class WebcamCaptureService {
  private stream: MediaStream | null = null;

  get isActive(): boolean {
    return this.stream !== null;
  }

  async start(options?: WebcamStartOptions): Promise<MediaStream> {
    const { width = 400, height = 300, facingMode = 'user', audio = false } = options ?? {};
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width, height, facingMode },
      audio,
    });
    return this.stream;
  }

  stop(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  capture(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    options?: WebcamCaptureOptions,
  ): string | null {
    if (!this.stream) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    canvas.width = options?.width ?? video.videoWidth;
    canvas.height = options?.height ?? video.videoHeight;

    // Mirror the webcam frame during snapshot
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    return canvas.toDataURL('image/jpeg', options?.quality);
  }
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e: ProgressEvent<FileReader>) => resolve(e.target?.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
