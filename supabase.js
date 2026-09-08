const SUPABASE_URL = 'https://rzivwbsqmsyhywfnmxbr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_JG7SoGkEeLCvjU_ZbT89Uw_9gVjq856';
 
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
 
// ============================================================
// AUTH
// ============================================================
 
async function signUp(email, password, name, role) {
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: { name, role }
    }
  });
  if (error) throw error;
  return data;
}
 
async function signIn(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}
 
async function signOut() {
  if (typeof resetWorkoutSession === 'function') resetWorkoutSession();
  await supabaseClient.auth.signOut();
}
 
async function getCurrentUser() {
  const { data } = await supabaseClient.auth.getUser();
  return data?.user ?? null;
}
 
async function getProfile(userId) {
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
 
  if (error) throw error;
 
  if (!data) {
    const user = await getCurrentUser();
    const name = user?.user_metadata?.name || user?.email?.split('@')[0] || 'Usuário';
    const role = user?.user_metadata?.role || 'aluno';
 
    const { data: created, error: insertErr } = await supabaseClient
      .from('profiles')
      .insert([{ id: userId, name, role }])
      .select()
      .maybeSingle();
 
    if (insertErr) throw insertErr;
    return created;
  }
 
  return data;
}
 
async function updateProfile(userId, updates) {
  const { data, error } = await supabaseClient
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}
 
// ============================================================
// STUDENTS
// ============================================================
 
async function dbGetStudents() {
  const user = await getCurrentUser();
  const { data, error } = await supabaseClient
    .from('students')
    .select('*')
    .eq('professor_id', user.id)
    .order('name');
  if (error) throw error;
  return data ?? [];
}
 
async function dbCreateStudent(payload) {
  const user = await getCurrentUser();
  const { data, error } = await supabaseClient
    .from('students')
    .insert([{ ...payload, professor_id: user.id, progress: 0 }])
    .select()
    .single();
  if (error) throw error;
  return data;
}
 
async function dbUpdateStudent(id, updates) {
  const { data, error } = await supabaseClient
    .from('students')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}
 
// Versão para o aluno atualizar o próprio progresso (filtra por user_id)
async function dbUpdateStudentProgress(studentId, progress) {
  const user = await getCurrentUser();
  const { error } = await supabaseClient
    .from('students')
    .update({ progress })
    .eq('id', studentId)
    .eq('user_id', user.id)
    .select('id')
    .single();
  if (error) throw error;
}
 
async function dbDeleteStudent(id) {
  const { error } = await supabaseClient.from('students').delete().eq('id', id);
  if (error) throw error;
}
 
// ============================================================
// EXERCISES
// ============================================================
 
async function dbGetExercises() {
  const { data, error } = await supabaseClient
    .from('exercises')
    .select('*')
    .order('name');
  if (error) throw error;
  return data ?? [];
}
 
async function dbCreateExercise(payload) {
  const user = await getCurrentUser();
  const { data, error } = await supabaseClient
    .from('exercises')
    .insert([{ ...payload, created_by: user.id }])
    .select()
    .single();
  if (error) throw error;
  return data;
}
 
async function dbUpdateExercise(id, updates) {
  const { data, error } = await supabaseClient
    .from('exercises')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}
 
async function dbDeleteExercise(id) {
  const { error } = await supabaseClient.from('exercises').delete().eq('id', id);
  if (error) throw error;
}
 
// ============================================================
// PLANS
// ============================================================
 
