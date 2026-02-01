/**
 * Supabase Auth
 *
 * Authentication wrapper for Supabase Auth.
 * Handles user sign-in, sign-out, and session management.
 */

import { getSupabaseClient, isSupabaseInitialized } from "./client";
import type { AuthResult, SupabaseUser, SupabaseSession } from "./types";

// =============================================================================
// Auth Functions
// =============================================================================

/**
 * Sign in with email and password
 */
export async function signInWithEmail(
  email: string,
  password: string
): Promise<AuthResult> {
  if (!isSupabaseInitialized()) {
    return { success: false, error: "Supabase not initialized" };
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      user: data.user as SupabaseUser,
      session: data.session as SupabaseSession,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Sign in failed",
    };
  }
}

/**
 * Sign up with email and password
 */
export async function signUpWithEmail(
  email: string,
  password: string,
  metadata?: Record<string, unknown>
): Promise<AuthResult> {
  if (!isSupabaseInitialized()) {
    return { success: false, error: "Supabase not initialized" };
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: metadata,
      },
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      user: data.user as SupabaseUser,
      session: data.session as SupabaseSession,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Sign up failed",
    };
  }
}

/**
 * Sign in with magic link (passwordless)
 */
export async function signInWithMagicLink(email: string): Promise<AuthResult> {
  if (!isSupabaseInitialized()) {
    return { success: false, error: "Supabase not initialized" };
  }

  try {
    const client = getSupabaseClient();
    const { error } = await client.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: undefined, // Uses default from Supabase dashboard
      },
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Magic link failed",
    };
  }
}

/**
 * Sign in with OAuth provider
 */
export async function signInWithOAuth(
  provider: "github" | "google" | "gitlab" | "bitbucket"
): Promise<AuthResult> {
  if (!isSupabaseInitialized()) {
    return { success: false, error: "Supabase not initialized" };
  }

  try {
    const client = getSupabaseClient();
    const { error } = await client.auth.signInWithOAuth({
      provider,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "OAuth failed",
    };
  }
}

/**
 * Sign out current user
 */
export async function signOut(): Promise<AuthResult> {
  if (!isSupabaseInitialized()) {
    return { success: false, error: "Supabase not initialized" };
  }

  try {
    const client = getSupabaseClient();
    const { error } = await client.auth.signOut();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Sign out failed",
    };
  }
}

/**
 * Get current session
 */
export async function getSession(): Promise<SupabaseSession | null> {
  if (!isSupabaseInitialized()) {
    return null;
  }

  try {
    const client = getSupabaseClient();
    const { data } = await client.auth.getSession();
    return data.session as SupabaseSession | null;
  } catch {
    return null;
  }
}

/**
 * Get current user
 */
export async function getUser(): Promise<SupabaseUser | null> {
  if (!isSupabaseInitialized()) {
    return null;
  }

  try {
    const client = getSupabaseClient();
    const { data } = await client.auth.getUser();
    return data.user as SupabaseUser | null;
  } catch {
    return null;
  }
}

/**
 * Refresh the session
 */
export async function refreshSession(): Promise<AuthResult> {
  if (!isSupabaseInitialized()) {
    return { success: false, error: "Supabase not initialized" };
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client.auth.refreshSession();

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      user: data.user as SupabaseUser,
      session: data.session as SupabaseSession,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Refresh failed",
    };
  }
}

/**
 * Update user metadata
 */
export async function updateUser(
  updates: { email?: string; password?: string; data?: Record<string, unknown> }
): Promise<AuthResult> {
  if (!isSupabaseInitialized()) {
    return { success: false, error: "Supabase not initialized" };
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client.auth.updateUser(updates);

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      user: data.user as SupabaseUser,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Update failed",
    };
  }
}

/**
 * Reset password (sends email)
 */
export async function resetPassword(email: string): Promise<AuthResult> {
  if (!isSupabaseInitialized()) {
    return { success: false, error: "Supabase not initialized" };
  }

  try {
    const client = getSupabaseClient();
    const { error } = await client.auth.resetPasswordForEmail(email);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Reset failed",
    };
  }
}

/**
 * Verify OTP (for magic link or phone)
 */
export async function verifyOtp(
  token: string,
  type: "email" | "sms" = "email",
  email?: string
): Promise<AuthResult> {
  if (!isSupabaseInitialized()) {
    return { success: false, error: "Supabase not initialized" };
  }

  try {
    const client = getSupabaseClient();
    
    // Build the verification params
    const verifyParams: { token: string; type: "email" | "sms"; email?: string } = {
      token,
      type,
    };
    
    if (email) {
      verifyParams.email = email;
    }
    
    const { data, error } = await client.auth.verifyOtp(verifyParams as Parameters<typeof client.auth.verifyOtp>[0]);

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      user: data.user as SupabaseUser,
      session: data.session as SupabaseSession,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Verification failed",
    };
  }
}
