import { createClient } from 'npm:@supabase/supabase-js@2';

// A chave privilegiada fica apenas no ambiente da Edge Function.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export async function handleRequest(req, client) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Método não permitido.' });
  try {
    const token = req.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return reply(401, { error: 'Entre novamente no sistema.' });
    const { data: auth, error: authError } = await client.auth.getUser(token);
    if (authError || !auth?.user) return reply(401, { error: 'Sessão inválida.' });
    const { data: caller, error: callerError } = await client.from('profiles')
      .select('role, active').eq('id', auth.user.id).single();
    if (callerError || caller?.role !== 'admin' || caller.active === false)
      return reply(403, { error: 'Acesso restrito ao administrador.' });

    let body;
    try { body = await req.json(); } catch (_) { return reply(400, { error: 'Dados inválidos.' }); }
    if (!body || !['inspect', 'update'].includes(body.action) ||
        typeof body.profId !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.profId))
      return reply(400, { error: 'Professor ou operação inválidos.' });
    const { data: profile, error: profileError } = await client.from('profiles')
      .select('id, role, email').eq('id', body.profId).single();
    if (profileError || profile?.role !== 'professor')
      return reply(404, { error: 'Professor não encontrado.' });
    const { data: target, error: targetError } = await client.auth.admin.getUserById(body.profId);
    if (targetError || !target?.user) return reply(404, { error: 'Conta de acesso não encontrada.' });
    let user = target.user;
    if (body.action === 'update') {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return reply(400, { error: 'Informe um e-mail válido.' });
      if (typeof body.expectedEmail !== 'string' || body.expectedEmail !== (user.email || ''))
        return reply(409, { error: 'O e-mail mudou. Reabra a edição antes de salvar.' });
      if (email !== user.email) {
        const { data: changed, error: changeError } = await client.auth.admin.updateUserById(body.profId, { email });
        if (changeError) {
          const duplicate = ['email_exists', 'email_conflict', 'user_already_exists'].includes(changeError.code);
          return reply(duplicate ? 409 : 400, { error: duplicate
            ? 'Este e-mail já está em uso por outra conta.'
            : 'Não foi possível alterar o e-mail. Confira o endereço e a instalação da sincronização.' });
        }
        if (!changed?.user) return reply(502, { error: 'Alteração não confirmada. Reabra a edição para consultar o e-mail atual.' });
        user = changed.user;
      }
      // Repara também divergências antigas e novas tentativas após resposta perdida.
      // Mudanças reais de e-mail são sincronizadas atomicamente pelo trigger SQL.
      const { error: syncError } = await client.from('profiles').update({ email: user.email })
        .eq('id', body.profId).eq('role', 'professor').select('id').single();
      if (syncError) return reply(409, {
        error: 'O login usa o e-mail informado abaixo, mas o perfil não foi sincronizado. Reabra a edição e tente novamente.',
        currentEmail: user.email,
      });
    }
    return reply(200, { id: user.id, email: user.email || '',
      emailConfirmed: Boolean(user.email_confirmed_at),
      profileEmail: body.action === 'update' ? user.email : profile.email,
    });
  } catch (_) { return reply(500, { error: 'Não foi possível consultar ou alterar o e-mail. Tente novamente.' }); }
}

Deno.serve(req => handleRequest(req, createClient(
  Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } },
)));
