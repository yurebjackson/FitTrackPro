// Preparação: npm.cmd install --prefix .validation --ignore-scripts @electric-sql/pglite
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('../.validation/node_modules/@electric-sql/pglite');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('transação dos planos e isolamento por professor/aluno em PostgreSQL', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated; create role anon;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth, public to authenticated, anon;
      create table students(id uuid primary key, user_id uuid, professor_id uuid, progress int default 0);
      create table exercises(id uuid primary key);
      create table plans(id uuid primary key default gen_random_uuid(), student_id uuid references students,
        professor_id uuid, name text not null, description text, created_at timestamp default now());
      create table plan_days(id uuid primary key default gen_random_uuid(), plan_id uuid references plans on delete cascade,
        label text, sort_order int default 0);
      create table plan_exercises(id uuid primary key default gen_random_uuid(), plan_id uuid references plans on delete cascade,
        plan_day_id uuid references plan_days on delete cascade, exercise_id uuid references exercises on delete cascade,
        sort_order int default 0);
      grant select, insert, update, delete on all tables in schema public to authenticated, anon;
      alter table students enable row level security;
      alter table plans enable row level security;
      alter table plan_days enable row level security;
      alter table plan_exercises enable row level security;
      create policy students_professor on students for all using(professor_id=auth.uid()) with check(professor_id=auth.uid());
      create policy students_self_read on students for select using(user_id=auth.uid());
      create policy students_self_update on students for update using(user_id=auth.uid()) with check(user_id=auth.uid());
      create policy plans_professor on plans for all using(professor_id=auth.uid()) with check(professor_id=auth.uid());
      create policy plans_student_read on plans for select using(student_id in(select id from students where user_id=auth.uid()));
      create policy plan_days_access on plan_days for all using(true);
      create policy plan_exercises_access on plan_exercises for all using(true);
      insert into students values('${id(10)}','${id(2)}','${id(1)}',60),('${id(20)}','${id(4)}','${id(3)}',40);
      insert into exercises values('${id(100)}');
    `);
    const migration = fs.readFileSync(path.join(__dirname, '../backend/planos-atomicos.sql'), 'utf8');
    await db.exec(migration);
    await db.exec(migration); // Pode reaplicar sem duplicar políticas.
    const login = async user => {
      await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '${user}';`);
    };
    const days = [{ label: 'A', exercises: [id(100)] }];
    const save = async (plan, student, content=days) => (await db.query(
      'select public.save_plan_atomic($1::uuid,$2::uuid,$3,$4,$5::jsonb) as plan',
      [plan,student,'Treino','Descrição',JSON.stringify(content)]
    )).rows[0].plan;
    await login(id(1));
    const original = await save(null,id(10));
    assert.equal(original.plan_days[0].plan_exercises[0].exercise_id,id(100));
    assert.equal((await db.query('select progress from students')).rows[0].progress,0);
    const snapshot = JSON.stringify((await db.query('select * from plan_days')).rows);
    // Falha no segundo exercício após DELETE e INSERT deve desfazer tudo.
    await assert.rejects(save(original.id,id(10),[{label:'B',exercises:[id(100),id(999)]}]));
    assert.equal(JSON.stringify((await db.query('select * from plan_days')).rows),snapshot);
    await db.exec('update students set progress=55');
    await assert.rejects(save(null,id(10),[{label:'B',exercises:[id(999)]}]));
    assert.equal((await db.query('select count(*)::int n from plans')).rows[0].n,1);
    assert.equal((await db.query('select progress from students')).rows[0].progress,55);
    const updated = await save(original.id,id(10));
    assert.notEqual(updated.plan_days[0].id,original.plan_days[0].id);
    const day = updated.plan_days[0].id;
    await assert.rejects(save(original.id,id(20)));
    await login(id(3));
    assert.equal((await db.query('select * from plan_exercises')).rows.length,0);
    await assert.rejects(save(original.id,id(20)));
    await assert.rejects(db.query('insert into plan_exercises(plan_day_id,exercise_id) values($1,$2)',[day,id(100)]));
    await login(id(2));
    assert.equal((await db.query('select * from plan_exercises')).rows.length,1);
    assert.equal((await db.query('delete from plan_days returning id')).rows.length,0);
    assert.equal((await db.query('update plan_exercises set sort_order=99 returning id')).rows.length,0);
    await assert.rejects(save(updated.id,id(10)));
    await assert.rejects(db.query('insert into plan_days(plan_id,label) values($1,$2)',[updated.id,'Intruso']));
    await assert.rejects(db.query('insert into plan_exercises(plan_day_id,exercise_id) values($1,$2)',[day,id(100)]));
    await db.exec('reset role; set role anon;');
    assert.equal((await db.query('select * from plan_exercises')).rows.length,0);
    await assert.rejects(save(null,id(10)));
    // Formato legado sem plan_id continua disponível ao professor e aluno corretos.
    await login(id(1));
    await db.query('insert into plan_exercises(plan_day_id,exercise_id) values($1,$2)',[day,id(100)]);
    await login(id(2));
    assert.equal((await db.query('select * from plan_exercises')).rows.length,2);
  } finally { await db.close(); }
});
