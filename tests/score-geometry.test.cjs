const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const ts = require('typescript');

const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const geometryModule = { exports: {} };
new Function('module', 'exports', compile(fs.readFileSync(require.resolve('../app/score-sync/score-geometry.ts'), 'utf8')))(geometryModule, geometryModule.exports);
const { readScoreGeometry, findVectorStaves, vectorBarsForStaff } = geometryModule.exports;
const pageSource = fs.readFileSync(require.resolve('../app/score-sync/page.tsx'), 'utf8');
const source = ts.createSourceFile('page.tsx', pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const helpers = source.statements.filter(node => ts.isVariableStatement(node)
  || (ts.isFunctionDeclaration(node) && node.name?.text !== 'ScoreSyncPage'));
const pageModule = { exports: {} };
new Function('module', 'findVectorStaves', 'vectorBarsForStaff', compile(
  helpers.map(node => node.getText(source)).join('\n') + '\nmodule.exports = { findMeasures, applyVoltaPasses };',
))(pageModule, findVectorStaves, vectorBarsForStaff);
const { findMeasures, applyVoltaPasses } = pageModule.exports;
const navigationModule = { exports: {} };
new Function('module', 'exports', compile(fs.readFileSync(require.resolve('../app/score-sync/navigation.ts'), 'utf8')))(navigationModule, navigationModule.exports);
const { compilePlaybackOrder } = navigationModule.exports;

let pdfjs;
before(async () => {
  process.getBuiltinModule ??= name => require(name);
  const { DOMMatrix, ImageData, Path2D } = require('@napi-rs/canvas');
  Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve('../public/pdf.worker.min.mjs')).href;
});

function canvas(width = 1190, height = 1684) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  return { width, height, getContext: () => ({ getImageData: () => ({ data }) }),
    rect(left, top, right, bottom) {
      for (let y = Math.round(top); y <= Math.round(bottom); y++) {
        for (let x = Math.round(left); x <= Math.round(right); x++) data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
      }
    },
  };
}

function addStaff(geometry, top, spacing, count, edges) {
  const lines = Array.from({ length: count }, (_, i) => top + i * spacing);
  geometry.horizontal.push(...lines.map(y => ({ y, left: edges[0], right: edges.at(-1) })));
  geometry.vertical.push(...edges.map(x => ({ x, top, bottom: lines.at(-1) })));
  return lines;
}

test('reads transformed line strokes, excluding curves and filled glyphs', () => {
  const { OPS } = pdfjs;
  const stroke = (x, y, endX, endY) => [OPS.stroke, [new Float32Array([0, x, y, 1, endX, endY])]];
  const operations = [
    [OPS.save, []], [OPS.transform, [2, 0, 0, 2, 10, 20]],
    [OPS.constructPath, stroke(5, 5, 5, 25)], [OPS.restore, []],
    [OPS.paintFormXObjectBegin, [[1, 0, 0, 1, 30, 40]]],
    [OPS.beginGroup, [{ matrix: [1, 0, 0, 1, 30, 40] }]],
    [OPS.constructPath, stroke(0, 0, 100, 0)],
    [OPS.endGroup, []], [OPS.paintFormXObjectEnd, []],
    [OPS.constructPath, stroke(100, 10, 100, 30)],
    [OPS.constructPath, [OPS.fill, [new Float32Array([0, 20, 10, 1, 20, 30])]]],
    [OPS.constructPath, [OPS.stroke, [new Float32Array([0, 40, 10, 2, 40, 15, 40, 25, 40, 30])]]],
  ];
  const result = readScoreGeometry({ fnArray: operations.map(op => op[0]), argsArray: operations.map(op => op[1]) }, [1, 0, 0, -1, 0, 300], pdfjs);
  assert.deepEqual(result.vertical, [{ x: 20, top: 230, bottom: 270 }, { x: 100, top: 270, bottom: 290 }]);
  assert.deepEqual(result.horizontal, [{ y: 260, left: 30, right: 130 }]);
});

test('recognizes five staff lines and six TAB lines, but no title or lyric rows', () => {
  const geometry = { horizontal: [], vertical: [] };
  addStaff(geometry, 100, 8.3, 5, [72, 400, 1142]);
  addStaff(geometry, 230, 9.24, 6, [72, 400, 1142]);
  geometry.horizontal.push({ y: 40, left: 300, right: 800 }, { y: 50, left: 300, right: 800 },
    ...[350, 360, 370, 380, 390].map(y => ({ y, left: 500, right: 600 })));
  const staves = findVectorStaves(geometry, 1190);
  assert.deepEqual(staves.map(staff => staff.lines.length), [5, 6]);
  assert.equal(staves[1].lines.at(-1), 276.2);
});

