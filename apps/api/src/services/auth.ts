import { jwtVerify } from 'jose';

const User = {
  user_id: (v: unknown) => {
    if (typeof v !== 'string' || v.length < 10) throw new Error('invalid user id');
    return v;
  },
  email: (v: unknown) => (typeof v === 'string' ? v : undefined)
};

export interface AuthUser {
  user_id: string;
  email?: string;
}

export async function verifyUser(token: string): Promise<AuthUser> {
  const mode = (process.env.AUTH_MODE ?? 'dev').toLowerCase();
  if (mode === 'dev') {
    if (token !== 'dev') throw new Error('dev token required');
    const userId = process.env.DEV_USER_ID;
    if (!userId) throw new Error('DEV_USER_ID is required when AUTH_MODE=dev');
    return { user_id: userId, email: 'dev@local' };
  }

  if (mode !== 'supabase') throw new Error(`Unknown AUTH_MODE: ${mode}`);

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  if (supabaseUrl && supabaseAnonKey) {
    const res = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey
      }
    });
    if (!res.ok) throw new Error('invalid token');
    const json = (await res.json()) as { id: string; email?: string };
    return { user_id: User.user_id(json.id), email: json.email };
  }

  // Legacy Supabase projects may still use an HS256 shared JWT secret. Modern
  // projects should configure URL + publishable/anon key and use /auth/v1/user.
  const jwtSecret = process.env.SUPABASE_JWT_SECRET;
  if (jwtSecret) {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(jwtSecret));
    return {
      user_id: User.user_id(payload.sub),
      email: User.email(payload.email)
    };
  }

  throw new Error('SUPABASE_URL + SUPABASE_ANON_KEY or legacy SUPABASE_JWT_SECRET required for Supabase auth');
}
