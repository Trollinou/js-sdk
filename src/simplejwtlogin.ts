import type { AuthenticateInterface } from "./Requests/AuthenticateInterface.js";
import type { AutologinInterface } from "./Requests/AutologinInterface.js";
import type { ChangePasswordInterface } from "./Requests/ChangePasswordInterface.js";
import type { DeleteUserInterface } from "./Requests/DeleteUserInterface.js";
import type { RefreshTokenInterface } from "./Requests/RefreshTokenInterface.js";
import type { RegisterUserInterface } from "./Requests/RegisterUserInterface.js";
import type { ResetPasswordInterface } from "./Requests/ResetPasswordInterface.js";
import type { RevokeTokenInterface } from "./Requests/RevokeTokenInterface.js";
import type { ValidateTokenInterface } from "./Requests/ValidateTokenInterface.js";
import type { AuthenticateResponse } from "./Responses/AuthenticateResponse.js";
import type { RegisterUserResponse } from "./Responses/RegisterUserResponse.js";
import type { ValidateTokenResponse } from "./Responses/ValidateTokenResponse.js";
import { SimpleJwtLoginApiError } from "./Responses/SimpleJwtLoginError.js";
import { InMemoryTokenStorage, type TokenStorage } from "./TokenStorage.js";

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

/**
 * Decode base64url encoded string (handles URL-safe characters and padding).
 */
function decodeBase64Url(input: string): string {
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  return atobPolyfill(base64);
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
   * Optional default auth code automatically sent on requests (including silent token refresh)
   * when no explicit `authCode` argument is passed to a method.
   */
  defaultAuthCode?: string;

  /**
   * Token storage implementation.
   * Defaults to in-memory storage (tokens lost on page reload).
   * Use `LocalStorageTokenStorage` for a PWA:
   * @example
   * import { SimpleJwtLogin, LocalStorageTokenStorage } from "simple-jwt-login";
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
   * Called when a silent token refresh fails due to an authentication/authorization
   * rejection from the server (e.g., HTTP 400, 401, 403 — expired or revoked refresh token)
   * and stored tokens are cleared. Not called on transient network/offline or 5xx errors.
   * @param error - The API error returned by the server
   */
  onSessionExpired?: (error: SimpleJwtLoginApiError) => void;

  /**
   * How many seconds before JWT expiry a proactive refresh is triggered.
   * Defaults to 60 seconds.
   */
  refreshBeforeExpirySeconds?: number;

  /**
   * Use pretty permalinks (`/wp-json<namespace>`) instead of `/?rest_route=<namespace>`.
   * Defaults to `false` (`/?rest_route=` works regardless of WordPress permalink settings).
   */
  useWpJson?: boolean;
}

export class SimpleJwtLogin {
  private readonly host: string;
  private readonly namespace: string;
  private readonly authCodeKey: string;
  private readonly defaultAuthCode: string;
  private readonly storage: TokenStorage;
  private readonly onTokenRefreshed: ((jwt: string, refreshToken: string) => void) | undefined;
  private readonly onSessionExpired: ((error: SimpleJwtLoginApiError) => void) | undefined;
  private readonly refreshBeforeExpirySeconds: number;
  private readonly useWpJson: boolean;

  /** Flag to prevent concurrent refresh calls */
  private isRefreshing = false;
  private refreshPromise: Promise<string | null> | null = null;