async function dbGetPlansForStudent(studentId) {
  const { data, error } = await supabaseClient
    .from('plans')
    .select(`
      *,
      plan_days (
        *,
        plan_exercises ( *, exercises(*) )
      )
    `)
    .eq('student_id', studentId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
 
async function dbGetAllPlans() {
  const user = await getCurrentUser();
  const { data, error } = await supabaseClient
    .from('plans')
    .select(`
      *,
      plan_days (
        *,
        plan_exercises ( *, exercises(*) )
      )
    `)
    .eq('professor_id', user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
 
async function dbSavePlanAtomic(planId, studentId, name, description, days) {
  const { data, error } = await supabaseClient.rpc('save_plan_atomic', {
    p_plan_id: planId, p_student_id: studentId, p_name: name,
    p_description: description, p_days: days,
  });
  if (error) throw error;
  if (!data?.id || !Array.isArray(data.plan_days)) throw new Error('Resposta do plano inválida');
  return data;
}

async function dbCreatePlan(studentId, name, description, days) {
  return dbSavePlanAtomic(null, studentId, name, description, days);
}

async function dbDeletePlan(planId) {
  const { error } = await supabaseClient.from('plans').delete().eq('id', planId);
  if (error) throw error;
}
 
async function dbAssignPlan(studentId, planId) {
  // Atualiza plan_id no aluno
  await dbUpdateStudent(studentId, { plan_id: planId });
 
  // Atualiza também student_id no plano (garante que loadStudentData encontra)
  const { error } = await supabaseClient
    .from('plans')
    .update({ student_id: studentId })
    .eq('id', planId);
  if (error) throw error;
}
 
// ============================================================
// ASSESSMENTS
// ============================================================
 
async function dbGetAssessments(studentId) {
  const { data, error } = await supabaseClient
    .from('assessments')
    .select('*')
    .eq('student_id', studentId)
    .order('date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
 
async function dbCreateAssessment(payload) {
  const user = await getCurrentUser();
  const { data, error } = await supabaseClient
    .from('assessments')
    .insert([{ ...payload, professor_id: user.id }])
    .select()
    .single();
  if (error) throw error;
  return data;
}
 
// ============================================================
// TRAINING HISTORY
// ============================================================
 
async function dbGetHistory(studentId) {
  const { data, error } = await supabaseClient
    .from('training_history')
    .select('*')
    .eq('student_id', studentId)
    .order('date', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data ?? [];
}
 
async function dbAddHistory(studentId, entry) {
  const { data, error } = await supabaseClient
    .from('training_history')
    .insert([{ student_id: studentId, ...entry }])
    .select()
    .single();
  // Uma resposta perdida pode levar à repetição de um INSERT já confirmado.
  // O mesmo ID é reutilizado; nunca atualizamos um histórico existente.
  if (error && entry.id) {
    const { data: existing, error: readError } = await supabaseClient
      .from('training_history').select('*')
      .eq('id', entry.id).eq('student_id', studentId).maybeSingle();
    if (!readError && existing) return existing;
  }
  if (error) throw error;
  return data;
}

// ============================================================
// NOTIFICATIONS
// ============================================================

async function dbCreateNotification(userId, title, message) {
  const { error } = await supabaseClient
    .from('notifications')
    .insert([{ user_id: userId, title, message }]);
  if (error) throw error;
}

async function dbGetNotifications(userId) {
  const { data, error } = await supabaseClient
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw error;
  return data ?? [];
}

async function dbMarkNotifRead(id) {
  const { error } = await supabaseClient
    .from('notifications')
    .update({ read: true })
    .eq('id', id);
  if (error) throw error;
}

async function dbMarkAllNotifsRead(userId) {
  const { error } = await supabaseClient
    .from('notifications')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('read', false);
  if (error) throw error;
}

// ============================================================
// AVATAR (Storage)
// ============================================================

async function uploadAvatar(userId, file) {
  const ext  = file.name.split('.').pop().toLowerCase();
  const path = `${userId}/avatar.${ext}`;

  const { error } = await supabaseClient.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;

  const { data } = supabaseClient.storage
    .from('avatars')
    .getPublicUrl(path);

  // Salva URL no profile com cache-bust
  const url = `${data.publicUrl}?t=${Date.now()}`;
  await updateProfile(userId, { avatar_url: url });
  return url;
}

// ============================================================
// SCHEDULED ASSESSMENTS
// ============================================================

async function dbCreateScheduledAssessment(payload) {
  const user = await getCurrentUser();
  const { data, error } = await supabaseClient
    .from('scheduled_assessments')
    .insert([{ ...payload, professor_id: user.id }])
    .select().single();
  if (error) throw error;
  return data;
}

async function dbGetScheduledAssessments() {
  const user = await getCurrentUser();
  const { data, error } = await supabaseClient
    .from('scheduled_assessments')
    .select('*, students(name, user_id)')
    .eq('professor_id', user.id)
    .order('scheduled_date', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function dbGetStudentSchedules(studentId) {
  const { data, error } = await supabaseClient
    .from('scheduled_assessments')
    .select('*')
    .eq('student_id', studentId)
    .order('scheduled_date', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function dbUpdateScheduledAssessment(id, updates) {
  const { error } = await supabaseClient
    .from('scheduled_assessments')
    .update(updates)
    .eq('id', id);
  if (error) throw error;
}

async function dbDeleteScheduledAssessment(id) {
  const { error } = await supabaseClient
    .from('scheduled_assessments')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ============================================================
// WORKOUT FEEDBACK
// ============================================================

async function dbSaveFeedback(payload) {
  const { data, error } = await supabaseClient
    .from('workout_feedback')
    .insert([payload])
    .select().single();
  if (error) throw error;
  return data;
}

async function dbGetFeedbacks(studentId) {
  const { data, error } = await supabaseClient
    .from('workout_feedback')
    .select('*')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// ============================================================
// ADMIN
// ============================================================

async function dbGetAllProfessores() {
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('role', 'professor')
    .order('created_at', { ascending: false });
  if (error) throw error;

  const profs = data ?? [];
  if (!profs.length) return [];

  // Busca assinaturas de todos os professores de uma vez
  const ids = profs.map(p => p.id);
  const { data: subs } = await supabaseClient
    .from('subscriptions')
    .select('professor_id, status, next_payment_date, last_payment_date, init_point, mp_subscription_id')
    .in('professor_id', ids);

  const subMap = {};
  (subs ?? []).forEach(s => { subMap[s.professor_id] = s; });

  return profs.map(p => ({
    ...p,
    email:            p.email ?? '',
    // Dado de assinatura mesclado no objeto do professor
    sub_status:       subMap[p.id]?.status ?? null,
    sub_next_payment: subMap[p.id]?.next_payment_date ?? null,
    sub_init_point:   subMap[p.id]?.init_point ?? null,
    sub_mp_id:        subMap[p.id]?.mp_subscription_id ?? null,
  }));
}

// Busca dados de assinatura do professor logado
async function dbGetMySubscription() {
  const user = await getCurrentUser();
  const { data, error } = await supabaseClient
    .from('subscriptions')
    .select('*')
    .eq('professor_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function dbGetProfessorStats(professorId) {
  // Usa count via RPC para evitar problema de RLS
  const { data, error } = await supabaseClient
    .from('students')
    .select('id, active', { count: 'exact' })
    .eq('professor_id', professorId);
  if (error) {
    console.warn('dbGetProfessorStats error:', error.message);
    return { total: 0, ativos: 0 };
  }
  const rows   = data ?? [];
  const total  = rows.length;
  const ativos = rows.filter(s => s.active !== false).length;
  return { total, ativos };
}

async function dbToggleProfessorActive(profileId, active) {
  // Seta active no profile — usaremos coluna active em profiles
  const { error } = await supabaseClient
    .from('profiles')
    .update({ active })
    .eq('id', profileId);
  if (error) throw error;
}

async function dbCreateProfessorViaFunction(name, email, planType) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/create-professor`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ name, email, plan_type: planType }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? 'Erro ao criar professor');
  return json;
}

async function dbAdminProfessorEmail(payload) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session?.access_token) throw new Error('Entre novamente no sistema.');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-professor-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY,
      Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json.error || 'Não foi possível acessar o serviço de e-mail.') +
    (json.currentEmail ? ` E-mail atual do login: ${json.currentEmail}.` : ''));
  if (typeof json.email !== 'string' || json.id !== payload.profId)
    throw new Error('Resposta de e-mail inválida. Consulte novamente.');
  return json;
}

// ============================================================
// STUDENT EXERCISE CONFIG (séries/reps personalizadas)
// ============================================================

async function dbGetStudentExerciseConfigs(studentId, planId) {
  const { data, error } = await supabaseClient
    .from('student_exercise_config')
    .select('*')
    .eq('student_id', studentId)
    .eq('plan_id', planId);
  if (error) throw error;
  return data ?? [];
}

async function dbSaveStudentExerciseConfig(studentId, exerciseId, planId, customSeries, customReps) {
  const { error } = await supabaseClient
    .from('student_exercise_config')
    .upsert({
      student_id:    studentId,
      exercise_id:   exerciseId,
      plan_id:       planId,
      custom_series: customSeries || null,
      custom_reps:   customReps   || null,
      updated_at:    new Date().toISOString(),
    }, { onConflict: 'student_id,exercise_id,plan_id' });
  if (error) throw error;
}

// ============================================================
// STUDENT EXERCISE LOAD (kg por exercício)
// ============================================================

async function dbGetStudentLoads(studentId) {
  const { data, error } = await supabaseClient
    .from('student_exercise_load')
    .select('*')
    .eq('student_id', studentId);
  if (error) throw error;
  // Retorna mapa { exercise_id: load_kg }
  const map = {};
  (data ?? []).forEach(r => { map[r.exercise_id] = r.load_kg; });
  return map;
}

async function dbSaveStudentLoad(studentId, exerciseId, loadKg) {
  const { error } = await supabaseClient
    .from('student_exercise_load')
    .upsert({
      student_id:  studentId,
      exercise_id: exerciseId,
      load_kg:     loadKg,
      updated_at:  new Date().toISOString(),
    }, { onConflict: 'student_id,exercise_id' });
  if (error) throw error;
}
