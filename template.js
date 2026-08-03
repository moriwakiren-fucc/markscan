/*
  template.js
  マークシート用紙のテンプレートを生成する。
  生成される座標情報(TemplateModel)は vision.js の画像解析で
  「テンプレート座標系」として使われる。
*/

const MarkTemplate = (() => {

  // 用紙サイズ（内部座標系。A4比率 1:1.414 相当。実際の出力は高解像度にスケールする）
  const PAGE_W = 1240;   // ≒ A4 150dpi 幅
  const PAGE_H = 1754;   // ≒ A4 150dpi 高さ

  const MARKER_SIZE = 34;      // 四隅マーカー（塗りつぶし四角）の一辺
  const MARKER_MARGIN = 46;    // 用紙端からマーカーまでの余白

  const HEADER_H = 150;        // タイトル領域の高さ
  const CONTENT_TOP = HEADER_H + 60;
  const CONTENT_BOTTOM = PAGE_H - 110;

  const COL_GAP = 40;          // 列間の余白
  const ROWS_PER_COL = 25;     // 1列あたりの最大問題数（超えたら次の列へ）

  function labelFor(style, index) {
    if (style === 'alpha') return String.fromCharCode(65 + index); // A,B,C...
    if (style === 'kana') {
      const kana = ['ア','イ','ウ','エ','オ','カ','キ','ク','ケ','コ'];
      return kana[index] || String(index + 1);
    }
    return String(index + 1); // num
  }

  /**
   * テンプレートモデルを生成する。
   * @param {object} opts {questions, choices, labelStyle, title}
   * @returns {object} TemplateModel: 座標・メタ情報一式
   */
  function build(opts) {
    const questions = Math.max(1, Math.min(200, opts.questions | 0));
    const choices = Math.max(2, Math.min(10, opts.choices | 0));
    const labelStyle = opts.labelStyle || 'num';
    const title = opts.title || '';

    // 列数の決定：1列25問を上限に、必要な列数を計算
    const numCols = Math.ceil(questions / ROWS_PER_COL);
    const rowsInThisLayout = Math.ceil(questions / numCols);

    const contentW = PAGE_W - MARKER_MARGIN * 2 - MARKER_SIZE;
    const colW = (contentW - COL_GAP * (numCols - 1)) / numCols;
    const rowH = Math.min(56, (CONTENT_BOTTOM - CONTENT_TOP) / rowsInThisLayout);

    const bubbleR = Math.min(11, (colW - 60) / choices / 2 - 4);

    const questionsModel = [];
    for (let q = 0; q < questions; q++) {
      const col = Math.floor(q / rowsInThisLayout);
      const rowInCol = q % rowsInThisLayout;

      const colX = MARKER_MARGIN + MARKER_SIZE + col * (colW + COL_GAP);
      const y = CONTENT_TOP + rowInCol * rowH + rowH / 2;

      const numLabelW = 46;
      const bubblesStartX = colX + numLabelW;
      const bubbleSpacing = (colW - numLabelW) / choices;

      const bubbles = [];
      for (let c = 0; c < choices; c++) {
        bubbles.push({
          choiceIndex: c,
          label: labelFor(labelStyle, c),
          cx: bubblesStartX + bubbleSpacing * c + bubbleSpacing / 2,
          cy: y,
          r: bubbleR
        });
      }

      questionsModel.push({
        qIndex: q,
        qNumber: q + 1,
        numLabelX: colX,
        y: y,
        bubbles: bubbles
      });
    }

    // 四隅マーカーの座標（中心点ではなく矩形の左上原点で保持）
    const markers = {
      topLeft:     { x: MARKER_MARGIN, y: MARKER_MARGIN },
      topRight:    { x: PAGE_W - MARKER_MARGIN - MARKER_SIZE, y: MARKER_MARGIN },
      bottomLeft:  { x: MARKER_MARGIN, y: PAGE_H - MARKER_MARGIN - MARKER_SIZE },
      bottomRight: { x: PAGE_W - MARKER_MARGIN - MARKER_SIZE, y: PAGE_H - MARKER_MARGIN - MARKER_SIZE }
    };

    return {
      pageW: PAGE_W,
      pageH: PAGE_H,
      markerSize: MARKER_SIZE,
      markers: markers,
      questions: questionsModel,
      meta: { questionCount: questions, choiceCount: choices, labelStyle, title }
    };
  }

  /**
   * TemplateModel を Canvas に描画する。
   */
  function render(canvas, model) {
    canvas.width = model.pageW;
    canvas.height = model.pageH;
    const ctx = canvas.getContext('2d');

    // 背景
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, model.pageW, model.pageH);

    // 四隅マーカー（塗りつぶし黒四角）
    ctx.fillStyle = '#000000';
    Object.values(model.markers).forEach(m => {
      ctx.fillRect(m.x, m.y, model.markerSize, model.markerSize);
    });

    // ヘッダー
    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '600 30px "IBM Plex Serif", serif';
    ctx.fillText(model.meta.title || 'マークシート解答用紙', MARKER_MARGIN + MARKER_SIZE + 10, 78);

    ctx.font = '13px monospace';
    ctx.fillStyle = '#555555';
    ctx.fillText(
      `全 ${model.meta.questionCount} 問 ／ 各問 ${model.meta.choiceCount} 択`,
      MARKER_MARGIN + MARKER_SIZE + 10, 104
    );

    // 氏名欄
    const nameBoxX = model.pageW - 340;
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(nameBoxX, 40, 250, 70);
    ctx.font = '11px monospace';
    ctx.fillStyle = '#555555';
    ctx.fillText('氏名 / ID', nameBoxX + 8, 55);

    ctx.strokeStyle = '#cccccc';
    ctx.beginPath();
    ctx.moveTo(MARKER_MARGIN + MARKER_SIZE, HEADER_H);
    ctx.lineTo(model.pageW - MARKER_MARGIN - MARKER_SIZE, HEADER_H);
    ctx.stroke();

    // 各設問・マーク欄
    model.questions.forEach(q => {
      ctx.font = '600 15px monospace';
      ctx.fillStyle = '#000000';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(q.qNumber).padStart(2, '0'), q.numLabelX, q.y);

      q.bubbles.forEach(b => {
        ctx.beginPath();
        ctx.arc(b.cx, b.cy, b.r, 0, Math.PI * 2);
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = '#222222';
        ctx.stroke();

        ctx.font = '10px sans-serif';
        ctx.fillStyle = '#666666';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(b.label, b.cx, b.cy + b.r + 11);
      });
    });
    ctx.textAlign = 'left';

    // フッター注記
    ctx.font = '10px monospace';
    ctx.fillStyle = '#888888';
    ctx.fillText('鉛筆またはマークペンで◯をしっかり塗りつぶしてください。四隅の黒四角は消さないでください。',
      MARKER_MARGIN + MARKER_SIZE, model.pageH - 50);
  }

  return { build, render, PAGE_W, PAGE_H };
})();
