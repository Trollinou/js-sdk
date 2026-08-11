/**
 * Response returned by the authenticate endpoint (POST /auth).
 * Since plugin v4.0, the response also includes a refresh_token.
 */
export interface AuthenticateResponse {
  success: boolean;
  data: {
    jwt: string;
    /** Available since plugin v4.0.0 */
    refresh_token?: string;
  };
}
