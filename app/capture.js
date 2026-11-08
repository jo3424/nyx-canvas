'use strict';
const API = window.nyxAPI; const q = document.getElementById('q'); let mode = 'note';
const set = (m) => { mode = m; document.getElementById('m-note').classList.toggle('on', m === 'note'); document.getElementById('m-ai').classList.toggle('on', m === 'assistant'); q.placeholder = m === 'note' ? t('capture.001') : t('capture.002'); q.focus(); };
document.getElementById('m-note').onclick = () => set('note'); document.getElementById('m-ai').onclick = () => set('assistant');
q.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); if (e.key === 'Tab') { e.preventDefault(); set(mode === 'note' ? 'assistant' : 'note'); } if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const text = q.value.trim(); if (!text) return; API.inv('capture:submit', { text, mode }); q.value = ''; } });
window.addEventListener('focus', () => q.focus());
