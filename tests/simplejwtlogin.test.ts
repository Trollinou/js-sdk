import { AuthenticateInterface } from "../src/Requests/AuthenticateInterface";
import { SimpleJwtLogin } from "../src/simplejwtlogin";

describe("SimpleJwtLogin", () => {
  const host = "http://example.com";
  let sdk: SimpleJwtLogin;

  beforeEach(() => {
    sdk = new SimpleJwtLogin(host);

    // Mock the global fetch
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Constructor", () => {
    it("should initialize with default values", () => {
      const defaultSdk = new SimpleJwtLogin(host);
      expect((defaultSdk as unknown as Record<string, string>).host).toBe(host);
      expect((defaultSdk as unknown as Record<string, string>).namespace).toBe("/simple-jwt-login/v1");
      expect((defaultSdk as unknown as Record<string, string>).authCodeKey).toBe("AUTH_KEY");
    });

    it("should initialize with custom values", () => {
      const customSdk = new SimpleJwtLogin(host, "/custom/v1", "CUSTOM_KEY");
      expect((customSdk as unknown as Record<string, string>).host).toBe(host);
      expect((customSdk as unknown as Record<string, string>).namespace).toBe("/custom/v1");
      expect((customSdk as unknown as Record<string, string>).authCodeKey).toBe("CUSTOM_KEY");
    });
  });

  describe("autologin", () => {
    it("should generate the correct autologin URL", () => {
      const params = { JWT: "my-jwt-token", redirectUrl: "/dashboard" };
      const url = sdk.autologin(params);

      expect(url).toBe(
        "http://example.com/?rest_route=/simple-jwt-login/v1/autologin&JWT=my-jwt-token&redirectUrl=%2Fdashboard"
      );
    });

    it("should append authCode if provided", () => {
      const params = { JWT: "my-jwt-token", redirectUrl: null };
      const url = sdk.autologin(params, "secret123");

      expect(url).toBe(
        "http://example.com/?rest_route=/simple-jwt-login/v1/autologin&JWT=my-jwt-token&AUTH_KEY=secret123"
      );
    });
  });

  describe("API requests", () => {
    it("should make a POST request to authenticate", async () => {
      const mockResponse = { success: true, data: { jwt: "new-token" } };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValueOnce(JSON.stringify(mockResponse)),
      });

      const params = { username: "user", password: "password", email: "test@example.com", password_hash: "hash" };
      const result = await sdk.authenticate(params as unknown as AuthenticateInterface);

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://example.com/?rest_route=/simple-jwt-login/v1/auth",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json;charset=UTF-8",
          },
          body: JSON.stringify(params),
        }
      );
    });

    it("should make a GET request to validate token", async () => {
      const mockResponse = { success: true };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValueOnce(JSON.stringify(mockResponse)),
      });

      const params = { JWT: "token-to-validate" };
      const result = await sdk.validateToken(params);

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://example.com/?rest_route=/simple-jwt-login/v1/auth/validate&JWT=token-to-validate",
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json;charset=UTF-8",
          },
        }
      );
    });

    it("should handle HTTP errors gracefully", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: jest.fn().mockResolvedValueOnce("Unauthorized"),
      });

      const params = { username: "wrong", password: "user", email: "test@example.com", password_hash: "hash" };

      await expect(sdk.authenticate(params as unknown as AuthenticateInterface)).rejects.toThrow("HTTP Error: 401 - Unauthorized");
    });
  });
});
