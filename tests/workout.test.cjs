const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const source = html.slice(html.indexOf('let workoutContextKey'), html.indexOf('function showFinishModal'));

function setup() {
  const storage = new Map();
  const records = new Map();
  const ctx = vm.createContext({
    CURRENT_USER: { id: 'user-1' }, curUser: { sid: 'student-1', name: 'Aluno' },
    STUDENTS: [{ id: 'student-1', plan: 'plan-1', progress: 0, history: [] }],
    PLANS: [{ id: 'plan-1', days: [{ id: 'day-1', label: 'A', exercises: ['ex-1'] }] }],
    trainTimer: null, trainStartTime: null, trainDayIndex: null, completedEx: {}, openDays: {},
    console, crypto: require('node:crypto').webcrypto,
    clearInterval() {}, setInterval() { return 1; },
    localStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) },
    document: { getElementById() { return null; }, querySelectorAll() { return []; } },
    showToast(message) { ctx.toast = message; },
    showFinishModal(...args) { ctx.summary = args; },
    openFeedbackModal(id) { ctx.feedbackId = id; },
    getPlanById(id) { return ctx.PLANS.find(p => p.id === id); },
    async dbAddHistory(sid, entry) {
      if (ctx.failHistory) throw new Error('offline');
      records.set(entry.id, { ...entry, student_id: sid });
      if (ctx.loseResponse) { ctx.loseResponse = false; throw new Error('resposta perdida'); }
      return records.get(entry.id);
    },
    async dbUpdateStudentProgress(sid, progress) {
      if (ctx.failProgress) throw new Error('progresso indisponível');
      ctx.savedProgress = progress;
    },
  });
  vm.runInContext(source, ctx);
  const students = fs.readFileSync(path.join(root, 'students.js'), 'utf8');
  vm.runInContext(students.slice(students.indexOf('async function registerHistory'), students.indexOf('// Helpers internos')), ctx);
  vm.runInContext('loadWorkoutState(); trainDayIndex = 0; trainStartTime = Date.now() - 60000; completedEx = { "0-ex-1": true }; saveWorkoutState();', ctx);
  return { ctx, storage, records, run: code => vm.runInContext(code, ctx) };
}

test('todos os scripts locais e inline têm sintaxe válida', () => {
  for (const file of ['auth.js', 'students.js', 'supabase.js', 'plans.js', 'exercises.js'])
    new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
});

test('falha mantém marcações e nova tentativa retorna ID para feedback', async () => {
  const { ctx, run, records } = setup();
  ctx.failHistory = true;
  await run("finishWorkout(0, 'A', ['ex-1'])");
  assert.equal(ctx.trainDayIndex, 0);
  assert.equal(ctx.completedEx['0-ex-1'], true);
  assert.equal(ctx.summary, undefined);
  assert.equal(run('finishingWorkout'), false);
  const id = run('pendingWorkout.entry.id');
  ctx.failHistory = false;
  await run("finishWorkout(0, 'A', ['ex-1'])");
  assert.equal(records.size, 1);
  assert.equal(ctx.trainDayIndex, null);
  ctx.summary[6]();
  assert.equal(ctx.feedbackId, id);
});

test('resposta perdida e refresh repetem o mesmo ID e resumo', async () => {
  const { ctx, run, records } = setup();
  ctx.loseResponse = true;
  await run("finishWorkout(0, 'A', ['ex-1'])");
  const id = run('pendingWorkout.entry.id');
  const time = run('pendingWorkout.timeStr');
  run('loadWorkoutState()');
  await run("finishWorkout(0, 'A', ['ex-1'])");
  assert.equal(records.size, 1);
  assert.ok(records.has(id));
  assert.equal(ctx.summary[1], time);
});

test('falha no progresso não incrementa duas vezes nem duplica histórico local', async () => {
  const { ctx, run, records } = setup();
  ctx.failProgress = true;
  await run("finishWorkout(0, 'A', ['ex-1'])");
  assert.equal(ctx.summary, undefined);
  ctx.failProgress = false;
  await run("finishWorkout(0, 'A', ['ex-1'])");
  assert.equal(records.size, 1);
  assert.equal(ctx.STUDENTS[0].history.length, 1);
  assert.equal(ctx.savedProgress, 10);
});

test('troca de usuário, plano e alteração de exercícios não restaura marcações incompatíveis', () => {
  const { ctx, run } = setup();
  ctx.CURRENT_USER.id = 'user-2';
  run('loadWorkoutState()');
  assert.equal(ctx.trainDayIndex, null);
  ctx.CURRENT_USER.id = 'user-1';
  run('loadWorkoutState()');
  assert.equal(ctx.trainDayIndex, 0);
  ctx.STUDENTS[0].plan = 'plan-2';
  run('loadWorkoutState()');
  assert.equal(ctx.trainDayIndex, null);
  ctx.STUDENTS[0].plan = 'plan-1';
  ctx.PLANS[0].days[0].exercises = ['ex-2'];
  run('loadWorkoutState()');
  assert.equal(ctx.trainDayIndex, null);
});

test('duplo clique envia somente uma conclusão', async () => {
  const { run, records } = setup();
  await Promise.all([run("finishWorkout(0, 'A', ['ex-1'])"), run("finishWorkout(0, 'A', ['ex-1'])")]);
  assert.equal(records.size, 1);
});

test('armazenamento indisponível impede envio sem identificação recuperável', async () => {
  const { ctx, run, records } = setup();
  ctx.localStorage.setItem = () => { throw new Error('quota'); };
  await run("finishWorkout(0, 'A', ['ex-1'])");
  assert.equal(records.size, 0);
  assert.equal(ctx.trainDayIndex, 0);
  assert.equal(ctx.summary, undefined);
});

test('logout limpa memória e preserva tentativa para o mesmo usuário', () => {
  const { ctx, run } = setup();
  run('resetWorkoutSession()');
  assert.equal(ctx.trainDayIndex, null);
  assert.equal(Object.keys(ctx.completedEx).length, 0);
  run('loadWorkoutState()');
  assert.equal(ctx.trainDayIndex, 0);
});

test('dbAddHistory recupera INSERT já salvo pelo mesmo ID e aluno', async () => {
  const db = fs.readFileSync(path.join(root, 'supabase.js'), 'utf8');
  const filters = [];
  const saved = { id: 'attempt', student_id: 'student' };
  const query = {
    insert() { return this; }, select() { return this; },
    single: async () => ({ error: { code: '23505' } }),
    eq(k,v) { filters.push([k,v]); return this; },
    maybeSingle: async () => ({ data: saved }),
  };
  const ctx = vm.createContext({ supabaseClient: { from() { return query; } } });
  vm.runInContext(db.slice(db.indexOf('async function dbAddHistory'), db.indexOf('// NOTIFICATIONS')), ctx);
  assert.equal(await vm.runInContext("dbAddHistory('student', { id: 'attempt' })", ctx), saved);
  assert.deepEqual(filters, [['id', 'attempt'], ['student_id', 'student']]);
});
