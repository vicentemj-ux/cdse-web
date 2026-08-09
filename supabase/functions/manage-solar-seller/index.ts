import { createClient } from 'npm:@supabase/supabase-js@2.111.0';

const ALLOWED_ORIGINS = new Set([
  'https://cdse.com.mx',
  'https://www.cdse.com.mx',
  'http://localhost:4321',
  'http://127.0.0.1:4321',
]);
const STAFF_ROLES = new Set(['seller', 'operations', 'engineering', 'installer', 'finance', 'viewer']);

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
  if (normalized.length < min || normalized.length > max) throw new Error(`${field} no es válido.`);
  return normalized;
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (request.method !== 'POST') return response(origin, 405, { error: 'METHOD_NOT_ALLOWED' });

  try {
    const authorization = request.headers.get('authorization');
    if (!authorization?.startsWith('Bearer ')) return response(origin, 401, { error: 'AUTH_REQUIRED' });

    const url = env('SUPABASE_URL');
    const callerClient = createClient(url, env('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: authorization } }, auth: { persistSession: false },
    });
    const serviceClient = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) return response(origin, 401, { error: 'INVALID_SESSION' });
    const { data: caller } = await serviceClient.from('solar_profiles').select('role,active').eq('user_id', userData.user.id).maybeSingle();
    if (!caller?.active || caller.role !== 'admin') return response(origin, 403, { error: 'ADMIN_REQUIRED' });

    const payload = await request.json();
    const action = payload.action ?? 'create';

    if (action === 'create') {
      const fullName = text(payload.fullName, 'Nombre', 2, 120);
      const email = text(payload.email, 'Correo', 5, 254).toLowerCase();
      const password = text(payload.password, 'Contraseña temporal', 10, 128);
      const role = typeof payload.role === 'string' && STAFF_ROLES.has(payload.role) ? payload.role : 'seller';
      const commissionRate = role === 'seller' ? Number(payload.commissionRate ?? 5) : 0;
      if (role === 'seller' && (!Number.isFinite(commissionRate) || commissionRate < 5 || commissionRate > 10)) {
        throw new Error('La comisión debe estar entre 5 y 10 por ciento.');
      }

      const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name: fullName, portal: 'solar', role },
      });
      if (createError || !created.user) throw createError ?? new Error('No se creó el usuario.');

      const { error: profileError } = await serviceClient.from('solar_profiles').insert({
        user_id: created.user.id, full_name: fullName, role, active: true,
        commission_rate: commissionRate, created_by: userData.user.id,
      });
      if (profileError) {
        await serviceClient.auth.admin.deleteUser(created.user.id);
        throw profileError;
      }
      await serviceClient.from('solar_access_events').insert({
        target_user_id: created.user.id, event_type: 'profile_created', role,
        actor_user_id: userData.user.id, metadata: { email },
      });
      return response(origin, 201, { staff: { userId: created.user.id, fullName, email, role, commissionRate, active: true } });
    }

    const userId = text(payload.userId, 'Integrante', 36, 36);
    if (action === 'update') {
      const { data: target } = await serviceClient.from('solar_profiles').select('role,active').eq('user_id', userId).maybeSingle();
      if (!target) throw new Error('No se encontró el perfil.');
      if (target.role === 'admin') throw new Error('El perfil administrador se protege desde la consola de administración.');
      const updates: Record<string, unknown> = {};
      if (payload.fullName !== undefined) updates.full_name = text(payload.fullName, 'Nombre', 2, 120);
      if (payload.commissionRate !== undefined) {
        const rate = Number(payload.commissionRate);
        if (target.role === 'seller' && (!Number.isFinite(rate) || rate < 5 || rate > 10)) throw new Error('La comisión debe estar entre 5 y 10 por ciento.');
        updates.commission_rate = target.role === 'seller' ? rate : 0;
      }
      if (payload.active !== undefined) updates.active = Boolean(payload.active);
      if (!Object.keys(updates).length) throw new Error('No hay cambios para guardar.');

      const { data, error } = await serviceClient.from('solar_profiles').update(updates).eq('user_id', userId).select().single();
      if (error) throw error;
      const changedActive = payload.active !== undefined && Boolean(payload.active) !== target.active;
      await serviceClient.from('solar_access_events').insert({
        target_user_id: userId,
        event_type: changedActive ? (Boolean(payload.active) ? 'access_restored' : 'access_suspended') : 'profile_updated',
        role: target.role, actor_user_id: userData.user.id, metadata: { changedFields: Object.keys(updates) },
      });
      return response(origin, 200, { staff: data });
    }

    if (action === 'password') {
      const password = text(payload.password, 'Contraseña temporal', 10, 128);
      const { error } = await serviceClient.auth.admin.updateUserById(userId, { password });
      if (error) throw error;
      return response(origin, 200, { updated: true });
    }
    return response(origin, 400, { error: 'INVALID_ACTION' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo administrar el acceso del equipo.';
    return response(origin, 400, { error: 'REQUEST_FAILED', message });
  }
});
