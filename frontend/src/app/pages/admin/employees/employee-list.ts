import { Component, OnInit, signal, computed, ElementRef, viewChild, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DialogService } from '../../../core/services/dialog.service';

export interface EmployeeBase {
  id: number;
  name: string;
  age: number;
  image_path: string;
  role: string;
  current_position: string;
}

@Component({
  selector: 'app-employee-list',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './employee-list.html',
  styleUrl: './employee-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EmployeeListComponent implements OnInit {
  videoElement = viewChild<ElementRef<HTMLVideoElement>>('videoElement');
  canvasElement = viewChild<ElementRef<HTMLCanvasElement>>('canvasElement');

  employees = signal<EmployeeBase[]>([]);
  searchQuery = signal<string>('');
  isLoading = signal<boolean>(true);
  errorMsg = signal<string | null>(null);

  // Modal and Form States
  showAddModal = signal<boolean>(false);
  isSubmitting = signal<boolean>(false);
  
  // New Employee Form Signals
  newName = signal<string>('');
  newAge = signal<number>(28);
  newRole = signal<'staff' | 'admin'>('staff');
  newPassword = signal<string>('');
  newPosition = signal<string>('');
  newIncome = signal<number>(3000);
  newSkills = signal<string>(''); // formatted as "Skill: Desc, Skill2: Desc"
  newProjects = signal<string>(''); // formatted as "Name: Role: Desc"
  imgBase64 = signal<string>('');
  
  // Webcam States for modal registration
  showWebcam = signal<boolean>(false);
  private webcamStream: MediaStream | null = null;

  // Pagination for employee list
  currentPage = signal<number>(1);
  pageSize = signal<number>(8);

  // Filtered employees list
  filteredEmployees = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return this.employees();
    return this.employees().filter(e => 
      e.name.toLowerCase().includes(q) || 
      e.current_position.toLowerCase().includes(q) ||
      e.id.toString() === q
    );
  });

  // Computed: Pagination properties
  totalPages = computed(() => {
    const len = this.filteredEmployees().length;
    return Math.ceil(len / this.pageSize()) || 1;
  });

  paginatedEmployees = computed(() => {
    let page = this.currentPage();
    const total = this.totalPages();
    if (page > total) {
      page = total;
    }
    const start = (page - 1) * this.pageSize();
    return this.filteredEmployees().slice(start, start + this.pageSize());
  });

  private readonly apiUrl = 'http://localhost:8000/api';

  constructor(
    private http: HttpClient,
    private dialogService: DialogService
  ) {}

  ngOnInit(): void {
    this.loadEmployees();
  }

  loadEmployees(): void {
    this.isLoading.set(true);
    this.errorMsg.set(null);

    this.http.get<any>(`${this.apiUrl}/employees`).subscribe({
      next: (res) => {
        this.isLoading.set(false);
        if (res.success) {
          this.employees.set(res.data);
        }
      },
      error: (err) => {
        this.isLoading.set(false);
        this.errorMsg.set('Không thể kết nối đến máy chủ để lấy danh sách nhân sự.');
      }
    });
  }

  prevPage(): void {
    if (this.currentPage() > 1) {
      this.currentPage.update(p => p - 1);
    }
  }

  nextPage(): void {
    if (this.currentPage() < this.totalPages()) {
      this.currentPage.update(p => p + 1);
    }
  }

  openAddModal(): void {
    this.resetForm();
    this.showAddModal.set(true);
  }

  closeAddModal(): void {
    this.stopWebcam();
    this.showAddModal.set(false);
  }

  resetForm(): void {
    this.newName.set('');
    this.newAge.set(28);
    this.newRole.set('staff');
    this.newPassword.set('');
    this.newPosition.set('');
    this.newIncome.set(3000);
    this.newSkills.set('');
    this.newProjects.set('');
    this.imgBase64.set('');
    this.showWebcam.set(false);
  }

  async startWebcam(): Promise<void> {
    this.showWebcam.set(true);
    try {
      this.webcamStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 400, height: 300, facingMode: 'user' }
      });
      setTimeout(() => {
        if (this.videoElement()) {
          this.videoElement()!.nativeElement.srcObject = this.webcamStream;
        }
      }, 100);
    } catch (err: any) {
      this.dialogService.alert('LỖI CAMERA', 'Không thể khởi chạy camera: ' + err.message);
      this.showWebcam.set(false);
    }
  }

  stopWebcam(): void {
    if (this.webcamStream) {
      this.webcamStream.getTracks().forEach(track => track.stop());
      this.webcamStream = null;
    }
    this.showWebcam.set(false);
  }

  capturePhoto(): void {
    if (!this.webcamStream) return;
    const video = this.videoElement()!.nativeElement;
    const canvas = this.canvasElement()!.nativeElement;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      canvas.width = 400;
      canvas.height = 300;
      
      // Mirror the webcam frame during snapshot
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // Reset transform
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      this.imgBase64.set(canvas.toDataURL('image/jpeg', 0.95));
      this.stopWebcam();
    }
  }

  triggerFileInput(): void {
    const fileInput = document.getElementById('employee-file-input') as HTMLInputElement;
    if (fileInput) fileInput.click();
  }

  handleFileUpload(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        this.imgBase64.set(e.target.result);
      };
      reader.readAsDataURL(input.files[0]);
    }
  }

  async submitEmployee(): Promise<void> {
    if (!this.newName() || !this.imgBase64()) {
      await this.dialogService.alert('THIẾU THÔNG TIN', 'Vui lòng điền tên và chụp/tải lên ảnh chân dung mẫu.');
      return;
    }

    this.isSubmitting.set(true);

    // Parse skills: e.g. "Angular: Expert state management, ROS: Robotics control"
    const parsedSkills = this.newSkills().split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(s => {
        const parts = s.split(':');
        return {
          skill_name: parts[0]?.trim() || '',
          description: parts[1]?.trim() || 'No description provided'
        };
      })
      .filter(sk => sk.skill_name.length > 0);

    // Parse projects: e.g. "Project Name: Role in project: Project description details"
    const parsedProjects = this.newProjects().split(',')
      .map(p => p.trim())
      .filter(p => p.length > 0)
      .map(p => {
        const parts = p.split(':');
        return {
          project_name: parts[0]?.trim() || '',
          role: parts[1]?.trim() || 'Contributor',
          description: parts[2]?.trim() || 'No description provided'
        };
      })
      .filter(pr => pr.project_name.length > 0);

    const payload = {
      name: this.newName(),
      age: this.newAge(),
      role: this.newRole(),
      password: this.newRole() === 'admin' ? this.newPassword() : null,
      img: this.imgBase64(),
      position: this.newPosition() || 'Developer',
      income: this.newIncome(),
      skills: parsedSkills,
      projects: parsedProjects
    };

    this.http.post<any>(`${this.apiUrl}/employees`, payload).subscribe({
      next: async (res) => {
        this.isSubmitting.set(false);
        if (res.success) {
          await this.dialogService.alert('ĐĂNG KÝ THÀNH CÔNG', 'Đăng ký tài khoản nhân sự mới thành công.');
          this.closeAddModal();
          this.loadEmployees();
        }
      },
      error: async (err) => {
        this.isSubmitting.set(false);
        await this.dialogService.alert('LỖI ĐĂNG KÝ', 'Lỗi đăng ký: ' + (err.error?.error || err.message));
      }
    });
  }

  async deleteEmployee(id: number, name: string): Promise<void> {
    const confirmed = await this.dialogService.confirm(
      'XÁC NHẬN XÓA NHÂN SỰ',
      `Bạn có chắc chắn muốn xóa hồ sơ nhân sự của "${name}" (Mã: #${id})? Hành động này sẽ xóa vĩnh viễn dữ liệu chấm công liên quan.`
    );
    if (confirmed) {
      this.http.delete<any>(`${this.apiUrl}/employees/${id}`).subscribe({
        next: async (res) => {
          if (res.success) {
            await this.dialogService.alert('XÓA THÀNH CÔNG', 'Đã xóa hồ sơ nhân sự thành công.');
            this.loadEmployees();
          }
        },
        error: async (err) => {
          await this.dialogService.alert('LỖI XÓA HỒ SƠ', 'Lỗi xóa nhân viên: ' + (err.error?.error || err.message));
        }
      });
    }
  }

  onImageError(event: Event): void {
    const target = event.target as HTMLImageElement;
    if (target) {
      target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2394a3b8"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>';
    }
  }

}
