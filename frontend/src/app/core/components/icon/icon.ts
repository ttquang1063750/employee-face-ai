import {
  Component,
  computed,
  inject,
  input,
  ChangeDetectionStrategy,
  ElementRef,
  AfterViewInit,
  signal,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

// Shared line-icon set (24x24, stroke-based) used in place of emoji across
// nav links, page titles, and section headers. Add new shapes here rather
// than inlining raw <svg> markup at each call site.
const ICON_PATHS = {
  'chart-bar':
    '<line x1="4" y1="20" x2="4" y2="12"></line><line x1="10" y1="20" x2="10" y2="6"></line><line x1="16" y1="20" x2="16" y2="10"></line><line x1="22" y1="20" x2="22" y2="3"></line>',
  users:
    '<path d="M17 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 5 18.5V20"></path><circle cx="9.5" cy="7.5" r="3.5"></circle><path d="M19 20v-1.5a3.5 3.5 0 0 0-2.5-3.36"></path><path d="M14.5 4.13a3.5 3.5 0 0 1 0 6.74"></path>',
  'calendar-check':
    '<rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="16" y1="2" x2="16" y2="6"></line><path d="M8 14l2.5 2.5L16 11"></path>',
  document:
    '<path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"></path><path d="M14 3v4h4"></path><line x1="9" y1="12" x2="15" y2="12"></line><line x1="9" y1="16" x2="15" y2="16"></line>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"></rect><path d="M2 6l10 7 10-7"></path>',
  archive:
    '<path d="M3 7l3-4h12l3 4"></path><rect x="3" y="7" width="18" height="13" rx="1"></rect><path d="M3 7h18"></path><path d="M10 11h4"></path>',
  pencil: '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path>',
  'arrow-left':
    '<line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline>',
  upload:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line>',
  download:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>',
  list: '<path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1z"></path><rect x="5" y="6" width="14" height="16" rx="1"></rect><line x1="9" y1="12" x2="15" y2="12"></line><line x1="9" y1="16" x2="15" y2="16"></line>',
} as const;

export type IconName = keyof typeof ICON_PATHS;

@Component({
  selector: 'app-icon',
  standalone: true,
  templateUrl: './icon.html',
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IconComponent implements AfterViewInit {
  private sanitizer = inject(DomSanitizer);
  private host = inject(ElementRef);
  protected readonly iconName = signal<string>('');

  ngAfterViewInit() {
    const iconName = this.host.nativeElement.textContent?.trim() || '';
    if (iconName) {
      this.iconName.set(iconName);
    }
  }

  // Static, developer-authored path data (never user content) — safe to
  // bypass sanitization, unlike message/template rich content elsewhere.
  svgContent = computed<SafeHtml>(() => {
    const iconName = this.iconName() as IconName;
    if (iconName) {
      return this.sanitizer.bypassSecurityTrustHtml(ICON_PATHS[iconName]);
    }

    return '';
  });
}
