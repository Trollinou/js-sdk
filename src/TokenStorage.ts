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

  getJwt(): string | null {
    return localStorage.getItem(this.jwtKey);
  }

  setJwt(jwt: string): void {
    localStorage.setItem(this.jwtKey, jwt);
  }

  getRefreshToken(): string | null {
    return localStorage.getItem(this.refreshKey);
  }

  setRefreshToken(token: string): void {
    localStorage.setItem(this.refreshKey, token);
  }

  clearTokens(): void {
    localStorage.removeItem(this.jwtKey);
    localStorage.removeItem(this.refreshToken);
  }

  /** @internal */
  private get refreshToken(): string {
    return this.refreshKey;
  }
}
