// Builds compact offline asset bundles for the renderer.
const fs = require('fs'), path = require('path');
const NM = path.join(__dirname, '..', 'node_modules');
const OUT = path.join(__dirname, '..', 'app', 'assets');
const wjs = (k, v) => fs.writeFileSync(path.join(OUT, 'data', k + '.js'), 'window.NYX_DATA=window.NYX_DATA||{};NYX_DATA[' + JSON.stringify(k) + ']=' + JSON.stringify(v) + ';');
const rd = p => JSON.parse(fs.readFileSync(path.join(NM, p), 'utf8'));

// Emoji: [char, label, group, tags, hexcode]
const em = rd('emojibase-data/en/compact.json').filter(e => e.group !== undefined && e.group !== 2);
const emoji = em.map(e => [e.unicode, e.label, e.group, (e.tags || []).join(' '), e.hexcode.toLowerCase()]);
wjs('emoji', emoji);

// Icons -> {name: innerSVG}
function nodesToSvg(nodes) {
  return nodes.map(([tag, attrs]) => '<' + tag + ' ' + Object.entries(attrs).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${v}"`).join(' ') + '/>').join('');
}
const luc = rd('lucide-static/icon-nodes.json'); const lucTags = rd('lucide-static/tags.json');
const lucide = {}; for (const [n, nodes] of Object.entries(luc)) lucide[n] = [nodesToSvg(nodes), (lucTags[n] || []).join(' ')];
wjs('lucide', lucide);
const tab = rd('@tabler/icons/tabler-nodes-outline.json');
const tabler = {}; for (const [n, nodes] of Object.entries(tab)) tabler[n] = [nodesToSvg(nodes), ''];
wjs('tabler', tabler);
const tabf = rd('@tabler/icons/tabler-nodes-filled.json');
const tablerF = {}; for (const [n, nodes] of Object.entries(tabf)) tablerF[n] = [nodesToSvg(nodes), ''];
wjs('tablerFilled', tablerF);

// Twemoji SVGs (sticker art)
const tw = path.join(NM, '@twemoji/svg'); let c = 0;
for (const f of fs.readdirSync(tw)) if (f.endsWith('.svg')) { fs.copyFileSync(path.join(tw, f), path.join(OUT, 'twemoji', f)); c++; }
// perfect-freehand ESM
{ let src = fs.readFileSync(path.join(NM, 'perfect-freehand/dist/esm/index.mjs'), 'utf8');
  src = src.replace(/\/\/# sourceMappingURL.*$/m, '').replace(/export\{([^}]*)\};?\s*$/, (m, g) => 'window.PF={' + g.split(',').map(x => { const [a, b] = x.trim().split(/\s+as\s+/); return (b || a) + ':' + a; }).join(',') + '};');
  fs.writeFileSync(path.join(__dirname, '..', 'app', 'vendor', 'perfect-freehand.js'), '(function(){' + src + '})();'); }
console.log('emoji', emoji.length, 'lucide', Object.keys(lucide).length, 'tabler', Object.keys(tabler).length, 'filled', Object.keys(tablerF).length, 'twemoji', c);
