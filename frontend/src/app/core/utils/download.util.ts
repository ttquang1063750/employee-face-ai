/** Triggers a browser "Save As" download of a Blob via a detached, synthetic
 * anchor click — the same approach `dashboard.ts`'s CSV export already used
 * before this was extracted, now shared with the documents feature's file
 * downloads too. */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
