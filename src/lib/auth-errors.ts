// Maps a Supabase auth error to an i18n key so the auth forms never show the
// raw (English, technical) `error.message`. Unknown errors get `fallbackKey`.

interface AuthErrorLike {
  code?: string
  status?: number
  name?: string
  message?: string
}

const CODE_KEYS: Record<string, string> = {
  invalid_credentials: 'auth.loginError',
  user_already_exists: 'auth.emailInUse',
  email_exists: 'auth.emailInUse',
  email_not_confirmed: 'ui.screens.auth.errorEmailNotConfirmed',
  weak_password: 'ui.screens.auth.errorWeakPassword',
  same_password: 'ui.screens.auth.errorSamePassword',
  email_address_invalid: 'ui.screens.auth.errorInvalidEmail',
  validation_failed: 'ui.screens.auth.errorInvalidEmail',
  over_email_send_rate_limit: 'ui.screens.auth.errorRateLimit',
  over_request_rate_limit: 'ui.screens.auth.errorRateLimit',
  signup_disabled: 'ui.screens.auth.errorSignupDisabled',
  email_provider_disabled: 'ui.screens.auth.errorSignupDisabled',
  session_not_found: 'ui.screens.auth.errorSessionExpired',
  session_expired: 'ui.screens.auth.errorSessionExpired',
  refresh_token_not_found: 'ui.screens.auth.errorSessionExpired',
}

export function authErrorKey(error: AuthErrorLike | null | undefined, fallbackKey: string): string {
  if (!error) return fallbackKey
  if (error.code && CODE_KEYS[error.code]) return CODE_KEYS[error.code]

  // Older GoTrue servers send no code: fall back to the known messages.
  const message = error.message ?? ''
  if (message === 'Invalid login credentials') return 'auth.loginError'
  if (message.includes('already registered')) return 'auth.emailInUse'
  if (message.includes('Email not confirmed')) return 'ui.screens.auth.errorEmailNotConfirmed'

  if (error.status === 429) return 'ui.screens.auth.errorRateLimit'
  if (error.name === 'AuthRetryableFetchError') return 'ui.screens.auth.errorNetwork'
  if (error.name === 'AuthSessionMissingError') return 'ui.screens.auth.errorSessionExpired'

  return fallbackKey
}
