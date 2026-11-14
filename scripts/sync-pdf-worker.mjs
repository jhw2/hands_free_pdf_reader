import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const source = new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url);
const destination = new URL("../public/pdf.worker.min.mjs", import.meta.url);
// shortcut: PDF.js only shrinks discarded temporary buffers, so detaching the source is unnecessary.
const transferCompatibility = `if(!ArrayBuffer.prototype.transferToFixedLength)Object.defineProperty(ArrayBuffer.prototype,"transferToFixedLength",{configurable:true,writable:true,value:function(length=this.byteLength){const target=new ArrayBuffer(length),source=new Uint8Array(this);return new Uint8Array(target).set(source.subarray(0,length)),target}});\n`;

await mkdir(dirname(destination.pathname), { recursive: true });
await writeFile(destination, transferCompatibility + await readFile(source, "utf8"));
await cp(new URL("../node_modules/pdfjs-dist/cmaps/", import.meta.url), new URL("../public/cmaps/", import.meta.url), { recursive: true });

const ocrAssets = new URL("../public/ocr/", import.meta.url);
await mkdir(ocrAssets, { recursive: true });
await cp(new URL("../node_modules/tesseract.js/dist/worker.min.js", import.meta.url), new URL("worker.min.js", ocrAssets));
const core = new URL("../node_modules/tesseract.js-core/", import.meta.url);
for (const file of await readdir(core)) {
  if (/-lstm\.wasm(?:\.js)?$/.test(file)) await cp(new URL(file, core), new URL(file, ocrAssets));
}
await cp(new URL("../node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", import.meta.url), new URL("eng.traineddata.gz", ocrAssets));
