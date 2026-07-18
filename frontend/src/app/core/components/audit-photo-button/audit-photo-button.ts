import { Component, OnDestroy, ChangeDetectionStrategy, signal, input, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

/**
 * Views a check-in/check-out audit photo (`logs/*.jpg`, admin-only) on
 * demand. The endpoint requires a Bearer token, which a plain `<img src>`
 * can't attach, so this fetches the JPEG via HttpClient (the auth
 * interceptor adds the header) as a Blob and displays it as an object URL
 * in a lightbox instead of eagerly loading a thumbnail for every row.
 */
@Component({
  selector: 'app-audit-photo-button',
  standalone: true,
  imports: [],
  templateUrl: './audit-photo-button.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuditPhotoButtonComponent implements OnDestroy {
  private http = inject(HttpClient);
  private readonly baseUrl = 'http://localhost:8000';

  imagePath = input<string | undefined>();

  isLoading = signal(false);
  photoUrl = signal<string | null>(null);
  loadFailed = signal(false);

  view(): void {
    const path = this.imagePath();
    if (!path || this.isLoading()) return;

    this.isLoading.set(true);
    this.loadFailed.set(false);
    this.http.get(`${this.baseUrl}/${path}`, { responseType: 'blob' }).subscribe({
      next: (blob) => {
        this.isLoading.set(false);
        this.photoUrl.set(URL.createObjectURL(blob));
      },
      error: () => {
        this.isLoading.set(false);
        this.loadFailed.set(true);
      },
    });
  }

  close(): void {
    this.revokeUrl();
    this.photoUrl.set(null);
  }

  ngOnDestroy(): void {
    this.revokeUrl();
  }

  private revokeUrl(): void {
    const url = this.photoUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
  }
}
