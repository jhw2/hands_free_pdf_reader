import { copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const source = new URL("../node_modules/pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url);
const destination = new URL("../public/pdf.worker.min.mjs", import.meta.url);

await mkdir(dirname(destination.pathname), { recursive: true });
await copyFile(source, destination);
