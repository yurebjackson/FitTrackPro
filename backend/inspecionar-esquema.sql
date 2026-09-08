-- Consulta somente metadados. Executar no SQL Editor do Supabase e
-- compartilhar os resultados; não consulta alunos, senhas ou tokens.
select table_name, column_name, data_type, udt_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name in
  ('plans', 'plan_days', 'plan_exercises', 'students', 'training_history', 'workout_feedback', 'exercises')
order by table_name, ordinal_position;

select c.relname as tabela, con.conname, pg_get_constraintdef(con.oid) as definicao
from pg_constraint con join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in
  ('plans', 'plan_days', 'plan_exercises', 'students', 'training_history', 'workout_feedback', 'exercises');

select tablename, indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename in
  ('plans', 'plan_days', 'plan_exercises', 'students', 'training_history', 'workout_feedback', 'exercises');

select * from pg_policies where schemaname = 'public' and tablename in
  ('plans', 'plan_days', 'plan_exercises', 'students', 'training_history', 'workout_feedback', 'exercises');

select c.relname as tabela, c.relrowsecurity, c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in
  ('plans', 'plan_days', 'plan_exercises', 'students', 'training_history', 'workout_feedback', 'exercises');

select event_object_table, trigger_name, action_statement
from information_schema.triggers
where event_object_schema = 'public' and event_object_table in
  ('plans', 'plan_days', 'plan_exercises', 'students', 'training_history', 'workout_feedback', 'exercises');
