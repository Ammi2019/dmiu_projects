// Shared result calculation for the browser (same rules as computeResult in routes/results.js).
// marks: { a1: 72, mid: 60, ... }; config: from /api/results/config
window.computeResult = function computeResult(marks, config) {
  const round1 = n => Math.round(n * 10) / 10;
  let ca = 0, caMax = 0, exam = 0, examMax = 0, complete = true;

  for (const c of config.components) {
    const v = marks[c.key];
    const has = v !== undefined && v !== null && v !== '';
    if (!has) complete = false;
    const contribution = has ? (Number(v) * c.weight) / 100 : 0;
    if (c.ca) { ca += contribution; caMax += c.weight; }
    else { exam += contribution; examMax += c.weight; }
  }

  const result = { ca: round1(ca), caMax, exam: round1(exam), examMax, complete, total: null, grade: null, remark: null, passed: null };
  if (complete) {
    result.total = round1(ca + exam);
    const band = config.grades.find(g => result.total >= g.min) || config.grades[config.grades.length - 1];
    result.grade = band.grade;
    result.remark = band.remark;
    result.passed = result.total >= config.passMark;
  }
  return result;
};
