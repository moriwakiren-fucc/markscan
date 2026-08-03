/*
  vision.js
  ブラウザのCanvas APIのみを使った画像解析エンジン。
  流れ:
    1. 画像を読み込みグレースケール化
    2. 四隅の位置合わせマーカー(黒四角)を探索
    3. 4点から透視変換(ホモグラフィ)行列を計算
    4. テンプレート座標 -> 実画像座標へ逆変換しながら、
       各マーク欄の暗さ(塗りつぶし具合)をサンプリングして判定
*/

const MarkVision = (() => {

  // ---------- 画像読み込み ----------

  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { resolve(img); URL.revokeObjectURL(url); };
      img.onerror = reject;
      img.src = url;
    });
  }

  function loadImageFromDataURL(dataURL) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataURL;
    });
  }

  // ---------- グレースケール変換 ----------

  function toGrayscaleData(img, maxDim = 1400) {
    let w = img.width, h = img.height;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    w = Math.round(w * scale);
    h = Math.round(h * scale);

    const cvs = document.createElement('canvas');
    cvs.width = w; cvs.height = h;
    const ctx = cvs.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const r = imgData.data[i * 4], g = imgData.data[i * 4 + 1], b = imgData.data[i * 4 + 2];
      gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
    return { gray, w, h, canvas: cvs };
  }

  // ---------- 四隅マーカー検出 ----------
  /*
    戦略:
    画像を4つの象限(左上/右上/左下/右下)に大まかに分割し、
    各象限内で「暗いピクセルが密集している矩形領域」の重心を探す。
    位置合わせマーカーは大きな黒塗りベタ四角なので、
    小さな文字やノイズより暗さの密度が高く、閾値+密度フィルタで拾える。
  */

  function findDarkBlobCentroid(gray, w, h, xMin, xMax, yMin, yMax, darkThreshold = 90) {
    xMin = Math.floor(Math.max(0, xMin)); yMin = Math.floor(Math.max(0, yMin));
    xMax = Math.ceil(Math.min(w, xMax)); yMax = Math.ceil(Math.min(h, yMax));

    // まず候補領域内の暗ピクセルをラフに検出
    let sumX = 0, sumY = 0, count = 0;
    const darkMap = [];
    for (let y = yMin; y < yMax; y++) {
      for (let x = xMin; x < xMax; x++) {
        const v = gray[y * w + x];
        if (v < darkThreshold) {
          darkMap.push([x, y]);
        }
      }
    }
    if (darkMap.length < 30) return null; // マーカーらしき塊が無い

    // 密集度の高い領域を粗くクラスタリング(グリッドヒストグラム方式)
    const gridSize = 8;
    const gw = Math.ceil((xMax - xMin) / gridSize);
    const gh = Math.ceil((yMax - yMin) / gridSize);
    const hist = new Int32Array(gw * gh);
    darkMap.forEach(([x, y]) => {
      const gx = Math.floor((x - xMin) / gridSize);
      const gy = Math.floor((y - yMin) / gridSize);
      hist[gy * gw + gx]++;
    });

    // 最も密度の高いグリッドセルを中心に、その周辺を最終ブロブとして重心計算
    let bestIdx = 0, bestVal = -1;
    for (let i = 0; i < hist.length; i++) {
      if (hist[i] > bestVal) { bestVal = hist[i]; bestIdx = i; }
    }
    const bestGX = bestIdx % gw, bestGY = Math.floor(bestIdx / gw);
    const centerX = xMin + bestGX * gridSize + gridSize / 2;
    const centerY = yMin + bestGY * gridSize + gridSize / 2;

    // 中心から一定半径以内の暗ピクセルだけで重心を再計算(精緻化)
    const radius = gridSize * 6;
    sumX = 0; sumY = 0; count = 0;
    darkMap.forEach(([x, y]) => {
      if (Math.hypot(x - centerX, y - centerY) <= radius) {
        sumX += x; sumY += y; count++;
      }
    });
    if (count < 20) return null;

    return { x: sumX / count, y: sumY / count, confidence: count };
  }

  function detectCornerMarkers(gray, w, h) {
    // 各象限のサーチ範囲(画像端寄り30%の領域を対象にする)
    const qx = w * 0.32, qy = h * 0.32;

    const topLeft = findDarkBlobCentroid(gray, w, h, 0, qx, 0, qy);
    const topRight = findDarkBlobCentroid(gray, w, h, w - qx, w, 0, qy);
    const bottomLeft = findDarkBlobCentroid(gray, w, h, 0, qx, h - qy, h);
    const bottomRight = findDarkBlobCentroid(gray, w, h, w - qx, w, h - qy, h);

    if (!topLeft || !topRight || !bottomLeft || !bottomRight) {
      return { ok: false, points: null };
    }
    return { ok: true, points: { topLeft, topRight, bottomLeft, bottomRight } };
  }

  // ---------- ホモグラフィ（透視変換）----------
  /*
    テンプレート座標系の4点 -> 実画像座標系の4点、の対応から
    3x3 の射影変換行列を解く(一般的なDLT法の4点版)。
  */

  function computeHomography(srcPts, dstPts) {
    // srcPts, dstPts: [{x,y}, {x,y}, {x,y}, {x,y}] (topLeft, topRight, bottomRight, bottomLeft の順)
    const A = [];
    const b = [];
    for (let i = 0; i < 4; i++) {
      const { x: sx, y: sy } = srcPts[i];
      const { x: dx, y: dy } = dstPts[i];
      A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]);
      b.push(dx);
      A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]);
      b.push(dy);
    }
    const h = solveLinearSystem(A, b); // 8要素
    if (!h) return null;
    return [
      h[0], h[1], h[2],
      h[3], h[4], h[5],
      h[6], h[7], 1
    ];
  }

  function solveLinearSystem(A, b) {
    // ガウスの消去法で Ax = b を解く（8x8）
    const n = A.length;
    const M = A.map((row, i) => [...row, b[i]]);

    for (let col = 0; col < n; col++) {
      let pivotRow = col;
      for (let r = col + 1; r < n; r++) {
        if (Math.abs(M[r][col]) > Math.abs(M[pivotRow][col])) pivotRow = r;
      }
      if (Math.abs(M[pivotRow][col]) < 1e-10) return null;
      [M[col], M[pivotRow]] = [M[pivotRow], M[col]];

      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const factor = M[r][col] / M[col][col];
        for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
      }
    }
    return M.map((row, i) => row[n] / row[i]);
  }

  function applyHomography(H, x, y) {
    const denom = H[6] * x + H[7] * y + H[8];
    return {
      x: (H[0] * x + H[1] * y + H[2]) / denom,
      y: (H[3] * x + H[4] * y + H[5]) / denom
    };
  }

  // ---------- マーク欄の判定 ----------

  function sampleDarkness(gray, w, h, cx, cy, r) {
    let sum = 0, count = 0;
    const rr = Math.max(2, Math.round(r * 0.75));
    for (let dy = -rr; dy <= rr; dy++) {
      for (let dx = -rr; dx <= rr; dx++) {
        if (dx * dx + dy * dy > rr * rr) continue;
        const px = Math.round(cx + dx), py = Math.round(cy + dy);
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        sum += gray[py * w + px];
        count++;
      }
    }
    if (count === 0) return 255;
    return sum / count; // 0=黒 255=白
  }

  /**
   * メイン解析関数。
   * @param {HTMLImageElement} img 解析対象の画像
   * @param {object} templateModel template.js の build() で作った座標モデル
   * @returns {object} { ok, error?, answers: [{qIndex, selected:[choiceIndex...], darkness:[...]}], corners, warnings }
   */
  function analyze(img, templateModel) {
    const { gray, w, h } = toGrayscaleData(img);
    const detection = detectCornerMarkers(gray, w, h);

    if (!detection.ok) {
      return {
        ok: false,
        error: '四隅の位置合わせマーカーを検出できませんでした。用紙全体が写るように、明るい場所で真上から撮影し直してください。'
      };
    }

    const pts = detection.points;
    // テンプレート座標系（マーカー中心）
    const m = templateModel.markers;
    const half = templateModel.markerSize / 2;
    const srcPts = [
      { x: m.topLeft.x + half, y: m.topLeft.y + half },
      { x: m.topRight.x + half, y: m.topRight.y + half },
      { x: m.bottomRight.x + half, y: m.bottomRight.y + half },
      { x: m.bottomLeft.x + half, y: m.bottomLeft.y + half }
    ];
    const dstPts = [
      { x: pts.topLeft.x, y: pts.topLeft.y },
      { x: pts.topRight.x, y: pts.topRight.y },
      { x: pts.bottomRight.x, y: pts.bottomRight.y },
      { x: pts.bottomLeft.x, y: pts.bottomLeft.y }
    ];

    const H = computeHomography(srcPts, dstPts);
    if (!H) {
      return { ok: false, error: '画像の補正計算に失敗しました。撮影角度を変えて再度お試しください。' };
    }

    // 背景の明るさを参照するため、ランダムな余白サンプリングで白レベルを推定
    const whiteLevel = estimateWhiteLevel(gray, w, h, H, templateModel);

    const answers = [];
    const warnings = [];

    templateModel.questions.forEach(q => {
      const darknessList = q.bubbles.map(b => {
        const p = applyHomography(H, b.cx, b.cy);
        const d = sampleDarkness(gray, w, h, p.x, p.y, b.r * (w / templateModel.pageW) * 1.4 || b.r);
        return d;
      });

      // 相対的な暗さ判定: 白レベルに対してどれだけ暗いか
      const threshold = whiteLevel - 45; // 白レベルより45以上暗ければ塗り
      const selected = [];
      darknessList.forEach((d, i) => { if (d < threshold) selected.push(i); });

      if (selected.length === 0) {
        warnings.push({ qIndex: q.qIndex, type: 'none', message: `第${q.qNumber}問：マークが検出されませんでした` });
      } else if (selected.length > 1) {
        warnings.push({ qIndex: q.qIndex, type: 'multi', message: `第${q.qNumber}問：複数マークが検出されました` });
      }

      answers.push({ qIndex: q.qIndex, selected, darkness: darknessList });
    });

    return { ok: true, answers, warnings, corners: pts };
  }

  function estimateWhiteLevel(gray, w, h, H, templateModel) {
    // マーク欄以外の余白領域(用紙上部の何点か)をサンプリングして白の基準値を推定
    const samples = [];
    const testPoints = [
      { x: templateModel.pageW * 0.5, y: 30 },
      { x: templateModel.pageW * 0.15, y: templateModel.pageH * 0.5 },
      { x: templateModel.pageW * 0.85, y: templateModel.pageH * 0.5 }
    ];
    testPoints.forEach(tp => {
      const p = applyHomography(H, tp.x, tp.y);
      const d = sampleDarkness(gray, w, h, p.x, p.y, 6);
      samples.push(d);
    });
    samples.sort((a, b) => b - a);
    return samples[0] || 235;
  }

  return {
    loadImageFromFile,
    loadImageFromDataURL,
    analyze
  };
})();
