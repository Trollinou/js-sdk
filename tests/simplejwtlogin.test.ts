import { AuthenticateInterface } from "../src/Requests/AuthenticateInterface";
import { SimpleJwtLogin } from "../src/simplejwtlogin";
import { InMemoryTokenStorage, LocalStorageTokenStorage, CookieTokenStorage } from "../src/TokenStorage";
import { SimpleJwtLoginApiError, ERROR_CODES } from "../src/Responses/SimpleJwtLoginError";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Polyfill for btoa (base64 encode) for Node.js environments */
function btoaPolyfill(input: string): string {
  if (typeof btoa !== "undefined") {
    return btoa(input);
  }
  // Node.js fallback using Buffer (available in Node.js environments)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (Buffer as any).from(input, "binary").toString("base64");
}

/** Build a JWT with a given expiry (seconds from now). exp=0 means already expired. */
function buildJwt(expInSeconds: number): string {
  const payload = { exp: Math.floor(Date.now() / 1000) + expInSeconds, sub: "1" };
  const encoded = btoaPolyfill(JSON.stringify(payload));
  return `header.${encoded}.signature`;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SimpleJwtLogin", () => {
  const host = "http://example.com";
  let sdk: SimpleJwtLogin;

  beforeEach(() => {
    sdk = new SimpleJwtLogin(host);
    globalThis.fetch = jest.fn() as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Constructor ─────────────────────────────────────────────────────────────

  describe("Constructor", () => {
    it("should initialize with default values", () => {
      const s = new SimpleJwtLogin(host);
      expect(s.getJwt()).toBeNull();
    });

    it("should accept options object", () => {
      const storage = new InMemoryTokenStorage();
      const s = new SimpleJwtLogin(host, {
        namespace: "/custom/v1",
        authCodeKey: "CUSTOM_KEY",
        tokenStorage: storage,
        refreshBeforeExpirySeconds: 120,
      });
      expect(s).toBeDefined();
    });

    it("should normalize trailing slashes on host and namespace", () => {
      const s = new SimpleJwtLogin("http://example.com///", {
        namespace: "custom/v1/",
      });
      const url = s.autologin({ JWT: "tok" });
      expect(url).toBe("http://example.com/?rest_route=/custom/v1/autologin&JWT=tok");
    });

    it("should support useWpJson pretty permalinks option", async () => {
      const s = new SimpleJwtLogin("http://example.com/", { useWpJson: true });
      expect(s.autologin({ JWT: "tok" })).toBe(
        "http://example.com/wp-json/simple-jwt-login/v1/autologin?JWT=tok",
      );

      (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValueOnce(JSON.stringify({ success: true })),
      });
      await s.validateToken({ JWT: "tok" });
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://example.com/wp-json/simple-jwt-login/v1/auth/validate?JWT=tok",
        expect.objectContaining({ method: "GET" }),
      );
    });
  });

  // ── Token Management & PWA Resilience ───────────────────────────────────────

  describe("Token Management", () => {
    it("setTokens / getJwt / getRefreshToken / clearTokens", () => {
      sdk.setTokens("my-jwt", "my-refresh");
      expect(sdk.getJwt()).toBe("my-jwt");
      expect(sdk.getRefreshToken()).toBe("my-refresh");
      sdk.clearTokens();
      expect(sdk.getJwt()).toBeNull();
      expect(sdk.getRefreshToken()).toBeNull();
    });

    it("isAuthenticated checks refresh token or non-expired JWT", () => {
      expect(sdk.isAuthenticated()).toBe(false);

      // Valid JWT without refresh token
      sdk.setTokens(buildJwt(3600));
      expect(sdk.isAuthenticated()).toBe(true);

      // Expired JWT without refresh token
      sdk.setTokens(buildJwt(-10));
      expect(sdk.isAuthenticated()).toBe(false);

      // Expired JWT WITH refresh token -> still authenticated (can refresh)
      sdk.setTokens(buildJwt(-10), "valid-refresh");
      expect(sdk.isAuthenticated()).toBe(true);
    });

    it("logout revokes token server-side and clears local storage even if offline", async () => {
      sdk.setTokens("my-jwt", "my-refresh");
      (globalThis.fetch as jest.Mock).mockRejectedValueOnce(new TypeError("Failed to fetch"));

      await sdk.logout();
      expect(sdk.getJwt()).toBeNull();
      expect(sdk.getRefreshToken()).toBeNull();
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://example.com/?rest_route=/simple-jwt-login/v1/auth/revoke",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("getValidJwt returns null when no JWT or refresh token is stored", async () => {
      const result = await sdk.getValidJwt();
      expect(result).toBeNull();
    });

    it("getValidJwt refreshes when only refresh token is stored", async () => {
      const storage = new InMemoryTokenStorage();
      storage.setRefreshToken("only-refresh");
      const s = new SimpleJwtLogin(host, { tokenStorage: storage });

      (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValueOnce(
          JSON.stringify({ success: true, data: { jwt: "recovered-jwt" } }),
        ),
      });

      const result = await s.getValidJwt();
      expect(result).toBe("recovered-jwt");
    });

    it("getValidJwt returns JWT directly when not expiring soon", async () => {
      const jwt = buildJwt(3600); // expires in 1 hour
      sdk.setTokens(jwt);
      const result = await sdk.getValidJwt();
      expect(result).toBe(jwt);
    });

    it("getValidJwt triggers silent refresh when JWT is about to expire", async () => {
      const expiredJwt = buildJwt(10); // expires in 10s (< default 60s threshold)
      const freshJwt = "fresh-jwt-token";

      sdk.setTokens(expiredJwt, "my-refresh-token");

      (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValueOnce(
          JSON.stringify({ success: true, data: { jwt: freshJwt, refresh_token: "new-refresh" } }),
        ),
      });

      const result = await sdk.getValidJwt();
      expect(result).toBe(freshJwt);
      expect(sdk.getJwt()).toBe(freshJwt);
      // Ensure refresh_token is prioritized over JWT in request body
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/auth/refresh"),
        expect.objectContaining({
          body: JSON.stringify({ refresh_token: "my-refresh-token" }),
        }),
      );
    });

    it("getValidJwt uses JWT fallback when no refresh token is stored", async () => {
      const expiredJwt = buildJwt(10);
      const freshJwt = "fresh-jwt-token";

      sdk.setTokens(expiredJwt); // No refresh token

      (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValueOnce(
          JSON.stringify({ success: true, data: { jwt: freshJwt } }),
        ),
      });

      const result = await sdk.getValidJwt();
      expect(result).toBe(freshJwt);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/auth/refresh"),
        expect.objectContaining({
          body: JSON.stringify({ JWT: expiredJwt }),
        }),
      );
    });

    it("handles JWT with base64url characters (- and _) correctly", async () => {
      // Create a payload that produces '+' and '/' in base64, replaced with '-' and '_'
      const exp = Math.floor(Date.now() / 1000) + 3600;
      // Payload designed to trigger base64 characters
      const json = JSON.stringify({ exp, sub: "user-123", test: "???>>><<<" });
      const b64 = Buffer.from(json).toString("base64");
      const b64url = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const b64urlJwt = `header.${b64url}.signature`;

      sdk.setTokens(b64urlJwt);
      const result = await sdk.getValidJwt();
      expect(result).toBe(b64urlJwt);
    });

    it("getValidJwt clears tokens and fires onSessionExpired on 401/403 auth rejection", async () => {
      const onSessionExpired = jest.fn();
      const s = new SimpleJwtLogin(host, { onSessionExpired });
      const expiredJwt = buildJwt(10);
      s.setTokens(expiredJwt, "bad-refresh");

      (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: jest.fn().mockResolvedValueOnce(
          JSON.stringify({ success: false, error_code: 51, data: { message: "Refresh token expired" } }),
        ),
      });

      const result = await s.getValidJwt();
      expect(result).toBeNull();
      expect(s.getJwt()).toBeNull();
      expect(s.getRefreshToken()).toBeNull();
      expect(onSessionExpired).toHaveBeenCalledTimes(1);
      expect(onSessionExpired.mock.calls[0][0]).toBeInstanceOf(SimpleJwtLoginApiError);
    });

    it("PWA resilience: preserves tokens on network failure or 5xx error during silent refresh", async () => {
      const onSessionExpired = jest.fn();
      const s = new SimpleJwtLogin(host, { onSessionExpired });
      // Already expired JWT (-30s) + valid refresh token
      const expiredJwt = buildJwt(-30);
      s.setTokens(expiredJwt, "durable-refresh-token");

      // 1. Offline / network error
      (globalThis.fetch as jest.Mock).mockRejectedValueOnce(new TypeError("Failed to fetch"));
      const offlineResult = await s.getValidJwt();
      expect(offlineResult).toBeNull();
      // Crucial for PWA: refresh_token must NOT be wiped!
      expect(s.getRefreshToken()).toBe("durable-refresh-token");
      expect(onSessionExpired).not.toHaveBeenCalled();

      // 2. Temporary 503 Server Error
      (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: jest.fn().mockResolvedValueOnce("Service Unavailable"),
      });
      const serverErrorResult = await s.getValidJwt();
      expect(serverErrorResult).toBeNull();
      expect(s.getRefreshToken()).toBe("durable-refresh-token");

      // 3. Connectivity returns -> refresh succeeds seamlessly without re-login!
      (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValueOnce(
          JSON.stringify({ success: true, data: { jwt: "recovered-jwt", refresh_token: "rotated-refresh" } }),
        ),
      });
      const recoveredResult = await s.getValidJwt();
      expect(recoveredResult).toBe("recovered-jwt");
      expect(s.getRefreshToken()).toBe("rotated-refresh");
    });

    it("PWA resilience: returns still-valid JWT if proactive refresh fails due to offline network", async () => {
      // JWT expires in 30s (within 60s threshold, so proactive refresh triggers, but token is still valid!)
      const soonExpiringJwt = buildJwt(30);
      sdk.setTokens(soonExpiringJwt, "my-refresh");

      (globalThis.fetch as jest.Mock).mockRejectedValueOnce(new TypeError("Network error"));

      const result = await sdk.getValidJwt();
      expect(result).toBe(soonExpiringJwt);
      expect(sdk.getRefreshToken()).toBe("my-refresh");
    });

    it("PWA multi-tab recovery: uses updated JWT from storage if another tab refreshed concurrently", async () => {
      const storage = new InMemoryTokenStorage();
      const s = new SimpleJwtLogin(host, { tokenStorage: storage });
      const oldJwt = buildJwt(-10);
      const newTabJwt = buildJwt(3600);
      s.setTokens(oldJwt, "old-refresh");

      (globalThis.fetch as jest.Mock).mockImplementationOnce(async () => {
        // Simulate another tab updating shared storage before this tab's request fails with 401
        storage.setJwt(newTabJwt);
        storage.setRefreshToken("new-tab-refresh");
        return {
          ok: false,
          status: 401,
          text: async () => JSON.stringify({ success: false, error_code: 51 }),
        };
      });

      const result = await s.getValidJwt();
      expect(result).toBe(newTabJwt);
      expect(s.getRefreshToken()).toBe("new-tab-refresh");
    });

    it("concurrent getValidJwt calls deduplicate the refresh request", async () => {
      const expiredJwt = buildJwt(10);
      sdk.setTokens(expiredJwt, "refresh");

      (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValueOnce(
          JSON.stringify({ success: true, data: { jwt: "fresh-jwt" } }),
        ),
      });

      // Fire two concurrent calls
      const [r1, r2] = await Promise.all([sdk.getValidJwt(), sdk.getValidJwt()]);
      expect(r1).toBe("fresh-jwt");
      expect(r2).toBe("fresh-jwt");
      // Only one fetch call should have been made
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
  });

  // ── fetchWithAuth (WordPress REST API helper) ───────────────────────────────

  describe("fetchWithAuth", () => {
    it("attaches Authorization Bearer header and resolves relative paths against host", async () => {
      const validJwt = buildJwt(3600);
      sdk.setTokens(validJwt, "refresh-tok");

      (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ items: [] }),
      });

      const response = await sdk.fetchWithAuth("/wp-json/my-plugin/v1/items", {
        method: "POST",
        headers: { "X-Custom": "1" },
      });

      expect(response.status).toBe(200);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(calledUrl).toBe("http://example.com/wp-json/my-plugin/v1/items");
      const headers = calledInit.headers as Headers;
      expect(headers.get("Authorization")).toBe(`Bearer ${validJwt}`);
      expect(headers.get("X-Custom")).toBe("1");
    });

    it("automatically forces token refresh and retries once on 401 response (clock skew / revoked JWT)", async () => {
      const initialJwt = buildJwt(3600); // appears valid locally, but rejected by WP
      const refreshedJwt = buildJwt(7200);
      sdk.setTokens(initialJwt, "my-refresh-token");

      // 1st call: WP plugin API returns 401
      // 2nd call: /auth/refresh returns new JWT
      // 3rd call: retried WP plugin API returns 200
      (globalThis.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          text: async () => "Expired token",
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              success: true,
              data: { jwt: refreshedJwt, refresh_token: "new-refresh-token" },
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ ok: true }),
        });

      const response = await sdk.fetchWithAuth("http://example.com/wp-json/my-plugin/v1/profile");
      expect(response.status).toBe(200);
      expect(globalThis.fetch).toHaveBeenCalledTimes(3);

      const retryHeaders = (globalThis.fetch as jest.Mock).mock.calls[2][1].headers as Headers;
      expect(retryHeaders.get("Authorization")).toBe(`Bearer ${refreshedJwt}`);
    });
  });

  // ── autologin ───────────────────────────────────────────────────────────────

  describe("autologin", () => {
    it("should generate the correct autologin URL", () => {
      const params = { JWT: "my-jwt-token", redirectUrl: "/dashboard" };
      const url = sdk.autologin(params);
      expect(url).toBe(
        "http://example.com/?rest_route=/simple-jwt-login/v1/autologin&JWT=my-jwt-token&redirectUrl=%2Fdashboard",
      );
    });

    it("should append authCode if provided", () => {
      const params = { JWT: "my-jwt-token" };
      const url = sdk.autologin(params, "secret123");
      expect(url).toBe(
        "http://example.com/?rest_route=/simple-jwt-login/v1/autologin&JWT=my-jwt-token&AUTH_KEY=secret123",
      );
    });
  });

  // ── authenticate ────────────────────────────────────────────────────────────

  describe("authenticate", () => {
    it("should POST to /auth and auto-store tokens (v4 response format)", async () => {
      const mockResponse = {
        success: true,
        data: { jwt: "new-jwt", refresh_token: "new-refresh" },
      };
      (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValueOnce(JSON.stringify(mockResponse)),
      });

      const params: AuthenticateInterface = { login: "user@example.com", password: "pass" };
      const result = await sdk.authenticate(params);

      expect(result).toEqual(mockResponse);
      expect(sdk.getJwt()).toBe("new-jwt");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://example.com/?rest_route=/simple-jwt-login/v1/auth",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("should call onTokenRefreshed callback after silent refresh", async () => {
      const onTokenRefreshed = jest.fn();
      const s = new SimpleJwtLogin(host, { onTokenRefreshed });

      const expiredJwt = buildJwt(10);
      s.setTokens(expiredJwt, "old-refresh");

      (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValueOnce(
          JSON.stringify({ success: true, data: { jwt: "refreshed-jwt", refresh_token: "new-refresh" } }),
        ),
      });

      await s.getValidJwt();
      expect(onTokenRefreshed).toHaveBeenCalledWith("refreshed-jwt", "new-refresh");
    });

    it("should support legacy username/password fields", async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValueOnce(
          JSON.stringify({ success: true, data: { jwt: "tok" } }),
        ),
      });

      const params: AuthenticateInterface = {
        username: "myuser",
        password: "mypass",
      };
      const result = await sdk.authenticate(params);
      expect(result.data.jwt).toBe("tok");
    });

    it("should handle HTTP errors gracefully", async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: jest.fn().mockResolvedValueOnce("Unauthorized"),
      });

      await expect(
        sdk.authenticate({ login: "wrong", password: "bad" }),
      ).rejects.toThrow(SimpleJwtLoginApiError);
    });

    it("should handle HTTP errors with error code", async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: jest.fn().mockResolvedValueOnce(
          JSON.stringify({ success: false, error_code: 48, data: { message: "Invalid credentials" } })
        ),
      });

      try {
        await sdk.authenticate({ login: "wrong", password: "bad" });
        fail("Should have thrown an error");
      } catch (error) {
        expect(error).toBeInstanceOf(SimpleJwtLoginApiError);
        expect((error as SimpleJwtLoginApiError).status).toBe(401);
        expect((error as SimpleJwtLoginApiError).errorCode).toBe(48);
        expect((error as SimpleJwtLoginApiError).message).toBe("Invalid credentials");
        expect((error as SimpleJwtLoginApiError).toPluginFormat()).toEqual({
          success: false,
          error_code: 48,
          errorCode: 48,
          data: { message: "Invalid credentials" },
        });
      }
    });

    it("should expose ERROR_CODES constants", () => {
      expect(ERROR_CODES.INVALID_CREDENTIALS).toBe(48);
      expect(ERROR_CODES.AUTH_CODE_INVALID).toBe(27);
      expect(ERROR_CODES.JWT_EXPIRED).toBe(12);
      expect(ERROR_CODES.REFRESH_TOKEN_NOT_FOUND).toBe(51);
    });

    it("should use refresh_token parameter as per plugin v4 API", async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValueOnce(
          JSON.stringify({ success: true, data: { jwt: "new-jwt", refresh_token: "new-refresh" } })
        ),
      });

      const result = await sdk.refreshToken({ refresh_token: "my-refresh-token" });

      expect(result.data.jwt).toBe("new-jwt");
      expect(result.data.refresh_token).toBe("new-refresh");
      // Verify the request body contains refresh_token (plugin v4 API format)
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://example.com/?rest_route=/simple-jwt-login/v1/auth/refresh",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ refresh_token: "my-refresh-token" }),
        })
      );
    });

    it("should fall back to JWT parameter for backward compatibility", async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValueOnce(
          JSON.stringify({ success: true, data: { jwt: "new-jwt" } })
        ),
      });

      const result = await sdk.refreshToken({ JWT: "my-jwt-token" });

      expect(result.data.jwt).toBe("new-jwt");
      // Verify the request body contains JWT (backward compatibility)
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://example.com/?rest_route=/simple-jwt-login/v1/auth/refresh",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ JWT: "my-jwt-token" }),
        })
      );
    });
  });

  // ── validateToken & User Endpoints ──────────────────────────────────────────

  describe("validateToken & User Endpoints", () => {
    it("should make a GET request to /auth/validate", async () => {
      const mockResponse = {
        success: true,
        data: {
          user: { ID: "1", user_login: "admin", user_email: "a@b.com", display_name: "Admin" },
          roles: ["administrator"],
        },
      };
      (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValueOnce(JSON.stringify(mockResponse)),
      });

      const result = await sdk.validateToken({ JWT: "token-to-validate" });

      expect(result).toEqual(mockResponse);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://example.com/?rest_route=/simple-jwt-login/v1/auth/validate&JWT=token-to-validate",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("should register a user with only required fields (email & password)", async () => {
      const mockResponse = { success: true, data: { id: 42 } };
      (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValueOnce(JSON.stringify(mockResponse)),
      });

      const result = await sdk.registerUser({
        email: "new@example.com",
        password: "secret",
        first_name: "John",
      });

      expect(result.data?.id).toBe(42);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://example.com/?rest_route=/simple-jwt-login/v1/users",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            email: "new@example.com",
            password: "secret",
            first_name: "John",
          }),
        }),
      );
    });

    it("should support revokeToken, deleteUser, resetPassword, and changePassword", async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        text: jest.fn().mockResolvedValue(JSON.stringify({ success: true })),
      });

      await sdk.revokeToken({ JWT: "tok" });
      expect(globalThis.fetch).toHaveBeenLastCalledWith(
        "http://example.com/?rest_route=/simple-jwt-login/v1/auth/revoke",
        expect.objectContaining({ method: "POST" }),
      );

      await sdk.deleteUser({ JWT: "tok" }, "auth-del");
      expect(globalThis.fetch).toHaveBeenLastCalledWith(
        "http://example.com/?rest_route=/simple-jwt-login/v1/users",
        expect.objectContaining({
          method: "DELETE",
          body: JSON.stringify({ JWT: "tok", AUTH_KEY: "auth-del" }),
        }),
      );

      await sdk.resetPassword({ email: "a@b.com" });
      expect(globalThis.fetch).toHaveBeenLastCalledWith(
        "http://example.com/?rest_route=/simple-jwt-login/v1/user/reset_password",
        expect.objectContaining({ method: "POST" }),
      );

      await sdk.changePassword({ email: "a@b.com", new_password: "new", code: "123" });
      expect(globalThis.fetch).toHaveBeenLastCalledWith(
        "http://example.com/?rest_route=/simple-jwt-login/v1/user/reset_password",
        expect.objectContaining({ method: "PUT" }),
      );
    });
  });

  // ── InMemoryTokenStorage ────────────────────────────────────────────────────

  describe("InMemoryTokenStorage", () => {
    it("should store and retrieve tokens", () => {
      const storage = new InMemoryTokenStorage();
      expect(storage.getJwt()).toBeNull();
      storage.setJwt("test-jwt");
      storage.setRefreshToken("test-refresh");
      expect(storage.getJwt()).toBe("test-jwt");
      expect(storage.getRefreshToken()).toBe("test-refresh");
      storage.clearTokens();
      expect(storage.getJwt()).toBeNull();
      expect(storage.getRefreshToken()).toBeNull();
    });
  });

  // ── LocalStorageTokenStorage ────────────────────────────────────────────────

  describe("LocalStorageTokenStorage", () => {
    beforeEach(() => {
      // Mock localStorage
      const store: Record<string, string> = {};
      globalThis.localStorage = {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, val: string) => { store[key] = val; },
        removeItem: (key: string) => { delete store[key]; },
        clear: () => { Object.keys(store).forEach(k => delete store[k]); },
        length: 0,
        key: () => null,
      };
    });

    it("should persist tokens in localStorage with prefix", () => {
      const storage = new LocalStorageTokenStorage("myapp");
      storage.setJwt("jwt-value");
      storage.setRefreshToken("refresh-value");
      expect(storage.getJwt()).toBe("jwt-value");
      expect(storage.getRefreshToken()).toBe("refresh-value");
      storage.clearTokens();
      expect(storage.getJwt()).toBeNull();
    });
  });

  // ── CookieTokenStorage ────────────────────────────────────────────────────────

  describe("CookieTokenStorage", () => {
    let cookieStore: Record<string, string>;

    beforeEach(() => {
      // Mock document.cookie using a simple store
      cookieStore = {};
      
      // Helper to get cookie string
      const getCookieString = () => {
        return Object.entries(cookieStore)
          .map(([k, v]) => `${k}=${v}`)
          .join("; ");
      };

      // Helper to set cookie from string
      const setCookieFromString = (cookieString: string) => {
        if (cookieString === "") {
          cookieStore = {};
          return;
        }
        // Simple parsing - just handle the first key=value pair
        // (full cookie parsing is complex, this is enough for testing)
        const firstSemicolon = cookieString.indexOf(";");
        const cookiePart = firstSemicolon === -1 ? cookieString : cookieString.substring(0, firstSemicolon);
        const equalsIndex = cookiePart.indexOf("=");
        if (equalsIndex !== -1) {
          const key = cookiePart.substring(0, equalsIndex).trim();
          const value = cookiePart.substring(equalsIndex + 1).trim();
          cookieStore[key] = value;
        }
      };

      globalThis.document = {
        get cookie(): string {
          return getCookieString();
        },
        set cookie(value: string) {
          setCookieFromString(value);
        },
      } as unknown as Document;
    });

    afterEach(() => {
      // Clean up: remove document from globalThis
      // @ts-expect-error - Deleting global property for test cleanup
      delete globalThis.document;
    });

    it("should store and retrieve tokens in cookies", () => {
      const storage = new CookieTokenStorage("myapp");
      storage.setJwt("jwt-value");
      storage.setRefreshToken("refresh-value");
      expect(storage.getJwt()).toBe("jwt-value");
      expect(storage.getRefreshToken()).toBe("refresh-value");
    });

    it("should clear tokens from cookies", () => {
      const storage = new CookieTokenStorage("myapp");
      storage.setJwt("jwt-value");
      storage.setRefreshToken("refresh-value");
      storage.clearTokens();
      expect(storage.getJwt()).toBeNull();
      expect(storage.getRefreshToken()).toBeNull();
    });

    it("should use custom prefix for cookie names", () => {
      const storage = new CookieTokenStorage("custom");
      storage.setJwt("test-jwt");
      // The cookie should be set
      expect(cookieStore).toHaveProperty("custom_jwt");
      expect(cookieStore["custom_jwt"]).toBe("test-jwt");
    });

    it("should correctly encode and decode cookies with special characters", () => {
      const storage = new CookieTokenStorage("myapp");
      const specialJwt = "header.payload.signature?val=1&foo=bar;baz,qux";
      const specialRefresh = "refresh=token;special/value";
      storage.setJwt(specialJwt);
      storage.setRefreshToken(specialRefresh);
      expect(storage.getJwt()).toBe(specialJwt);
      expect(storage.getRefreshToken()).toBe(specialRefresh);
    });

    it("should return null in SSR environment without document", () => {
      const originalDocument = globalThis.document;
      // @ts-expect-error - We're deleting document for testing
      delete globalThis.document;

      const storage = new CookieTokenStorage("myapp");
      storage.setJwt("jwt-value");
      expect(storage.getJwt()).toBeNull();

      globalThis.document = originalDocument;
    });
  });
});
