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

/**
 * Known error codes from the Simple-JWT-Login plugin v4.
 * @see https://simplejwtlogin.com/api/v4/simple-jwt-login#error-response-format
 */
export const ERROR_CODES = {
  // JWT-related errors
  JWT_SIGNATURE_INVALID: 11,
  JWT_EXPIRED: 12,
  JWT_NOT_YET_VALID: 13,
  JWT_REVOKED: 55,
  JWT_STRUCTURAL_ERROR: 53,
  JWT_MISSING: 53,
  
  // Authentication errors
  INVALID_CREDENTIALS: 48,
  AUTH_CODE_REQUIRED: 94,
  AUTH_CODE_INVALID: 27,
  AUTH_DISABLED: 45,
  IP_NOT_ALLOWED: 41,
  
  // User-related errors
  USER_NOT_FOUND: 55,
  USER_ALREADY_EXISTS: 409,
  EMAIL_INVALID: 36,
  EMAIL_DOMAIN_NOT_ALLOWED: 37,
  
  // Refresh token errors
  REFRESH_TOKEN_NOT_FOUND: 51,
  REFRESH_TOKEN_DISABLED: 81,
  
  // Validation errors
  VALIDATION_DISABLED: 82,
  VALIDATION_MISSING_JWT: 53,
  
  // Revocation errors
  REVOCATION_DISABLED: 83,
  TOKEN_ALREADY_REVOKED: 55,
  
  // 2FA errors
  TWO_FACTOR_REQUIRED: 110,
  
  // Registration errors
  REGISTRATION_DISABLED: 45,
  REGISTRATION_MISSING_FIELDS: 400,
} as const;

/**
 * Type for known error codes.
 */
export type SimpleJwtLoginErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];

/**
 * API error thrown by SimpleJwtLogin methods.
 * Matches the plugin's error response format for better compatibility.
 */
export class SimpleJwtLoginApiError extends Error {
  /** HTTP status code (e.g., 401, 403, 422) */
  public readonly status: number;
  
  /** Plugin-specific error code (e.g., 48 for invalid credentials) */
  public readonly errorCode: number | undefined;
  
  /** Raw response data from the plugin */
  public readonly responseData: unknown;

  /**
   * Creates a new API error.
   * @param status - HTTP status code
   * @param errorCode - Plugin-specific error code (from ERROR_CODES)
   * @param message - Human-readable error message
   * @param responseData - Raw response data from the plugin
   */
  constructor(
    status: number,
    errorCode: number | undefined,
    message: string,
    responseData: unknown = null,
  ) {
    super(message);
    this.name = 'SimpleJwtLoginApiError';
    this.status = status;
    this.errorCode = errorCode;
    this.responseData = responseData;
  }

  /**
   * Converts the error to the plugin's standard error response format.
   * Useful for middleware or client-side error handling.
   */
  toPluginFormat(): SimpleJwtLoginErrorResponse {
    return {
      success: false,
      error_code: this.errorCode,
      errorCode: this.errorCode, // Backward compatibility
      data: {
        message: this.message,
      },
    };
  }

  /**
   * Checks if this error matches a known error code.
   * @param code - Error code to check (from ERROR_CODES)
   */
  isErrorCode(code: SimpleJwtLoginErrorCode): boolean {
    return this.errorCode === code;
  }
}
