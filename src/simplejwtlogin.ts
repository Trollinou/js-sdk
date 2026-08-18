import { AuthenticateInterface } from "./Requests/AuthenticateInterface";
import { AutologinInterface } from "./Requests/AutologinInterface";
import { ChangePasswordInterface } from "./Requests/ChangePasswordInterface";
import { DeleteUserInterface } from "./Requests/DeleteUserInterface";
import { RefreshTokenInterface } from "./Requests/RefreshTokenInterface";
import { RegisterUserInterface } from "./Requests/RegisterUserInterface";
import { ResetPasswordInterface } from "./Requests/ResetPasswordInterface";
import { RevokeTokenInterface } from "./Requests/RevokeTokenInterface";
import { ValidateTokenInterface } from "./Requests/ValidateTokenInterface";
import { AuthenticateResponse } from "./Responses/AuthenticateResponse";
import { RegisterUserResponse } from "./Responses/RegisterUserResponse";
import { ValidateTokenResponse } from "./Responses/ValidateTokenResponse";
import { SimpleJwtLoginApiError } from "./Responses/SimpleJwtLoginError";
import { InMemoryTokenStorage, TokenStorage } from "./TokenStorage";

/**
 * Polyfill for atob (base64 decode) for environments where it's not available.
 * Works in browsers (native atob) and Node.js (Buffer fallback).
 */
function atobPolyfill(input: string): string {
  if (typeof atob !== "undefined") {
    return atob(input);
  }
  // Node.js fallback using Buffer (available in Node.js environments)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (Buffer as any).from(input, "base64").toString("binary");
}

/** Configuration options for SimpleJwtLogin */
export interface SimpleJwtLoginOptions {
  /**
   * Route namespace. Defaults to `/simple-jwt-login/v1`.
   * Must match the "Route Namespace" setting in the WordPress plugin.
   */
  namespace?: string;

  /**
   * Auth code parameter name. Defaults to `AUTH_KEY`.
   * Must match the "Auth Code Key" setting in the WordPress plugin.
   */
  authCodeKey?: string;

  /**
   * Token storage implementation.
   * Defaults to in-memory storage (tokens lost on page reload).
   * Use `LocalStorageTokenStorage` for a PWA:
   * @example
   * import { LocalStorageTokenStorage } from "simple-jwt-login/TokenStorage";
   * new SimpleJwtLogin("https://example.com", {
   *   tokenStorage: new LocalStorageTokenStorage("my-app"),
   * });
   */
  tokenStorage?: TokenStorage;

  /**
   * Called whenever a token refresh completes successfully.
   * Use this to react to new tokens (e.g., sync to another store).
   * @param jwt - The new JWT
   * @param refreshToken - The new refresh token (empty string if not provided by plugin)
   */
  onTokenRefreshed?: (jwt: string, refreshToken: string) => void;

  /**
   * How many seconds before JWT expiry a proactive refresh is triggered.
   * Defaults to 60 seconds.
   */
  refreshBeforeExpirySeconds?: number;
}

export class SimpleJwtLogin {
  private readonly host: string;
  private readonly namespace: string;
  private readonly authCodeKey: string;
  private readonly storage: TokenStorage;
  private readonly onTokenRefreshed: ((jwt: string, refreshToken: string) => void) | undefined;
  private readonly refreshBeforeExpirySeconds: number;

  /** Flag to prevent concurrent refresh calls */
  private isRefreshing = false;
  private refreshPromise: Promise<string | null> | null = null;

  /**
   * @param host WordPress site URL (e.g. `https://example.com`)
   * @param options SDK configuration options
   */
  constructor(host: string, options: SimpleJwtLoginOptions = {}) {
    this.host = host;
    this.namespace = options.namespace ?? "/simple-jwt-login/v1";
    this.authCodeKey = options.authCodeKey ?? "AUTH_KEY";
    this.storage = options.tokenStorage ?? new InMemoryTokenStorage();
    this.onTokenRefreshed = options.onTokenRefreshed;
    this.refreshBeforeExpirySeconds = options.refreshBeforeExpirySeconds ?? 60;
  }

  // ─── Token Management ──────────────────────────────────────────────────────

  /**
   * Manually set the JWT and refresh token (e.g., after restoring from storage).
   */
  setTokens(jwt: string, refreshToken = ""): void {
    this.storage.setJwt(jwt);
    if (refreshToken) {
      this.storage.setRefreshToken(refreshToken);
    }
  }

  /**
   * Returns the current JWT, or null if not authenticated.
   */
  getJwt(): string | null {
    return this.storage.getJwt();
  }

  /**
   * Clears all stored tokens (logout).
   */
  clearTokens(): void {
    this.storage.clearTokens();
  }

