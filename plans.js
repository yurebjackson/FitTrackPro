// ============================================================
// EriTrain Pro — Plans Module
// ============================================================

let PLANS = [];

// ============================================================
// LOAD  (professor — todos os planos que criou)
// ============================================================
async function loadPlans() {
  try {
    const rows = await dbGetAllPlans();
    PLANS = rows.map(normalizePlan);
    return PLANS;
  } catch (err) {
    console.error('loadPlans:', err);
    return [];
  }
}

// ============================================================
// Normalização banco → UI
// O banco retorna planos com plan_days[] aninhados, cada um
// com plan_exercises[] que têm exercises{} dentro.
// ============================================================
function normalizePlan(row) {
  const days = (row.plan_days ?? [])
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(d => ({
      id:        d.id,
      label:     d.label,
      exercises: (d.plan_exercises ?? [])
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(pe => pe.exercise_id),         // apenas o ID do exercício
    }));

  return {
    id:   row.id,
    name: row.name,
    desc: row.description ?? '',
    days,
    studentId: row.student_id,
  };
}

// ============================================================
// CREATE  (professor cria um plano para um aluno)
// ============================================================
async function savePlan() {
  const studentId   = document.getElementById('plStudentSel').value;
  const name        = document.getElementById('plName').value.trim();
  const description = document.getElementById('plDesc').value.trim();

  if (!studentId || !name) {
    showToast('Selecione o aluno e informe o nome do plano');
    return;
  }

  // Coleta os dias adicionados dinamicamente
  const dayRows = document.querySelectorAll('.plan-day-row');
  const days = [];

  dayRows.forEach(row => {
    const label = row.querySelector('.plDayLabel')?.value.trim();
    const exIds = Array.from(row.querySelectorAll('.plDayEx:checked')).map(cb => cb.value);
    if (label && exIds.length) days.push({ label, exercises: exIds });
  });

  if (!days.length) {
    showToast('Adicione ao menos um dia com exercícios');
    return;
  }

  setBtnLoading('btnSavePlan', true);

  try {
    const plan = await dbCreatePlan(studentId, name, description, days);

    PLANS.push(normalizePlan(plan));
    const student = STUDENTS.find(s => s.id === studentId);
    if (student) student.progress = 0;

    closeM('moNewPlan');
    showToast('Plano criado!');
    nav('planos');
  } catch (err) {
    showToast('Erro: ' + err.message);
  } finally {
    setBtnLoading('btnSavePlan', false);
  }
}

// ============================================================
// DELETE
// ============================================================
async function deletePlan(planId) {
  if (!confirm('Remover este plano?')) return;

  try {
    await dbDeletePlan(planId);
    PLANS = PLANS.filter(p => p.id !== planId);
    showToast('Plano removido');
    nav('planos');
  } catch (err) {
    showToast('Erro: ' + err.message);
  }
}

// ============================================================
// Helpers
// ============================================================
function getPlanById(id) {
  return PLANS.find(p => p.id === id);
}

function getPlansForStudent(studentId) {
  return PLANS.filter(p => p.studentId === studentId);
}
