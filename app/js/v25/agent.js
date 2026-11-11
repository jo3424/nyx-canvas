'use strict';
// v2.5 — agent-like assistant (all local): persistent memory (profile + journal, auto-extract + dedupe, keyword/embedding recall),
// evolving skills (save/run/edit, learn from corrections), plan → act → verify with live steps, step limits, cancel and per-action undo,
// provider fallback chain (local → Groq → others), confirmation before destructive actions. Private mode bypasses memory entirely.
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const AGENT_DEF = { memory: true, learn: true, learnModel: true, recallEmb: true, alwaysConfirm: true, maxSteps: 24, maxRounds: 10, webMaxDl: 6, maxPages: 6, freeLicense: true, zipMaxFiles: 40,
  searchUrl: 'https://www.bing.com/search?q=%s', imageSearchUrl: 'https://www.bing.com/images/search?q=%s&qft=+filterui:imagesize-large', videoSearchUrl: 'https://www.bing.com/videos/search?q=%s' };
const READONLY = new Set(['search_cards', 'read_cards', 'show_card', 'web_search', 'open_url', 'open_panel', 'recall', 'list_attachments', 'read_attachment', 'browse_open', 'browse_search', 'browse_read', 'browse_click', 'browse_fill', 'browse_scroll', 'find_media', 'web_fetch', 'show_plan', 'list_skills', 'run_skill', 'remember', 'forget_memory', 'save_skill', 'delete_skill']);

