# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

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