  /**
   * @param host WordPress site URL (e.g. `https://example.com`)
   * @param options SDK configuration options
   */
  constructor(host: string, options: SimpleJwtLoginOptions = {}) {
    this.host = host.replace(/\/+$/, "");
    const rawNamespace = (options.namespace ?? "/simple-jwt-login/v1").replace(/\/+$/, "");
    this.namespace = rawNamespace.startsWith("/") ? rawNamespace : `/${rawNamespace}`;
    this.authCodeKey = options.authCodeKey ?? "AUTH_KEY";
    this.defaultAuthCode = options.defaultAuthCode ?? "";
    this.storage = options.tokenStorage ?? new InMemoryTokenStorage();
    this.onTokenRefreshed = options.onTokenRefreshed;
    this.onSessionExpired = options.onSessionExpired;
    this.refreshBeforeExpirySeconds = options.refreshBeforeExpirySeconds ?? 60;
    this.useWpJson = options.useWpJson ?? false;
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
   * Returns the current refresh token, or null if none is stored.
   */
  getRefreshToken(): string | null {
    return this.storage.getRefreshToken();
  }

  /**
   * Returns true if the client holds a non-expired JWT or a refresh token
   * capable of renewing the session.
   */
  isAuthenticated(): boolean {
    const refreshToken = this.storage.getRefreshToken();
    if (refreshToken) {
      return true;
    }
    const jwt = this.storage.getJwt();
    if (!jwt) {
      return false;
    }
    return !this.isJwtExpiringSoon(jwt, 0);
  }

  /**
   * Clears all stored tokens locally (without calling the server).
   */
  clearTokens(): void {
    this.storage.clearTokens();
  }

  /**
   * Logs out the user: attempts to revoke the current JWT server-side (ignoring network
   * or revocation errors if offline) and always clears local token storage.
   *
   * @param authCode Optional auth code
   */
  async logout(authCode = ""): Promise<void> {
    const jwt = this.storage.getJwt();
    this.storage.clearTokens();
    if (jwt) {
      try {
        await this.revokeToken({ JWT: jwt }, authCode);
      } catch {
        // Ignore network/server errors during logout since local tokens are already cleared
      }
    }
  }

  /**
   * Returns a valid (non-expired) JWT.
   * If the stored JWT is close to expiry, it is silently refreshed first.
   * If a refresh token is stored without a JWT, it attempts to obtain a new JWT.
   * Returns null if not authenticated or if refresh fails.
   *
   * @param forceRefresh When true, forces a silent refresh even if the local JWT does not appear expired.
   */
  async getValidJwt(forceRefresh = false): Promise<string | null> {
    const jwt = this.storage.getJwt();
    if (!jwt) {
      if (this.storage.getRefreshToken()) {
        return this.silentRefresh();
      }
      return null;
    }

    if (forceRefresh || this.isJwtExpiringSoon(jwt)) {
      return this.silentRefresh();
    }

    return jwt;
  }

  /**
   * Performs an authenticated `fetch` request to any WordPress REST API endpoint.
   * Automatically attaches `Authorization: Bearer <jwt>` using `getValidJwt()`.
   * If the server responds with `401 Unauthorized`, forces a silent token refresh once
   * and retries the request with the new JWT.
   *
   * @param input Request URL or Request object (relative paths are resolved against `host`)
   * @param init Optional fetch RequestInit options
   */
  async fetchWithAuth(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const resolvedInput =
      typeof input === "string" && input.startsWith("/")
        ? `${this.host}${input}`
        : input;

    const jwt = await this.getValidJwt();
    const executeFetch = (token: string | null): Promise<Response> => {
      const headers = new Headers(init.headers);
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }
      return fetch(resolvedInput, {
        ...init,
        headers,
      });
    };

    const response = await executeFetch(jwt);

    if (response.status === 401 && (this.storage.getRefreshToken() || this.storage.getJwt())) {
      const refreshedJwt = await this.getValidJwt(true);
      if (refreshedJwt && refreshedJwt !== jwt) {
        return executeFetch(refreshedJwt);
      }
    }

    return response;
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
    const effectiveAuthCode = authCode || this.defaultAuthCode;
    if (effectiveAuthCode !== "") {
      params = { ...params, [this.authCodeKey]: effectiveAuthCode };
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
    const effectiveAuthCode = authCode || this.defaultAuthCode;
    if (effectiveAuthCode !== "") {
      params = { ...params, [this.authCodeKey]: effectiveAuthCode };
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
    params: RefreshTokenInterface = {},
    authCode = "",
  ): Promise<AuthenticateResponse> {
    const { refresh_token, JWT, ...rest } = params;
    const body: Record<string, unknown> = { ...rest };

    // Prefer refresh_token as per plugin v4 API specification
    if (refresh_token) {
      body.refresh_token = refresh_token;
    } else if (JWT) {
      // Fallback to JWT for backward compatibility
      body.JWT = JWT;
    } else {
      // If no token provided in params, use the stored refresh token
      const storedRefreshToken = this.storage.getRefreshToken();
      if (storedRefreshToken) {
        body.refresh_token = storedRefreshToken;
      }
    }

    const effectiveAuthCode = authCode || this.defaultAuthCode;
    if (effectiveAuthCode !== "") {
      body[this.authCodeKey] = effectiveAuthCode;
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
    const effectiveAuthCode = authCode || this.defaultAuthCode;
    if (effectiveAuthCode !== "") {
      params = { ...params, [this.authCodeKey]: effectiveAuthCode };
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
    const p: Record<string, unknown> = { ...params };
    const effectiveAuthCode = authCode || this.defaultAuthCode;
    if (effectiveAuthCode !== "") {
      p[this.authCodeKey] = effectiveAuthCode;
    }
    const separator = this.useWpJson ? "?" : "&";
    return this.buildUrl() + "/autologin" + separator + this.queryData(p);
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
    const effectiveAuthCode = authCode || this.defaultAuthCode;
    if (effectiveAuthCode !== "") {
      params = { ...params, [this.authCodeKey]: effectiveAuthCode };
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
    const effectiveAuthCode = authCode || this.defaultAuthCode;
    if (effectiveAuthCode !== "") {
      params = { ...params, [this.authCodeKey]: effectiveAuthCode };
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
    const effectiveAuthCode = authCode || this.defaultAuthCode;
    if (effectiveAuthCode !== "") {
      params = { ...params, [this.authCodeKey]: effectiveAuthCode };
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
    const effectiveAuthCode = authCode || this.defaultAuthCode;
    if (effectiveAuthCode !== "") {
      params = { ...params, [this.authCodeKey]: effectiveAuthCode };
    }
    return this.call("PUT", "/user/reset_password", params);
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  /**
   * Silently refresh the JWT using the stored refresh token.
   * Concurrent calls are deduplicated — only one refresh runs at a time.
   *
   * PWA resilience:
   * - Transient network errors (offline, DNS failure, timeout) or 5xx server errors
   *   do NOT clear stored tokens so the user stays logged in when connectivity returns.
   * - Multi-tab rotation recovery: if another tab already refreshed the JWT in shared
   *   storage while this tab's refresh failed, the fresh JWT from storage is returned.
   */
  private silentRefresh(): Promise<string | null> {
    if (this.isRefreshing && this.refreshPromise) {
      return this.refreshPromise;
    }

    const initialRefreshToken = this.storage.getRefreshToken();
    const initialJwt = this.storage.getJwt();

    if (!initialRefreshToken && !initialJwt) {
      return Promise.resolve(null);
    }

    this.isRefreshing = true;
    this.refreshPromise = (async () => {
      try {
        const response = await this.refreshToken(
          initialRefreshToken
            ? { refresh_token: initialRefreshToken }
            : { JWT: initialJwt ?? "" },
        );
        return response.data?.jwt ?? null;
      } catch (error) {
        // Multi-tab recovery: check if another tab updated storage with a valid JWT
        const latestJwt = this.storage.getJwt();
        if (latestJwt && latestJwt !== initialJwt && !this.isJwtExpiringSoon(latestJwt)) {
          return latestJwt;
        }

        // Only clear tokens if the server explicitly rejected the token/credentials (400, 401, 403)
        if (
          error instanceof SimpleJwtLoginApiError &&
          (error.status === 400 || error.status === 401 || error.status === 403)
        ) {
          this.storage.clearTokens();
          this.onSessionExpired?.(error);
          return null;
        }

        // For network errors (offline PWA) or 5xx server errors, keep stored tokens intact.
        // If the current JWT is not yet strictly expired (exp > now), return it as a fallback.
        if (initialJwt && !this.isJwtExpiringSoon(initialJwt, 0)) {
          return initialJwt;
        }

        return null;
      } finally {
        this.isRefreshing = false;
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  /**
   * Decode the JWT payload and check if it expires within `thresholdSeconds`.
   * Works in both browser and Node.js environments.
   */
  private isJwtExpiringSoon(
    jwt: string,
    thresholdSeconds = this.refreshBeforeExpirySeconds,
  ): boolean {
    try {
      const parts = jwt.split(".");
      if (parts.length !== 3) return false;
      // Use base64url decoder for JWT payload compatibility
      const payload = JSON.parse(decodeBase64Url(parts[1])) as { exp?: number };
      if (typeof payload.exp !== "number") return false;
      return Date.now() / 1000 >= payload.exp - thresholdSeconds;
    } catch {
      return false;
    }
  }

  private buildUrl(): string {
    if (this.useWpJson) {
      return `${this.host}/wp-json${this.namespace}`;
    }
    return `${this.host}/?rest_route=${this.namespace}`;
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
      const separator = this.useWpJson ? "?" : "&";
      callUrl = callUrl + separator + this.queryData(params as Record<string, unknown>);
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
        if (typeof parsed.error_code === "number") {
          errorCode = parsed.error_code;
        } else if (typeof parsed.errorCode === "number") {
          errorCode = parsed.errorCode;
        } else if (typeof parsed.data?.error_code === "number") {
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
