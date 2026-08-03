/*
  students.js
  STEP 3: 生徒の解答登録（複数人対応）
  各生徒ごとに: 撮影/アップロード → 解析 → フォーム反映 → 編集 → 確定
*/

const StudentsStep = (() => {

  let pendingId = 0;
  let draft = null; // 現在編集中の生徒 {id, name, answers, warnings}

  function newDraft() {
    return {
      id: 'draft-' + (++pendingId),
      name: '',
      answers: App.state.template ? App.state.template.questions.map(q => ({ qIndex: q.qIndex, selected: [] })) : [],
      warnings: []
    };
  }

  function render() {
    const panel = document.getElementById('panel-students');
    panel.innerHTML = `
      <div class="panel-head">
        <span class="eyebrow">Step 3</span>
        <h2>生徒の解答を登録する</h2>
        <p>1人ずつ、解答用紙を撮影/アップロードして解析し、内容を確認してから登録します。複数人分を繰り返し登録できます。</p>
      </div>

      <div class="card">
        <h3>新しい解答を追加</h3>
        <label class="field" style="max-width:320px;">
          <span class="lbl">氏名 / ID（任意）</span>
          <input type="text" id="st-name" placeholder="例：山田 太郎">
        </label>
        <div id="st-image-input"></div>
        <div class="hint" id="st-scan-hint">用紙を明るい場所で真上から撮影し、四隅の黒いマーカーが写り込むようにしてください。</div>
      </div>

      <div class="card" id="st-form-block" style="display:none;">
        <div class="std-card-head">
          <h3 style="margin:0; border:none; padding:0;">解答内容の確認・修正</h3>
          <span class="tag" id="st-warn-tag"></span>
        </div>
        <div id="st-form-grid"></div>
        <div class="btn-row">
          <button class="btn accent" id="st-add-confirm">この内容で生徒を登録</button>
          <button class="btn secondary" id="st-cancel">キャンセル</button>
        </div>
      </div>

      <div class="card">
        <div class="std-card-head">
          <h3 style="margin:0; border:none; padding:0;">登録済みの生徒（<span id="st-count">0</span>名）</h3>
        </div>
        <div id="st-list"></div>
      </div>

      <div class="btn-row">
        <button class="btn secondary" id="st-back">← 模範解答に戻る</button>
        <button class="btn accent" id="st-to-results" disabled>採点結果を見る →</button>
      </div>
    `;

    App.buildImageInputWidget(document.getElementById('st-image-input'), async (img) => {
      await handleScannedImage(img);
    });

    document.getElementById('st-add-confirm').addEventListener('click', confirmDraft);
    document.getElementById('st-cancel').addEventListener('click', cancelDraft);
    document.getElementById('st-back').addEventListener('click', () => App.goToStep('answerkey'));
    document.getElementById('st-to-results').addEventListener('click', () => {
      ResultsStep.compute();
      App.goToStep('results');
    });

    renderList();
  }

  function onTemplateChanged() {
    // テンプレートが再生成されたら生徒リストをリセット（整合性のため）
    App.state.students = [];
    draft = null;
    if (document.getElementById('panel-students').innerHTML) renderList();
  }

  async function handleScannedImage(img) {
    const hint = document.getElementById('st-scan-hint');
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

    draft = newDraft();
    draft.name = document.getElementById('st-name').value.trim();
    draft.answers = result.answers.map(a => ({ qIndex: a.qIndex, selected: a.selected.slice() }));
    draft.warnings = result.warnings;

    document.getElementById('st-form-block').style.display = 'block';
    renderFormGrid();

    if (result.warnings.length > 0) {
      hint.className = 'hint warn';
      hint.textContent = `解析完了。${result.warnings.length}件、確認が必要な設問があります。内容を確認してから登録してください。`;
    } else {
      hint.className = 'hint';
      hint.textContent = '解析完了。内容を確認して登録してください。';
    }

    document.getElementById('st-form-block').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderFormGrid() {
    const grid = document.getElementById('st-form-grid');
    const warnTag = document.getElementById('st-warn-tag');
    if (!draft || !App.state.template) return;

    const warnQIndexes = new Set(draft.warnings.map(w => w.qIndex));
    warnTag.textContent = draft.warnings.length > 0 ? `要確認 ${draft.warnings.length}件` : '警告なし';
    warnTag.className = 'tag ' + (draft.warnings.length > 0 ? 'warn' : 'ok');

    const model = App.state.template;
    let html = '<div class="ak-grid">';
    model.questions.forEach(q => {
      const entry = draft.answers.find(a => a.qIndex === q.qIndex) || { selected: [] };
      const rowClass = warnQIndexes.has(q.qIndex) ? 'warn-row' : '';
      html += `<div class="ak-row ${rowClass}" data-qindex="${q.qIndex}">
        <span class="ak-qnum">Q${q.qNumber}</span>
        <div class="ak-choices">`;
      q.bubbles.forEach(b => {
        const checked = entry.selected.includes(b.choiceIndex) ? 'checked' : '';
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
        const entry = draft.answers.find(a => a.qIndex === qi);
        if (cb.checked) {
          if (!entry.selected.includes(ci)) entry.selected.push(ci);
        } else {
          entry.selected = entry.selected.filter(c => c !== ci);
        }
        // 手動修正されたら警告表示は落とす
        draft.warnings = draft.warnings.filter(w => w.qIndex !== qi);
        const row = grid.querySelector(`.ak-row[data-qindex="${qi}"]`);
        if (row) row.classList.remove('warn-row', 'bad-row');
        document.getElementById('st-warn-tag').textContent = draft.warnings.length > 0 ? `要確認 ${draft.warnings.length}件` : '警告なし';
        document.getElementById('st-warn-tag').className = 'tag ' + (draft.warnings.length > 0 ? 'warn' : 'ok');
      });
    });
  }

  function confirmDraft() {
    if (!draft) return;
    draft.name = document.getElementById('st-name').value.trim() || `生徒${App.state.students.length + 1}`;
    App.state.students.push(draft);
    draft = null;

    document.getElementById('st-form-block').style.display = 'none';
    document.getElementById('st-name').value = '';
    document.getElementById('st-scan-hint').className = 'hint';
    document.getElementById('st-scan-hint').textContent = '登録しました。続けて次の生徒の用紙を撮影/アップロードできます。';

    renderList();
  }

  function cancelDraft() {
    draft = null;
    document.getElementById('st-form-block').style.display = 'none';
  }

  function renderList() {
    const list = document.getElementById('st-list');
    const count = document.getElementById('st-count');
    const toResults = document.getElementById('st-to-results');
    if (!list) return;

    count.textContent = App.state.students.length;
    toResults.disabled = App.state.students.length === 0;

    if (App.state.students.length === 0) {
      list.innerHTML = '<div class="hint">まだ生徒が登録されていません。</div>';
      return;
    }

    list.innerHTML = App.state.students.map((s, i) => `
      <div class="std-card">
        <div class="std-card-head">
          <strong style="font-size:14px;">${escapeHtml(s.name)}</strong>
          <div class="flex gap8">
            ${s.warnings.length > 0 ? `<span class="tag warn">要確認 ${s.warnings.length}件</span>` : `<span class="tag ok">OK</span>`}
            <button class="btn secondary" style="padding:5px 10px; font-size:12px;" data-remove="${i}">削除</button>
          </div>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.remove, 10);
        App.state.students.splice(idx, 1);
        renderList();
      });
    });
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function init() {
    window.__studentsInited = true;
    render();
  }

  return { init, onTemplateChanged };
})();
