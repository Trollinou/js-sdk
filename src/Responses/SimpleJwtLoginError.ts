/**
 * Error response returned by the plugin.
 *
 * @note Since plugin v4.0.0, `errorCode` was renamed to `error_code`.
 */
export interface SimpleJwtLoginErrorResponse {
  success: false;
  /** @since plugin v4.0.0 */
  error_code?: number;
  /** @deprecated Since plugin v4.0.0 — use error_code instead */
  errorCode?: number;
  data?: {
    message?: string;
  };
  [key: string]: unknown;
}
