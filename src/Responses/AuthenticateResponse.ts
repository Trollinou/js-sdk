/**
 * Response returned by the authenticate endpoints (`POST /auth` and `POST /auth/2fa`).
 * Requires Simple-JWT-Login WordPress plugin >= 4.1.1.
 */
export interface AuthenticateResponse {
  success: boolean;
  data: {
    jwt: string;
    /** Available when authentication completes (omitted on 2FA interim response) */
    refresh_token?: string;
    /** True when Two-Factor Authentication is required to complete login via `verifyTwoFactor()` */
    two_factor_required?: boolean;
    /** Active 2FA provider class name when `two_factor_required` is true (e.g. `Two_Factor_Totp`) */
    provider?: string;
  };
}
