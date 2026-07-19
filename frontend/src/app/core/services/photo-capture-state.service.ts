import { Injectable, Signal, ElementRef, signal, inject } from '@angular/core';
import { WebcamCaptureService, readFileAsBase64 } from './webcam-capture.service';
import { DialogService } from './dialog.service';

interface PhotoCaptureRefs {
  videoElement: Signal<ElementRef<HTMLVideoElement> | undefined>;
  canvasElement: Signal<ElementRef<HTMLCanvasElement> | undefined>;
  fileInputElement: Signal<ElementRef<HTMLInputElement> | undefined>;
}

/**
 * Owns the "capture a portrait photo via webcam or file upload, stage it as
 * base64" flow shared by every avatar/registration capture UI
 * (`employee-list`'s new-employee form, `base-profile-modal`'s and
 * `staff-profile`'s avatar-change modals). Provide this per-component
 * (`providers: [...]` in `@Component`, alongside `WebcamCaptureService`),
 * never `providedIn: 'root'` — each capture flow needs its own staged
 * `imgBase64`/`showWebcam` state, not one shared across every page.
 *
 * `viewChild()` refs can only be declared on the host component itself, so
 * call `configure()` once (typically in the constructor) with the video/
 * canvas/file-input viewChild signals for this page.
 */
@Injectable()
export class PhotoCaptureStateService {
  private webcam = inject(WebcamCaptureService);
  private dialogService = inject(DialogService);

  private refs: PhotoCaptureRefs = {
    videoElement: signal(undefined),
    canvasElement: signal(undefined),
    fileInputElement: signal(undefined),
  };

  configure(refs: PhotoCaptureRefs): void {
    this.refs = refs;
  }

  imgBase64 = signal<string>('');
  showWebcam = signal<boolean>(false);

  reset(): void {
    this.imgBase64.set('');
    this.showWebcam.set(false);
  }

  async startWebcam(): Promise<void> {
    this.showWebcam.set(true);
    try {
      const stream = await this.webcam.start();
      setTimeout(() => {
        const video = this.refs.videoElement();
        if (video) {
          video.nativeElement.srcObject = stream;
        }
      }, 100);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.dialogService.alert('LỖI CAMERA', 'Không thể khởi chạy camera: ' + message);
      this.showWebcam.set(false);
    }
  }

  stopWebcam(): void {
    this.webcam.stop();
    this.showWebcam.set(false);
  }

  capturePhoto(): void {
    const video = this.refs.videoElement()?.nativeElement;
    const canvas = this.refs.canvasElement()?.nativeElement;
    if (!video || !canvas) return;
    const dataUrl = this.webcam.capture(video, canvas, { width: 400, height: 300, quality: 0.95 });
    if (dataUrl) {
      this.imgBase64.set(dataUrl);
      this.stopWebcam();
    }
  }

  triggerFileInput(): void {
    this.refs.fileInputElement()?.nativeElement.click();
  }

  async handleFileUpload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.imgBase64.set(await readFileAsBase64(input.files[0]));
    }
  }
}
