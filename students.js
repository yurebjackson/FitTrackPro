// ============================================================
// EriTrain Pro — Students Module
// ============================================================

let STUDENTS = [];

// ============================================================
// LOAD  (professor carrega seus alunos + dados aninhados)
// ============================================================
async function loadStudents() {
  try {
    const rows = await dbGetStudents();

    // Para cada aluno, carrega avaliações e histórico
    STUDENTS = await Promise.all(rows.map(async (s) => {
      const [avaliacoes, history] = await Promise.all([
        dbGetAssessments(s.id).catch(() => []),
        dbGetHistory(s.id).catch(() => []),
      ]);
      return { ...s, avaliacoes, history };
    }));

    return STUDENTS;
  } catch (err) {
    console.error('loadStudents:', err);
    return [];
  }
}

// ============================================================
// LOAD  (aluno carrega seus próprios dados)
// ============================================================
async function loadStudentData() {
  try {
    // Carrega exercícios primeiro (necessário para renderizar o treino)
    await loadExercises();

    // Busca o registro do aluno vinculado ao user logado
    const { data, error } = await supabaseClient
      .from('students')
      .select('*')
      .eq('user_id', CURRENT_USER.id)
      .single();

    if (error || !data) return;

    // Bloqueia acesso se aluno estiver desativado
    if (data.active === false) {
      await signOut();
      CURRENT_USER = CURRENT_PROFILE = null;
      showLoginScreen();
      showToast('Sua conta foi desativada. Fale com seu professor.', 'erro');
      return;
    }

    const [avaliacoes, history, plans] = await Promise.all([
      dbGetAssessments(data.id).catch(() => []),
      dbGetHistory(data.id).catch(() => []),
      dbGetPlansForStudent(data.id).catch(() => []),
    ]);

    const student = { ...data, avaliacoes, history };
    STUDENTS = [student];
    curUser.sid = data.id;

    // Normaliza planos para o formato interno
    PLANS = plans.map(normalizePlan);

    // Define plano ativo (o mais recente ou o vinculado em students.plan_id)
    if (data.plan_id) {
      const activePlan = PLANS.find(p => p.id === data.plan_id);
      if (activePlan) student.plan = data.plan_id;
    } else if (PLANS.length) {
      student.plan = PLANS[0].id;
    }

  } catch (err) {
    console.error('loadStudentData:', err);
  }
}

// ============================================================
// DELETE (professor remove aluno)
// ============================================================
async function deleteStudent(id) {
  if (!confirm('Remover este aluno permanentemente?')) return;

  try {
    await dbDeleteStudent(id);
    STUDENTS = STUDENTS.filter(s => s.id !== id);
    document.getElementById('alunosCard').innerHTML = renderStudentRows();
    showToast('Aluno removido');
  } catch (err) {
    showToast('Erro: ' + err.message);
  }
}

// ============================================================
// ASSIGN PLAN  (professor atribui plano a aluno)
// ============================================================
async function confirmAssign() {
  if (!selPlan || !assignTarget) return;

  try {
    await dbAssignPlan(assignTarget, selPlan);

    const s    = STUDENTS.find(st => st.id === assignTarget);
    const plan = PLANS.find(p => p.id === selPlan);

    if (s) {
      s.plan = selPlan;
      await resetStudentProgress(assignTarget);

      // Notifica o aluno se ele tiver user_id vinculado
      if (s.user_id) {
        const planName = plan?.name ?? 'Novo treino';
        await dbCreateNotification(
          s.user_id,
          '🏋️ Novo treino atribuído!',
          `Seu professor atribuiu o plano "${planName}". Acesse "Meu Treino" para começar.`
        ).catch(e => console.warn('notif:', e.message));
      }
    }

    closeM('moAssign');
    showToast('Treino atribuído!');
    nav('alunos');
  } catch (err) {
    showToast('Erro: ' + err.message);
  }
}

// ============================================================
// ASSESSMENTS
// ============================================================
async function saveAvaliacao() {
  const peso = parseFloat(document.getElementById('avPeso').value);
  if (!peso || !avTarget) {
    showToast('Informe pelo menos o peso');
    return;
  }

  const payload = {
    student_id:  avTarget,
    date:        new Date().toISOString().slice(0, 10),
    weight:      peso,
    height:      parseFloat(document.getElementById('avAltura').value)  || null,
    body_fat:    parseFloat(document.getElementById('avGordura').value) || null,
    muscle_mass: parseFloat(document.getElementById('avMusculo').value) || null,
    chest:       parseFloat(document.getElementById('avPeito').value)   || null,
    waist:       parseFloat(document.getElementById('avCintura').value) || null,
    hips:        parseFloat(document.getElementById('avQuadril').value) || null,
    arm:         parseFloat(document.getElementById('avBraco').value)   || null,
    notes:       document.getElementById('avObs').value.trim(),
  };

  try {
    const saved = await dbCreateAssessment(payload);

    // Adiciona localmente
    const s = STUDENTS.find(st => st.id === avTarget);
    if (s) {
      s.avaliacoes.unshift(saved);
      await dbAddHistory(avTarget, {
        date:    payload.date,
        type:    'avaliacao',
        label:   'Avaliação física',
        details: `Peso: ${peso}kg · Gordura: ${payload.body_fat ?? '–'}%`,
        tags:    ['avaliação'],
      });
    }

    closeM('moAvaliacao');
    showToast('Avaliação salva!');
    nav(isProfessor() ? 'avaliacoes' : 'minha-avaliacao');
  } catch (err) {
    showToast('Erro: ' + err.message);
  }
}

// ============================================================
// TRAINING HISTORY  (aluno registra exercício concluído)
// ============================================================
async function registerHistory(studentId, entry) {
  const saved = await dbAddHistory(studentId, entry);
  if (!saved?.id) throw new Error('O histórico salvo não foi confirmado.');
  const s = STUDENTS.find(st => st.id === studentId);
  if (s) {
    s.history ??= [];
    if (!s.history.some(item => item.id === saved.id)) s.history.unshift(saved);
  }
  return saved;
}

// ============================================================
// Helpers internos
// ============================================================
function getStudentById(id) {
  return STUDENTS.find(s => s.id === id);
}
