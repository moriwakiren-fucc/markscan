/*
  results.js
  STEP 4: 採点結果
  模範解答と各生徒の解答を照合し、得点・正誤一覧・CSV出力を提供
*/

const ResultsStep = (() => {

  let scored = []; // [{student, score, total, details:[{qIndex, correct, selected, isCorrect}]}]

  function arraysEqualAsSets(a, b) {
    if (a.length !== b.length) return false;
    const sa = new Set(a), sb = new Set(b);
    if (sa.size !== sb.size) return false;
    for (const v of sa) if (!sb.has(v)) return false;
    return true;
  }

  function compute() {
    const template = App.state.template;
    const key = App.state.answerKey;
    if (!template || !key) {
      scored = [];
      render();
      return;
    }

    scored = App.state.students.map(student => {
      let score = 0;
      const details = template.questions.map(q => {
        const keyEntry = key.find(k => k.qIndex === q.qIndex) || { correct: [] };
        const ansEntry = student.answers.find(a => a.qIndex === q.qIndex) || { selected: [] };
        const isCorrect = keyEntry.correct.length > 0 && arraysEqualAsSets(keyEntry.correct, ansEntry.selected);
        if (isCorrect) score++;
        return {
          qIndex: q.qIndex,
          qNumber: q.qNumber,
          correct: keyEntry.correct,
          selected: ansEntry.selected,
          isCorrect
        };
      });
      return { student, score, total: template.questions.length, details };
    });

    render();
  }

  function labelsFor(indexes) {
    const model = App.state.template;
    if (!model || indexes.length === 0) return '—';
    const q0 = model.questions[0];
    return indexes.map(i => (q0.bubbles[i] ? q0.bubbles[i].label : i + 1)).join(', ');
  }

  function render() {
    const panel = document.getElementById('panel-results');

    if (scored.length === 0) {
      panel.innerHTML = `
        <div class="panel-head">
          <span class="eyebrow">Step 4</span>
          <h2>採点結果</h2>
          <p>まだ採点できるデータがありません。模範解答と生徒の解答を登録してください。</p>
        </div>
        <div class="btn-row">
          <button class="btn secondary" id="rs-back">← 生徒の解答に戻る</button>
        </div>
      `;
      document.getElementById('rs-back').addEventListener('click', () => App.goToStep('students'));
      return;
    }

    const avg = (scored.reduce((s, r) => s + r.score, 0) / scored.length).toFixed(1);
    const total = scored[0].total;

    panel.innerHTML = `
      <div class="panel-head">
        <span class="eyebrow">Step 4</span>
        <h2>採点結果</h2>
        <p>模範解答と照合した結果です。表の行をクリックすると設問ごとの正誤を確認できます。</p>
      </div>

      <div class="grid-3">
        <div class="card"><h3 style="border:none; padding:0; margin:0 0 6px;">受験者数</h3><div style="font-family:var(--serif); font-size:32px;">${scored.length}<span style="font-size:14px; color:var(--ink-soft);"> 名</span></div></div>
        <div class="card"><h3 style="border:none; padding:0; margin:0 0 6px;">平均点</h3><div style="font-family:var(--serif); font-size:32px;">${avg}<span style="font-size:14px; color:var(--ink-soft);"> / ${total}</span></div></div>
        <div class="card"><h3 style="border:none; padding:0; margin:0 0 6px;">満点者</h3><div style="font-family:var(--serif); font-size:32px;">${scored.filter(r => r.score === total).length}<span style="font-size:14px; color:var(--ink-soft);"> 名</span></div></div>
      </div>

      <div class="card mt16">
        <h3>一覧</h3>
        <table style="width:100%; border-collapse:collapse; font-size:13.5px;">
          <thead>
            <tr style="border-bottom:2px solid var(--ink); text-align:left;">
              <th style="padding:8px 6px;">氏名 / ID</th>
              <th style="padding:8px 6px;">得点</th>
              <th style="padding:8px 6px;">正答率</th>
              <th style="padding:8px 6px;"></th>
            </tr>
          </thead>
          <tbody id="rs-table-body"></tbody>
        </table>
      </div>

      <div id="rs-detail-block"></div>

      <div class="btn-row">
        <button class="btn secondary" id="rs-back">← 生徒の解答に戻る</button>
        <button class="btn" id="rs-export-csv">CSVで書き出す</button>
      </div>
    `;

    const tbody = document.getElementById('rs-table-body');
    tbody.innerHTML = scored.map((r, i) => `
      <tr style="border-bottom:1px solid var(--line); cursor:pointer;" data-idx="${i}" class="rs-row">
        <td style="padding:8px 6px;">${escapeHtml(r.student.name)}</td>
        <td style="padding:8px 6px; font-family:var(--mono);">${r.score} / ${r.total}</td>
        <td style="padding:8px 6px;">${((r.score / r.total) * 100).toFixed(0)}%</td>
        <td style="padding:8px 6px; text-align:right; color:var(--accent); font-size:12px;">詳細を見る ▸</td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.rs-row').forEach(row => {
      row.addEventListener('click', () => showDetail(parseInt(row.dataset.idx, 10)));
    });

    document.getElementById('rs-back').addEventListener('click', () => App.goToStep('students'));
    document.getElementById('rs-export-csv').addEventListener('click', exportCsv);
  }

  function showDetail(idx) {
    const r = scored[idx];
    const block = document.getElementById('rs-detail-block');
    block.innerHTML = `
      <div class="card mt16">
        <h3>${escapeHtml(r.student.name)} の詳細（${r.score} / ${r.total}点）</h3>
        <table style="width:100%; border-collapse:collapse; font-size:13px;">
          <thead>
            <tr style="border-bottom:1px solid var(--line); text-align:left;">
              <th style="padding:6px;">設問</th>
              <th style="padding:6px;">解答</th>
              <th style="padding:6px;">正解</th>
              <th style="padding:6px;">判定</th>
            </tr>
          </thead>
          <tbody>
            ${r.details.map(d => `
              <tr style="border-bottom:1px solid var(--line); ${d.isCorrect ? '' : 'background:var(--bad-soft);'}">
                <td style="padding:6px; font-family:var(--mono);">Q${d.qNumber}</td>
                <td style="padding:6px;">${labelsFor(d.selected)}</td>
                <td style="padding:6px;">${labelsFor(d.correct)}</td>
                <td style="padding:6px;">${d.isCorrect ? '<span class="tag ok">正解</span>' : '<span class="tag bad">不正解</span>'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    block.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function exportCsv() {
    const model = App.state.template;
    const header = ['氏名/ID', '得点', ...model.questions.map(q => `Q${q.qNumber}`)];
    const rows = scored.map(r => {
      const row = [r.student.name, r.score];
      r.details.forEach(d => row.push(labelsFor(d.selected)));
      return row;
    });
    const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'markscan-results.csv';
    a.click();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function init() {
    render();
  }

  return { init, compute };
})();
