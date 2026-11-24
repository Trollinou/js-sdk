# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

## [1.2.1] - 2026-11-24

### Added

- **Error Codes (`4.2.1` alignment)**: Added WordPress plugin `4.2.0`/`4.2.1` constants to `ERROR_CODES`: `JWT_USER_PROPERTY_NOT_FOUND` (`29`), `JWT_USER_PARAMETER_NOT_FOUND` (`30`), `CHANGE_PASSWORD_MISSING_CODE` (`60`), `OAUTH_INVALID_STATE` (`129`), `JWT_AUDIENCE_MISMATCH` (`130`), `REFRESH_TOKEN_STORE_FAILED` (`131`), `API_KEY_INVALID_EXPIRY` (`132`), and `TWO_FACTOR_NONCE_CREATE_FAILED` (`133`)

### Changed

- **Documentation & JSDoc (`4.2.0`/`4.2.1` alignment)**: Updated `README.md`, `CHANGELOG.md`, `AuthenticateResponse`, and `SimpleJwtLogin` JSDoc with WordPress `>= 6.2` requirement for plugin `>= 4.2.0`, real HTTP status codes (`401`/`403`/`404`/`422`/`429`), anti-enumeration HTTP `200` behavior on `resetPassword()`, single-use 2FA nonces and refresh tokens, `wp_authenticate()` / reserved `aud` claims on `authenticate()`, and password-change session revocation on `changePassword()`

## [1.2.0] - 2026-11-17

### Added

- **WordPress Plugin >= 4.1.1 Prerequisite**: Documented minimum required plugin version (`>= 4.1.1`) and mandatory cross-origin CORS ("Allow origin") configuration introduced by plugin v4.1.1 anti-CSRF enforcement
- **2FA Support**: Added `verifyTwoFactor()` (`POST /auth/2fa`) and `VerifyTwoFactorInterface`, plus `two_factor_required` and `provider` fields on `AuthenticateResponse`
- **Error Codes**: Added new plugin v4.0–v4.1.1 constants to `ERROR_CODES` (Protect Endpoints `75`/`114`, 2FA `105`–`110`, OAuth, API Keys, Revoked Tokens, Registration, AI Abilities `120`–`128`)

### Fixed

- **2FA Interim JWT Handling**: `authenticate()` no longer stores the interim challenge JWT in `tokenStorage` when `response.data.two_factor_required` is `true`
- **Error Codes Alignment**: Fixed misaligned `ERROR_CODES` values against WordPress plugin `ErrorCodes.php` (`JWT_EXPIRED`: `14`, `JWT_NOT_BEFORE`: `12`, `USER_NOT_FOUND`: `24`, `USER_ALREADY_EXISTS`: `38`, `REGISTRATION_DISABLED`: `31`, `REGISTRATION_MISSING_FIELDS`: `35`)

## [1.1.4] - 2026-11-07

### Security

- **fetchWithAuth**: Prevented Bearer JWT token leakage by strictly validating target URL origin against the configured host origin before attaching `Authorization` header (CWE-200 / CWE-522)
- **CookieTokenStorage**:
  - Sanitized cookie `path` and `domain` options against CRLF and `;` characters to prevent cookie attribute injection (CWE-113)
  - Automatically enabled `Secure` flag on HTTPS or when `SameSite=None` is specified (CWE-614)
  - Added security documentation and JSDoc notices regarding client-side refresh token storage risks (CWE-312)
- **URL & Protocol Validation**: Enforced URL validation in `SimpleJwtLogin` constructor, strictly allowing only `http:` and `https:` protocols and rejecting pseudo-protocols (`javascript:`, `data:`, etc.) (CWE-20)
- **autologin**: Sanitized and validated `redirectUrl` against dangerous pseudo-protocols (`javascript:`, `data:`, `vbscript:`) to prevent Open Redirect and DOM-based XSS (CWE-601 / CWE-79)
- **queryData**: Replaced `for...in` loop with `Object.entries()` and filtered out prototype keys (`__proto__`, `constructor`, `prototype`) against prototype pollution (CWE-1321)
- **Base64 Decoding**: Refactored `atobPolyfill` to use `TextDecoder` / standard `Buffer.from()` with proper UTF-8 decoding and removed `any` cast
- **CI / Build**:
  - Added clean build script (`npm run clean`) to purge `dist/` before TypeScript compilation, preventing leftover test files in published npm bundles
  - Updated CI workflow to use `npm ci` and added automated security audit (`npm audit`)

### Added

- **Unit Tests**: Added security test coverage for cross-origin token isolation, URL/protocol validation, dangerous redirect protocols, and cookie attribute sanitization

---

## [1.1.3] - 2026-10-13

### Added

- **Packaging**: Added `"files": ["dist"]` in `package.json` to strictly whitelist published artifacts
- **Scripts**: Added `test:coverage` and `prepublishOnly` lifecycle hook scripts
- **Tests**: Added tests for silent refresh token prioritization, base64url JWT decoding, and cookie URL encoding

### Changed

- **Dependencies**: Moved `eslint-config-prettier` and `typescript-eslint` from `dependencies` to `devDependencies`
- **Build**: Excluded `tests/` from TypeScript compilation in `tsconfig.json` to prevent shipping tests in the distribution bundle

### Fixed

