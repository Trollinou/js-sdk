/**
 * Request interface for refreshing a JWT.
 * @see https://simplejwtlogin.com/api/v4/refresh-jwt
 */
export interface RefreshTokenInterface {
  /**
   * The refresh token to use for obtaining a new JWT.
   * This is the primary field as per plugin v4 API.
   */
  refresh_token?: string;

  /**
   * The current JWT (optional, used for additional validation).
   * @deprecated Use refresh_token instead. Kept for backward compatibility.
   */
  JWT?: string;

  [key: string]: string | number | null | boolean | object | undefined;
}