test('requires staff endpoints and falls back when vector end strokes are unavailable', () => {
  const geometry = { horizontal: [], vertical: [] };
  addStaff(geometry, 100, 10, 5, [72, 400, 1142]);
  geometry.vertical.push({ x: 600, top: 90, bottom: 150 }, { x: 800, top: 110, bottom: 140 });
  const [staff] = findVectorStaves(geometry, 1190);
  assert.deepEqual(vectorBarsForStaff(geometry, staff), [72, 400, 1142]);
  geometry.vertical = geometry.vertical.filter(line => line.x !== 1142);
  assert.equal(vectorBarsForStaff(geometry, staff), null);
});

test('keeps the Kaiju fourth and fifth measures separate across connected guitar TAB parts', () => {
  const geometry = { horizontal: [], vertical: [] };
  const edges = [92.64, 280.32, 452.16, 624, 795.84, 967.68, 1142.4];
  addStaff(geometry, 421.68, 8.28, 5, edges);
  addStaff(geometry, 527.76, 9.216, 6, edges);
  addStaff(geometry, 626.16, 9.216, 6, edges);
  geometry.vertical.push({ x: edges[0], top: 421.68, bottom: 672.24 },
    { x: 710, top: 410, bottom: 460 }, { x: 710, top: 520, bottom: 580 }, { x: 710, top: 620, bottom: 680 });
  const measures = findMeasures(canvas(), 1, [], geometry);
  assert.equal(measures.length, 6);
  assert.deepEqual(measures.map(measure => measure.pixelRight), edges.slice(1));
  assert.equal(measures[3].pixelRight, measures[4].pixelLeft);
  assert.ok(measures.every(measure => measure.system === 0 && measure.staffTop === 422 && measure.staffBottom === 672));
});

test('does not split Drowning at long stems or miss real bars next to notes', () => {
  const geometry = { horizontal: [], vertical: [] };
  const edges = [72.24, 395.76, 644.04, 892.32, 1142.4];
  addStaff(geometry, 777, 8.3, 5, edges);
  addStaff(geometry, 891, 9.2, 6, edges);
  geometry.vertical.push({ x: edges[0], top: 777, bottom: 937 },
    { x: 550, top: 766, bottom: 817 }, { x: 550, top: 880, bottom: 945 });
  const image = canvas();
  image.rect(638, 770, 654, 818); // Dense notes touching a legitimate barline.
  const measures = findMeasures(image, 3, [], geometry);
  assert.deepEqual(measures.map(measure => measure.pixelRight), edges.slice(1));
  assert.ok(measures.every(measure => measure.staffBottom === 937));
});

test('accepts a bar spanning all connected staves while retaining separate systems', () => {
  const geometry = { horizontal: [], vertical: [] };
  addStaff(geometry, 100, 10, 5, [72, 1142]);
  addStaff(geometry, 220, 10, 6, [72, 1142]);
  addStaff(geometry, 400, 10, 5, [72, 400, 1142]);
  geometry.vertical.push(...[72, 400, 1142].map(x => ({ x, top: 100, bottom: 270 })));
  const measures = findMeasures(canvas(), 1, [], geometry);
  assert.deepEqual(measures.map(measure => [measure.system, measure.pixelRight, measure.staffBottom]),
    [[0, 400, 270], [0, 1142, 270], [1, 400, 440], [1, 1142, 440]]);
});

test('image-only scores retain bar detection and include the sixth TAB line', () => {
  const image = canvas();
  for (const y of [100, 110, 120, 130, 140, 150]) image.rect(72, y, 1142, y);
  for (const x of [72, 400, 700, 1142]) image.rect(x, 100, x, 150);
  for (const geometry of [undefined, { horizontal: [], vertical: [] }]) {
    const measures = findMeasures(image, 1, [], geometry);
    assert.equal(measures.length, 3);
    assert.ok(measures.every(measure => measure.staffBottom === 150));
  }
});

test('repeat dot edges are not counted as a connecting stem', () => {
  const image = canvas();
  const geometry = { horizontal: [], vertical: [] };
  addStaff(geometry, 614.76, 8.31, 5, [72, 400, 1142]);
  for (const line of geometry.horizontal) image.rect(line.left, line.y, line.right, line.y);
  for (const x of [72, 77, 400, 1142]) image.rect(x, 615, x, 648);
  image.rect(84, 625, 87, 629);
  image.rect(84, 634, 87, 638);
  assert.equal(findMeasures(image, 1, [], geometry)[0].repeatStart, true);
});

