/**
 * Pluggable token storage interface.
 * Implement this to persist tokens in localStorage, IndexedDB, SecureStorage, etc.
 * The SDK uses in-memory storage by default.
 */
export interface TokenStorage {
  getJwt(): string | null;
  setJwt(jwt: string): void;
  getRefreshToken(): string | null;
  setRefreshToken(token: string): void;
  clearTokens(): void;
}

/**
 * Default in-memory token storage.
 * Tokens are lost on page reload — suitable for testing or SSR.
 * For a PWA, use LocalStorageTokenStorage or a custom implementation.
 */
export class InMemoryTokenStorage implements TokenStorage {
  private jwt: string | null = null;
  private refreshToken: string | null = null;

  getJwt(): string | null {
    return this.jwt;
  }

  setJwt(jwt: string): void {
    this.jwt = jwt;
  }

  getRefreshToken(): string | null {
    return this.refreshToken;
  }

  setRefreshToken(token: string): void {
    this.refreshToken = token;
  }

  clearTokens(): void {
    this.jwt = null;
    this.refreshToken = null;
  }
}

/**
 * localStorage-based token storage.
 * Tokens survive page reloads — recommended for PWAs.
 *
 * @example
 * const sdk = new SimpleJwtLogin("https://example.com", {
 *   tokenStorage: new LocalStorageTokenStorage("myapp"),
 * });
 *
 * @note In SSR/Node.js environments where localStorage is not available,
 * all methods will silently return null or no-op. Use InMemoryTokenStorage
 * for server-side rendering.
 */
export class LocalStorageTokenStorage implements TokenStorage {
  private readonly jwtKey: string;
  private readonly refreshKey: string;

  /**
   * @param prefix Optional key prefix to namespace tokens (e.g. your app name).
   */
  constructor(prefix = "sjl") {
    this.jwtKey = `${prefix}:jwt`;
    this.refreshKey = `${prefix}:refresh_token`;
  }

  /**
   * Checks if localStorage is available in the current environment.
   * Returns false in SSR/Node.js or if localStorage is disabled.
   */
  private isLocalStorageAvailable(): boolean {
    try {
      return typeof localStorage !== "undefined" && localStorage !== null;
    } catch {
      return false;
    }
  }

  getJwt(): string | null {
    if (!this.isLocalStorageAvailable()) {
      return null;
    }
    try {
      return localStorage.getItem(this.jwtKey);
    } catch {
      return null;
    }
  }

  setJwt(jwt: string): void {
    if (!this.isLocalStorageAvailable()) {
      return;
    }
    try {
      localStorage.setItem(this.jwtKey, jwt);
    } catch {
      // Silently fail if localStorage is not accessible
    }
  }

  getRefreshToken(): string | null {
    if (!this.isLocalStorageAvailable()) {
      return null;
    }
    try {
      return localStorage.getItem(this.refreshKey);
    } catch {
      return null;
    }
  }

  setRefreshToken(token: string): void {
    if (!this.isLocalStorageAvailable()) {
      return;
    }
    try {
      localStorage.setItem(this.refreshKey, token);
    } catch {
      // Silently fail if localStorage is not accessible
    }
  }

  clearTokens(): void {
    if (!this.isLocalStorageAvailable()) {
      return;
    }
    try {
      localStorage.removeItem(this.jwtKey);
      localStorage.removeItem(this.refreshKey);
    } catch {
      // Silently fail if localStorage is not accessible
    }
  }
}

/**
 * Cookie-based token storage.
 * Tokens are stored in browser cookies (`document.cookie`) with configurable SameSite/Secure flags.
 * Recommended for web apps that share authentication state via client-side cookies.
 *
 * @example
 * const sdk = new SimpleJwtLogin("https://example.com", {
 *   tokenStorage: new CookieTokenStorage("myapp"),
 * });
 *
 * @note In SSR/Node.js environments where document is not available,
 * all methods will silently return null or no-op. Use InMemoryTokenStorage
 * for server-side rendering.
 */