  /**
   * Returns a valid (non-expired) JWT.
   * If the stored JWT is close to expiry, it is silently refreshed first.
   * Returns null if not authenticated or if refresh fails.
   */
  async getValidJwt(): Promise<string | null> {
    const jwt = this.storage.getJwt();
    if (!jwt) return null;

    if (this.isJwtExpiringSoon(jwt)) {
      return this.silentRefresh();
    }

    return jwt;
  }

  // ─── Auth Endpoints ────────────────────────────────────────────────────────

  /**
   * Authenticate with WordPress credentials and get a JWT.
   * Tokens are automatically stored after a successful authentication.
   *
   * @param params Credentials (`email`/`username`/`login` + `password`)
   * @param authCode Optional auth code if required by plugin settings
   */
  public async authenticate(
    params: AuthenticateInterface,
    authCode = "",
  ): Promise<AuthenticateResponse> {
    if (authCode !== "") {
      params = { ...params, [this.authCodeKey]: authCode };
    }

    const response = await this.call<AuthenticateResponse>("POST", "/auth", params);

    // Auto-store tokens
    if (response.data?.jwt) {
      this.storage.setJwt(response.data.jwt);
      if (response.data.refresh_token) {
        this.storage.setRefreshToken(response.data.refresh_token);
      }
    }

    return response;
  }

  /**
   * Validate a JWT and get user information.
   *
   * @param params Must contain a `JWT` field
   * @param authCode Optional auth code
   */
  public validateToken(
    params: ValidateTokenInterface,
    authCode = "",
  ): Promise<ValidateTokenResponse> {
    if (authCode !== "") {
      params = { ...params, [this.authCodeKey]: authCode };
    }
    return this.call<ValidateTokenResponse>("GET", "/auth/validate", params);
  }

  /**
   * Refresh the JWT using a refresh token.
   * Tokens are automatically stored after a successful refresh.
   *
   * @param params Must contain a `refresh_token` field (as per plugin v4 API).
   *              Falls back to `JWT` for backward compatibility.
   * @param authCode Optional auth code
   */
  public async refreshToken(
    params: RefreshTokenInterface,
    authCode = "",
  ): Promise<AuthenticateResponse> {
    // Build request body - prioritize refresh_token (plugin v4 API)
    const body: Record<string, string> = {};
    
    // Prefer refresh_token as per plugin v4 API specification
    if (params.refresh_token) {
      body.refresh_token = params.refresh_token;
    } else if (params.JWT) {
      // Fallback to JWT for backward compatibility
      body.JWT = params.JWT;
    } else {
      // If no token provided in params, use the stored refresh token
      const storedRefreshToken = this.storage.getRefreshToken();
      if (storedRefreshToken) {
        body.refresh_token = storedRefreshToken;
      }
    }

    if (authCode !== "") {
      body[this.authCodeKey] = authCode;
    }

    const response = await this.call<AuthenticateResponse>("POST", "/auth/refresh", body);

    // Auto-store refreshed tokens
    if (response.data?.jwt) {
      this.storage.setJwt(response.data.jwt);
      if (response.data.refresh_token) {
        this.storage.setRefreshToken(response.data.refresh_token);
      }
      this.onTokenRefreshed?.(
        response.data.jwt,
        response.data.refresh_token ?? "",
      );
    }

    return response;
  }

  /**
   * Revoke (invalidate) a JWT server-side.
   *
   * @param params Must contain a `JWT` field
   * @param authCode Optional auth code
   */
  public revokeToken(
    params: RevokeTokenInterface,
    authCode = "",
  ): Promise<unknown> {
    if (authCode !== "") {
      params = { ...params, [this.authCodeKey]: authCode };
    }
    return this.call("POST", "/auth/revoke", params);
  }

  // ─── User Endpoints ────────────────────────────────────────────────────────

  /**
   * Generate an autologin URL (magic link) for the given JWT.
   * The user visits this URL to get automatically logged into WordPress.
   *
   * @param params Must contain a `JWT` field and optional `redirectUrl`
   * @param authCode Optional auth code
   */
  public autologin(params: AutologinInterface, authCode = ""): string {
    const p = { ...params };
    if (authCode !== "") {
      p[this.authCodeKey] = authCode;
    }
    return this.buildUrl() + "/autologin&" + this.queryData(p);
  }

  /**
   * Register a new WordPress user.
   *
   * @note Since plugin v4.0.0, the response changed:
   *   Before: `{ success: true, ID: 42 }`
   *   After:  `{ success: true, data: { id: 42 } }`
   *
   * @param params User details (email + password required)
   * @param authCode Optional auth code
   */
  public registerUser(
    params: RegisterUserInterface,
    authCode = "",
  ): Promise<RegisterUserResponse> {
    if (authCode !== "") {
      params = { ...params, [this.authCodeKey]: authCode };
    }
    return this.call<RegisterUserResponse>("POST", "/users", params);
  }

