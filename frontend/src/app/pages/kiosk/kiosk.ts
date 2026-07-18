import { Component, OnInit, OnDestroy, ElementRef, viewChild, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

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
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class KioskComponent implements OnInit, OnDestroy {
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

  constructor(private http: HttpClient) {}

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
        audio: false
      });
      if (this.videoElement()) {
        this.videoElement()!.nativeElement.srcObject = this.stream;
      }
    } catch (err: any) {
      console.error('Error starting webcam:', err);
      this.statusMsg.set(`⚠️ Không thể truy cập Camera: ${err.message}. Vui lòng cấp quyền truy cập camera.`);
      this.isSuccess.set(false);
    }
  }

  stopCamera(): void {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
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
      
      this.http.post<any>(`${this.apiUrl}/attendance`, {
        img: base64Data,
        action: this.currentAction(),
        detector_backend: this.detector()
      }).subscribe({
        next: (res) => {
          this.isLoading.set(false);
          this.isSuccess.set(true);
          this.resultData.set(res.data);
          
          // Clear status after 10 seconds automatically
          setTimeout(() => {
            if (this.resultData() === res.data) {
              this.resultData.set(null);
            }
          }, 12000);
        },
        error: (err) => {
          this.isLoading.set(false);
          this.isSuccess.set(false);
          if (err.error && err.error.error) {
            this.statusMsg.set(err.error.error);
          } else {
            this.statusMsg.set('Lỗi kết nối máy chủ hoặc lỗi nhận diện.');
          }
        }
      });
    }
  }
}
