import { AbstractControl, ValidationErrors } from '@angular/forms';

// The rich text editor's "empty" state is still non-blank HTML (an empty
// <p></p>), so a plain truthy/trim check on the raw string — as used for the
// rest of this app's plain-text fields — always passes. Treat content as
// empty only when it has neither visible text nor an inserted image.
export function isRichContentEmpty(html: string | null | undefined): boolean {
  if (!html) return true;
  if (/<img\b/i.test(html)) return false;
  return html.replace(/<[^>]*>/g, '').trim().length === 0;
}

export function richContentRequiredValidator(control: AbstractControl): ValidationErrors | null {
  return isRichContentEmpty(control.value) ? { required: true } : null;
}

// Plain-text summary for table-cell previews (message templates list) —
// rendering raw HTML in a truncated cell would show literal tags or
// mis-sized inline images, so strip markup down to its text content instead.
export function stripRichContentPreview(html: string | null | undefined): string {
  if (!html) return '';
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text) return text;
  return /<img\b/i.test(html) ? '[Hình ảnh]' : '';
}
