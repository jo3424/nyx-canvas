'use strict';
// v2.5 Models table (lazy): every GGUF on disk with quant, «fits in 24 GB?», max context, duplicates (wasted GB), one-click load into llama-server.
const ModelsTable = {
  vram: 24, ctx: 8192, roots: [],
  open() {
    Panels.openDrawer('models', '<span class="ti">' + iconSvg('table-2', 20) + '</span> ' + t('v25.models_title'), (body) => {
      const head = h('div', { class: 'row gap wrap mt-head' },
        Hub.field('VRAM (GB)', h('input', { class: 'inp', type: 'number', value: this.vram, min: 4, max: 192, onchange: (e) => { this.vram = +e.target.value || 24; run(); } })),
        Hub.field('Context', h('input', { class: 'inp', type: 'number', value: this.ctx, step: 1024, onchange: (e) => { this.ctx = +e.target.value || 8192; run(); } })),
        h('button', { class: 'btn ghost sm', onclick: async () => { const d = await API.inv('sys:pickDir', t('v22.find_in')); if (d) { this.roots.unshift(d); run(); } } }, iconSvg('folder-search', 14), t('v22.find_in')),
        h('button', { class: 'btn ghost sm', onclick: () => run() }, iconSvg('rotate-ccw', 14), t('v25.refresh')));
      const out = h('div', { class: 'mt-out' }); body.append(head, out);
      const run = async () => {
        out.innerHTML = ''; out.append(h('p', { class: 'muted small' }, t('v22.searching')));
        let r; try { r = await API.inv('models:scan', { extraRoots: this.roots, ctx: this.ctx, vramGB: this.vram }); } catch (e) { out.innerHTML = ''; out.append(h('p', { class: 'err' }, cleanErr(e))); return; }
        out.innerHTML = ''; this.render(out, r);
      };
      run();
    });
  },
  render(out, r) {
    const cur = Store.state.settings.ai.servers.llama.model;
    const fit = { yes: ['ok', '✓ ' + t('v25.md_fit_yes')], ctx: ['warn', '≈ ' + t('v25.md_fit_ctx')], no: ['bad', '✗ ' + t('v25.md_fit_no')], '?': ['', '?'] };
    if (!r.rows.length) return out.append(h('p', { class: 'muted' }, t('v25.md_none')));
    out.append(h('p', { class: 'small' }, t('v25.md_sum', { v0: r.rows.length, v1: fmtGB(r.rows.reduce((a, x) => a + x.size, 0)), v2: r.vramGB, v3: r.ctx })),
      r.dupBytes ? h('p', { class: 'warn small' }, '♻️ ' + t('v25.md_dup', { v0: fmtGB(r.dupBytes) })) : null);
    const tbl = h('table', { class: 'v25-tbl models' }, h('tr', {}, h('th', {}, t('v25.md_model')), h('th', {}, 'Quant'), h('th', { class: 'num' }, t('v25.md_size')), h('th', {}, '24 GB'), h('th', { class: 'num' }, 'max ctx'), h('th', {})));
    for (const x of r.rows) {
      const [c, l] = fit[x.fit] || fit['?'];
      tbl.append(h('tr', { class: (x.dupOf ? 'dup ' : '') + (x.path === cur ? 'cur' : ''), title: x.path + (x.error ? '\n⚠️ ' + x.error : '') },
        h('td', {}, h('b', {}, x.name || x.file), h('div', { class: 'muted small' }, [x.arch, x.sizeLabel, x.experts ? 'MoE ' + x.experts : '', x.parts > 1 ? x.parts + ' parts' : '', x.vision ? 'mmproj' : ''].filter(Boolean).join(' · ')), x.dupOf ? h('div', { class: 'warn small' }, '♻️ ' + t('v25.md_dup_of') + ' ' + x.dupOf.split(/[\\/]/).slice(-2).join('/')) : null),
        h('td', {}, h('span', { class: 'chip' }, x.quant)), h('td', { class: 'num' }, fmtGB(x.size)),
        h('td', {}, h('span', { class: 'chip ' + c, title: x.need ? t('v25.md_need', { v0: fmtGB(x.need) }) : '' }, l)), h('td', { class: 'num' }, x.ctxFit ? Math.round(x.ctxFit / 1024) + 'k' : '—'),
        h('td', {}, x.vision ? null : h('button', { class: 'btn sm' + (x.path === cur ? ' primary' : ''), onclick: (e) => this.load(x, e.currentTarget) }, iconSvg('play', 13), x.path === cur ? t('v25.md_loaded') : t('v25.md_load')),
          h('button', { class: 'btn ghost sm ico', title: t('hub.037'), onclick: () => API.inv('sys:reveal', x.path) }, iconSvg('folder-open', 13)))));
    }
    out.append(tbl, h('p', { class: 'muted small' }, t('v25.md_note')));
  },
  async load(x, btn) {
    const S = Store.state.settings.ai.servers.llama; btn.disabled = true;
    try {
      S.model = x.path; if (x.fit === 'ctx' && x.ctxFit) S.ctx = Math.min(S.ctx || 8192, x.ctxFit); Store.save(); Router.loaded = null;
      await API.inv('proc:stopWait', 'llama', 15000).catch(() => {});
      const r = await Hub.startServer('llama'); if (r.ok) { delete AI.modelCache.llama; toast('▶️ ' + x.file); }
    } finally { btn.disabled = false; }
  },
};