  /**
   * Delete the WordPress user identified by the JWT.
   *
   * @param params Must contain a `JWT` field
   * @param authCode Optional auth code
   */
  public deleteUser(
    params: DeleteUserInterface,
    authCode = "",
  ): Promise<unknown> {
    if (authCode !== "") {
      params = { ...params, [this.authCodeKey]: authCode };
    }
    return this.call("DELETE", "/users", params);
  }

  /**
   * Request a password reset email for the given email address.
   *
   * @param params Must contain an `email` field
   * @param authCode Optional auth code
   */
  public resetPassword(
    params: ResetPasswordInterface,
    authCode = "",
  ): Promise<unknown> {
    if (authCode !== "") {
      params = { ...params, [this.authCodeKey]: authCode };
    }
    return this.call("POST", "/user/reset_password", params);
  }

  /**
   * Change the user password using the reset code received by email.
   *
   * @param params Must contain `email`, `new_password`, and either `code` or `JWT`
   * @param authCode Optional auth code
   */
  public changePassword(
    params: ChangePasswordInterface,
    authCode = "",
  ): Promise<unknown> {
    if (authCode !== "") {
      params = { ...params, [this.authCodeKey]: authCode };
    }
    return this.call("PUT", "/user/reset_password", params);
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  /**
   * Silently refresh the JWT using the stored refresh token.
   * Concurrent calls are deduplicated — only one refresh runs at a time.
   */
  private silentRefresh(): Promise<string | null> {
    if (this.isRefreshing && this.refreshPromise) {
      return this.refreshPromise;
    }

    const refreshToken = this.storage.getRefreshToken();
    const currentJwt = this.storage.getJwt();

    if (!refreshToken && !currentJwt) {
      return Promise.resolve(null);
    }

    this.isRefreshing = true;
    this.refreshPromise = this.refreshToken({
      JWT: currentJwt ?? "",
    })
      .then((response) => {
        this.isRefreshing = false;
        this.refreshPromise = null;
        return response.data?.jwt ?? null;
      })
      .catch(() => {
        this.isRefreshing = false;
        this.refreshPromise = null;
        this.storage.clearTokens();
        return null;
      });

    return this.refreshPromise;
  }

  /**
   * Decode the JWT payload and check if it expires within `refreshBeforeExpirySeconds`.
   * Works in both browser and Node.js environments.
   */
  private isJwtExpiringSoon(jwt: string): boolean {
    try {
      const parts = jwt.split(".");
      if (parts.length !== 3) return false;
      // Use polyfill for Node.js compatibility
      const payload = JSON.parse(atobPolyfill(parts[1])) as { exp?: number };
      if (typeof payload.exp !== "number") return false;
      return Date.now() / 1000 >= payload.exp - this.refreshBeforeExpirySeconds;
    } catch {
      return false;
    }
  }

  private buildUrl(): string {
    return this.host + "/?rest_route=" + this.namespace;
  }

  private queryData(data: Record<string, unknown>): string {
    const searchParams = new URLSearchParams();
    for (const key in data) {
      const value = data[key];
      if (value !== null && value !== undefined) {
        searchParams.append(key, String(value));
      }
    }
    return searchParams.toString();
  }

  /**
   * @param method HTTP method (GET, POST, PUT, DELETE)
   * @param endpoint Plugin REST endpoint (e.g. `/auth`)
   * @param params Request parameters
   */
  private async call<
    T = unknown,
    P extends Record<string, unknown> = Record<string, unknown>,
  >(method: string, endpoint: string, params: P | null = null): Promise<T> {
    let callUrl = this.buildUrl() + endpoint;
    const fetchOptions: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
      },
    };

    if (method === "GET" && params) {
      callUrl = callUrl + "&" + this.queryData(params as Record<string, unknown>);
    } else if (params) {
      fetchOptions.body = JSON.stringify(params);
    }

    const response = await fetch(callUrl, fetchOptions);

    if (!response.ok) {
      const errorText = await response.text();
      let errorCode: number | undefined;
      let errorMessage: string;
      let responseData: unknown = null;
      
      try {
        const parsed = JSON.parse(errorText);
        responseData = parsed;
        
        // Extract error_code from plugin response (can be at root or in data)
        if (typeof parsed.error_code === 'number') {
          errorCode = parsed.error_code;
        } else if (parsed.data?.error_code && typeof parsed.data.error_code === 'number') {
          errorCode = parsed.data.error_code;
        }
        
        // Extract message (can be at root or in data)
        if (parsed.message) {
          errorMessage = parsed.message;
        } else if (parsed.data?.message) {
          errorMessage = parsed.data.message;
        } else {
          errorMessage = errorText;
        }
      } catch {
        // Not JSON, use raw text
        errorMessage = errorText;
      }

      throw new SimpleJwtLoginApiError(
        response.status,
        errorCode,
        errorMessage,
        responseData,
      );
    }

    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;
  }
}
