import { AuthenticateInterface } from "../src/Requests/AuthenticateInterface";
import { SimpleJwtLogin } from "../src/simplejwtlogin";
import { InMemoryTokenStorage, LocalStorageTokenStorage } from "../src/TokenStorage";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a JWT with a given expiry (seconds from now). exp=0 means already expired. */
function buildJwt(expInSeconds: number): string {
  const payload = { exp: Math.floor(Date.now() / 1000) + expInSeconds, sub: "1" };
  const encoded = btoa(JSON.stringify(payload));
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
      ).rejects.toThrow("HTTP Error: 401 - Unauthorized");
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
});
