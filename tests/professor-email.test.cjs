const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const profId = '00000000-0000-4000-8000-000000000001';
const original = fs.readFileSync(path.join(root, 'backend/admin-professor-email/index.ts'), 'utf8');
const source = original.replace(/^import .*;\r?\n/, '').replace('export async function', 'async function').split('Deno.serve')[0];

function setup(options = {}) {
  let writes = 0;
  const user = { id: profId, email: 'old@example.com', email_confirmed_at: '2026-01-01' };
  const ctx = vm.createContext({ Request, Response });
  vm.runInContext(source, ctx);
  const client = {
    auth: {
      getUser: async () => options.invalidToken ? { error: {} } : { data: { user: { id: 'admin-id' } } },
      admin: {
        getUserById: async () => ({ data: { user: { ...user } } }),
        updateUserById: async (id, change) => {
          writes++;
          if (options.duplicate) return { error: { code: 'email_exists' } };
          user.email = change.email;
          return { data: { user: { ...user } } };
        },
      },
    },
    from() {
      let target, updating = false;
      return {
        select() { return this; },
        eq(key, value) { if (key === 'id') target = value; return this; },
        update() { updating = true; return this; },
        async single() {
          if (updating) return options.syncFail ? { error: {} } : { data: { id: profId } };
          return { data: target === 'admin-id'
            ? { role: options.role || 'admin', active: !options.inactive }
            : { id: profId, role: options.targetRole || 'professor', email: 'old@example.com' } };
        },
      };
    },
  };
  const call = async (body, auth = true) => {
    const response = await ctx.handleRequest(new Request('https://test.local', {
      method: 'POST', headers: auth ? { Authorization: 'Bearer valid' } : {}, body: JSON.stringify(body),
    }), client);
    return { status: response.status, body: await response.json() };
  };
  return { call, writes: () => writes };
}
const update = { action: 'update', profId, email: 'new@example.com', expectedEmail: 'old@example.com' };

test('e-mail: sessão e papel de administrador são obrigatórios', async () => {
  for (const opts of [{ role: 'professor' }, { role: 'aluno' }, { inactive: true }, { invalidToken: true }]) {
    const app = setup(opts);
    assert.ok([401,403].includes((await app.call(update)).status));
    assert.equal(app.writes(), 0);
  }
  assert.equal((await setup().call(update,false)).status,401);
});
test('e-mail: consulta usa Auth sem alterar a conta', async () => {
  const app = setup();
  const result = await app.call({ action: 'inspect', profId });
  assert.equal(result.body.email,'old@example.com');
  assert.equal(result.body.emailConfirmed,true);
  assert.equal(app.writes(),0);
});
test('e-mail: valida alvo, endereço e consulta desatualizada', async () => {
  assert.equal((await setup({targetRole:'admin'}).call(update)).status,404);
  for (const body of [{ ...update, email: 'inválido' }, { ...update, expectedEmail:'stale@example.com' }]) {
    const app = setup();
    assert.ok([400,409].includes((await app.call(body)).status));
    assert.equal(app.writes(),0);
  }
});
test('e-mail: sucesso, duplicado e falha de sincronização são distintos', async () => {
  assert.equal((await setup().call(update)).body.email,'new@example.com');
  assert.equal((await setup({duplicate:true}).call(update)).status,409);
  const failure = await setup({syncFail:true}).call(update);
  assert.equal(failure.status,409);
  assert.equal(failure.body.currentEmail,'new@example.com');
});
test('e-mail: repetir o endereço atual sincroniza sem trocar o Auth', async () => {
  const app = setup();
  assert.equal((await app.call({...update,email:'old@example.com'})).status,200);
  assert.equal(app.writes(),0);
});

test('trigger sincroniza Auth/perfil e desfaz Auth quando o perfil falha', async () => {
  const { PGlite } = require('../.validation/node_modules/@electric-sql/pglite');
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key, email text);
      create table public.profiles(id uuid primary key, role text, email text check(email <> 'fail@example.com'));
      insert into auth.users values('${profId}','old@example.com');
      insert into profiles values('${profId}','professor','old@example.com');`);
    const sql = fs.readFileSync(path.join(root,'backend/sincronizar-email-professor.sql'),'utf8');
    await db.exec(sql);
    await db.exec(sql);
    await db.exec("update auth.users set email='new@example.com'");
    assert.equal((await db.query('select email from profiles')).rows[0].email,'new@example.com');
    await assert.rejects(db.exec("update auth.users set email='fail@example.com'"));
    assert.equal((await db.query('select email from auth.users')).rows[0].email,'new@example.com');
  } finally { await db.close(); }
});
