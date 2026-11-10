import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const source = new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url);
const destination = new URL("../public/pdf.worker.min.mjs", import.meta.url);
// shortcut: PDF.js only shrinks discarded temporary buffers, so detaching the source is unnecessary.
const transferCompatibility = `if(!ArrayBuffer.prototype.transferToFixedLength)Object.defineProperty(ArrayBuffer.prototype,"transferToFixedLength",{configurable:true,writable:true,value:function(length=this.byteLength){const target=new ArrayBuffer(length),source=new Uint8Array(this);return new Uint8Array(target).set(source.subarray(0,length)),target}});\n`;

await mkdir(dirname(destination.pathname), { recursive: true });
await writeFile(destination, transferCompatibility + await readFile(source, "utf8"));