test('a close double bar without dots is not a repeat end on a narrow staff', () => {
  for (const spacing of [8, 8.3]) {
    const image = canvas();
    const geometry = { horizontal: [], vertical: [] };
    addStaff(geometry, 100, spacing, 5, [72, 400, 700, 1142]);
    for (const line of geometry.horizontal) image.rect(line.left, line.y, line.right, line.y);
    for (const x of [395, 400]) image.rect(x, 100, x, 100 + spacing * 4);
    const measures = findMeasures(image, 1, [], geometry);
    assert.equal(measures[0].repeatEnd, undefined, `spacing ${spacing}`);
  }
});

test('small repeat dots on a narrow staff preserve the repeated playback section', () => {
  const image = canvas();
  const geometry = { horizontal: [], vertical: [] };
  addStaff(geometry, 100, 8, 5, [72, 400, 700, 1142]);
  for (const line of geometry.horizontal) image.rect(line.left, line.y, line.right, line.y);
  for (const x of [72, 400, 404, 700, 1138, 1142]) image.rect(x, 100, x, 132);
  for (const x of [410, 1130]) {
    image.rect(x, 111, x + 2, 113);
    image.rect(x, 119, x + 2, 121);
  }
  const measures = findMeasures(image, 1, [], geometry);
  assert.equal(measures.length, 3);
  assert.equal(measures[1].repeatStart, true);
  assert.equal(measures[2].repeatEnd, true);
  assert.deepEqual(compilePlaybackOrder(measures), { order: [0, 1, 2, 1, 2], warnings: [], valid: true });
});

test('recognizes repeat dots beside staff lines rasterized across adjacent pixels', () => {
  const image = canvas();
  const geometry = { horizontal: [], vertical: [] };
  addStaff(geometry, 1041, 8.31, 5, [72, 400, 700, 1142]);
  for (const [top, bottom] of [[1041, 1041], [1049, 1050], [1057, 1058], [1066, 1066], [1074, 1075]]) {
    image.rect(72, top, 1142, bottom);
  }
  for (const x of [1132, 1140]) image.rect(x, 1041, x, 1075);
  image.rect(1125, 1051, 1129, 1054);
  image.rect(1125, 1059, 1129, 1062);
  assert.equal(findMeasures(image, 3, [], geometry)[2].repeatEnd, true);
});

test('an instrument bracket outside the staff is not a second repeat barline', () => {
  const image = canvas();
  const geometry = { horizontal: [], vertical: [] };
  addStaff(geometry, 614.76, 8.31, 5, [72, 400, 1142]);
  for (const line of geometry.horizontal) image.rect(line.left, line.y, line.right, line.y);
  for (const x of [66, 72, 400, 1142]) image.rect(x, 615, x, 648);
  image.rect(84, 625, 87, 629);
  image.rect(84, 634, 87, 638);
  assert.equal(findMeasures(image, 1, [], geometry)[0].repeatStart, undefined);
});

test('TAB marks beside a double bar cannot outvote an unmarked melody staff', () => {
  for (const melodyDots of [false, true]) {
    const image = canvas();
    const geometry = { horizontal: [], vertical: [] };
    for (const [top, count] of [[100, 5], [220, 6], [340, 6]]) {
      addStaff(geometry, top, 10, count, [72, 400, 700, 1142]);
      for (const x of [400, 405]) image.rect(x, top, x, top + (count - 1) * 10);
      if (count === 6 || melodyDots) {
        image.rect(412, top + 13, 416, top + 17);
        image.rect(412, top + 23, 416, top + 27);
      }
    }
    geometry.vertical.push({ x: 72, top: 100, bottom: 390 });
    for (const line of geometry.horizontal) image.rect(line.left, line.y, line.right, line.y);
    const measures = findMeasures(image, 3, [], geometry);
    assert.equal(measures.length, 3);
    assert.equal(measures[1].repeatStart, melodyDots ? true : undefined);
  }
});

test('recognizes repeat dots when the score contains only six-line TAB', () => {
  const image = canvas();
  const geometry = { horizontal: [], vertical: [] };
  addStaff(geometry, 100, 10, 6, [72, 400, 700, 1142]);
  for (const line of geometry.horizontal) image.rect(line.left, line.y, line.right, line.y);
  for (const x of [72, 77, 400, 700, 1137, 1142]) image.rect(x, 100, x, 150);
  for (const x of [84, 1125]) {
    image.rect(x, 113, x + 4, 117);
    image.rect(x, 123, x + 4, 127);
  }
  const measures = findMeasures(image, 1, [], geometry);
  assert.equal(measures[0].repeatStart, true);
  assert.equal(measures[2].repeatEnd, true);
  assert.deepEqual(compilePlaybackOrder(measures), { order: [0, 1, 2, 0, 1, 2], warnings: [], valid: true });
});

