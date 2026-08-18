<p align="center">
    <img src="https://ps.w.org/simple-jwt-login/assets/banner-772x250.png?rev=2106097" alt="Banner"/>
</p>
<p align="center">
   <img src="https://img.shields.io/npm/dt/simple-jwt-login" alt="npm downloads" />
   <img src="https://img.shields.io/badge/plugin-v4.x-blue" alt="Plugin compatibility" />
   <img src="https://img.shields.io/badge/version-1.0.0-green" alt="SDK version" />
</p>

# Simple-JWT-Login SDK

JavaScript/TypeScript SDK for the [**Simple-JWT-Login**](https://wordpress.org/plugins/simple-jwt-login/) WordPress plugin.

Compatible with **plugin v4.x** — includes **silent token refresh** for PWA/SPA use cases.

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Token Management](#token-management)
  - [Token Storage](#token-storage)
  - [Silent Refresh](#silent-refresh)
- [API Reference](#api-reference)
- [Response Types (v4)](#response-types-v4)
- [Migration from v0.x](#migration-from-v0x)
- [Changelog](#changelog)

---

## Installation

```bash
npm install simple-jwt-login
# or
yarn add simple-jwt-login
```

---

## Quick Start

```typescript
import { SimpleJwtLogin, LocalStorageTokenStorage } from "simple-jwt-login";

// 1. Create the SDK instance (once, as a singleton)
const sdk = new SimpleJwtLogin("https://your-wordpress.com", {
  tokenStorage: new LocalStorageTokenStorage("my-app"),
});

// 2. Authenticate
const response = await sdk.authenticate({ login: "user@example.com", password: "secret" });
// JWT and refresh token are automatically stored

// 3. Get a fresh JWT for protected API calls (auto-refresh if needed)
const jwt = await sdk.getValidJwt();
fetch("https://your-wordpress.com/wp-json/wc/v3/orders", {
  headers: { Authorization: `Bearer ${jwt}` },
});

// 4. Logout
sdk.clearTokens();
```

---

## Configuration

```typescript
new SimpleJwtLogin(host, options?)
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `namespace` | `string` | `"/simple-jwt-login/v1"` | Route namespace — must match plugin settings |
| `authCodeKey` | `string` | `"AUTH_KEY"` | Auth code parameter name — must match plugin settings |
| `tokenStorage` | `TokenStorage` | `InMemoryTokenStorage` | Where to persist JWT and refresh token |
| `onTokenRefreshed` | `(jwt, refreshToken) => void` | — | Callback fired after every successful silent refresh |
| `refreshBeforeExpirySeconds` | `number` | `60` | Trigger proactive refresh this many seconds before expiry |

```typescript
import { SimpleJwtLogin, LocalStorageTokenStorage } from "simple-jwt-login";

const sdk = new SimpleJwtLogin("https://your-wordpress.com", {
  namespace: "/simple-jwt-login/v1",
  authCodeKey: "AUTH_KEY",
  tokenStorage: new LocalStorageTokenStorage("my-app"),
  refreshBeforeExpirySeconds: 60,
  onTokenRefreshed: (jwt, refreshToken) => {
    console.log("Tokens silently refreshed");
  },
});
```

---

## Server-Side Rendering (SSR) & Node.js Support

The SDK is fully compatible with **Server-Side Rendering** frameworks like Next.js, Nuxt, and Node.js environments:

### Automatic Environment Detection

All token storage implementations automatically detect their environment:

- **`LocalStorageTokenStorage`**: Returns `null` for all operations if `localStorage` is not available (SSR)
- **`CookieTokenStorage`**: Returns `null` for all operations if `document` is not available (SSR)
- **`InMemoryTokenStorage`**: Works in all environments (recommended for SSR)

### Base64 Polyfills

The SDK includes polyfills for `atob` and `btoa` functions, ensuring compatibility with:
- Modern browsers (native support)
- Node.js 16+ (native support)
- Node.js < 16 (Buffer fallback)

This means JWT decoding (for expiry checking) works seamlessly in all environments.

### Recommended Usage

| Environment | Recommended Storage | Reason |
|-------------|---------------------|--------|
| **PWA / Client-side SPA** | `LocalStorageTokenStorage` | Tokens persist across page reloads |
| **SSR / Next.js / Nuxt** | `InMemoryTokenStorage` or `CookieTokenStorage` | No `localStorage` in SSR |
| **Traditional Web App** | `CookieTokenStorage` | HTTP-only cookies for security |
| **Node.js Scripts** | `InMemoryTokenStorage` | No browser APIs available |

---

## Token Management

### Token Storage

Three options are available out of the box:

#### `InMemoryTokenStorage` (default)

Tokens are stored in memory and lost on page reload. Suitable for server-side rendering or testing.

```typescript
import { SimpleJwtLogin } from "simple-jwt-login";

const sdk = new SimpleJwtLogin("https://your-wordpress.com");
// Uses InMemoryTokenStorage by default
```

#### `LocalStorageTokenStorage` (recommended for PWA)

Tokens survive page reloads and are keyed by a prefix to avoid collisions.

```typescript
import { SimpleJwtLogin, LocalStorageTokenStorage } from "simple-jwt-login";

const sdk = new SimpleJwtLogin("https://your-wordpress.com", {
  tokenStorage: new LocalStorageTokenStorage("my-app"),
  // Keys used: "my-app:jwt" and "my-app:refresh_token"
});
```

#### Custom Storage

Implement the `TokenStorage` interface to use any backend (IndexedDB, SecureStorage, etc.):

```typescript
import { SimpleJwtLogin, TokenStorage } from "simple-jwt-login";

class MySecureStorage implements TokenStorage {
  getJwt() { return secureGet("jwt"); }
  setJwt(jwt: string) { secureSet("jwt", jwt); }
  getRefreshToken() { return secureGet("refresh"); }
  setRefreshToken(token: string) { secureSet("refresh", token); }
  clearTokens() { secureClear("jwt"); secureClear("refresh"); }
}

const sdk = new SimpleJwtLogin("https://your-wordpress.com", {
  tokenStorage: new MySecureStorage(),
});
```

#### `CookieTokenStorage`

Cookie-based storage for traditional web applications that require HTTP-only cookies:

```typescript
import { SimpleJwtLogin, CookieTokenStorage } from "simple-jwt-login";

const sdk = new SimpleJwtLogin("https://your-wordpress.com", {
  tokenStorage: new CookieTokenStorage("my-app", {
    secure: true,        // HTTPS only (recommended for production)
    httpOnly: false,     // Allow JavaScript access (set to true for HTTP-only)
    sameSite: "Lax",     // CSRF protection: "Lax", "Strict", or "None"
    maxAgeDays: 7,       // Cookie expiry in days
    path: "/",           // Cookie path (default: "/")
    domain: "example.com" // Cookie domain (optional)
  }),
});
```

> **Note:** In SSR/Node.js environments where `document` is not available, all cookie operations will safely return `null` or no-op.

### Silent Refresh

After authentication, the SDK automatically manages token renewal:

```typescript
// After login, tokens are stored automatically
await sdk.authenticate({ login: "user@example.com", password: "pass" });

// getValidJwt() always returns a non-expired JWT
// → if the JWT expires within 60s, a refresh call is made silently
// → concurrent calls are deduplicated (only one HTTP request)
// → if refresh fails, tokens are cleared and null is returned
const jwt = await sdk.getValidJwt();

if (!jwt) {
  // User session expired — redirect to login
}
```

**Manually managing tokens** (e.g., restoring from a database):

```typescript
sdk.setTokens(jwt, refreshToken);  // restore tokens
sdk.getJwt();                       // current JWT (may be expired)
await sdk.getValidJwt();            // fresh JWT (auto-refresh if needed)
sdk.clearTokens();                  // logout
```

### Error Handling

All API errors are thrown as `SimpleJwtLoginApiError` instances with full type information and plugin-compatible format:

```typescript
import { SimpleJwtLogin, SimpleJwtLoginApiError, ERROR_CODES } from "simple-jwt-login";

try {
  await sdk.authenticate({ login: "user@example.com", password: "wrong" });
} catch (error) {
  if (error instanceof SimpleJwtLoginApiError) {
    // Typed error with plugin-compatible information
    console.log(error.status);       // HTTP status code (401, 403, 422, etc.)
    console.log(error.errorCode);   // Plugin-specific error code (48, 27, 55, etc.)
    console.log(error.message);      // Human-readable error message
    
    // Check against known error codes
    if (error.isErrorCode(ERROR_CODES.INVALID_CREDENTIALS)) {
      // Handle invalid credentials (error_code: 48)
      console.log("Please check your email and password");
    } else if (error.isErrorCode(ERROR_CODES.JWT_EXPIRED)) {
      // Handle expired JWT (error_code: 12)
      console.log("Your session has expired, please log in again");
    } else if (error.isErrorCode(ERROR_CODES.AUTH_CODE_INVALID)) {
      // Handle invalid auth code (error_code: 27)
      console.log("Invalid authentication code");
    }
    
    // Convert to plugin's standard error format
    const pluginError = error.toPluginFormat();
    // Result: { success: false, error_code: 48, data: { message: "Invalid credentials" } }
    
    // Send error to your logging service
    console.error(pluginError);
  }
}
```

**Available error codes (from `ERROR_CODES`):**

| Code | Constant | Description |
|------|---------|-------------|
| 48 | `INVALID_CREDENTIALS` | Email/username or password is incorrect |
| 27 | `AUTH_CODE_INVALID` | The provided auth code is wrong |
| 12 | `JWT_EXPIRED` | JWT has expired |
| 11 | `JWT_SIGNATURE_INVALID` | JWT signature verification failed |
| 55 | `JWT_REVOKED` | JWT has been revoked |
| 51 | `REFRESH_TOKEN_NOT_FOUND` | Refresh token not found/expired |
| 45 | `AUTH_DISABLED` | Authentication is disabled in plugin settings |
| 41 | `IP_NOT_ALLOWED` | Client IP not on allow-list |
| 53 | `JWT_MISSING` | JWT is missing from request |
| 81 | `REFRESH_TOKEN_DISABLED` | Refresh token feature is disabled |
| 82 | `VALIDATION_DISABLED` | JWT validation is disabled |
| 83 | `REVOCATION_DISABLED` | Token revocation is disabled |

---

## API Reference

### `authenticate(params, authCode?)`

Exchange credentials for a JWT. Tokens are stored automatically.

```typescript
const response = await sdk.authenticate({
  login: "user@example.com",  // email OR username (plugin v3.6+)
  // or: email: "user@example.com"
  // or: username: "myuser"
  password: "secret",
  payload: { app: "my-pwa" }, // optional: extra claims merged into JWT
}, "optional-auth-code");

// response.data.jwt         → JWT token
// response.data.refresh_token → refresh token (plugin v4+)
```

### `autologin(params, authCode?)`

Generate a magic-link URL for browser-based auto-login.

```typescript
const url = sdk.autologin({
  JWT: "user-jwt-token",
  redirectUrl: "/dashboard", // optional
}, "optional-auth-code");

// → "https://your-wp.com/?rest_route=/simple-jwt-login/v1/autologin&JWT=...&redirectUrl=..."
// Redirect the browser to this URL to log the user in
```

### `validateToken(params, authCode?)`

Validate a JWT and retrieve the associated user information.

```typescript
const response = await sdk.validateToken({ JWT: "token-to-validate" });

// response.data.user   → { ID, user_login, user_email, display_name }
// response.data.roles  → ["subscriber"]
```

### `refreshToken(params, authCode?)`

Exchange the current JWT for a new one. Tokens are stored automatically.

```typescript
const response = await sdk.refreshToken({ JWT: "current-jwt" });
// response.data.jwt          → new JWT
// response.data.refresh_token → new refresh token
```

### `revokeToken(params, authCode?)`

Revoke (server-side blacklist) a JWT. Call this on logout.

```typescript
const jwt = sdk.getJwt();
await sdk.revokeToken({ JWT: jwt! });
sdk.clearTokens();
```

### `registerUser(params, authCode?)`

Create a new WordPress user.

> **⚠️ v4 breaking change** — Response format changed:
> - Before v4: `{ success: true, ID: 42 }`
> - Since v4: `{ success: true, data: { id: 42 } }`

```typescript
const response = await sdk.registerUser({
  email: "new@example.com",
  password: "secure-password",
  first_name: "John",
  last_name: "Doe",
  user_meta: { custom_field: "value" },
});

const userId = response.data?.id; // v4
```

### `deleteUser(params, authCode?)`

Delete the WordPress user identified by the JWT.

```typescript
await sdk.deleteUser({ JWT: "user-jwt-to-delete" }, "auth-code");
```

### `resetPassword(params, authCode?)`

Send a password reset email to the given address.

```typescript
await sdk.resetPassword({ email: "user@example.com" });
```

### `changePassword(params, authCode?)`

Set a new password using the code received by email, or a valid JWT.

```typescript
await sdk.changePassword({
  email: "user@example.com",
  new_password: "new-secure-password",
  code: "reset-code-from-email", // or: JWT: "valid-jwt"
});
```

---

## Response Types (v4)

All response types are exported for use in your TypeScript code:

```typescript
import type {
  AuthenticateResponse,        // POST /auth
  RegisterUserResponse,        // POST /users
  ValidateTokenResponse,       // GET  /auth/validate
  SimpleJwtLoginErrorResponse, // Error shape (plugin format)
} from "simple-jwt-login";
```

### Error Types

For enhanced error handling:

```typescript
import type {
  SimpleJwtLoginApiError,    // Typed error class
  SimpleJwtLoginErrorCode,   // Error code type
} from "simple-jwt-login";

// Access all known error codes
import { ERROR_CODES } from "simple-jwt-login";
// ERROR_CODES.INVALID_CREDENTIALS, ERROR_CODES.JWT_EXPIRED, etc.
```

---

## Migration from v0.x

### Constructor

```typescript
// v0.x (positional arguments — removed)
new SimpleJwtLogin(host, "/simple-jwt-login/v1", "AUTH_KEY");

// v1.x (options object)
new SimpleJwtLogin(host, {
  namespace: "/simple-jwt-login/v1",
  authCodeKey: "AUTH_KEY",
});
```

### registerUser response

```typescript
// Plugin v3 → { success: true, ID: 42 }
const id = response.ID;

// Plugin v4 → { success: true, data: { id: 42 } }
const id = response.data?.id;
```

### authenticate response

```typescript
// Plugin v4 adds refresh_token to the response
const { jwt, refresh_token } = response.data;
```

---

## Changelog

### v1.1.0 (Unreleased)
- **New**: `CookieTokenStorage` for HTTP-only cookie-based token persistence with configurable options
- **New**: `CookieOptions` interface for cookie configuration (secure, httpOnly, sameSite, maxAgeDays, path, domain)
- **New**: `SimpleJwtLoginApiError` class for typed error handling with plugin-compatible format
- **New**: `ERROR_CODES` constants object with all WordPress plugin v4 error codes
- **New**: Base64 polyfills (`atob`/`btoa`) for Node.js < 16 compatibility
- **Fix**: `RefreshTokenInterface` now uses `refresh_token` as primary parameter (per [plugin v4 API](https://simplejwtlogin.com/api/v4/refresh-jwt)) with backward-compatible `JWT` fallback
- **Fix**: `LocalStorageTokenStorage` safely handles SSR/Node.js environments (returns null when unavailable)
- **Fix**: JWT expiry checking now works in Node.js environments via polyfill
- **Fix**: Added `@types/node` to TypeScript configuration for Buffer type support
- **New**: 16 additional unit tests for error handling and cookie storage (total: 50 tests)
- **Compatibility**: Full compliance with Simple-JWT-Login WordPress plugin v4.x

### v1.0.0
- **Breaking change**: constructor now accepts an options object instead of positional arguments
- **New**: silent JWT refresh with `getValidJwt()` — concurrent-safe, auto-deduplication
- **New**: pluggable `TokenStorage` — `InMemoryTokenStorage`, `LocalStorageTokenStorage`, or custom
- **New**: `onTokenRefreshed` callback
- **New**: response types for plugin v4 (`AuthenticateResponse`, `RegisterUserResponse`, `ValidateTokenResponse`)
- **New**: `login` field in `AuthenticateInterface` (plugin v3.6+ — accepts email or username)
- **New**: `payload` field in `AuthenticateInterface` (custom JWT claims)
- **Fix**: TypeScript configuration — tests now correctly resolved by `ts-jest`
- **Compatibility**: WordPress plugin v4.x

### v0.1.5
- Initial release
