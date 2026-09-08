-- Aplicar este arquivo inteiro no SQL Editor antes de publicar o frontend novo.
-- A migração e cada chamada da função são transacionais.
begin;

drop policy if exists plan_days_access on public.plan_days;
drop policy if exists plan_exercises_access on public.plan_exercises;
drop policy if exists plan_days_owner on public.plan_days;
drop policy if exists plan_days_reader on public.plan_days;
drop policy if exists plan_exercises_owner on public.plan_exercises;
drop policy if exists plan_exercises_reader on public.plan_exercises;

create policy plan_days_owner on public.plan_days for all to authenticated
using (exists (select 1 from public.plans p where p.id = plan_id and p.professor_id = auth.uid()))
with check (exists (select 1 from public.plans p where p.id = plan_id and p.professor_id = auth.uid()));
create policy plan_days_reader on public.plan_days for select to authenticated
using (exists (select 1 from public.plans p join public.students s on s.id = p.student_id
  where p.id = plan_id and s.user_id = auth.uid()));

-- Aceita o formato legado (plan_id nulo com plan_day_id preenchido),
-- mas, quando ambos existem, exige que apontem para o mesmo plano.
create policy plan_exercises_owner on public.plan_exercises for all to authenticated
using (exists (select 1 from public.plans p where p.professor_id = auth.uid() and (
  (plan_day_id is null and p.id = plan_exercises.plan_id) or
  exists (select 1 from public.plan_days d where d.id = plan_day_id and d.plan_id = p.id
    and (plan_exercises.plan_id is null or plan_exercises.plan_id = p.id)))))
with check (exists (select 1 from public.plans p where p.professor_id = auth.uid() and (
  (plan_day_id is null and p.id = plan_exercises.plan_id) or
  exists (select 1 from public.plan_days d where d.id = plan_day_id and d.plan_id = p.id
    and (plan_exercises.plan_id is null or plan_exercises.plan_id = p.id)))));
create policy plan_exercises_reader on public.plan_exercises for select to authenticated
using (exists (select 1 from public.plans p join public.students s on s.id = p.student_id
  where s.user_id = auth.uid() and (
  (plan_day_id is null and p.id = plan_exercises.plan_id) or
  exists (select 1 from public.plan_days d where d.id = plan_day_id and d.plan_id = p.id
    and (plan_exercises.plan_id is null or plan_exercises.plan_id = p.id)))));

create or replace function public.save_plan_atomic(
  p_plan_id uuid, p_student_id uuid, p_name text, p_description text, p_days jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_plan public.plans%rowtype;
  v_day jsonb;
  v_day_id uuid;
  v_ex text;
  v_day_order integer := 0;
  v_ex_order integer;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Autenticação necessária'; end if;
  if p_name is null or btrim(p_name) = '' then raise exception 'Informe o nome do plano'; end if;
  if p_days is null or jsonb_typeof(p_days) <> 'array' then raise exception 'Dias inválidos'; end if;
  if jsonb_array_length(p_days) = 0 then raise exception 'Informe ao menos um dia'; end if;

  -- Bloqueia o aluno durante a operação e confirma a responsabilidade.
  perform 1 from public.students s where s.id = p_student_id and s.professor_id = auth.uid() for update;
  if not found then raise exception 'Aluno indisponível para este professor'; end if;

  if p_plan_id is null then
    insert into public.plans(student_id, professor_id, name, description)
    values (p_student_id, auth.uid(), btrim(p_name), p_description) returning * into v_plan;
    update public.students set progress = 0 where id = p_student_id;
  else
    select * into v_plan from public.plans p
      where p.id = p_plan_id and p.professor_id = auth.uid() for update;
    if not found then raise exception 'Plano indisponível para este professor'; end if;
    update public.plans set student_id = p_student_id, name = btrim(p_name), description = p_description
      where id = p_plan_id returning * into v_plan;
    delete from public.plan_days where plan_id = p_plan_id;
  end if;

  for v_day in select value from jsonb_array_elements(p_days) loop
    if jsonb_typeof(v_day) <> 'object' or coalesce(btrim(v_day->>'label'), '') = '' then
      raise exception 'Informe o nome de cada dia';
    end if;
    if v_day->'exercises' is null or jsonb_typeof(v_day->'exercises') <> 'array' then
      raise exception 'Exercícios inválidos';
    end if;
    if jsonb_array_length(v_day->'exercises') = 0 then raise exception 'Dia sem exercícios'; end if;
    insert into public.plan_days(plan_id, label, sort_order)
      values(v_plan.id, btrim(v_day->>'label'), v_day_order) returning id into v_day_id;
    v_ex_order := 0;
    for v_ex in select value from jsonb_array_elements_text(v_day->'exercises') loop
      if v_ex is null then raise exception 'Exercício inválido'; end if;
      insert into public.plan_exercises(plan_id, plan_day_id, exercise_id, sort_order)
        values(v_plan.id, v_day_id, v_ex::uuid, v_ex_order);
      v_ex_order := v_ex_order + 1;
    end loop;
    v_day_order := v_day_order + 1;
  end loop;

  select to_jsonb(v_plan) || jsonb_build_object('plan_days', coalesce(jsonb_agg(
    to_jsonb(d) || jsonb_build_object('plan_exercises', (
      select coalesce(jsonb_agg(to_jsonb(e) order by e.sort_order), '[]'::jsonb)
      from public.plan_exercises e where e.plan_day_id = d.id
    )) order by d.sort_order), '[]'::jsonb)) into v_result
    from public.plan_days d where d.plan_id = v_plan.id;
  return v_result;
end;
$$;
revoke all on function public.save_plan_atomic(uuid, uuid, text, text, jsonb) from public, anon;
grant execute on function public.save_plan_atomic(uuid, uuid, text, text, jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
