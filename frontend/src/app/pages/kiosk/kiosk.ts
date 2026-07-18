import {
  Component,
  OnInit,
  OnDestroy,
  ElementRef,
  viewChild,
  signal,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ApiResponse } from '../../core/models/api-response.model';

export interface AttendanceResult {
  employee_name: string;
  action: string;
  mood: string;
  time: string;
}

@Component({
  selector: 'app-kiosk',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './kiosk.html',
  styleUrl: './kiosk.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KioskComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);

  videoElement = viewChild<ElementRef<HTMLVideoElement>>('videoElement');
  canvasElement = viewChild<ElementRef<HTMLCanvasElement>>('canvasElement');

  currentAction = signal<'CHECK_IN' | 'CHECK_OUT'>('CHECK_IN');
  detector = signal<string>('retinaface');

  isLoading = signal<boolean>(false);
  statusMsg = signal<string | null>(null);
  isSuccess = signal<boolean>(false);
  resultData = signal<AttendanceResult | null>(null);

  private stream: MediaStream | null = null;
  private readonly apiUrl = 'http://localhost:8000/api';

  ngOnInit(): void {
    this.startCamera();
  }

  ngOnDestroy(): void {
    this.stopCamera();
  }

  async startCamera(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });
      if (this.videoElement()) {
        this.videoElement()!.nativeElement.srcObject = this.stream;
      }
    } catch (err) {
      console.error('Error starting webcam:', err);
      const message = err instanceof Error ? err.message : String(err);
      this.statusMsg.set(
        `⚠️ Không thể truy cập Camera: ${message}. Vui lòng cấp quyền truy cập camera.`,
      );
      this.isSuccess.set(false);
    }
  }

  stopCamera(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
  }

  selectAction(action: 'CHECK_IN' | 'CHECK_OUT'): void {
    this.currentAction.set(action);
  }

  submitAttendance(): void {
    if (!this.stream) {
      alert('Camera chưa sẵn sàng!');
      return;
    }

    this.isLoading.set(true);
    this.statusMsg.set(null);
    this.resultData.set(null);

    const video = this.videoElement()!.nativeElement;
    const canvas = this.canvasElement()!.nativeElement;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      // Mirror image capture
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const base64Data = canvas.toDataURL('image/jpeg');

      this.http
        .post<ApiResponse<AttendanceResult>>(`${this.apiUrl}/attendance`, {
          img: base64Data,
          action: this.currentAction(),
          detector_backend: this.detector(),
        })
        .subscribe({
          next: (res) => {
            this.isLoading.set(false);
            this.isSuccess.set(true);
            this.resultData.set(res.data ?? null);

            // Clear status after 10 seconds automatically
            setTimeout(() => {
              if (this.resultData() === res.data) {
                this.resultData.set(null);
              }
            }, 12000);
          },
          error: (err: HttpErrorResponse) => {
            this.isLoading.set(false);
            this.isSuccess.set(false);
            if (err.error && err.error.error) {
              this.statusMsg.set(err.error.error);
            } else {
              this.statusMsg.set('Lỗi kết nối máy chủ hoặc lỗi nhận diện.');
            }
          },
        });
    }
  }
}