export class CookieTokenStorage implements TokenStorage {
  private readonly jwtKey: string;
  private readonly refreshKey: string;

  /**
   * @param prefix Optional cookie name prefix to namespace tokens (e.g. your app name).
   * @param options Cookie options (default: 7 days expiry, SameSite=Lax)
   */
  constructor(prefix = "sjl", private readonly options: CookieOptions = {}) {
    this.jwtKey = `${prefix}_jwt`;
    this.refreshKey = `${prefix}_refresh_token`;
  }

  /**
   * Checks if document is available in the current environment.
   * Returns false in SSR/Node.js or if document is not available.
   */
  private isDocumentAvailable(): boolean {
    try {
      return typeof document !== "undefined" && document !== null;
    } catch {
      return false;
    }
  }

  /**
   * Gets a cookie value by name.
   */
  private getCookie(name: string): string | null {
    if (!this.isDocumentAvailable()) {
      return null;
    }
    try {
      const cookies = document.cookie ? document.cookie.split("; ") : [];
      const encodedName = encodeURIComponent(name);
      for (const cookie of cookies) {
        const [k, ...v] = cookie.split("=");
        if (k === encodedName || k === name) {
          const val = decodeURIComponent(v.join("="));
          return val || null;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Sets a cookie with the given value.
   */
  private setCookie(name: string, value: string, days: number = 7): void {
    if (!this.isDocumentAvailable()) {
      return;
    }
    try {
      const expiryDate = new Date();
      expiryDate.setTime(expiryDate.getTime() + days * 24 * 60 * 60 * 1000);
      const expires = `expires=${expiryDate.toUTCString()}`;
      const path = `path=${this.options.path || "/"}`;
      const sameSite = `SameSite=${this.options.sameSite || "Lax"}`;
      const secure = this.options.secure ? "; Secure" : "";
      const domain = this.options.domain ? `; domain=${this.options.domain}` : "";

      document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; ${expires}; ${path}; ${sameSite}${secure}${domain}`;
    } catch {
      // Silently fail if document.cookie is not accessible
    }
  }

  /**
   * Deletes a cookie by name.
   */
  private deleteCookie(name: string): void {
    if (!this.isDocumentAvailable()) {
      return;
    }
    try {
      const path = this.options.path ? `; path=${this.options.path}` : "; path=/";
      const domain = this.options.domain ? `; domain=${this.options.domain}` : "";
      document.cookie = `${encodeURIComponent(name)}=; expires=Thu, 01 Jan 1970 00:00:00 UTC${path}${domain}`;
    } catch {
      // Silently fail if document.cookie is not accessible
    }
  }

  getJwt(): string | null {
    return this.getCookie(this.jwtKey);
  }

  setJwt(jwt: string): void {
    this.setCookie(this.jwtKey, jwt, this.options.maxAgeDays || 7);
  }

  getRefreshToken(): string | null {
    return this.getCookie(this.refreshKey);
  }

  setRefreshToken(token: string): void {
    this.setCookie(this.refreshKey, token, this.options.maxAgeDays || 7);
  }

  clearTokens(): void {
    this.deleteCookie(this.jwtKey);
    this.deleteCookie(this.refreshKey);
  }
}

/**
 * Cookie storage options.
 */
export interface CookieOptions {
  /** Cookie path (default: "/") */
  path?: string;
  /** Cookie domain (optional) */
  domain?: string;
  /** Maximum age in days (default: 7) */
  maxAgeDays?: number;
  /** SameSite attribute (default: "Lax") */
  sameSite?: "Lax" | "Strict" | "None";
  /** Secure flag (default: false) - requires HTTPS */
  secure?: boolean;
  /**
   * @deprecated HttpOnly cannot be set via client-side document.cookie.
   * Browsers ignore HttpOnly directives when setting cookies through JavaScript.
   */
  httpOnly?: boolean;
}
