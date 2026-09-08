-- Execute o arquivo inteiro antes de implantar admin-professor-email.
begin;
create or replace function public.sync_professor_auth_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = new.email
    where id = new.id and role = 'professor';
  return new;
end;
$$;
revoke all on function public.sync_professor_auth_email() from public, anon, authenticated;
drop trigger if exists sync_professor_auth_email on auth.users;
create trigger sync_professor_auth_email
after update of email on auth.users for each row
when (old.email is distinct from new.email)
execute function public.sync_professor_auth_email();
commit;
