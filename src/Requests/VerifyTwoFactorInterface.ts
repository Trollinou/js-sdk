export interface VerifyTwoFactorInterface {
  /**
   * Interim JWT returned by `authenticate()` when `data.two_factor_required` is `true`.
   */
  JWT: string;

  /**
   * Two-factor authentication code (TOTP code, email token, or backup code).
   */
  code: string;

  [key: string]: string | number | null | boolean | object | undefined;
}
