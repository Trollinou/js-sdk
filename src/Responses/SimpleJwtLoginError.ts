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
 * Known error codes from the Simple-JWT-Login WordPress plugin (>= 4.1.1).
 * @see https://github.com/nicumicle/simple-jwt-login/blob/master/simple-jwt-login/src/ErrorCodes.php
 */
export const ERROR_CODES = {
  // JWT-related errors
  JWT_SIGNATURE_INVALID: 11,
  JWT_NOT_BEFORE: 12,
  JWT_NOT_YET_VALID: 13,
  JWT_EXPIRED: 14,
  JWT_IS_MISSING: 23,
  JWT_REVOKED: 55,
  JWT_STRUCTURAL_ERROR: 53,
  JWT_MISSING: 53,

  // Authentication errors
  INVALID_CREDENTIALS: 48,
  AUTH_CODE_REQUIRED: 94,
  AUTH_CODE_INVALID: 27,
  AUTH_DISABLED: 45,
  IP_NOT_ALLOWED: 41,
  PASSWORD_HASH_NOT_ALLOWED: 113,

  // User-related errors
  USER_NOT_FOUND: 24,
  JWT_USER_NOT_FOUND: 54,
  RESET_PASSWORD_USER_NOT_FOUND: 64,
  USER_ALREADY_EXISTS: 38,
  EMAIL_INVALID: 36,
  EMAIL_DOMAIN_NOT_ALLOWED: 37,

  // Refresh token errors
  REFRESH_TOKEN_NULL_PAYLOAD: 49,
  REFRESH_TOKEN_TOO_OLD: 50,
  REFRESH_TOKEN_NOT_FOUND: 51,
  REFRESH_TOKEN_DISABLED: 81,

  // Validation errors
  VALIDATION_DISABLED: 82,
  VALIDATION_MISSING_JWT: 53,

  // Revocation errors
  REVOCATION_DISABLED: 83,
  TOKEN_ALREADY_REVOKED: 55,
  REVOKED_TOKEN_UNAUTHORIZED: 115,
  REVOKED_TOKEN_NOT_FOUND: 116,
  REVOKED_TOKEN_DELETE_FAILED: 117,

  // Protect Endpoints errors
  PROTECT_ENDPOINTS_MISSING_JWT: 75,
  PROTECT_ENDPOINTS_INSUFFICIENT_ROLE: 114,

  // 2FA errors
  TWO_FACTOR_NOT_ACTIVE: 105,
  TWO_FACTOR_INTERIM_JWT_REQUIRED: 106,
  TWO_FACTOR_INVALID_NONCE: 107,
  TWO_FACTOR_RATE_LIMITED: 108,
  TWO_FACTOR_INVALID_CODE: 109,
  TWO_FACTOR_INTERIM_JWT_REJECTED: 110,
  /** @deprecated Use `TWO_FACTOR_INTERIM_JWT_REJECTED` (or `106`–`110`) instead */
  TWO_FACTOR_REQUIRED: 110,

  // OAuth errors
  OAUTH_INVALID_PROVIDER: 69,
  OAUTH_PROVIDER_NOT_ACTIVE: 70,
  GOOGLE_MISSING_PARAM: 71,
  GOOGLE_INVALID_CODE: 72,
  GOOGLE_INVALID_ID_TOKEN: 73,
  GOOGLE_USER_NOT_FOUND: 74,
  GOOGLE_ID_TOKEN_INVALID_AUDIENCE: 118,
  GOOGLE_ID_TOKEN_EMAIL_NOT_VERIFIED: 119,
  AUTH0_MISSING_PARAM: 77,
  AUTH0_INVALID_CODE: 78,
  AUTH0_INVALID_TOKEN: 79,
  AUTH0_USER_NOT_FOUND: 80,
  AUTH0_EMAIL_NOT_VERIFIED: 111,
  FACEBOOK_MISSING_PARAM: 97,
  FACEBOOK_INVALID_CODE: 98,
  FACEBOOK_INVALID_TOKEN: 99,
  FACEBOOK_USER_NOT_FOUND: 100,
  GITHUB_MISSING_PARAM: 101,
  GITHUB_INVALID_CODE: 102,
  GITHUB_INVALID_TOKEN: 103,
  GITHUB_USER_NOT_FOUND: 104,
  GITHUB_EMAIL_NOT_VERIFIED: 112,

  // API Key errors
  API_KEY_UNAUTHORIZED: 84,
  API_KEY_MISSING_NAME: 85,
  API_KEY_MISSING_PERMISSIONS: 86,
  API_KEY_INVALID_PERMISSION: 87,
  API_KEY_CREATE_FAILED: 88,
  API_KEY_NOT_FOUND: 89,
  API_KEY_UPDATE_FAILED: 90,
  API_KEY_REVOKE_FAILED: 91,
  API_KEY_DELETE_FAILED: 92,

  // AI Abilities errors (v4.1.0+)
  ABILITY_UNKNOWN_SECTION: 120,
  ABILITY_UNKNOWN_SETTING: 121,
  ABILITY_SETTING_NOT_WRITABLE: 122,
  ABILITY_INVALID_VALUE: 123,
  ABILITY_WEBHOOK_NOT_FOUND: 124,
  ABILITY_INVALID_WEBHOOK: 125,
  ABILITY_LIST_ITEM_MISMATCH: 126,
  ABILITY_UNKNOWN_ERROR_CODE: 127,
  ABILITY_PERMISSION_DENIED: 128,

  // Registration errors
  REGISTRATION_DISABLED: 31,
  REGISTRATION_INVALID_AUTH_KEY: 32,
  REGISTRATION_IP_NOT_ALLOWED: 33,
  REGISTRATION_MISSING_FIELDS: 35,
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
