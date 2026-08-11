/**
 * Response returned by the validate token endpoint (GET /auth/validate).
 */
export interface ValidateTokenResponse {
  success: boolean;
  data?: {
    user?: {
      ID: string;
      user_login: string;
      user_email: string;
      display_name: string;
      [key: string]: unknown;
    };
    roles?: string[];
    jwt?: Array<{ token: string }>;
  };
}
