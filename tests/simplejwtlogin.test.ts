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
  });

  // ── Token Management ────────────────────────────────────────────────────────

  describe("Token Management", () => {
    it("setTokens / getJwt / clearTokens", () => {
      sdk.setTokens("my-jwt", "my-refresh");
      expect(sdk.getJwt()).toBe("my-jwt");
      sdk.clearTokens();
      expect(sdk.getJwt()).toBeNull();
    });

    it("getValidJwt returns null when no JWT is stored", async () => {
      const result = await sdk.getValidJwt();
      expect(result).toBeNull();
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
    });

    it("getValidJwt clears tokens and returns null when refresh fails", async () => {
      const expiredJwt = buildJwt(10);
      sdk.setTokens(expiredJwt, "bad-refresh");

      (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: jest.fn().mockResolvedValueOnce("Unauthorized"),
      });

      const result = await sdk.getValidJwt();
      expect(result).toBeNull();
      expect(sdk.getJwt()).toBeNull();
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
      const params = { JWT: "my-jwt-token", redirectUrl: null };
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

  // ── validateToken ───────────────────────────────────────────────────────────

  describe("validateToken", () => {
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
