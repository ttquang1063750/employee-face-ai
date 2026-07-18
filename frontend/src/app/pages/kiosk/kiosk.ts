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
import { WebcamCaptureService } from '../../core/services/webcam-capture.service';

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
  providers: [WebcamCaptureService],
})
export class KioskComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private webcam = inject(WebcamCaptureService);

  videoElement = viewChild<ElementRef<HTMLVideoElement>>('videoElement');
  canvasElement = viewChild<ElementRef<HTMLCanvasElement>>('canvasElement');

  currentAction = signal<'CHECK_IN' | 'CHECK_OUT'>('CHECK_IN');
  detector = signal<string>('retinaface');

  isLoading = signal<boolean>(false);
  statusMsg = signal<string | null>(null);
  isSuccess = signal<boolean>(false);
  resultData = signal<AttendanceResult | null>(null);

  // The scan is a single instant snapshot, not a continuous live scan — this
  // freezes that captured frame over the video feed (plus a brief flash) so
  // it's visually obvious the photo is already taken and the user doesn't
  // need to keep holding still while the request is in flight.
  capturedFrame = signal<string | null>(null);
  showFlash = signal<boolean>(false);

  private readonly apiUrl = 'http://localhost:8000/api';

  ngOnInit(): void {
    this.startCamera();
  }

  ngOnDestroy(): void {
    this.stopCamera();
  }

  async startCamera(): Promise<void> {
    try {
      const stream = await this.webcam.start({ width: 640, height: 480 });
      if (this.videoElement()) {
        this.videoElement()!.nativeElement.srcObject = stream;
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
    this.webcam.stop();
  }

  selectAction(action: 'CHECK_IN' | 'CHECK_OUT'): void {
    this.currentAction.set(action);
  }

  submitAttendance(): void {
    if (!this.webcam.isActive) {
      alert('Camera chưa sẵn sàng!');
      return;
    }

    this.isLoading.set(true);
    this.statusMsg.set(null);
    this.resultData.set(null);

    const video = this.videoElement()!.nativeElement;
    const canvas = this.canvasElement()!.nativeElement;
    const base64Data = this.webcam.capture(video, canvas);

    if (base64Data) {
      this.capturedFrame.set(base64Data);
      this.showFlash.set(true);
      setTimeout(() => this.showFlash.set(false), 250);

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
            this.capturedFrame.set(null);

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
            this.capturedFrame.set(null);
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
