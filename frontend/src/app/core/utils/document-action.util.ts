import { HttpClient } from '@angular/common/http';
import { EmployeeDocument } from '../models/document.model';
import { triggerBlobDownload } from './download.util';

/** Opens/downloads an `EmployeeDocument` depending on its source — shared by
 * the admin documents list and the staff profile's own-documents panel
 * (previously each hand-rolled the same blob-fetch download, see rule 22).
 * A `source_type: 'link'` document has no local file to fetch: it's opened
 * directly as a new tab (`noopener,noreferrer` — this is otherwise-arbitrary
 * content pasted by an admin, the same tabnabbing-prevention reflex every
 * external link deserves). There's no Angular/RxJS equivalent to `window.open` — a
 * raw browser API, not a DOM query/listener, so this isn't covered by rule
 * 29 (same sanctioned-native-API shape as `WebcamCaptureService`'s
 * `getUserMedia`). */
export function openEmployeeDocument(
  http: HttpClient,
  apiUrl: string,
  doc: EmployeeDocument,
  onError: () => void,
): void {
  if (doc.source_type === 'link') {
    if (doc.external_url) {
      window.open(doc.external_url, '_blank', 'noopener,noreferrer');
    }
    return;
  }

  http.get(`${apiUrl}/documents/${doc.id}/download`, { responseType: 'blob' }).subscribe({
    next: (blob) => triggerBlobDownload(blob, doc.file_name || doc.title),
    error: onError,
  });
}
