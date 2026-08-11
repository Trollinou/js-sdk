export interface AuthenticateInterface {
  /**
   * User email address.
   * Provide either `email`, `username`, or `login`.
   */
  email?: string | null;

  /**
   * WordPress username.
   * Provide either `email`, `username`, or `login`.
   */
  username?: string | null;

  /**
   * Accepts either an email or a username (since plugin v3.6.0).
   * Provide either `email`, `username`, or `login`.
   */
  login?: string | null;

  /** Plain-text password */
  password?: string | null;

  /** Password hash (alternative to plain-text password) */
  password_hash?: string | null;

  /**
   * Extra claims to merge into the generated JWT payload.
   * @example { "app": "my-pwa", "role": "user" }
   */
  payload?: Record<string, unknown> | null;

  [key: string]: string | number | null | boolean | object | undefined;
}
