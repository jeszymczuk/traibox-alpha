import { cpSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pdfkitDataSource = fileURLToPath(new URL('../node_modules/pdfkit/js/data/', import.meta.url));
const pdfkitDataTarget = fileURLToPath(new URL('../dist/runtime/data/', import.meta.url));

cpSync(pdfkitDataSource, pdfkitDataTarget, { recursive: true, force: true });

const requiredAssets = ['Helvetica.afm', 'Helvetica-Bold.afm', 'sRGB_IEC61966_2_1.icc'];
const copiedAssets = new Set(readdirSync(pdfkitDataTarget));
const missingAssets = requiredAssets.filter((asset) => !copiedAssets.has(asset));
if (missingAssets.length) throw new Error(`Missing PDFKit runtime asset(s): ${missingAssets.join(', ')}`);

const imported = await import(new URL('../dist/runtime/pdfkit.cjs', import.meta.url));
const PDFDocument = imported.default?.default ?? imported.default;
if (typeof PDFDocument !== 'function') throw new Error('Bundled PDFKit runtime does not export PDFDocument');

const document = new PDFDocument({ size: 'A4', margin: 40 });
document.on('error', (error) => {
  throw error;
});
document.fontSize(12).text('TRAIBOX production PDF runtime check');
document.end();

if (!existsSync(pdfkitDataTarget)) throw new Error('PDFKit runtime data directory was not created');
console.log(`Prepared ${copiedAssets.size} PDFKit runtime assets and verified the production PDF bundle.`);
