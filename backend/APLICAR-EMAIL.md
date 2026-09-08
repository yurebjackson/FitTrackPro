# E-mail de acesso do professor

## Instalação

1. No SQL Editor, execute **todo** `sincronizar-email-professor.sql` em uma consulta
   vazia. Esse SQL instala um gatilho que mantém `profiles.email` sincronizado
   quando `auth.users.email` muda para um professor. A instalação não altera
   e-mails existentes. Uma falha no perfil desfaz a mudança de e-mail do Auth.
2. Em Edge Functions, crie uma função chamada **admin-professor-email**. Cole o
   conteúdo de `admin-professor-email/index.ts` e publique. Mantenha a verificação
   JWT ativada. A própria função também valida o token com `getUser` e consulta
   o papel `admin` no perfil; recusa administradores desativados e outros papéis.
3. Ela usa `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` do ambiente do Supabase.
   Não coloque seus valores no código, frontend ou conversa.
4. Depois de confirmar essas duas instalações, publicar `index.html` e
   `supabase.js`. No painel admin, abrir **Professores → Editar → E-mail de acesso**.

## Comportamento

- Consulta o endereço de login e `email_confirmed_at` no Auth, não presume que o
  e-mail salvo no perfil seja o endereço atual.
- Botão de alteração separado do salvamento de nome/plano, com confirmação
  explícita do novo endereço de login. Não envia mensagens ao professor por conta
  própria. O status exibido é o registro de confirmação fornecido pelo Supabase,
  não uma comprovação adicional de posse do endereço.
- Usa a API administrativa `updateUserById({ email })` para trocar o login.
  Não escreve diretamente em `auth.users` via SQL, nem marca `email_confirm: true`.
- O gatilho deve ser instalado antes da função. A sincronização adicional do
  perfil pela função permite reparar divergências antigas e repetir o mesmo
  endereço; falhas nessa etapa retornam erro explícito com o endereço atual.
- A comparação com o e-mail consultado detecta uma tela desatualizada, mas não
  constitui bloqueio transacional entre duas chamadas administrativas simultâneas.
- Não modifica `create-professor` ou `reset-professor-password`. O código dessas
  funções ainda não foi fornecido; esta implementação tem autorização própria.

## Validação

`node --test tests/workout.test.cjs tests/plans-database.test.cjs tests/professor-email.test.cjs`

16 testes locais passaram, incluindo dados fictícios em PostgreSQL embarcado
(PGlite) e simulação da API Auth. Ainda é necessário validar a Edge Function
implantada, configurações reais de Auth e login com o novo endereço no projeto.

Referências oficiais:
- https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid
- https://supabase.com/docs/reference/javascript/auth-getuser
- https://supabase.com/docs/guides/functions/auth
