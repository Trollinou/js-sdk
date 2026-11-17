export interface RegisterUserInterface {
  email: string;
  password: string;

  user_login?: string | null;
  user_nicename?: string | null;
  user_url?: string | null;
  display_name?: string | null;
  nickname?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  description?: string | null;
  rich_editing?: string | null;
  syntax_highlighting?: string | null;
  comment_shortcuts?: string | null;
  admin_color?: string | null;
  use_ssl?: boolean | null;
  user_registered?: string | null;
  user_activation_key?: string | null;
  spam?: string | null;
  show_admin_bar_front?: string | null;
  locale?: string | null;

  /**
   * Custom user metadata to store on registration.
   * Note: Since WordPress plugin v4.1.0+, meta keys ending in `capabilities`,
   * `user_level`, or `session_tokens` are always ignored by the server even if
   * listed in "Allowed user meta".
   */
  user_meta?: Record<string, unknown> | object | null;

  [key: string]: string | number | null | boolean | object | undefined;
}
