/*
  answerkey.js
  STEP 2: 模範解答の登録
  - 画面フォームで直接入力
  - CSV/JSON読み込み
  - 模範解答用紙を撮影/アップロードして自動解析→フォームに反映→編集可
*/

const AnswerKeyStep = (() => {

  let currentKey = null; // [{qIndex, correct:[choiceIndex,...]}]

  function labelFor(model, choiceIndex) {
    const q0 = model.questions[0];
    const b = q0.bubbles[choiceIndex];
    return b ? b.label : String(choiceIndex + 1);
  }

  function emptyKeyFromTemplate(model) {
    return model.questions.map(q => ({ qIndex: q.qIndex, correct: [] }));
  }

  function render() {
    const panel = document.getElementById('panel-answerkey');
    panel.innerHTML = `
      <div class="panel-head">
        <span class="eyebrow">Step 2</span>
        <h2>模範解答を登録する</h2>
        <p>模範解答用紙を撮影/アップロードして自動解析するか、CSV・JSONの読み込み、または画面フォームでの手入力から選べます。自動解析後も内容は自由に編集できます。</p>
      </div>

      <div class="card">
        <h3>登録方法を選ぶ</h3>
        <div class="btn-row" style="margin-top:0;">
          <button class="btn secondary method-btn active" data-method="scan">📷 用紙を撮影・解析</button>
          <button class="btn secondary method-btn" data-method="file">📄 CSV / JSON を読み込む</button>
          <button class="btn secondary method-btn" data-method="manual">✏️ 手入力のみで進める</button>
        </div>
      </div>

      <div class="card" id="ak-scan-block">
        <h3>模範解答用紙を撮影・解析</h3>
        <div id="ak-image-input"></div>
        <div class="hint" id="ak-scan-hint">用紙を明るい場所で真上から撮影し、四隅の黒いマーカーが写り込むようにしてください。</div>
      </div>

      <div class="card" id="ak-file-block" style="display:none;">
        <h3>CSV / JSON を読み込む</h3>
        <p style="font-size:13px; color:var(--ink-soft); margin-top:0;">
          CSV例：<code>1,3</code>（1問目の正解が選択肢3）を1行ずつ。<br>
          JSON例：<code>{"1":3,"2":[1,2],"3":4}</code>（複数正解も配列で指定可）
        </p>
        <input type="file" id="ak-file-input" accept=".csv,.json,text/csv,application/json">
        <div class="hint" id="ak-file-hint" style="display:none;"></div>
      </div>

      <div class="card" id="ak-form-block">
        <h3>正解一覧（確認・編集）</h3>
        <div id="ak-form-grid"></div>
      </div>

      <div class="btn-row">
        <button class="btn secondary" id="ak-back">← テンプレートに戻る</button>
        <button class="btn accent" id="ak-confirm">この内容で確定して次へ →</button>
      </div>
      <div class="hint" id="ak-confirm-hint" style="display:none;"></div>
    `;

    panel.querySelectorAll('.method-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.method-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const method = btn.dataset.method;
        panel.querySelector('#ak-scan-block').style.display = method === 'scan' ? 'block' : 'none';
        panel.querySelector('#ak-file-block').style.display = method === 'file' ? 'block' : 'none';
      });
    });

    App.buildImageInputWidget(document.getElementById('ak-image-input'), async (img) => {
      await handleScannedImage(img);
    });

    document.getElementById('ak-file-input').addEventListener('change', handleFileInput);
    document.getElementById('ak-back').addEventListener('click', () => App.goToStep('template'));
    document.getElementById('ak-confirm').addEventListener('click', confirmAndProceed);

    renderFormGrid();
  }

  function onTemplateChanged() {
    currentKey = emptyKeyFromTemplate(App.state.template);
    renderFormGrid();
  }

  async function handleScannedImage(img) {
    const hint = document.getElementById('ak-scan-hint');
    if (!App.state.template) {
      hint.className = 'hint bad';
      hint.textContent = '先にステップ1でテンプレートを生成してください。';
      return;
    }
    hint.className = 'hint';
    hint.textContent = '解析中です…';

    const result = MarkVision.analyze(img, App.state.template);
    if (!result.ok) {
      hint.className = 'hint bad';
      hint.textContent = result.error;
      return;
    }

    currentKey = App.state.template.questions.map((q, i) => ({
      qIndex: q.qIndex,
      correct: result.answers[i].selected.slice()
    }));

    renderFormGrid();

    if (result.warnings.length > 0) {
      hint.className = 'hint warn';
      hint.textContent = `解析完了。${result.warnings.length}件、確認が必要な設問があります（黄色/赤でハイライトされています）。下のフォームで正解を確認・修正してください。`;
    } else {
      hint.className = 'hint';
      hint.textContent = '解析完了。念のため下のフォームで正解を確認してください。';
    }
  }

  function handleFileInput(e) {
    const file = e.target.files[0];
    if (!file) return;
    const hint = document.getElementById('ak-file-hint');
    hint.style.display = 'block';

    if (!App.state.template) {
      hint.className = 'hint bad';
      hint.textContent = '先にステップ1でテンプレートを生成してください。';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        let parsed;
        if (file.name.endsWith('.json') || file.type === 'application/json') {
          parsed = JSON.parse(reader.result);
          currentKey = App.state.template.questions.map(q => {
            const key = String(q.qNumber);
            let val = parsed[key];
            if (val === undefined) val = [];
            else if (!Array.isArray(val)) val = [val];
            return { qIndex: q.qIndex, correct: val.map(v => Number(v) - 1) };
          });
        } else {
          // CSV: "問題番号,正解番号[,正解番号...]"
          const lines = reader.result.split(/\r?\n/).filter(l => l.trim().length > 0);
          const map = {};
          lines.forEach(line => {
            const parts = line.split(',').map(s => s.trim());
            const qNum = parseInt(parts[0], 10);
            const answers = parts.slice(1).map(s => parseInt(s, 10) - 1).filter(n => !isNaN(n));
            map[qNum] = answers;
          });
          currentKey = App.state.template.questions.map(q => ({
            qIndex: q.qIndex,
            correct: map[q.qNumber] || []
          }));
        }
        renderFormGrid();
        hint.className = 'hint';
        hint.textContent = '読み込みました。内容を確認してください。';
      } catch (err) {
        hint.className = 'hint bad';
        hint.textContent = '読み込みに失敗しました。フォーマットを確認してください：' + err.message;
      }
    };
    reader.readAsText(file);
  }

  function renderFormGrid() {
    const grid = document.getElementById('ak-form-grid');
    if (!grid) return;

    if (!App.state.template) {
      grid.innerHTML = '<div class="hint bad">先にステップ1でテンプレートを生成してください。</div>';
      return;
    }
    if (!currentKey) currentKey = emptyKeyFromTemplate(App.state.template);

    const model = App.state.template;
    let html = '<div class="ak-grid">';
    model.questions.forEach(q => {
      const entry = currentKey.find(k => k.qIndex === q.qIndex) || { correct: [] };
      html += `<div class="ak-row" data-qindex="${q.qIndex}">
        <span class="ak-qnum">Q${q.qNumber}</span>
        <div class="ak-choices">`;
      q.bubbles.forEach(b => {
        const checked = entry.correct.includes(b.choiceIndex) ? 'checked' : '';
        html += `<label class="ak-choice">
          <input type="checkbox" data-qindex="${q.qIndex}" data-choice="${b.choiceIndex}" ${checked}>
          <span>${b.label}</span>
        </label>`;
      });
      html += `</div></div>`;
    });
    html += '</div>';
    grid.innerHTML = html;

    grid.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', () => {
        const qi = parseInt(cb.dataset.qindex, 10);
        const ci = parseInt(cb.dataset.choice, 10);
        const entry = currentKey.find(k => k.qIndex === qi);
        if (cb.checked) {
          if (!entry.correct.includes(ci)) entry.correct.push(ci);
        } else {
          entry.correct = entry.correct.filter(c => c !== ci);
        }
      });
    });

    injectGridStyleOnce();
  }

  function injectGridStyleOnce() {
    if (document.getElementById('ak-grid-style')) return;
    const style = document.createElement('style');
    style.id = 'ak-grid-style';
    style.textContent = `
      .ak-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:8px; }
      .ak-row{ display:flex; align-items:center; gap:10px; border:1px solid var(--line); border-radius:3px; padding:8px 10px; background:var(--paper); }
      .ak-qnum{ font-family:var(--mono); font-size:12px; font-weight:600; color:var(--ink-soft); width:34px; }
      .ak-choices{ display:flex; gap:8px; flex-wrap:wrap; }
      .ak-choice{ display:flex; align-items:center; gap:3px; font-size:12.5px; cursor:pointer; }
      .std-card{ border:1px solid var(--line); border-radius:3px; padding:14px; margin-top:12px; background:var(--paper); }
      .std-card-head{ display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
      .warn-row{ background:var(--warn-soft) !important; }
      .bad-row{ background:var(--bad-soft) !important; }
    `;
    document.head.appendChild(style);
  }

  function confirmAndProceed() {
    const hint = document.getElementById('ak-confirm-hint');
    if (!App.state.template) {
      hint.style.display = 'block';
      hint.className = 'hint bad';
      hint.textContent = '先にステップ1でテンプレートを生成してください。';
      return;
    }
    const totalAnswered = currentKey.filter(k => k.correct.length > 0).length;
    if (totalAnswered < App.state.template.questions.length) {
      hint.style.display = 'block';
      hint.className = 'hint warn';
      hint.textContent = `${App.state.template.questions.length - totalAnswered}問、正解が未設定です。それでも進める場合はもう一度「次へ」を押してください。`;
      hint.dataset.confirmedOnce = hint.dataset.confirmedOnce === '1' ? '' : '1';
      if (hint.dataset.confirmedOnce !== '1') return;
    }

    App.state.answerKey = currentKey;
    App.unlockStep('students');
    App.markStepDone('answerkey');
    StudentsStep.onTemplateChanged();
    App.goToStep('students');
  }

  function init() {
    window.__answerKeyInited = true;
    render();
  }

  return { init, onTemplateChanged, getCurrentKey: () => currentKey, labelFor };
})();