test('takes the second ending after a wide clef and key signature on the next page', () => {
  const image = canvas();
  const geometry = { horizontal: [], vertical: [] };
  const edges = [72, 345, 600, 850, 1142];
  addStaff(geometry, 100, 8.3, 5, edges);
  addStaff(geometry, 220, 9.24, 6, edges);
  addStaff(geometry, 330, 9.24, 6, edges);
  geometry.vertical.push({ x: 72, top: 100, bottom: 376.2 });
  image.rect(148, 57, 345, 57);
  image.rect(148, 57, 148, 82);
  const label = { text: '2', x: 156, y: 60, width: 7, height: 14, fontName: 'ending' };
  const measures = findMeasures(image, 3, [label], geometry);
  assert.equal(measures.length, 4);
  assert.ok(measures[0].voltaGroup);
  assert.equal(measures[0].voltaOpen, true);
  assert.ok(measures.slice(1).every(measure => !measure.voltaGroup));

  const firstImage = canvas();
  const firstGeometry = { horizontal: [], vertical: [] };
  addStaff(firstGeometry, 100, 10, 5, [72, 400, 700, 1142]);
  for (const line of firstGeometry.horizontal) firstImage.rect(line.left, line.y, line.right, line.y);
  for (const x of [72, 77, 400, 700, 1137, 1142]) firstImage.rect(x, 100, x, 140);
  for (const x of [84, 1125]) {
    firstImage.rect(x, 113, x + 4, 117);
    firstImage.rect(x, 123, x + 4, 127);
  }
  firstImage.rect(400, 65, 700, 65);
  firstImage.rect(400, 65, 400, 90);
  const score = [...findMeasures(firstImage, 2, [], firstGeometry), ...measures];
  applyVoltaPasses(score);
  assert.deepEqual(score.map(measure => measure.volta), [undefined, [1], [1], [2], undefined, undefined, undefined]);
  assert.deepEqual(compilePlaybackOrder(score), { order: [0, 1, 2, 0, 3, 4, 5, 6], warnings: [], valid: true });
});

test('an ending number without a bracket does not create an ending', () => {
  const geometry = { horizontal: [], vertical: [] };
  addStaff(geometry, 100, 10, 5, [72, 400, 700, 1142]);
  const label = { text: '2', x: 188, y: 68, width: 7, height: 14, fontName: 'ending' };
  assert.ok(findMeasures(canvas(), 1, [label], geometry).every(measure => !measure.voltaGroup));
});

test('a beam inside the first measure needs an aligned ending number to extend the hook search', () => {
  const image = canvas();
  const geometry = { horizontal: [], vertical: [] };
  addStaff(geometry, 100, 10, 5, [72, 400, 700, 1142]);
  image.rect(180, 65, 330, 65);
  image.rect(180, 65, 180, 90);
  const label = { text: '2', x: 188, y: 68, width: 7, height: 14, fontName: 'ending' };
  for (const textItems of [[], [{ ...label, text: 'Verse' }], [{ ...label, y: 105 }], [{ ...label, y: 40 }]]) {
    const measures = findMeasures(image, 1, textItems, geometry);
    assert.ok(measures.every(measure => !measure.voltaGroup), JSON.stringify(textItems));
  }
});

test('distinguishes an open volta bracket from one with a closing hook', () => {
  for (const closed of [false, true]) {
    const image = canvas();
    const geometry = { horizontal: [], vertical: [] };
    addStaff(geometry, 100, 10, 5, [72, 400, 700, 1142]);
    image.rect(400, 65, 1142, 65);
    image.rect(400, 65, 400, 90);
    if (closed) image.rect(1142, 65, 1142, 90);
    const measures = findMeasures(image, 1, [], geometry);
    assert.equal(measures[0].voltaGroup, undefined);
    assert.equal(measures[1].voltaGroup, measures[2].voltaGroup);
    assert.equal(measures[2].voltaOpen, !closed);
  }
});

test('installed PDF.js exposes line coordinates before rendering mutates its paths', async () => {
  const content = 'q 2 0 0 2 10 20 cm 5 5 m 5 25 l S Q';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  let document = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(document.length); document += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = document.length;
  document += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const task = pdfjs.getDocument({ data: new Uint8Array(Buffer.from(document)) });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const geometry = readScoreGeometry(await page.getOperatorList(), viewport.transform, pdfjs);
    assert.deepEqual(geometry.vertical, [{ x: 20, top: 230, bottom: 270 }]);
    const { createCanvas } = require('@napi-rs/canvas');
    const image = createCanvas(300, 300);
    await page.render({ canvasContext: image.getContext('2d'), viewport }).promise;
    assert.deepEqual(geometry.vertical, [{ x: 20, top: 230, bottom: 270 }]);
    assert.ok(pageSource.indexOf('readScoreGeometry(await page.getOperatorList()') < pageSource.indexOf('await page.render('));
  } finally { await task.destroy(); }
});
