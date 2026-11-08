'use strict';
// v2.5 Performance panel (lazy): RAM per Nyx process + servers, system RAM, VRAM, GPU load & temperature (7900 XTX).
const Perf = {
  iv: null,
  open() {
    Panels.openDrawer('perf', '<span class="ti">' + iconSvg('gauge', 20) + '</span> ' + t('v25.perf_title'), (body) => {
      const box = h('div', { class: 'perf' }, h('p', { class: 'muted small' }, '…')); body.append(box);
      const tick = async () => { if (!document.contains(box)) { clearInterval(this.iv); this.iv = null; return; } try { this.render(box, await API.inv('perf:snapshot')); } catch (e) { box.innerHTML = ''; box.append(h('p', { class: 'err' }, cleanErr(e))); } };
      clearInterval(this.iv); tick(); this.iv = setInterval(tick, 2500);
    });
  },
  bar(v, max, cls = '') { const p = max ? Math.min(100, v / max * 100) : 0; return h('div', { class: 'pbar ' + cls + (p > 90 ? ' hot' : p > 75 ? ' warm' : '') }, h('i', { style: `width:${p.toFixed(1)}%` })); },
  render(box, s) {
    box.innerHTML = ''; const g = s.gpu || {}; const a = g.adapter;
    const used = s.ram.total - s.ram.free;
    const temp = g.temp ?? g.hot;
    box.append(
      h('div', { class: 'perf-cards' },
        h('div', { class: 'pcard' }, h('span', { html: iconSvg('memory-stick', 18) }), h('b', {}, 'RAM'), h('div', { class: 'big' }, fmtGB(used) + ' / ' + fmtGB(s.ram.total)), this.bar(used, s.ram.total)),
        h('div', { class: 'pcard' }, h('span', { html: iconSvg('hard-drive', 18) }), h('b', {}, 'VRAM'), a ? h('div', { class: 'big' }, (a.used != null ? fmtGB(a.used) : '—') + ' / ' + (a.total ? fmtGB(a.total) : '—')) : h('div', { class: 'muted' }, t('v25.pf_nogpu')), a?.total ? this.bar(a.used || 0, a.total) : null, a ? h('small', { class: 'muted' }, a.name || '') : null),
        h('div', { class: 'pcard' }, h('span', { html: iconSvg('cpu', 18) }), h('b', {}, 'GPU'), h('div', { class: 'big' }, g.util != null ? Math.round(g.util) + ' %' : '—'), g.util != null ? this.bar(g.util, 100) : null),
        h('div', { class: 'pcard' }, h('span', { html: iconSvg('thermometer', 18) }), h('b', {}, t('v25.pf_temp')), h('div', { class: 'big' + (temp >= 95 ? ' bad' : temp >= 85 ? ' warn' : '') }, temp != null ? Math.round(temp) + ' °C' : '—'),
          g.hot != null && g.temp != null ? h('small', { class: 'muted' }, 'hotspot ' + Math.round(g.hot) + ' °C') : null, temp == null ? h('small', { class: 'muted' }, t('v25.pf_temp_na')) : h('small', { class: 'muted' }, g.tempSrc || ''))),
      h('h4', {}, t('v25.pf_procs')),
      h('table', { class: 'v25-tbl' }, h('tr', {}, h('th', {}, t('v25.pf_proc')), h('th', {}, 'PID'), h('th', { class: 'num' }, 'RAM'), h('th', { class: 'num' }, 'VRAM'), h('th', { class: 'num' }, 'CPU')),
        ...(s.servers || []).map(x => h('tr', { class: 'srv-row' }, h('td', {}, h('b', {}, ({ llama: 'llama-server', whisper: 'whisper-server', sd: 'sd-server' })[x.id] || x.id)), h('td', {}, x.pid), h('td', { class: 'num' }, x.mem ? fmtMB(x.mem) : '—'), h('td', { class: 'num' }, x.vram ? fmtMB(x.vram) : '—'), h('td', {}, ''))),
        ...(s.nyx || []).sort((p, q) => q.mem - p.mem).map(x => h('tr', {}, h('td', {}, 'Nyx · ' + (x.name || x.type)), h('td', {}, x.pid), h('td', { class: 'num' }, fmtMB(x.mem)), h('td', { class: 'num' }, '—'), h('td', { class: 'num' }, x.cpu + '%'))),
        h('tr', { class: 'tot' }, h('td', {}, h('b', {}, 'Nyx ' + t('v25.pf_total'))), h('td', {}), h('td', { class: 'num' }, h('b', {}, fmtMB(s.nyxTotal))), h('td', {}), h('td', {}))),
      g.procs?.length ? h('details', {}, h('summary', {}, t('v25.pf_vram_procs')), h('table', { class: 'v25-tbl' }, ...g.procs.map(p => h('tr', {}, h('td', {}, p.name || p.owner || '?'), h('td', {}, p.pid), h('td', { class: 'num' }, fmtMB(p.vram)))))) : null,
      g.error ? h('p', { class: 'muted small' }, '⚠️ ' + g.error) : null,
      h('p', { class: 'muted small' }, t('v25.pf_note', { v0: s.ms })));
  },
};