const Agent = {
  cur: null, undos: new Map(), lastSkill: null, ctx: '', seq: 0,
  S() { const S = (Store.state.settings.agent ||= {}); for (const k in AGENT_DEF) if (S[k] === undefined) S[k] = AGENT_DEF[k]; return S; },
  defaults() { const S = this.S(); for (const [k, v] of Object.entries(AGENT_DEF)) if (S[k] === undefined) S[k] = v; },
  // ---------- run lifecycle ----------
  check() { if (this.cur?.cancelled) { const e = new Error(t('v25.ag_cancelled')); e.cancelled = true; throw e; } },
  cancel() { const R = this.cur; if (!R || R.cancelled) return; R.cancelled = true; R.abort?.(); this.liveNote('⏹ ' + t('v25.ag_cancelled')); },
  begin() {
    const R = { id: 'r' + Date.now().toString(36) + (++this.seq), steps: [], snaps: [], say: [], n: 0, cancelled: false, start: this.snapAll(), t0: Date.now() };
    R.aborted = new Promise(res => { R.abort = () => res({ cancelled: true }); });
    this.cur = R; this.live(R); return R;
  },
  end(R) { if (this.cur === R) this.cur = null; R.liveEl?.remove(); this.sendBtn(false); if (R.snaps.length) { this.undos.set(R.id, R); if (this.undos.size > 12) this.undos.delete(this.undos.keys().next().value); } },
  // ---------- live steps panel (with Stop) ----------
  // a tool's own one-line summary (used when no model writes the answer: offline intents)
  say(line) { if (this.cur && line) this.cur.say.push(line); },
  live(R) {
    R.liveEl = h('div', { class: 'as-msg r-assistant ag-live' }, h('div', { class: 'bubble' }, h('div', { class: 'ag-head' }, h('span', { class: 'dots' }, h('i'), h('i'), h('i')), h('b', {}, t('v25.ag_working')), h('div', { class: 'grow' }), h('button', { class: 'btn sm ghost ag-stop', onclick: () => this.cancel() }, iconSvg('square', 13), t('v25.ag_stop'))), h('ol', { class: 'ag-steps' })));
    this.sendBtn(true);
  },
  showLive() { const R = this.cur; const box = $('#as-msgs'); if (!R || !box || !R.liveEl) return; if (!R.liveEl.isConnected) { box.querySelector('.thinking')?.remove(); box.append(R.liveEl); } box.scrollTop = 1e9; },
  sendBtn(on) { const b = $('#assistant .as-input .send'); if (!b) return; if (on) { b.dataset.stop = '1'; b.innerHTML = iconSvg('square', 16); b.title = t('v25.ag_stop'); } else { delete b.dataset.stop; b.innerHTML = iconSvg('send', 18); b.title = t('assistant.072'); } },
  stepStart(R, name, args) {
    const s = { name, args, state: 'run', sub: '', t0: Date.now() }; R.steps.push(s);
    s.el = h('li', { class: 'run' }, h('span', { class: 'st' }), h('span', { class: 'lb' }, Assistant.actLabel({ tool: name, args }) + this.argHint(name, args)), h('span', { class: 'sub' }));
    R.liveEl.querySelector('.ag-steps').append(s.el); this.showLive(); return s;
  },
  argHint(name, a) { a = typeof a === 'string' ? (() => { try { return JSON.parse(a); } catch (e) { return {}; } })() : a || {}; const v = a.query || a.url || a.name || a.title || a.text || ''; return v ? ' · ' + String(v).slice(0, 48) : ''; },
  stepEnd(s, r) { s.state = r?.ok === false ? 'bad' : 'ok'; s.el.className = s.state; if (r?.ok === false && r.error) s.el.querySelector('.sub').textContent = r.error; else if (r?.placed != null) s.el.querySelector('.sub').textContent = '✓ ' + r.placed; this.showLive(); },
  sub(text) { const R = this.cur; const s = R?.steps[R.steps.length - 1]; if (s?.el) { s.el.querySelector('.sub').textContent = text; this.showLive(); } },
  liveNote(text) { const R = this.cur; if (!R?.liveEl) return; R.liveEl.querySelector('.ag-steps').append(h('li', { class: 'note' }, text)); this.showLive(); },
  plan(steps) { const R = this.cur; if (!R) return; R.plan = steps.map(String).slice(0, 12); const el = h('div', { class: 'ag-plan' }, h('b', {}, t('v25.ag_plan')), h('ol', {}, ...R.plan.map(s => h('li', {}, s)))); R.liveEl.querySelector('.ag-steps').before(el); this.showLive(); },
  // ---------- undo (whole-state snapshots before every changing action; memory only) ----------
  snapAll() { const s = Store.state; return JSON.stringify({ boards: s.boards, subs: s.subs, active: s.active }); },
  restoreAll(snap) {
    const s = JSON.parse(snap); Store.change(() => { Store.state.boards = s.boards; Store.state.subs = s.subs; Store.state.active = s.active; });
    try { Canvas.refresh(); Panels.refreshDrawer(); Features.refreshSubsCards(); Panels.tabs(); Panels.stylebar(); Minimap?.drawSoon?.(); } catch (e) { console.warn(e); }
  },
  async undo(runId, fromStep = 0) {
    const R = this.undos.get(runId); if (!R) return toast(t('v25.ag_undo_gone'));
    const sn = R.snaps.find(x => x.i >= fromStep); if (!sn) return;
    const later = R.snaps.filter(x => x.i >= fromStep).length;
    if (!await Cmd.confirm(t('v25.ag_undo_q'), [t('v25.ag_undo_list', { n: later })], t('v25.ag_undo'))) return;
    this.restoreAll(sn.snap); R.snaps = R.snaps.filter(x => x.i < fromStep); if (!R.snaps.length) this.undos.delete(runId);
    toast('↶ ' + t('v25.ag_undone', { n: later })); Assistant.render();
  },
  // ---------- verify: what actually changed on the boards ----------
  verify(R, res) {
    if (!R.snaps.length) return '';
    const before = JSON.parse(R.start).boards, after = Store.state.boards; const lines = [];
    for (const b of after) { const o = before.find(x => x.id === b.id); const n0 = o ? o.items.length : 0, n1 = b.items.length; if (!o) lines.push(t('v25.ag_v_newboard', { name: b.name, n: n1 })); else if (n0 !== n1) lines.push(t('v25.ag_v_items', { name: b.name, d: (n1 > n0 ? '+' : '') + (n1 - n0) })); }
    for (const o of before) if (!after.find(b => b.id === o.id)) lines.push(t('v25.ag_v_gone', { name: o.name }));
    const claimed = (res.actions || []).reduce((s, a) => s + (a.placed || 0), 0);
    const added = after.reduce((s, b) => s + b.items.length, 0) - before.reduce((s, b) => s + b.items.length, 0);
    if (claimed && added < claimed) lines.push('⚠️ ' + t('v25.ag_v_mismatch', { claimed, added }));
    return lines.length ? '✔ ' + t('v25.ag_verify') + ': ' + lines.join(' · ') : '✔ ' + t('v25.ag_v_changed');
  },
  // ---------- canvas placement (grid near the view centre, source attribution) ----------
  async placeGrid(list, { title } = {}) {
    if (!list.length) return [];
    const cols = Math.min(3, list.length), cw = 420, ch = 320; const W = cols * cw, H = Math.ceil(list.length / cols) * ch;
    const c = Cmd.freeSpot(W, H); const x0 = c.x - W / 2 + cw / 2, y0 = c.y - H / 2 + ch / 2; const out = [];
    for (const [i, m] of list.entries()) {
      try { const it = await Features.addMedia({ file: m.file, name: m.name || m.file, mime: m.mime }, x0 + (i % cols) * cw, y0 + Math.floor(i / cols) * ch);
        if (it && (m.source || m.caption)) Store.change(() => { if (m.caption) it.caption = m.caption; if (m.source) it.source = m.source; it.tags = [...new Set([...(it.tags || []), ...(m.source ? ['web'] : [])])]; });
        if (it) { Items.mount(it); out.push(it); } } catch (e) { console.warn('place', e); }
    }
    if (title && out.length > 1 && Cmd.T.group_cards) { try { await Cmd.T.group_cards.run({ ids: out.map(i => i.id), title }); } catch (e) {} }
    Canvas.select(out.map(i => i.id)); try { Canvas.fit(out); } catch (e) {}
    return out;
  },
  // ---------- provider order: local → Groq → others ----------
  isLocal(p) { return /^(https?:\/\/)?(localhost|127\.|\[?::1|0\.0\.0\.0)/i.test(p?.base || ''); },
  chain() { const E = AI.enabled(); const rank = (p) => this.isLocal(p) ? 0 : (p.id === 'groq' || /groq\.com/.test(p.base)) ? 1 : 2; return E.slice().sort((a, b) => rank(a) - rank(b)); },
  async modelFor(p) { if (p.id === 'llama' || /:8080|llama/i.test(p.base)) { try { const ms = await AI.models(p.id, true); return ms[0]?.id || 'default'; } catch (e) { return null; } } const ms = await AI.models(p.id).catch(() => null); if (!ms?.length) return null; return (p.defModel && ms.find(x => x.id === p.defModel)?.id) || ms.find(x => !NOT_CHAT.test(x.id))?.id || null; },
  // ---------- memory ----------
  async embed(texts) { if (!this.S().recallEmb) return null; const { p, m } = AI.task('embed'); if (!p || !m) return null; if (!this.isLocal(p)) return null; if (Date.now() - (this._embDown || 0) < 300e3) return null; // optional: unreachable embed server → quiet lexical fallback, retry after 5 min
    try { const r = await API.inv('ai:embed', p, m, texts); return r?.length ? r : null; } catch (e) { this._embDown = Date.now(); return null; } },
  async prepare(text) {
    const S = this.S(); const parts = [];
    if (S.memory) {
      try {
        const emb = (await this.embed([text]))?.[0] || null;
        const hits = await API.inv('mem:search', text, { emb, limit: 6 });
        const prof = (await API.inv('mem:list')).facts.filter(f => ['profile', 'preference', 'correction'].includes(f.kind)).sort((a, b) => b.upd - a.upd).slice(0, 6);
        const all = [...prof, ...hits.filter(h => !prof.find(p => p.id === h.id))].slice(0, 9);
        if (all.length) parts.push(t('v25.ag_mem_head') + '\n' + all.map(f => `- [${f.kind}] ${f.text}`).join('\n'));
        const sk = await API.inv('mem:skillMatch', text, 2);
        if (sk.length) parts.push(t('v25.ag_skill_head') + '\n' + sk.map(s => `• «${s.name}»: ` + s.steps.map((x, i) => `${i + 1}) ${x}`).join(' ') + (s.notes?.length ? ' — ' + t('v25.ag_notes') + ': ' + s.notes.join('; ') : '')).join('\n'));
        if (sk.length) this.lastSkill = { id: sk[0].id, name: sk[0].name, at: Date.now() };
      } catch (e) { console.warn('memory', e); }
    }
    const ab = Att.brief(); if (ab) parts.push(ab);
    parts.push(t('v25.ag_method', { max: S.maxSteps }));
    return '\n\n' + parts.join('\n\n');
  },
  // heuristics (offline, EL/EN). Returns [{text, kind}]
  extract(text) {
    const s = String(text || '').trim(); const n = norm(s); const out = []; let m;
    if ((m = s.match(/^(?:θυμήσου|θυμησου|να θυμάσαι|να θυμασαι|remember)(?:\s+(?:ότι|οτι|that))?\s+(.{3,})$/i))) out.push({ text: m[1], kind: /(προτιμ|μου αρεσ|παντα|ποτε|prefer|i like|always|never)/.test(norm(m[1])) ? 'preference' : 'fact' });
    else if (/^(λεγομαι|με λενε|το ονομα μου ειναι|my name is|i'm called)\b/.test(n)) out.push({ text: s, kind: 'profile' });
    else if (/^(ειμαι|i am|i'm)\s+(ενας |μια |a |an )?(φωτογραφ|photographer|σχεδιαστ|designer|developer|προγραμματιστ|καλλιτεχν|artist|μαθητ|φοιτητ|student|δασκαλ|teacher)/.test(n)) out.push({ text: s, kind: 'profile' });
    else if (/(^|\s)(προτιμω|προτιμαω|μου αρεσ(ει|ουν)|δεν μου αρεσ(ει|ουν)|θελω παντα|παντα να|ποτε να μη|ποτε μη|i prefer|i like|i don'?t like|i hate|always use|never use)(\s|$)/.test(n) && s.length < 300) out.push({ text: s, kind: 'preference' });
    return out.map(f => ({ ...f, text: f.text.replace(/[.!]+$/, '').trim() })).filter(f => f.text.length >= 4);
  },
  isCorrection(text) { const n = norm(text); return /^(οχι|οχι ετσι|λαθος|no|nope|not like that|wrong)\b[\s,.!-]+(.{6,})/.test(n) && /(καν|καντ|κανε|βαλ|θελω|προτιμ|αντι|καλυτερα|ετσι|σαν|do|make|put|use|instead|like|rather|should)/.test(n); },
  async learn(text, res) {
    const S = this.S(); if (!S.memory || !S.learn || Private?.on) return [];
    const learned = [];
    const add = async (f) => { try { const emb = (await this.embed([f.text]))?.[0] || null; const r = await API.inv('mem:add', { ...f, emb, src: 'chat' }); learned.push({ ...r.fact, merged: r.merged }); } catch (e) {} };
    if (this.isCorrection(text)) {
      const sk = this.lastSkill && Date.now() - this.lastSkill.at < 15 * 60e3 ? this.lastSkill : null;
      const note = text.replace(/^\s*(όχι|οχι|no|nope)[\s,.!-]+/i, '').trim();
      if (sk) { await API.inv('mem:skillNote', sk.id, note); learned.push({ text: note, kind: 'skill', skill: sk.name }); }
      else await add({ text: t('v25.ag_corr_prefix') + ' ' + note, kind: 'correction' });
    }
    for (const f of this.extract(text)) await add(f);
    // optional model extraction — only with a LOCAL model (nothing leaves the PC for this)
    if (S.learnModel && !learned.length && text.length > 25) {
      const { p } = AI.task('commands');
      if (p && this.isLocal(p)) (async () => {
        try { const raw = await AI.text('commands', t('v25.ag_extract_prompt', { text: text.slice(0, 1500) })); const j = parseJsonLoose(raw); for (const f of (j?.facts || []).slice(0, 3)) if (f?.text && String(f.text).length > 5) await add({ text: String(f.text), kind: f.kind || 'fact' }); if (learned.length) this.renderLearn(learned); } catch (e) {}
      })();
    }
    try { await API.inv('mem:journal', { text: text.slice(0, 300), acts: (res.actions || []).map(a => a.tool + (a.ok === false ? ' ✗' : '')) }); } catch (e) {}
    return learned;
  },
  renderLearn(learned) { if (learned.length) toast('🧠 ' + t('v25.ag_learned', { list: learned.map(l => l.skill ? `«${l.skill}» ← ${l.text}` : l.text).join(' · ').slice(0, 160) }), { ms: 5000, action: { label: t('v25.mem_title'), fn: () => Agent.panel() } }); },
  // ---------- Memory & Skills panel ----------
  async panel(tab = 'profile') {
    const data = await API.inv('mem:list'); const S = this.S();
    Panels.openDrawer('memory', iconSvg('brain', 18) + ' ' + t('v25.mem_title'), (body) => {
      const tabs = h('div', { class: 'seg mem-tabs' }, ...[['profile', t('v25.mem_profile')], ['journal', t('v25.mem_journal')], ['skills', t('v25.mem_skills')], ['opts', t('v25.mem_opts')]].map(([k, l]) => h('button', { class: 'chip' + (k === tab ? ' on' : ''), 'data-tab': k, onclick: () => this.panel(k) }, l)));
      body.append(h('p', { class: 'muted small' }, t('v25.mem_local')), tabs);
      const box = h('div', { class: 'mem-box', 'data-tab': tab }); body.append(box);
      if (tab === 'profile') {
        const q = h('input', { class: 'inp', placeholder: t('v25.mem_addph'), onkeydown: async (e) => { if (e.key === 'Enter' && q.value.trim()) { e.preventDefault(); await API.inv('mem:add', { text: q.value.trim(), kind: kindSel.value, src: 'manual', emb: (await this.embed([q.value.trim()]))?.[0] || null }); this.panel('profile'); } } });
        const kindSel = h('select', { class: 'inp' }, ...['fact', 'profile', 'preference', 'person', 'project', 'correction'].map(k => h('option', { value: k }, t('v25.mem_k_' + k))));
        box.append(h('div', { class: 'row' }, q, kindSel));
        if (!data.facts.length) box.append(h('p', { class: 'muted' }, t('v25.mem_empty')));
        for (const f of data.facts.slice().sort((a, b) => b.upd - a.upd)) {
          const txt = h('div', { class: 'mf-text', contenteditable: 'true', spellcheck: 'false', onkeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); txt.blur(); } }, onblur: async () => { const v = txt.textContent.trim(); if (v && v !== f.text) { await API.inv('mem:update', f.id, { text: v }); toast('🧠 ✓'); } } }, f.text);
          box.append(h('div', { class: 'mem-fact', 'data-id': f.id }, h('span', { class: 'chip k-' + f.kind }, t('v25.mem_k_' + f.kind)), txt, h('span', { class: 'muted small' }, Agent.dmy(f.upd) + (f.n > 1 ? ' ×' + f.n : '')),
            h('button', { class: 'ib', title: t('v25.mem_forget'), html: iconSvg('trash', 14), onclick: async () => { if (!await Cmd.confirm(t('v25.mem_forget') + '?', [f.text], t('v25.mem_forget'))) return; await API.inv('mem:forget', [f.id]); this.panel('profile'); } })));
        }
      } else if (tab === 'journal') {
        if (!data.days.length) box.append(h('p', { class: 'muted' }, t('v25.mem_nojournal')));
        for (const d of data.days.slice(0, 30)) { const det = h('details', { class: 'mem-day' }, h('summary', {}, d.split('-').reverse().join('/'))); det.addEventListener('toggle', async () => { if (!det.open || det.dataset.l) return; det.dataset.l = 1; for (const e of await API.inv('mem:day', d)) det.append(h('div', { class: 'mem-j' }, h('span', { class: 'muted small' }, new Date(e.at).toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' })), ' ', e.text, e.acts?.length ? h('span', { class: 'muted small' }, ' → ' + e.acts.join(', ')) : '')); }); box.append(det); }
      } else if (tab === 'skills') {
        box.append(h('button', { class: 'btn sm', onclick: () => this.editSkill() }, iconSvg('plus', 14), t('v25.sk_new')));
        if (!data.skills.length) box.append(h('p', { class: 'muted' }, t('v25.sk_empty')));
        for (const s of data.skills) box.append(h('div', { class: 'mem-skill', 'data-id': s.id }, h('div', { class: 'row' }, h('b', {}, s.name), h('span', { class: 'muted small' }, 'v' + (s.v || 1) + ' · ' + t('v25.sk_uses', { n: s.uses || 0 })), h('div', { class: 'grow' }),
          h('button', { class: 'ib', title: t('v25.sk_run'), html: iconSvg('play', 14), onclick: () => { Assistant.show(); Assistant.send(t('v25.sk_run_cmd', { name: s.name })); } }),
          h('button', { class: 'ib', title: t('v25.sk_edit'), html: iconSvg('pencil', 14), onclick: () => this.editSkill(s) }),
          h('button', { class: 'ib', title: t('v25.sk_del'), html: iconSvg('trash', 14), onclick: async () => { if (!await Cmd.confirm(t('v25.sk_del') + '?', [s.name], t('v25.sk_del'))) return; await API.inv('mem:skillDel', s.id); this.panel('skills'); } })),
          s.trigger ? h('div', { class: 'muted small' }, '⚡ ' + s.trigger) : '', h('ol', {}, ...s.steps.map(x => h('li', {}, x))), ...(s.notes?.length ? [h('div', { class: 'small sk-notes' }, '📝 ' + s.notes.join(' · '))] : [])));
      } else {
        const tg = (k, label) => h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: !!S[k], onchange: (e) => { S[k] = e.target.checked; Store.save(); } }), label);
        box.append(tg('memory', t('v25.mem_o_memory')), tg('learn', t('v25.mem_o_learn')), tg('learnModel', t('v25.mem_o_model')), tg('recallEmb', t('v25.mem_o_emb')), tg('alwaysConfirm', t('v25.mem_o_confirm')), tg('freeLicense', t('v25.mem_o_license')),
          h('label', { class: 'row' }, t('v25.mem_o_steps'), h('input', { class: 'inp', type: 'number', min: 4, max: 60, value: S.maxSteps, style: 'width:80px', onchange: (e) => { S.maxSteps = clamp(+e.target.value || 24, 4, 60); Store.save(); } })),
          h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: async () => { const txt = await API.inv('mem:export'); const n = 'nyx-memory-' + new Date().toISOString().slice(0, 10) + '.json'; const r = await API.inv('file:saveText', n, txt).catch(() => null); if (r !== null) toast('💾 ' + t('v25.mem_exported')); else { const a = h('a', { href: URL.createObjectURL(new Blob([txt], { type: 'application/json' })), download: n }); a.click(); } } }, iconSvg('download', 14), t('v25.mem_export')),
            h('button', { class: 'btn sm danger', onclick: async () => { if (!await Cmd.confirm(t('v25.mem_wipe') + '?', [t('v25.mem_wipe_d')], t('v25.mem_wipe'))) return; await API.inv('mem:forgetAll'); this.panel('profile'); } }, iconSvg('trash', 14), t('v25.mem_wipe'))));
      }
    });
  },
  editSkill(s = { name: '', trigger: '', steps: [] }) {
    const name = h('input', { class: 'inp', value: s.name, placeholder: t('v25.sk_name') }), trig = h('input', { class: 'inp', value: s.trigger || '', placeholder: t('v25.sk_trigger') });
    const steps = h('textarea', { class: 'inp', rows: 7, placeholder: t('v25.sk_steps_ph') }, (s.steps || []).join('\n'));
    const notes = h('textarea', { class: 'inp', rows: 2, placeholder: t('v25.sk_notes') }, (s.notes || []).join('\n'));
    Panels.modal(s.id ? t('v25.sk_edit') : t('v25.sk_new'), h('div', { class: 'col sk-form' }, name, trig, h('label', { class: 'small muted' }, t('v25.sk_steps')), steps, notes), { okLabel: t('save'), ok: async () => { if (!name.value.trim()) return false; await API.inv('mem:skillSave', { id: s.id, name: name.value.trim(), trigger: trig.value.trim(), steps: steps.value.split('\n'), notes: notes.value.split('\n') }); this.panel('skills'); } });
  },
  dmy(ts) { const d = new Date(ts); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0'); },
  // recent user commands (for «save that as a skill»)
  recentCmds() { const C = (Store.state.chat || []).filter(m => m.role === 'user'); const out = []; for (let i = C.length - 2; i >= 0 && out.length < 8; i--) { if (/δεξιοτητ|skill/i.test(norm(C[i].content))) break; if (i < C.length - 2 && C[i + 1].at - C[i].at > 20 * 60e3) break; out.unshift(C[i].content); } return out; },
};

// ---------- new tools ----------
Object.assign(Cmd.T, {
  show_plan: { d: t('v25.tl_plan'), p: { steps: { type: 'array', items: { type: 'string' } } }, req: ['steps'], async run(a) { Agent.plan(a.steps || []); return { ok: true }; } },
  remember: { d: t('v25.tl_remember'), p: { fact: { type: 'string' }, kind: { type: 'string', enum: ['profile', 'preference', 'fact', 'person', 'project', 'correction'] } }, req: ['fact'],
    async run(a) { if (Private?.on) return { ok: false, error: t('v25.pv_nomem') }; const emb = (await Agent.embed([a.fact]))?.[0] || null; const r = await API.inv('mem:add', { text: a.fact, kind: a.kind || 'fact', emb, src: 'assistant' }); return { ok: true, merged: r.merged, id: r.fact.id }; } },
  recall: { d: t('v25.tl_recall'), p: { query: { type: 'string' } }, req: ['query'], async run(a) { const emb = (await Agent.embed([a.query]))?.[0] || null; return { ok: true, facts: await API.inv('mem:search', a.query, { emb, limit: 10 }) }; } },
  forget_memory: { d: t('v25.tl_forget'), p: { query: { type: 'string' } }, req: ['query'],
    async run(a) { const hits = await API.inv('mem:search', a.query, { limit: 10 }); if (!hits.length) return { ok: false, error: t('v25.mem_nohit') }; if (!await Agent.confirmAlways(t('v25.mem_forget') + '?', hits.map(h => h.text), t('v25.mem_forget'))) return { ok: false, cancelled: true }; const n = await API.inv('mem:forget', hits.map(h => h.id)); return { ok: true, forgotten: n }; } },
  list_skills: { d: t('v25.tl_list_skills'), p: {}, async run() { const d = await API.inv('mem:list'); return { ok: true, skills: d.skills.map(s => ({ name: s.name, trigger: s.trigger, steps: s.steps.length })) }; } },
  save_skill: { d: t('v25.tl_save_skill'), p: { name: { type: 'string' }, trigger: { type: 'string' }, steps: { type: 'array', items: { type: 'string' } } }, req: ['name', 'steps'],
    async run(a) { const d = await API.inv('mem:list'); const ex = d.skills.find(s => norm(s.name) === norm(a.name)); if (ex && !await Agent.confirmAlways(t('v25.sk_over_q'), [ex.name + ': ' + ex.steps.join(' → ')], t('v25.sk_over'))) return { ok: false, cancelled: true };
      const s = await API.inv('mem:skillSave', { id: ex?.id, name: a.name, trigger: a.trigger || '', steps: a.steps || [] }); Agent.lastSkill = { id: s.id, name: s.name, at: Date.now() }; return { ok: true, name: s.name, version: s.v }; } },
  run_skill: { d: t('v25.tl_run_skill'), p: { name: { type: 'string' }, execute: { type: 'boolean' } }, req: ['name'],
    async run(a) {
      const d = await API.inv('mem:list'); const s = d.skills.find(x => norm(x.name) === norm(a.name)) || d.skills.find(x => norm(x.name).includes(norm(a.name)));
      if (!s) return { ok: false, error: t('v25.sk_none', { name: a.name }) };
      await API.inv('mem:skillUse', s.id); Agent.lastSkill = { id: s.id, name: s.name, at: Date.now() };
      if (!a.execute) return { ok: true, name: s.name, steps: s.steps, notes: s.notes || [], hint: t('v25.sk_follow') };
      Agent.plan(s.steps); const done = [];
      for (const st of s.steps) { Agent.check(); const acts = LocalIntent.parse(st); if (!acts) { done.push({ step: st, ok: false, error: t('v25.sk_noparse') }); continue; } for (const x of acts) { const r = await Cmd.exec(x.tool, x.args); done.push({ step: st, tool: x.tool, ok: r?.ok !== false }); } }
      return { ok: done.some(x => x.ok), name: s.name, done };
    } },
  delete_skill: { d: t('v25.tl_del_skill'), p: { name: { type: 'string' } }, req: ['name'],
    async run(a) { const d = await API.inv('mem:list'); const s = d.skills.find(x => norm(x.name) === norm(a.name)); if (!s) return { ok: false, error: t('v25.sk_none', { name: a.name }) }; if (!await Agent.confirmAlways(t('v25.sk_del') + '?', [s.name], t('v25.sk_del'))) return { ok: false, cancelled: true }; await API.inv('mem:skillDel', s.id); return { ok: true }; } },
});
// confirmation that ignores the «don't ask» setting when the agent's «always confirm destructive» is on
Agent.confirmAlways = async function (title, list, ok) { const A = Store.state.settings.ai.assistant; const was = A.confirm; if (Agent.S().alwaysConfirm) A.confirm = true; try { return await Cmd.confirm(title, list, ok); } finally { A.confirm = was; } };

// ---------- hooks ----------
(function hookAgent() {
  const A = Assistant, C = Cmd;
  // overwrite/delete always confirmed when «always confirm» is on
  const _del = C.T.delete_cards.run; C.T.delete_cards.run = async function (a) { const S = Agent.S(); if (!S.alwaysConfirm) return _del.call(this, a); const AA = Store.state.settings.ai.assistant; const was = AA.confirm; AA.confirm = true; try { return await _del.call(this, a); } finally { AA.confirm = was; } };
  const _upd = C.T.update_card.run; C.T.update_card.run = async function (a) {
    if (a.text != null && Agent.S().alwaysConfirm && Agent.cur) { const it = C.find({ ids: a.id ? [a.id] : [], query: a.query })?.[0] || null; const old = it ? (Features.searchText?.(it) || '').trim() : ''; if (old && old.length > 2 && !await Agent.confirmAlways(t('v25.ag_overwrite_q'), [old.slice(0, 160) + ' → ' + String(a.text).slice(0, 160)], t('v25.ag_overwrite'))) return { ok: false, cancelled: true }; }
    return _upd.call(this, a);
  };
  // every tool call: cancel check, step limit, live step, snapshot for undo
  const _exec = C.exec.bind(C);
  C.exec = async function (name, args) {
    const R = Agent.cur; if (!R) return _exec(name, args);
    if (R.cancelled) return { ok: false, cancelled: true, error: t('v25.ag_cancelled') };
    if (++R.n > Agent.S().maxSteps) { Agent.liveNote('⛔ ' + t('v25.ag_limit', { n: Agent.S().maxSteps })); return { ok: false, error: t('v25.ag_limit', { n: Agent.S().maxSteps }) }; }
    const s = Agent.stepStart(R, name, args); const idx = R.steps.length - 1;
    if (!READONLY.has(name)) R.snaps.push({ i: idx, snap: Agent.snapAll() });
    let r; try { r = await _exec(name, args); } catch (e) { r = { ok: false, error: cleanErr(e), cancelled: e.cancelled }; }
    if (r && typeof r === 'object' && r.error && /cancel|ακυρ/i.test(r.error) && R.cancelled) r.cancelled = true;
    Agent.stepEnd(s, r); if (r?.placed) R.placed = (R.placed || 0) + r.placed;
    return r;
  };
  // offline intents: web media → canvas, memory, skills
  const _parse = LocalIntent.parse.bind(LocalIntent);
  LocalIntent.parse = function (text) { return Agent.intent(text) || _parse(text); };
  // system prompt: memory + skills + attachments + method
  const _sys = A.system.bind(A); A.system = function (json, opts) { return _sys(json, opts) + (Agent.ctx || ''); };
  A.history = ((h0) => function (opts) { return h0(opts); })(A.history.bind(A));
  // user bubble chips + undo buttons on replies
  const _msg = A.msgEl.bind(A);
  A.msgEl = function (m) {
    const el = _msg(m);
    if (m.atts?.length) el.append(h('div', { class: 'as-atts' }, ...m.atts.map(a => Att.chip({ ...a, state: a.ok ? 'ok' : 'bad', error: a.ok ? '' : a.note, note: a.ok ? a.note : '' }))));
    if (m.plan?.length) el.querySelector('.bubble')?.prepend(h('div', { class: 'ag-plan' }, h('b', {}, t('v25.ag_plan')), h('ol', {}, ...m.plan.map(s => h('li', {}, s)))));
    if (m.run && Agent.undos.has(m.run)) {
      const R = Agent.undos.get(m.run);
      el.querySelectorAll('.as-acts .chip').forEach((c, i) => { if (R.snaps.some(x => x.i === i)) { c.classList.add('undoable'); c.append(h('button', { class: 'x', title: t('v25.ag_undo_from'), html: iconSvg('undo-2', 11), onclick: (e) => { e.stopPropagation(); Agent.undo(m.run, i); } })); } });
      (el.querySelector('.as-tools') || el).append(h('button', { class: 'btn sm ghost ag-undo', title: t('v25.ag_undo_all'), onclick: () => Agent.undo(m.run, 0) }, iconSvg('undo-2', 14), t('v25.ag_undo_all')));
    }
    return el;
  };
  // send: attachments (wait, chips), default text, stop button while busy
  const _send = A.send.bind(A);
  A.send = async function (text, voice) {
    if (this.busy) { if (Agent.cur) Agent.cancel(); return; }
    const q = $('#as-q'); let v = (text ?? q?.value ?? '').trim();
    if (!v && !Att.list.length) return;
    let L = null;
    if (Att.list.length) { if (Att.list.some(e => !e.fastOk && (e.state === 'work' || e.state === 'wait'))) toast(t('v25.at_waiting'), { ms: 2500 }); L = await Att.take(); if (!v) v = t('v25.at_default'); }
    Agent._pendingAtts = L; if (q) q.value = '';
    return _send(v, voice);
  };
  const _push = A.push.bind(A);
  A.push = function (m) { if (m.role === 'user' && Agent._pendingAtts) { m = { ...m, atts: Att.meta(Agent._pendingAtts) }; } return _push(m); };
  // run: memory/skills/attachments context, live steps, cancel, fallback chain, verify, learn
  const _run = A.run.bind(A);
  A.run = async function (text, onNotice, onDelta) {
    const L = Agent._pendingAtts; Agent._pendingAtts = null;
    const prompt = L ? text + Att.context(L) : text;
    if (Private?.on) { const R = Agent.begin(); try { return await Promise.race([_run(prompt, onNotice, onDelta), R.aborted.then(() => ({ content: '⏹ ' + t('v25.ag_cancelled'), actions: [] }))]); } finally { Agent.end(R); } }
    const S = Agent.S(); const AS = Store.state.settings.ai.assistant; const mr = AS.maxRounds; AS.maxRounds = Math.max(mr || 6, S.maxRounds || 10);
    Agent.ctx = await Agent.prepare(text);
    const R = Agent.begin(); let res;
    const attempt = () => Promise.race([_run(prompt, onNotice, onDelta), R.aborted.then(() => ({ content: '', actions: [], cancelled: true }))]);
    try {
      res = await Agent.withFallback(attempt, R);
      if (R.cancelled || res.cancelled) res = { ...res, content: '⏹ ' + t('v25.ag_cancelled') + (res.content ? '\n\n' + res.content : '') };
      if (res.model === 'local' && R.say.length && !R.cancelled) res = { ...res, content: R.say.join('\n') + (res.content ? '\n\n' + res.content : '') };
      const notes = [];
      const bad = Att.unreadable(L); if (bad) notes.push(bad);
      if (res.fallback) notes.push('↪ ' + t('v25.ag_fallback', { name: res.fallback }));
      const v = Agent.verify(R, { actions: R.steps.map(s => ({ placed: 0 })) }); if (v) notes.push(v);
      if (R.placed) { const added = Store.state.boards.reduce((a, b) => a + b.items.length, 0) - JSON.parse(R.start).boards.reduce((a, b) => a + b.items.length, 0); if (added < R.placed) notes.push('⚠️ ' + t('v25.ag_v_mismatch', { claimed: R.placed, added })); }
      res.content = [bad ? bad : '', res.content || '', ...notes.filter(n => n !== bad)].filter(Boolean).join('\n\n');
      if (R.plan) res.plan = R.plan; if (R.snaps.length) res.run = R.id;
      return res;
    } finally {
      AS.maxRounds = mr; Agent.end(R); Agent.ctx = '';
      if (res && !R.cancelled) Agent.learn(text, res).then(l => Agent.renderLearn(l)).catch(() => {});
    }
  };
  Agent.withFallback = async function (attempt, R) {
    const chain = Agent.chain();
    if (chain.length < 2) return attempt();
    const orig = AI.pickModel; let firstErr = null; const tried = new Set();
    // 1st: normal pick (Router/Private aware) but no offline acting yet
    const noOff = () => { const P = LocalIntent.parse; LocalIntent.parse = () => null; return () => { LocalIntent.parse = P; }; };
    let undo = noOff();
    try { const r = await attempt(); if (r.model !== 'local') return r; firstErr = new Error(r.content); }
    catch (e) { if (R.cancelled) throw e; firstErr = e; }
    finally { undo(); }
    tried.add(AI.last.commands || AI.task('commands').p?.id);
    for (const p of chain) {
      if (R.cancelled) break; if (tried.has(p.id)) continue; tried.add(p.id);
      const m = await Agent.modelFor(p).catch(() => null); if (!m) continue;
      Agent.liveNote('↪ ' + t('v25.ag_fallback', { name: p.name }));
      AI.pickModel = async function (task) { return task === 'commands' ? { p, m } : orig.call(AI, task); };
      undo = noOff();
      try { const r = await attempt(); if (r.model !== 'local') { r.fallback = p.name; return r; } }
      catch (e) { if (R.cancelled) throw e; }
      finally { AI.pickModel = orig; undo(); }
    }
    // everything failed → offline Greek/English intents
    AI.pickModel = async function () { throw firstErr || new Error(t('v23.no_enabled')); };
    try { return await attempt(); } finally { AI.pickModel = orig; }
  };
  // UI: brain button in the assistant header, Esc cancels a run
  const _init = A.init.bind(A);
  A.init = function () { const r = _init(); Agent.uiInit(); return r; };
})();

Agent.uiInit = function () {
  const head = $('#assistant .as-head'); if (!head || head.querySelector('.ag-mem')) return;
  const set = [...head.querySelectorAll('button')][0];
  set?.before(h('button', { class: 'ib ag-mem', title: t('v25.mem_title') + ' (Ctrl+Shift+Y)', html: iconSvg('brain', 16), onclick: () => Agent.panel() }));
  $('#as-q')?.addEventListener('keydown', (e) => { if (e.key === 'Escape' && Agent.cur) { e.stopImmediatePropagation(); Agent.cancel(); } }, true);
  Att.init();
};
if ($('#assistant .as-head') && Store.state) Agent.uiInit();
addEventListener('keydown', (e) => { if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'y') { e.preventDefault(); Agent.panel(); } if (e.key === 'Escape' && Agent.cur && !document.querySelector('.modal')) Agent.cancel(); });

// ---------- offline intents (EL/EN): web media → canvas, memory, skills, attachments ----------
const NUMW = { ενα: 1, ενας: 1, μια: 1, μια_: 1, δυο: 2, δυο_: 2, τρια: 3, τρεις: 3, τεσσερα: 4, τεσσερις: 4, πεντε: 5, εξι: 6, one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, couple: 2 };
Agent.intent = function (text) {
  const s = String(text || '').trim(); const n = norm(s); let m;
  // «άνοιξε το web, ψάξε nature wallpapers, κατέβασε 2 εικόνες ή ένα βίντεο και στείλ' τα στον καμβά»
  const media = /(εικον|φωτογραφ|φωτο\b|wallpaper|ταπετσαρ|backgrounds?|images?|photos?|pictures?|pics|βιντεο|videos?|clips?)/;
  const dl = /(κατεβασ|κατεβαζ|download|φερε|φερ\b|βρες|ψαξε|ψαξ|αναζητ|search|find|grab|get)/;
  if (dl.test(n) && media.test(n) && /(canvas|καμβα|πινακα|board|κατεβασ|download|στειλ|send|βαλ|put|add|place)/.test(n)) {
    let q = '';
    const qm = /(?:ψαξε|ψαξ|αναζητησε|αναζητηση|search(?:\s+for)?|look\s+up|βρες|find)\s+(?:για\s+|for\s+|στο\s+(?:web|ιντερνετ|διαδικτυο)\s+(?:για\s+)?)?(.+?)(?=\s*(?:,|;|\.|\s+και\s+|\s+and\s+|\s+then\s+|\s+μετα\s+|\s+κατεβασ|\s+download|\s+φερε|\s+στειλ|\s+send|$))/.exec(n);
    if (qm) q = s.substr(qm.index + qm[0].length - qm[1].length, qm[1].length);
    if (!q) { const q2 = /(?:\d+|ενα|μια|δυο|τρια|τρεις|two|three|a|an)?\s*(?:εικονες|φωτογραφιες|images|photos|pictures|wallpapers)\s+(?:με|απο|of|with)\s+(.+?)(?=\s*(?:,|\.|\s+και\s+|\s+and\s+|\s+στ|\s+to\s+|$))/.exec(n); if (q2) q = s.substr(q2.index + q2[0].length - q2[1].length, q2[1].length); }
    q = q.replace(/^(?:το\s+|the\s+|some\s+|μερικ\S+\s+)/i, '').replace(/\s+(?:εικονες|εικόνες|φωτογραφίες|images|photos)$/i, '').trim();
    if (q && !/^(web|ιντερνετ|ίντερνετ|internet|browser)$/i.test(q)) {
      const cm = /(\d+|ενα|ενας|μια|δυο|τρια|τρεις|τεσσερα|τεσσερις|πεντε|εξι|one|two|three|four|five|six|a|an|couple)\s+(?:(?:ακομα|more)\s+)?(?:εικον|φωτογραφ|wallpaper|ταπετσαρ|images?|photos?|pictures?|pics|βιντεο|videos?|clips?)/.exec(n);
      const count = cm ? (+cm[1] || NUMW[cm[1]] || 2) : 2;
      const img = /(εικον|φωτογραφ|wallpaper|ταπετσαρ|images?|photos?|pictures?|pics)/.test(n); const vid = /(βιντεο|videos?|clips?)/.test(n);
      const bm = /(?:σε\s+(?:νεο\s+)?πινακα|(?:new\s+)?board)\s+[«"']?([^»"',.]+)[»"']?/.exec(n);
      return [{ tool: 'web_media_to_canvas', args: { query: q, kind: img || !vid ? 'image' : 'video', count: Math.min(count, 12), ...(bm ? { board: s.substr(bm.index + bm[0].length - bm[1].length, bm[1].length).trim() } : {}) } }];
    }
  }
  // attachments
  if (Att.last.length && /(βαλ|τοποθετησ|put|place|add|στειλ|send)/.test(n) && /(φωτο|εικον|photo|image|βιντεο|video|αρχει|files?|συνημμεν|attach|αυτ|these|them)/.test(n) && /(πινακ|καμβα|board|canvas)/.test(n)) {
    const bm = /(?:σε\s+(?:νεο\s+)?πινακα|(?:new\s+)?board)\s+[«"']?([^»"',.]+)[»"']?/.exec(n);
    return [{ tool: 'place_attachments', args: { which: /(βιντεο|video)/.test(n) ? 'videos' : /(φωτο|εικον|photo|image)/.test(n) ? 'images' : 'media', ...(bm ? { board: s.substr(bm.index + bm[0].length - bm[1].length, bm[1].length).trim() } : {}) } }];
  }
  // memory
  if ((m = s.match(/^(?:θυμήσου|θυμησου|να θυμάσαι|να θυμασαι|remember)(?:\s+(?:ότι|οτι|that))?\s+(.{3,})$/i))) return [{ tool: 'remember', args: { fact: m[1].replace(/[.!]+$/, ''), kind: /(προτιμ|μου αρεσ|δεν μου αρεσ|παντα|ποτε|prefer|i like|always|never)/.test(norm(m[1])) ? 'preference' : 'fact' } }];
  if ((m = s.match(/^(?:ξέχασε|ξεχασε|forget)(?:\s+(?:ότι|οτι|that|το|τα))?\s+(.{3,})$/i))) return [{ tool: 'forget_memory', args: { query: m[1] } }];
  if (/^(τι\s+θυμασαι|τι\s+ξερεις\s+για\s+μενα|what\s+do\s+you\s+remember|what\s+do\s+you\s+know\s+about\s+me)/.test(n)) return [{ tool: 'open_panel_memory', args: {} }];
  // skills
  if ((m = s.match(/^(?:αποθήκευσε|αποθηκευσε|κράτα|κρατα|μάθε|μαθε|save|learn)\s+(?:(?:αυτό|αυτο|αυτά|αυτα|τα παραπάνω|τα παραπανω|this|that|these steps)\s+)?(?:ως|σαν|as)\s+(?:δεξιότητα|δεξιοτητα|skill)\s+[«"']?([^»"']+?)[»"']?\s*$/i))) return [{ tool: 'save_skill', args: { name: m[1].trim(), steps: Agent.recentCmds() } }];
  if ((m = s.match(/^(?:τρέξε|τρεξε|εκτέλεσε|εκτελεσε|κάνε|κανε|run|do)\s+(?:τη\s+|την\s+|the\s+)?(?:δεξιότητα|δεξιοτητα|skill)\s+[«"']?([^»"']+?)[»"']?\s*$/i))) return [{ tool: 'run_skill', args: { name: m[1].trim(), execute: true } }];
  return null;
};
Cmd.T.open_panel_memory = { d: t('v25.tl_mem_panel'), p: {}, async run() { Agent.panel(); return { ok: true }; } };
