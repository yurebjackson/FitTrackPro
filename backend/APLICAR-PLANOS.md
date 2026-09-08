# Aplicação dos planos atômicos

1. No SQL Editor do projeto Supabase, abra uma consulta vazia.
2. Cole **todo** o conteúdo de `planos-atomicos.sql`, de `begin;` até `commit;`, e execute uma única vez. Não execute os blocos separadamente.
3. Envie a confirmação ou a mensagem de erro completa. Só publique o frontend novo depois do sucesso.

O SQL substitui as duas políticas amplas de dias/exercícios por acesso de
escrita do professor responsável e leitura do aluno vinculado. Mantém suporte
a exercícios legados cujo `plan_id` está vazio, mas `plan_day_id` está preenchido.
Cria `save_plan_atomic`, executada com as permissões do usuário conectado.
Não concede permissões adicionais nas tabelas e não altera suas linhas durante
a instalação. A função valida o professor do aluno e do plano antes de gravar.

Criação e edição retornam o plano completo. A criação também zera o progresso
na mesma transação. Qualquer erro de gravação desfaz todas as etapas. A função
não captura erros para convertê-los em sucesso e o cliente não volta à sequência
antiga se a função estiver ausente.

Validação local: `node --test tests/workout.test.cjs tests/plans-database.test.cjs`.
O teste de banco usa PGlite (PostgreSQL embarcado), dados fictícios e as políticas
relevantes informadas pelo usuário. Instalação da dependência de teste:
`npm.cmd install --prefix .validation --no-audit --no-fund --ignore-scripts @electric-sql/pglite`.
Essa dependência não é carregada pelo site.

Após publicar, testar criação/edição com professor e leitura do treino com aluno.
Os testes locais não substituem a conferência das permissões de tabela e do cache
de funções no Supabase real. As políticas de outras tabelas permanecem fora desta
migração; esta alteração não é uma auditoria completa de segurança.

Referências: https://www.postgresql.org/docs/current/sql-createpolicy.html
e https://www.postgresql.org/docs/18/sql-createfunction.html.
