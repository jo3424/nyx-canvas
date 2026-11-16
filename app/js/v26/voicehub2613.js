// v2.6.13 «φωνή ster» — Hub → Ομιλία → vs-engine: «Φωνή απάντησης» (GPU Voice Studio personas + «Γενική γυναικεία»),
// the engine in use («OmniVoice του Hermes (7802)» / «δικός μου vs-engine»), and a clear message when personas.json or
// the chosen persona is missing. The list comes from main (names / ids / ready only — never the voice code or a token).
const VoiceHub = {
  rows(T) {
    const sel = h('select', { class: 'v2613-voice', 'aria-label': t('v2613.voice') });
    const err = h('div', { class: 'v2613-err', role: 'alert', hidden: true });
    const src = h('p', { class: 'muted small v2613-src' });
    const eng = h('p', { class: 'small v2613-engine' });
    const fill = async () => {
      sel.disabled = true; let r;
      try { r = await API.inv('tts:voiceList2613', {}); } catch (e) { r = { ok: false, error: { code: 'personas_read' }, personas: [] }; }
      sel.disabled = false; sel.innerHTML = '';
      const want = T.vsVoice || r.def || 'ster'; const ps = r.personas || [];
      const found = want === 'generic' ? { id: 'generic' } : ps.find((p) => p.id === want) || ps.find((p) => p.name === want) || ps.find((p) => p.name.toLowerCase() === String(want).toLowerCase());
      const og = h('optgroup', { label: t('v2613.group_vs') });
      for (const p of ps) og.append(h('option', { value: p.id || p.name, disabled: p.ready ? null : true }, p.name + (p.ready ? (p.steps ? ' · ' + t('v2613.steps', { v0: p.steps }) : '') : ' — ' + t('v2613.not_ready_' + (p.reason || 'type')))));
      if (!found && want !== 'generic') og.prepend(h('option', { value: want, class: 'missing' }, want + ' — ' + t('v2613.missing_tag')));
      if (og.children.length) sel.append(og);
      sel.append(h('option', { value: 'generic' }, t('v2613.generic')));
      sel.value = found ? (found.id === 'generic' ? 'generic' : (found.id || found.name)) : want;
      // the error state: file missing / unreadable / changed, or the chosen persona missing / not ready
      let msg = '';
      if (want !== 'generic') {
        if (r.error) msg = r.error.code === 'personas_missing' ? t('v2613.err_file') : t('v2613.err_schema');
        else if (!found) msg = t('v2613.err_missing', { v0: want });
        else if (!found.ready) msg = t('v2613.err_not_ready', { v0: found.name });
      }
      err.hidden = !msg; err.innerHTML = ''; if (msg) err.append(h('b', {}, '⚠️ ' + t('v2613.err_title')), h('p', { class: 'small' }, msg), h('p', { class: 'small muted' }, t('v2613.no_fallback')));
      src.textContent = t('v2613.source', { v0: r.file || '—' });
      VoiceHub.engineText(eng, r.engine, r.hermes);
    };
    sel.onchange = () => { T.vsVoice = sel.value; Store.save(); fill(); };
    const onEng = (e) => { if (eng.isConnected) VoiceHub.engineText(eng, e.detail, null); else removeEventListener('nyx:voice-engine', onEng); };
    addEventListener('nyx:voice-engine', onEng);
    fill();
    return [h('div', { class: 'v2613-box' },
      h('label', { class: 'sfield v2613-field' }, h('span', {}, t('v2613.voice')), h('div', { class: 'row gap' }, sel, h('button', { class: 'btn sm ghost v2613-refresh', title: t('hub.083'), onclick: fill }, iconSvg('refresh-cw', 14)))),
      err, src, eng, h('p', { class: 'muted small' }, t('v2613.hint')))];
  },
  engineText(el, e, hermes) {
    const now = e ? (e.kind === 'hermes' ? t('v2613.engine_hermes') : t('v2613.engine_own', { v0: e.port })) : t('v2613.engine_none');
    const pr = hermes ? t('v2613.probe_' + (hermes.state || 'down'), { v0: hermes.status || '' }) : '';
    el.innerHTML = ''; el.append(h('b', {}, t('v2613.engine') + ': '), document.createTextNode(now + (e && e.dead ? ' · ' + t('v2613.engine_dead') : '')));
    if (pr) el.append(h('br'), h('span', { class: 'muted' }, t('v2613.probe') + ': ' + pr));
  },
};