- **Silent Refresh**: `silentRefresh()` now correctly prioritizes the stored `refresh_token` over sending the expiring `JWT`
- **JWT Expiry**: Fixed `isJwtExpiringSoon` for JWT payloads using standard `base64url` characters (`-`, `_`) and unpadded payloads
- **CookieTokenStorage**: Added URI encoding and decoding (`encodeURIComponent` / `decodeURIComponent`) for cookies with special characters

### Deprecated

- **CookieOptions.httpOnly**: Deprecated `httpOnly` option as client-side `document.cookie` cannot set HTTP-only cookies in browsers

---

## [1.1.1] - 2026-08-24

### Fixed

- **ESM Compatibility**: Fixed `ReferenceError: exports is not defined in ES module scope` when imported in ESM / Vite / Vitest environments
  - Updated `tsconfig.json` to compile modules with `"module": "ES2022"` and `"moduleResolution": "bundler"` while maintaining `"target": "es2021"`
  - Added `types`, `module`, and `exports` map to `package.json`
  - Updated Jest config to ignore `dist/` directory

---

## [1.1.0] - 2025-08-18

### Added

- **CookieTokenStorage**: New token storage implementation using HTTP-only cookies for traditional web applications
  - Configurable options: `secure`, `httpOnly`, `sameSite`, `maxAgeDays`, `path`, `domain`
  - Automatic environment detection (gracefully handles SSR/Node.js)
  - Exported: `CookieTokenStorage`, `CookieOptions`

- **Enhanced Error Handling**: New typed error system matching WordPress plugin v4 error format
  - `SimpleJwtLoginApiError`: Extended `Error` class with `status`, `errorCode`, `message`, and `responseData`
  - `toPluginFormat()`: Converts error to plugin's standard format `{ success: false, error_code, data: { message } }`
  - `isErrorCode(code)`: Type-safe error code checking
  - `ERROR_CODES`: Complete object of all plugin v4 error codes (48, 27, 12, 55, etc.)
  - `SimpleJwtLoginErrorCode`: TypeScript type for error codes

- **SSR/Node.js Support**: Full compatibility with server-side rendering frameworks
  - `LocalStorageTokenStorage`: Safely handles environments without `localStorage`
  - `CookieTokenStorage`: Safely handles environments without `document`
  - Base64 polyfills: `atob` and `btoa` work in Node.js < 16 via Buffer fallback
  - All operations return `null` or no-op when API is unavailable

### Changed

- **RefreshTokenInterface**: Now uses `refresh_token` as the primary parameter (as per [plugin v4 API](https://simplejwtlogin.com/api/v4/refresh-jwt))
  - Backward compatible: `JWT` parameter still works
  - The SDK now prioritizes `refresh_token` > `JWT` > stored refresh token

- **tsconfig.json**: Added `"node"` to types for Buffer support

### Fixed

- **LocalStorageTokenStorage**: No longer crashes in SSR/Node.js environments
  - All methods check for `localStorage` availability
  - Returns `null` for getters, no-op for setters when unavailable

- **JWT Expiry Checking**: Now works in Node.js environments
  - Uses polyfill for `atob` when native function is unavailable

### Deprecated

- **JWT parameter in refreshToken**: Use `refresh_token` instead for plugin v4 compliance

---

## [1.0.0] - 2025-08-14

### Added

- **Pluggable Token Storage**: Interface-based storage system
  - `InMemoryTokenStorage`: Default, tokens lost on page reload
  - `LocalStorageTokenStorage`: Persistent storage for PWAs
  - Custom implementations via `TokenStorage` interface

- **Silent JWT Refresh**: Automatic token renewal with `getValidJwt()`
  - Concurrent-safe with request deduplication
  - Proactive refresh before expiry (configurable threshold)
  - `onTokenRefreshed` callback for token updates

- **New Response Types**: Full TypeScript support for plugin v4
  - `AuthenticateResponse`
  - `RegisterUserResponse`
  - `ValidateTokenResponse`
  - `SimpleJwtLoginErrorResponse`

- **login field**: `AuthenticateInterface` now accepts `login` (email OR username) for plugin v3.6+

- **payload field**: Custom JWT claims support in `AuthenticateInterface`

- **Test Suite**: 34 unit tests using Jest and ts-jest

### Changed

- **Constructor**: Now accepts options object instead of positional arguments
  ```typescript
  // Before (v0.x): new SimpleJwtLogin(host, namespace, authCodeKey)
  // After (v1.x):  new SimpleJwtLogin(host, { namespace, authCodeKey })
  ```

- **registerUser response**: Updated to match plugin v4 format
  ```typescript
  // Before (plugin v3): { success: true, ID: 42 }
  // After (plugin v4):  { success: true, data: { id: 42 } }
  ```

- **TypeScript Configuration**: Fixed for proper test resolution

### Removed

- **XMLHttpRequest**: Replaced with native `fetch` API
- **withCallback pattern**: Replaced with Promise-based async/await

---

## [0.1.5] - 2024

### Added

- Initial release of Simple-JWT-Login JavaScript SDK
- Basic JWT authentication support
- WordPress REST API integration

[Unreleased]: https://github.com/Trollinou/js-sdk/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Trollinou/js-sdk/compare/v0.1.5...v1.0.0
