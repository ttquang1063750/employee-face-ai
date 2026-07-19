import { SERVER_BASE_URL } from '../config/api.config';

const FALLBACK_AVATAR =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2394a3b8"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>';

/** Builds the full URL for an employee's reference photo served under `database/`. */
export function avatarUrl(imagePath: string | undefined | null): string {
  return `${SERVER_BASE_URL}/${imagePath ?? ''}`;
}

/** Swaps a broken employee avatar `<img>` for a neutral placeholder icon. */
export function onImageError(event: Event): void {
  const target = event.target as HTMLImageElement;
  if (target) {
    target.src = FALLBACK_AVATAR;
  }
}
