'use strict';
// Desktop sticky: a frameless always-on-top window that mirrors a sticky/text card. Edits go back to the main window.
const API = window.nyxAPI; const id = API.query().id; const t = document.getElementById('t'); let last = '';
function find(st) { for (const b of st.boards || []) for (const it of b.items || []) if (it.id === id) return it; }
function apply(text) { let st; try { st = JSON.parse(text); } catch (e) { return; } const it = find(st); if (!it) return window.close(); document.getElementById('s').style.setProperty('--p', it.paper || (it.type === 'text' ? '#f4f4f8' : '#ffe66d')); if (it.font) t.style.fontFamily = `'${it.font}'`; if (it.size) t.style.fontSize = Math.min(it.size, 28) + 'px'; if (document.activeElement !== t && it.html !== last) { t.innerHTML = it.html || ''; last = it.html || ''; } }
API.load().then(r => apply(r.text)); API.onState(apply);
let tm; t.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { last = t.innerHTML; API.inv('sticky:update', id, last); }, 350); });
t.addEventListener('blur', () => { if (t.innerHTML !== last) { last = t.innerHTML; API.inv('sticky:update', id, last); } });
document.getElementById('b-x').onclick = () => window.close();
document.getElementById('b-open').onclick = () => API.showMain(id);
