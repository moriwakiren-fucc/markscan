/*
  app.js
  アプリ全体の状態管理・画面制御・各ステップのUIロジック
*/

const App = (() => {

  // ===== 状態 =====
  const state = {
    template: null,       // template.js の TemplateModel
    templateCanvas: null, // 生成済みプレビューcanvas
    answerKey: null,      // 正解配列: [{qIndex, correct:[choiceIndex,...]}]
    students: [],          // [{id, name, answers:[{qIndex, selected:[...]}], warnings:[...]}]
  };

  const steps = ['template', 'answerkey', 'students', 'results'];

  function unlockStep(stepName) {
    const btn = document.querySelector(`.step-btn[data-step="${stepName}"]`);
    if (btn) btn.disabled = false;
  }

  function markStepDone(stepName) {
    const btn = document.querySelector(`.step-btn[data-step="${stepName}"]`);
    if (btn) btn.classList.add('done');
  }

  function goToStep(stepName) {
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.step-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`panel-${stepName}`).classList.add('active');
    document.querySelector(`.step-btn[data-step="${stepName}"]`).classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function initStepNav() {
    document.querySelectorAll('.step-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        goToStep(btn.dataset.step);
      });
    });
  }

  // ===== STEP 1: テンプレート生成 =====

  function initTemplateStep() {
    const btnGenerate = document.getElementById('btn-generate-template');
    const btnPrint = document.getElementById('btn-print-template');
    const btnDownload = document.getElementById('btn-download-template');
    const btnNext = document.getElementById('btn-to-answerkey');
    const hint = document.getElementById('template-hint');
    const previewWrap = document.getElementById('template-preview-wrap');
    const actions = document.getElementById('template-actions');

    btnGenerate.addEventListener('click', () => {
      const questions = parseInt(document.getElementById('cfg-questions').value, 10);
      const choices = parseInt(document.getElementById('cfg-choices').value, 10);
      const labelStyle = document.getElementById('cfg-label-style').value;
      const title = document.getElementById('cfg-title').value.trim();

      if (!questions || questions < 1) {
        hint.className = 'hint bad';
        hint.textContent = '問題数は1以上で入力してください。';
        return;
      }
      if (!choices || choices < 2) {
        hint.className = 'hint bad';
        hint.textContent = '選択肢数は2以上で入力してください。';
        return;
      }

      const model = MarkTemplate.build({ questions, choices, labelStyle, title });
      const canvas = document.createElement('canvas');
      MarkTemplate.render(canvas, model);

      state.template = model;
      state.templateCanvas = canvas;

      previewWrap.innerHTML = '';
      const previewImg = document.createElement('img');
      previewImg.src = canvas.toDataURL('image/png');
      previewImg.style.maxWidth = '100%';
      previewImg.style.boxShadow = '0 2px 10px rgba(0,0,0,.15)';
      previewWrap.appendChild(previewImg);

      actions.style.display = 'flex';
      hint.className = 'hint';
      hint.textContent = `生成しました（全${questions}問 / ${choices}択）。印刷してこの用紙に解答してもらうか、模範解答の作成に進んでください。`;

      unlockStep('answerkey');
      markStepDone('template');

      // 後続ステップが初期化済みならテンプレート変更を反映
      if (window.__answerKeyInited) AnswerKeyStep.onTemplateChanged();
      if (window.__studentsInited) StudentsStep.onTemplateChanged();
    });

    btnPrint.addEventListener('click', () => {
      if (!state.templateCanvas) return;
      const dataUrl = state.templateCanvas.toDataURL('image/png');
      const w = window.open('', '_blank');
      w.document.write(`<html><head><title>印刷</title></head><body style="margin:0;">
        <img src="${dataUrl}" style="width:100%;" onload="setTimeout(()=>window.print(),300)">
        </body></html>`);
      w.document.close();
    });

    btnDownload.addEventListener('click', () => {
      if (!state.templateCanvas) return;
      const a = document.createElement('a');
      a.href = state.templateCanvas.toDataURL('image/png');
      a.download = 'marksheet-template.png';
      a.click();
    });

    btnNext.addEventListener('click', () => goToStep('answerkey'));
  }

  // ===== 共通：画像入力ウィジェット =====
  /*
    ファイルアップロード・カメラ撮影の両対応の入力UIを生成し、
    画像が確定した時に onImageReady(imgElement) を呼ぶ。
  */
  function buildImageInputWidget(container, onImageReady) {
    container.innerHTML = `
      <div class="img-input">
        <div class="btn-row" style="margin-top:0;">
          <label class="btn secondary" style="cursor:pointer;">
            📁 ファイルを選択
            <input type="file" accept="image/*" style="display:none;" class="file-input">
          </label>
          <label class="btn secondary" style="cursor:pointer;">
            📷 カメラで撮影
            <input type="file" accept="image/*" capture="environment" style="display:none;" class="camera-input">
          </label>
        </div>
        <div class="img-preview-wrap mt16" style="display:none; background:#eee7d8; border:1px solid var(--line); border-radius:3px; padding:10px; text-align:center;">
          <img class="img-preview" style="max-width:100%; max-height:340px; box-shadow:0 2px 8px rgba(0,0,0,.15);">
        </div>
      </div>
    `;
    const fileInput = container.querySelector('.file-input');
    const cameraInput = container.querySelector('.camera-input');
    const previewWrap = container.querySelector('.img-preview-wrap');
    const previewImg = container.querySelector('.img-preview');

    async function handleFile(file) {
      if (!file) return;
      const img = await MarkVision.loadImageFromFile(file);
      previewImg.src = img.src;
      previewWrap.style.display = 'block';
      onImageReady(img);
    }

    fileInput.addEventListener('change', e => handleFile(e.target.files[0]));
    cameraInput.addEventListener('change', e => handleFile(e.target.files[0]));
  }

  // ===== 初期化 =====
  function init() {
    initStepNav();
    initTemplateStep();
    AnswerKeyStep.init();
    StudentsStep.init();
    ResultsStep.init();
  }

  return { state, goToStep, unlockStep, markStepDone, buildImageInputWidget, init };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
