/**
 * Response returned by the register user endpoint (POST /users).
 *
 * @breaking v4.0.0 — The response structure changed:
 *   Before v4: { "success": true, "ID": 42, "user_login": "..." }
 *   Since v4:  { "success": true, "data": { "id": 42 } }
 */
export interface RegisterUserResponse {
  success: boolean;
  /** Available since plugin v4.0.0 */
  data?: {
    id: number;
    [key: string]: unknown;
  };
  /** @deprecated Since plugin v4.0.0 — use data.id instead */
  ID?: number;
  [key: string]: unknown;
}
