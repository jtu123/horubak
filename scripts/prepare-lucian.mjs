// Extract the downloaded original styles without changing the element rules.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const groups = { workflow: ['032', '039', '042'], shell: ['040', '062', '070'] };
let css = '';
for (const [group, ids] of Object.entries(groups)) {
  for (const id of ids) {
    const html = readFileSync(resolve(root, `.cache/lucian-uxui/elements-${group}.txt/lucian-${id}.html`), 'utf8');
    const license = html.split('\n')[0].replace('<!-- ', '/* ').replace(' -->', ' */');
    css += `${license}\n${html.match(/<style>([\s\S]*?)<\/style>/)[1]}\n`;
  }
}
mkdirSync(resolve(root, 'frontend/src/styles'), { recursive: true });
writeFileSync(resolve(root, 'frontend/src/styles/lucian.css'), css);
writeFileSync(resolve(root, 'frontend/src/styles/tokens.css'), readFileSync(resolve(root, '.cache/lucian-uxui/tokens.css')));
console.log('Preserved original CSS and licenses for 032, 039, 042, 040, 062, 070.');
