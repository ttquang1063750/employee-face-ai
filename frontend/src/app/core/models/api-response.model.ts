// Generic wrapper matching the backend's consistent {success, data, error} JSON shape.
// Endpoint-specific extra fields (id, exists, message, ...) are optional add-ons.
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  id?: number;
  exists?: boolean;
}
