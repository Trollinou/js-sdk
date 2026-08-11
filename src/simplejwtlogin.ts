import { AuthenticateInterface } from "./Requests/AuthenticateInterface";
import { AutologinInterface } from "./Requests/AutologinInterface";
import { ChangePasswordInterface } from "./Requests/ChangePasswordInterface";
import { DeleteUserInterface } from "./Requests/DeleteUserInterface";
import { RefreshTokenInterface } from "./Requests/RefreshTokenInterface";
import { RegisterUserInterface } from "./Requests/RegisterUserInterface";
import { ResetPasswordInterface } from "./Requests/ResetPasswordInterface";
import { RevokeTokenInterface } from "./Requests/RevokeTokenInterface";
import { ValidateTokenInterface } from "./Requests/ValidateTokenInterface";
export class SimpleJwtLogin {
  private host: string;
  private namespace = "/simple-jwt-login/v1";
  private authCodeKey = "AUTH_KEY";

  /**
   * @param host WordPress instance domain
   * @param namespace Simple-JWT-Login route namespace. Optional. Default to /simple-jwt-login/v1
   * @param authCodeKey Simple-JWT-Login AUTH_CODE_KEY. Optional. Default to AUTH_KEY
   */
  constructor(host: string, namespace = "", authCodeKey = "") {
    this.host = host;
    if (authCodeKey !== "") {
      this.authCodeKey = authCodeKey;
    }
    if (namespace !== "") {
      this.namespace = namespace;
    }
  }

  /**
   * @param params Request parameters
   * @param authCode AuthCode value. Optional
   */
  public autologin(params: AutologinInterface, authCode = "") {
    if (authCode !== "") {
      params[this.authCodeKey] = authCode;
    }

    return this.buildUrl() + "/autologin&" + this.queryData(params);
  }

  /**
   * @param params Request parameters
   * @param authCode AuthCode value. Optional
   */
  public deleteUser(params: DeleteUserInterface, authCode = "") {
    if (authCode !== "") {
      params[this.authCodeKey] = authCode;
    }

    return this.call("DELETE", "/users", params);
  }

  /**
   * @param params Request parameters
   * @param authCode AuthCode value. Optional
   */
  public registerUser(params: RegisterUserInterface, authCode = "") {
    if (authCode !== "") {
      params[this.authCodeKey] = authCode;
    }

    return this.call("POST", "/users", params);
  }

  /**
   * @param params Request parameters
   * @param authCode AuthCode value. Optional
   */
  public resetPassword(params: ResetPasswordInterface, authCode = "") {
    if (authCode !== "") {
      params[this.authCodeKey] = authCode;
    }
    return this.call("POST", "/user/reset_password", params);
  }

  /**
   * @param params Request parameters
   * @param authCode AuthCode value. Optional
   */
  public changePassword(params: ChangePasswordInterface, authCode = "") {
    if (authCode !== "") {
      params[this.authCodeKey] = authCode;
    }

    return this.call("PUT", "/user/reset_password", params);
  }

  /**
   * @param params Request parameters
   * @param authCode AuthCode value. Optional
   */
  public authenticate(params: AuthenticateInterface, authCode = "") {
    if (authCode !== "") {
      params[this.authCodeKey] = authCode;
    }

    return this.call("POST", "/auth", params);
  }

  /**
   * @param params Request parameters
   * @param authCode AuthCode value. Optional
   */
  public refreshToken(params: RefreshTokenInterface, authCode = "") {
    if (authCode !== "") {
      params[this.authCodeKey] = authCode;
    }

    return this.call("POST", "/auth/refresh", params);
  }

  /**
   * @param params Request parameters
   * @param authCode AuthCode value. Optional
   */
  public validateToken(params: ValidateTokenInterface, authCode = "") {
    if (authCode !== "") {
      params[this.authCodeKey] = authCode;
    }

    return this.call("GET", "/auth/validate", params);
  }

  /**
   * @param params Request parameters
   * @param authCode AuthCode value. Optional
   */
  public revokeToken(params: RevokeTokenInterface, authCode = "") {
    if (authCode !== "") {
      params[this.authCodeKey] = authCode;
    }

    return this.call("POST", "/auth/revoke", params);
  }

  private buildUrl() {
    return this.host + "/?rest_route=" + this.namespace;
  }

  private queryData(data: Record<string, unknown>) {
    const searchParams = new URLSearchParams();
    for (const d in data) {
      if (data[d] !== null && data[d] !== undefined) {
        searchParams.append(d, String(data[d]));
      }
    }
    return searchParams.toString();
  }

  /**
   * @param method Request method. One of: GET, POST, PUT, PATCH, DELETE
   * @param endpoint The endpoint that will be called
   * @param params Request parameters
   * @private
   */
  private async call<T = unknown, P extends Record<string, unknown> = Record<string, unknown>>(
    method: string,
    endpoint: string,
    params: P | null = null
  ): Promise<T> {
    let callUrl = this.buildUrl() + endpoint;
    const fetchOptions: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
      },
    };

    if (method === "GET" && params) {
      callUrl = callUrl + "&" + this.queryData(params as Record<string, unknown>);
    } else if (params) {
      fetchOptions.body = JSON.stringify(params);
    }

    const response = await fetch(callUrl, fetchOptions);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP Error: ${response.status} - ${errorText}`);
    }

    // Some API responses might be empty
    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;
  }
}
