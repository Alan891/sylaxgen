// Builds public/demo.json from a local clone: node scripts/make-demo.js <dir> <owner/repo>
import { writeFileSync } from 'node:fs';
import { scanDirectory } from '../src/core/scan.js';

const [dir, name] = process.argv.slice(2);
if (!dir || !name) {
  console.error('Usage: node scripts/make-demo.js <clone dir> <owner/repo>');
  process.exit(1);
}
const data = scanDirectory(dir);
data.name = name;
data.source = { type: 'github', url: `https://github.com/${name}`, ref: 'main' };
writeFileSync(new URL('../public/demo.json', import.meta.url), JSON.stringify(data));
console.log(`demo.json: ${data.files.length} files`);
