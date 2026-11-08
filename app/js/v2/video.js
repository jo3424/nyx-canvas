'use strict';
// Shorts / video player card: scrub with highlight marks, speed, loop, A→B highlights, frame grab, thumbnail, whisper transcript, ffmpeg clip export.
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const Media2 = {
  marks: new Map(), // id -> pending in-point
  drawMarks(it) { const el = Items.el(it); const v = el?.querySelector('video'); const m = el?.querySelector('.vmarks'); const d = (v && isFinite(v.duration) && v.duration) || it.duration; if (!m || !d) return;
    m.innerHTML = (it.highlights || []).map(x => `<i style="left:${x.t0 / d * 100}%;width:${Math.max(0.8, (x.t1 - x.t0) / d * 100)}%"></i>`).join('') + (this.marks.has(it.id) ? `<b style="left:${this.marks.get(it.id) / d * 100}%"></b>` : ''); },
  vid(it) { return Items.el(it)?.querySelector('video'); },
  render(n, it) {
    const sp = it.speed || 1;
    n.innerHTML = t('video.001', { v0: iconSvg('film', 14), v1: esc(it.name || 'video'), v2: it.transcript ? t('video.002') : '', v3: (it.highlights || []).length ? `<span class="pbadge">★${it.highlights.length}</span>` : '', v4: esc(Store.media(it.file)), v5: it.poster ? `poster="${esc(Store.media(it.poster))}"` : '', v6: it.loop ? 'loop' : '', v7: iconSvg('play', 15), v8: it.duration ? fmtTime(it.duration) : '', sp, v10: it.loop ? 'on' : '', v11: iconSvg('repeat', 14), v12: this.marks.has(it.id) ? 'rec' : '', v13: iconSvg('star', 14), v14: iconSvg('camera', 14), v15: iconSvg('ellipsis', 14), v16: (it.highlights || []).map((x, i) => t('video.003', { i, v1: fmtTime(x.t0), v2: fmtTime(x.t1), v3: esc(x.label), v4: fmtTime(x.t0) })).join('') });
    const v = n.querySelector('video'), r = n.querySelector('.vr'), tEl = n.querySelector('.vt');
    v.playbackRate = sp;
    const dur = () => v.duration || it.duration || 0;
    const drawMarks = () => { const d = dur(); const m = n.querySelector('.vmarks'); if (!d || !m) return; m.innerHTML = (it.highlights || []).map(x => `<i style="left:${x.t0 / d * 100}%;width:${Math.max(0.8, (x.t1 - x.t0) / d * 100)}%"></i>`).join('') + (this.marks.has(it.id) ? `<b style="left:${this.marks.get(it.id) / d * 100}%"></b>` : ''); }; if (it.duration) drawMarks();
    v.addEventListener('loadedmetadata', () => { n.querySelector('.vdur').textContent = fmtTime(v.duration); if (!it.duration || !it.vw) { it.duration = v.duration; it.vw = v.videoWidth; it.vh = v.videoHeight; Store.save(); } drawMarks(); v.playbackRate = it.speed || 1; });
    v.addEventListener('timeupdate', () => { tEl.textContent = fmtTime(v.currentTime); if (!r._drag) r.value = dur() ? v.currentTime / dur() * 1000 : 0; const rg = v._range; if (rg && v.currentTime >= rg.t1) { if (it.loop) v.currentTime = rg.t0; else { v.pause(); v._range = null; } } });
    v.addEventListener('play', () => { n.querySelector('[data-v=play]').innerHTML = iconSvg('pause', 15); n.classList.add('playing'); });
    v.addEventListener('pause', () => { n.querySelector('[data-v=play]').innerHTML = iconSvg('play', 15); n.classList.remove('playing'); });
    v.addEventListener('click', () => v.paused ? v.play() : v.pause());
    v.addEventListener('dblclick', () => v.requestFullscreen?.());
    r.addEventListener('pointerdown', () => { r._drag = true; }); r.addEventListener('pointerup', () => { r._drag = false; });
    r.addEventListener('input', () => { v.currentTime = r.value / 1000 * dur(); v._range = null; });
    n.querySelector('.vctl').addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (!b) return; e.stopPropagation(); this.act(b.dataset.v, it, v, b, e); });
    n.querySelectorAll('.hl').forEach(b => { const x = it.highlights[+b.dataset.i]; b.onclick = (e) => { e.stopPropagation(); v._range = x; v.currentTime = x.t0; v.play(); }; b.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); this.hlMenu(e, it, +b.dataset.i); }; });
    n.addEventListener('wheel', (e) => { if (e.target.closest('.vscrub')) { e.stopPropagation(); e.preventDefault(); v.currentTime = clamp(v.currentTime + (e.deltaY > 0 ? 2 : -2), 0, dur()); } }, { passive: false });
  },
  async act(a, it, v, b, e) {
    const I = (x) => iconSvg(x, 15);
    if (a === 'play') return v.paused ? v.play() : v.pause();
    if (a === 'speed') { const i = SPEEDS.indexOf(it.speed || 1); it.speed = SPEEDS[(i + 1) % SPEEDS.length]; v.playbackRate = it.speed; b.textContent = it.speed + '×'; Store.save(); return; }
    if (a === 'loop') { it.loop = !it.loop; v.loop = it.loop; b.classList.toggle('on', it.loop); Store.save(); return; }
    if (a === 'mark') return this.mark(it, v);
    if (a === 'frame') return this.frame(it, v.currentTime);
    if (a === 'more') Panels.menu(e.clientX, e.clientY, [
      [I('image'), t('video.004'), () => this.thumb(it, v.currentTime)],
      [I('file-text'), it.transcript ? t('video.005') : t('video.006'), () => this.transcribe(it)],
      ...(it.transcript ? [[I('notebook-text'), t('video.007'), () => this.transcriptCard(it)], [I('sparkles'), t('video.008'), () => this.suggest(it)]] : []),
      [I('scissors'), t('video.009'), () => this.clipModal(it, v)], '-',
      [I('download'), t('extras.015'), () => API.inv('file:saveAs', it.file, it.name)], [I('folder-open'), t('extras.016'), () => API.inv('file:reveal', it.file)], [I('external-link'), t('video.010'), () => API.openMedia(it.file)]]);
  },
  mark(it, v) {
    const t = v.currentTime;
    if (!this.marks.has(it.id)) { this.marks.set(it.id, t); toast(tr('video.011', { v0: fmtTime(t) }), { ms: 2500 }); this.drawMarks(it); }
    else { let t0 = this.marks.get(it.id), t1 = t; this.marks.delete(it.id); if (t1 < t0) [t0, t1] = [t1, t0]; if (t1 - t0 < 0.3) t1 = Math.min(v.duration || t0 + 3, t0 + 3); Store.change(() => { (it.highlights ||= []).push({ t0, t1, label: 'Highlight ' + (it.highlights.length + 1) }); }); this.drawMarks(it); toast(`★ ${fmtTime(t0)}–${fmtTime(t1)}`); }
    const keep = v.currentTime, playing = !v.paused; Items.mount(it); const nv = this.vid(it); if (nv) { nv.currentTime = keep; if (playing) nv.play(); }
  },
  hlMenu(e, it, i) {
    const x = it.highlights[i]; const I = (n) => iconSvg(n, 15);
    Panels.menu(e.clientX, e.clientY, [
      [I('pencil'), t('video.012'), async () => { const f = form([['label', t('extras.058'), 'text', x.label]]); Panels.modal('★ Highlight', f.el, { ok: () => { Store.change(() => { x.label = f.val().label || x.label; }); Items.mount(it); } }); }],
      [I('scissors'), t('video.013'), () => this.exportClip(it, x)],
      [I('film'), t('video.014'), () => this.clipToCard(it, x)],
      [I('camera'), t('video.015'), () => this.frame(it, x.t0)], '-',
      [I('trash-2'), t('video.016'), () => { Store.change(() => it.highlights.splice(i, 1)); Items.mount(it); }, 'danger']]);
  },
  async frame(it, t) {
    try { const f = await API.inv('video:frame', it.file, t); const ar = it.vw && it.vh ? it.vh / it.vw : 9 / 16; const w = Math.min(320, it.w); const p = { x: it.x + it.w + 24, y: it.y + (this._fo = ((this._fo || 0) + 30) % 240) };
      Features.addAt({ type: 'image', file: f, name: `${it.name || 'video'} @${fmtTime(t)}.jpg`, caption: `${it.name || ''} · ${fmtTime(t)}`, source: it.id, w, h: w * ar }, p.x, p.y); toast('📸 ' + fmtTime(t));
    } catch (e) { toast(tr('video.017') + e.message + tr('video.018'), { kind: 'err', ms: 7000 }); }
  },
  async thumb(it, t) { try { const f = await API.inv('video:frame', it.file, t); Store.change(() => { it.poster = f; it.thumbFile = f; }); Items.mount(it); toast(tr('video.019')); } catch (e) { toast('⚠️ ' + e.message, { kind: 'err' }); } },
  async transcribe(it, silent) {
    const n = Items.el(it); n?.classList.add('busy'); if (!silent) toast(t('video.020'), { ms: 4000 });
    try { const r = it.type === 'video' || !it.voice ? await Speech.transcribeMedia(it.file) : await Speech.transcribeMedia(it.file); Store.change(() => { it.transcript = { text: r.text, segments: r.segments, at: Date.now(), lang: r.language }; }); Items.mount(it); delete Search.index[it.id];
      if (!silent) toast('📝 ✓ ' + (r.text || '').slice(0, 60)); Automations.fire('transcript', it); return r;
    } catch (e) { toast('⚠️ Whisper: ' + e.message + t('video.021'), { kind: 'err', ms: 8000 }); } finally { n?.classList.remove('busy'); }
  },
  transcriptCard(it) {
    const segs = it.transcript?.segments?.length ? it.transcript.segments : [{ start: 0, text: it.transcript?.text || '' }];
    const html = `<b>📝 ${esc(it.name || it.title || t('video.022'))}</b><br>` + segs.map(s => `[${fmtTime(s.start)}] ${esc(s.text)}`).join('<br>');
    const p = { x: it.x + it.w + 24, y: it.y }; return Features.addAt({ type: 'text', w: 420, h: 60, html, size: 14, bg: 'var(--card)', ref: it.id, tags: [t('video.023')] }, p.x, p.y);
  },
  seek(id, t) { const f = Store.find(id); if (!f) return; if (f.board.id !== Store.state.active) App.switchBoard(f.board.id); Canvas.focusItem(id); setTimeout(() => { const n = Items.el(f.item); const m = n?.querySelector('video,audio'); if (m) { m.currentTime = +t; m.play(); } }, 120); },
  async suggest(it) {
    try { toast(t('video.024')); const segs = it.transcript.segments.map(s => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`).join('\n').slice(0, 12000);
      const raw = await AI.text('summarize', t('video.025', { segs }));
      const arr = parseJsonLoose(raw); if (!Array.isArray(arr) || !arr.length) throw new Error(t('video.026'));
      Store.change(() => { it.highlights ||= []; for (const x of arr) if (isFinite(x.t0) && isFinite(x.t1)) it.highlights.push({ t0: +x.t0, t1: +x.t1, label: '✨ ' + String(x.label || 'AI').slice(0, 40) }); }); Items.mount(it); toast(`★ +${arr.length}`);
    } catch (e) { toast('⚠️ ' + e.message, { kind: 'err' }); }
  },
  // v2.3: visual trimmer — drag in/out handles on a thumbnail strip, I/O keys, frame step, live duration. Numbers are secondary.
  clipModal(it, v) {
    const src = Store.media(it.file); const D = () => (pv && isFinite(pv.duration) && pv.duration) || it.duration || (v && isFinite(v.duration) && v.duration) || 0;
    const now = v?.currentTime || 0; let t0 = Math.max(0, now - 5), t1 = now + 5; const FPS = 30; const I = (n) => iconSvg(n, 16);
    const pv = h('video', { class: 'tr-video', src, preload: 'auto', playsinline: '' });
    const strip = h('canvas', { class: 'tr-strip' }); const sel = h('div', { class: 'tr-sel' }); const hin = h('div', { class: 'tr-h in', title: t('v23.tr_in') + ' (I)' }, h('i')); const hout = h('div', { class: 'tr-h out', title: t('v23.tr_out') + ' (O)' }, h('i'));
    const head = h('div', { class: 'tr-head' }); const shadeL = h('div', { class: 'tr-shade l' }), shadeR = h('div', { class: 'tr-shade r' });
    const track = h('div', { class: 'tr-track', tabindex: '0' }, strip, shadeL, shadeR, sel, hin, hout, head);
    const lIn = h('b', { class: 'tr-in' }), lOut = h('b', { class: 'tr-out' }), lDur = h('b', { class: 'tr-dur' }), lNow = h('span', { class: 'tr-now' });
    const nIn = h('input', { class: 'inp sm', type: 'number', step: '0.01', min: '0' }), nOut = h('input', { class: 'inp sm', type: 'number', step: '0.01', min: '0' });
    const label = h('input', { class: 'inp', value: (it.name || 'clip').replace(/\.\w+$/, '') + '-clip' });
    const playB = h('button', { class: 'ib', title: t('v23.tr_play') + ' (Space)', html: I('play') });
    const fmt = (x) => { const m = Math.floor(x / 60), s = x - m * 60; return `${m}:${s.toFixed(2).padStart(5, '0')}`; };
    const sync = () => { const d = D(); if (!d) return; t0 = clamp(t0, 0, d); t1 = clamp(t1, 0, d); if (t1 - t0 < 0.1) t1 = Math.min(d, t0 + 0.1);
      const a = t0 / d * 100, b = t1 / d * 100; sel.style.left = hin.style.left = a + '%'; sel.style.width = (b - a) + '%'; hout.style.left = b + '%'; shadeL.style.width = a + '%'; shadeR.style.left = b + '%';
      head.style.left = (pv.currentTime / d * 100) + '%'; lIn.textContent = fmt(t0); lOut.textContent = fmt(t1); lDur.textContent = fmt(t1 - t0); lNow.textContent = fmt(pv.currentTime) + ' / ' + fmt(d);
      if (document.activeElement !== nIn) nIn.value = t0.toFixed(2); if (document.activeElement !== nOut) nOut.value = t1.toFixed(2); };
    const seek = (x) => { pv.currentTime = clamp(x, 0, D()); sync(); };
    const xToT = (cx) => { const r = track.getBoundingClientRect(); return clamp((cx - r.left) / r.width, 0, 1) * D(); };
    const drag = (which) => (e) => { e.preventDefault(); e.stopPropagation(); track.focus(); const g0 = xToT(e.clientX), a0 = t0, b0 = t1, x0 = e.clientX; let moved = false; pv.pause();
      const mv = (ev) => { if (Math.abs(ev.clientX - x0) > 3) moved = true; if (which === 'sel' && !moved) return; const tt = xToT(ev.clientX); if (which === 'in') { t0 = Math.min(tt, t1 - 0.1); seek(t0); } else if (which === 'out') { t1 = Math.max(tt, t0 + 0.1); seek(t1); } else if (which === 'sel') { const d = D(); const dt = clamp(tt - g0, -a0, d - b0); t0 = a0 + dt; t1 = b0 + dt; seek(t0); } else seek(tt); };
      const up = () => { if (which === 'sel' && !moved) seek(g0); removeEventListener('pointermove', mv); removeEventListener('pointerup', up); track.classList.remove('dragging'); }; track.classList.add('dragging'); addEventListener('pointermove', mv); addEventListener('pointerup', up); if (which === 'head') mv(e); };
    hin.onpointerdown = drag('in'); hout.onpointerdown = drag('out'); sel.onpointerdown = drag('sel'); track.onpointerdown = drag('head');
    const setIn = () => { t0 = Math.min(pv.currentTime, t1 - 0.1); if (t0 < 0) t0 = 0; sync(); }; const setOut = () => { t1 = Math.max(pv.currentTime, t0 + 0.1); sync(); };
    const step = (n) => { pv.pause(); seek(pv.currentTime + n); };
    const play = () => { if (!pv.paused) return pv.pause(); if (pv.currentTime < t0 || pv.currentTime >= t1 - 0.05) pv.currentTime = t0; pv.play(); };
    pv.addEventListener('timeupdate', () => { if (!pv.paused && pv.currentTime >= t1) { pv.pause(); pv.currentTime = t1; } sync(); });
    pv.addEventListener('play', () => { playB.innerHTML = I('pause'); }); pv.addEventListener('pause', () => { playB.innerHTML = I('play'); });
    pv.addEventListener('seeked', sync); pv.addEventListener('click', play);
    pv.addEventListener('loadedmetadata', () => { const d = D(); if (t1 > d) t1 = d; if (t1 - t0 < 0.1) t0 = Math.max(0, t1 - 10); pv.currentTime = now; sync(); this.filmstrip(src, strip, d); });
    nIn.onchange = () => { t0 = +nIn.value || 0; seek(t0); }; nOut.onchange = () => { t1 = +nOut.value || 0; seek(t1); };
    const keys = (e) => { if (e.target.tagName === 'INPUT') return; const k = e.key.toLowerCase();
      if (k === 'i') { e.preventDefault(); setIn(); } else if (k === 'o') { e.preventDefault(); setOut(); } else if (k === ' ') { e.preventDefault(); play(); }
      else if (k === 'arrowleft' || k === ',') { e.preventDefault(); step(e.shiftKey ? -1 : -1 / FPS); } else if (k === 'arrowright' || k === '.') { e.preventDefault(); step(e.shiftKey ? 1 : 1 / FPS); }
      else if (k === 'home') { e.preventDefault(); seek(t0); } else if (k === 'end') { e.preventDefault(); seek(t1); } };
    const B = (ic, tip, fn, cls = 'ib') => h('button', { class: cls, title: tip, html: I(ic), onclick: (e) => { e.preventDefault(); fn(); track.focus({ preventScroll: true }); } });
    playB.onclick = (e) => { e.preventDefault(); play(); };
    const root = h('div', { class: 'trimmer', tabindex: '-1', onkeydown: keys },
      h('div', { class: 'tr-stage' }, pv),
      h('div', { class: 'tr-ctl' }, B('skip-back', t('v23.tr_to_in') + ' (Home)', () => seek(t0)), B('chevron-left', t('v23.tr_prev') + ' (←)', () => step(-1 / FPS)), playB, B('chevron-right', t('v23.tr_next') + ' (→)', () => step(1 / FPS)), B('skip-forward', t('v23.tr_to_out') + ' (End)', () => seek(t1)), lNow, h('div', { class: 'grow' }),
        h('button', { class: 'btn sm', title: 'I', onclick: (e) => { e.preventDefault(); setIn(); } }, '[ ', t('v23.tr_set_in')), h('button', { class: 'btn sm', title: 'O', onclick: (e) => { e.preventDefault(); setOut(); } }, t('v23.tr_set_out'), ' ]')),
      track,
      h('div', { class: 'tr-info' }, h('span', {}, t('v23.tr_in'), ' ', lIn), h('span', { class: 'tr-durbox' }, '✂️ ', lDur), h('span', {}, t('v23.tr_out'), ' ', lOut)),
      h('details', { class: 'tr-more' }, h('summary', {}, t('v23.tr_exact')), h('div', { class: 'tr-nums' }, h('label', {}, tr('video.027'), nIn), h('label', {}, tr('video.028'), nOut), h('label', { class: 'grow' }, tr('extras.058'), label))),
      h('p', { class: 'small muted tr-hint' }, t('v23.tr_hint')));
    const x = () => ({ t0: +t0.toFixed(3), t1: +t1.toFixed(3), label: label.value.trim() || 'clip' });
    const close = Panels.modal(tr('video.029'), root, { wide: true, okLabel: tr('video.030'), ok: () => { pv.pause(); this.exportClip(it, x()); },
      extra: [h('button', { class: 'btn ghost', onclick: () => { pv.pause(); this.clipToCard(it, x()); close(); } }, iconSvg('film', 15), ' ', t('video.014')), h('button', { class: 'btn ghost', onclick: () => { const c = x(); Store.change(() => { (it.highlights ||= []).push({ t0: c.t0, t1: c.t1, label: c.label }); }); Items.mount(it); toast(`★ ${fmtTime(c.t0)}–${fmtTime(c.t1)}`); pv.pause(); close(); } }, iconSvg('star', 15), ' ', t('v23.tr_hl'))],
      onClose: () => { pv.pause(); pv.removeAttribute('src'); pv.load(); } });
    setTimeout(() => track.focus({ preventScroll: true }), 80); sync(); this._trim = { root, get t0() { return t0; }, get t1() { return t1; }, setIn, setOut, seek, step, pv };
    return close;
  },
  // thumbnails for the trimmer strip: a hidden <video> seeks N points and paints them (no ffmpeg needed)
  async filmstrip(src, cv, d) {
    if (!d) return; const r = cv.getBoundingClientRect(); const dpr = Math.min(devicePixelRatio || 1, 2); cv.width = Math.max(200, r.width * dpr); cv.height = Math.max(40, r.height * dpr);
    const ctx = cv.getContext('2d'); const v = h('video', { src, muted: '', preload: 'auto' }); v.muted = true;
    await new Promise((res) => { v.onloadeddata = res; v.onerror = res; setTimeout(res, 4000); }); if (!v.videoWidth) return;
    const th = cv.height, tw = th * v.videoWidth / v.videoHeight; const n = Math.max(1, Math.ceil(cv.width / tw));
    for (let i = 0; i < n; i++) { if (!cv.isConnected) break; await new Promise((res) => { v.onseeked = res; setTimeout(res, 1500); v.currentTime = Math.min(d - 0.05, (i + 0.5) * d / n); }); try { ctx.drawImage(v, i * tw, 0, tw, th); } catch { break; } }
    v.removeAttribute('src'); v.load();
  },
  async exportClip(it, x) { try { toast('✂️ ffmpeg…'); const p = await API.inv('video:clip', it.file, x.t0, x.t1, x.label); if (p) toast('✂️ ✓ ' + p); } catch (e) { toast('⚠️ ffmpeg: ' + e.message, { kind: 'err', ms: 7000 }); } },
  async clipToCard(it, x) { try { toast('✂️ ffmpeg…'); const f = await API.inv('video:clipToMedia', it.file, x.t0, x.t1); const p = { x: it.x + it.w + 24, y: it.y + 40 }; Features.addAt({ type: 'video', file: f, name: `${x.label}.mp4`, w: it.w, h: it.h, source: it.id }, p.x, p.y); } catch (e) { toast('⚠️ ' + e.message, { kind: 'err' }); } },
  audio(n, it) {
    const tr = it.transcript?.text;
    n.innerHTML = `<div class="card audio-card ${it.voice ? 'voice' : ''}"><div class="a-ico">${iconSvg(it.voice ? 'mic' : 'music', 22)}</div><div class="a-body"><div class="a-title">${esc(it.title || it.name || t('voice_memo'))}</div><div class="a-sub">${it.voice ? fmtDate(it.created) : ''}${tr ? '' : t('video.031', { v0: iconSvg('file-text', 12) })}</div><audio class="live" src="${esc(Store.media(it.file))}" controls preload="metadata"></audio>${tr ? t('video.032', { v0: esc(tr.slice(0, 220)) }) : ''}</div></div>`;
    n.querySelector('.a-tr')?.addEventListener('click', (e) => { e.stopPropagation(); this.transcriptCard(it); });
  },
  async afterVoice(it, blob) {
    if (!it || Store.state.settings.ai.stt.voiceMemos === false) return;
    try { const r = await Speech.transcribeBlob(blob); if (!r?.text) return; Store.change(() => { it.transcript = { text: r.text, segments: r.segments, at: Date.now() }; if (/^🎙️/.test(it.title || '')) it.title = '🎙️ ' + r.text.slice(0, 40) + (r.text.length > 40 ? '…' : ''); }); Items.mount(it); Automations.fire('transcript', it); }
    catch (e) { console.warn('voice memo stt', e.message); toast(t('video.033'), { ms: 3000 }); }
  },
};
Items.R.video = (n, it) => Media2.render(n, it);
Items.R.audio = (n, it) => Media2.audio(n, it);
document.addEventListener('click', (e) => { const ts = e.target.closest('.ts[data-ref]'); if (ts) { e.stopPropagation(); Media2.seek(ts.dataset.ref, ts.dataset.t); } }, true);
