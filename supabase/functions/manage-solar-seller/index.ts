import { createClient } from 'npm:@supabase/supabase-js@2.111.0';

const ALLOWED_ORIGINS = new Set([
  'https://cdse.com.mx',
  'https://www.cdse.com.mx',
  'http://localhost:4321',
  'http://127.0.0.1:4321',
]);

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function cors(origin: string | null): HeadersInit {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://www.cdse.com.mx';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function response(origin: string | null, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function text(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string') throw new Error(`${field} es obligatorio.`);
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length < min || normalized.length > max) {
    throw new Error(`${field} no es válido.`);
  }
  return normalized;
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (request.method !== 'POST') return response(origin, 405, { error: 'METHOD_NOT_ALLOWED' });

  try {
    const authorization = request.headers.get('authorization');
    if (!authorization?.startsWith('Bearer ')) {
      return response(origin, 401, { error: 'AUTH_REQUIRED' });
    }

    const url = env('SUPABASE_URL');
    const anonKey = env('SUPABASE_ANON_KEY');
    const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
    const callerClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const serviceClient = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) return response(origin, 401, { error: 'INVALID_SESSION' });

    const { data: caller } = await serviceClient
      .from('solar_profiles')
      .select('role, active')
      .eq('user_id', userData.user.id)
      .maybeSingle();
    if (!caller?.active || caller.role !== 'admin') {
      return response(origin, 403, { error: 'ADMIN_REQUIRED' });
    }

    const payload = await request.json();
    const action = payload.action ?? 'create';

    if (action === 'create') {
      const fullName = text(payload.fullName, 'Nombre', 2, 120);
      const email = text(payload.email, 'Correo', 5, 254).toLowerCase();
      const password = text(payload.password, 'Contraseña temporal', 10, 128);
      const commissionRate = Number(payload.commissionRate ?? 5);
      if (!Number.isFinite(commissionRate) || commissionRate < 5 || commissionRate > 10) {
        throw new Error('La comisión debe estar entre 5 y 10 por ciento.');
      }

      const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, portal: 'solar' },
      });
      if (createError || !created.user) throw createError ?? new Error('No se creó el usuario.');

      const { error: profileError } = await serviceClient.from('solar_profiles').insert({
        user_id: created.user.id,
        full_name: fullName,
        role: 'seller',
        active: true,
        commission_rate: commissionRate,
        created_by: userData.user.id,
      });
      if (profileError) {
        await serviceClient.auth.admin.deleteUser(created.user.id);
        throw profileError;
      }

      return response(origin, 201, {
        seller: {
          userId: created.user.id,
          fullName,
          email,
          commissionRate,
          active: true,
        },
      });
    }

    const userId = text(payload.userId, 'Vendedor', 36, 36);
    if (action === 'update') {
      const updates: Record<string, unknown> = {};
      if (payload.fullName !== undefined) updates.full_name = text(payload.fullName, 'Nombre', 2, 120);
      if (payload.commissionRate !== undefined) {
        const rate = Number(payload.commissionRate);
        if (!Number.isFinite(rate) || rate < 5 || rate > 10) {
          throw new Error('La comisión debe estar entre 5 y 10 por ciento.');
        }
        updates.commission_rate = rate;
      }
      if (payload.active !== undefined) updates.active = Boolean(payload.active);

      const { data, error } = await serviceClient
        .from('solar_profiles')
        .update(updates)
        .eq('user_id', userId)
        .eq('role', 'seller')
        .select()
        .single();
      if (error) throw error;
      return response(origin, 200, { seller: data });
    }

    if (action === 'password') {
      const password = text(payload.password, 'Contraseña temporal', 10, 128);
      const { error } = await serviceClient.auth.admin.updateUserById(userId, { password });
      if (error) throw error;
      return response(origin, 200, { updated: true });
    }

    return response(origin, 400, { error: 'INVALID_ACTION' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo administrar el vendedor.';
    return response(origin, 400, { error: 'REQUEST_FAILED', message });
  }
});
