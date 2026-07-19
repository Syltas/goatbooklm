import type { SupabaseClient } from "@supabase/supabase-js"

import type {
  LoginOtpRequestInput,
  LoginOtpVerifyInput,
  LoginPasswordInput,
  SignupInput,
} from "./schema"

/**
 * Pure auth service — the Supabase client is injected, never imported, so
 * the same logic works from a Server Action, a Route Handler, or a test
 * with a stub client. All methods either return the raw Supabase result the
 * caller needs or throw the Supabase `AuthError` on failure.
 */
export function createAuthService(client: SupabaseClient) {
  return new AuthService(client)
}

class AuthService {
  constructor(private readonly client: SupabaseClient) {}

  async signInWithPassword(data: LoginPasswordInput) {
    const { error } = await this.client.auth.signInWithPassword(data)
    if (error) throw error
  }

  async requestOtp(data: LoginOtpRequestInput) {
    const { error } = await this.client.auth.signInWithOtp({
      email: data.email,
      // Login-by-code must never silently create an account — that is what
      // /signup is for. Note this is not a perfect anti-enumeration
      // boundary: Supabase's API responds differently for an email with no
      // account (an error, since it cannot create one) than for a known
      // email (a sent code), so the response already reveals account
      // existence at the API layer regardless of what we do here.
      options: { shouldCreateUser: false },
    })
    if (error) throw error
  }

  async verifyOtp(data: LoginOtpVerifyInput) {
    const { error } = await this.client.auth.verifyOtp({
      email: data.email,
      token: data.token,
      type: "email",
    })
    if (error) throw error
  }

  async signUp(data: SignupInput) {
    const { data: result, error } = await this.client.auth.signUp({
      email: data.email,
      password: data.password,
    })
    if (error) throw error
    return result
  }

  async signOut() {
    const { error } = await this.client.auth.signOut()
    if (error) throw error
  }
}
