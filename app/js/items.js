'use strict';
// Item renderers. Each item -> absolutely positioned DOM node inside #items-layer.
const FONTS = [
  ['Inter', 'Inter'], ['Playpen Sans', t('items.001')], ['Mansalva', t('items.002')], ['Mynerve', t('items.003')], ['Comic Relief', 'Comic'], ['Caveat', t('items.004')], ['Permanent Marker', t('items.005')],
  ['Comfortaa', 'Comfortaa'], ['Arima', 'Arima'], ['Noto Serif', 'Serif'], ['Roboto Slab', 'Slab'], ['Ubuntu', 'Ubuntu'], ['JetBrains Mono', 'Mono'], ['Tektur', 'Tektur'], ['Handjet', 'Handjet'], ['Press Start 2P', 'Pixel'], ['Dela Gothic One', 'Dela Gothic'], ['Orbitron', t('items.006')]];
const PALETTE = ['#ffffff', '#c9cdd6', '#6b7280', '#111318', '#ff4d6d', '#ff8a4c', '#ffd23f', '#9be15d', '#3cf0b4', '#22d3ee', '#4f8cff', '#7c8cff', '#b07cff', '#f472b6', '#a0522d'];
const STICKY = ['#ffe66d', '#ffb86b', '#ff8fab', '#c3a6ff', '#8fd3ff', '#9ef0c4', '#f5f5f5', '#2b2f3a', '#ffadad', '#ffd6a5', '#caffbf', '#a0c4ff', '#e9d5ff', '#d4a373', '#264653', '#1d3557'];
// v2.3: paper kinds (it.paperKind). '' = classic sticky with tape.
const PAPER_KINDS = [['', 'sticky-note'], ['lined', 'notebook-text'], ['grid', 'grid-3x3'], ['dotted', 'grip'], ['kraft', 'package'], ['index', 'id-card'], ['torn', 'scissors'], ['polaroid', 'image'], ['pin', 'pin'], ['glass', 'gem']];
function stickyDefaults(extra) {
  const S = (Store.state && Store.state.settings) || {};
  const k = extra && 'paperKind' in extra ? extra.paperKind : (S.stickyKind || '');
  const o = { type: 'sticky', w: 220, h: 220, paper: S.stickyColor || STICKY[0], font: 'Playpen Sans', size: 20, html: '', r: (Math.random() * 4 - 2), ...(extra || {}) };
  if (k) o.paperKind = k; else delete o.paperKind;
  return o;
}

const paperDark = (c) => { const m = /^#?([0-9a-f]{6})$/i.exec(c || ''); if (!m) return false; const v = parseInt(m[1], 16); return (0.299 * (v >> 16) + 0.587 * (v >> 8 & 255) + 0.114 * (v & 255)) < 120; };

const Items = {
  nodes: new Map(),
  el(it) { return this.nodes.get(it.id); },
  mount(it) {
    let n = this.nodes.get(it.id);
    if (!n) {
      n = document.createElement('div'); n.className = 'item'; n.dataset.id = it.id;
      this.nodes.set(it.id, n);
      (it.type === 'frame' ? $('#frames-layer') : $('#items-layer')).append(n);
    }
    this.render(n, it); this.place(n, it); return n;
  },
  unmount(id) { const n = this.nodes.get(id); if (n) { n.querySelectorAll('video,audio').forEach(m => { try { m.pause(); } catch (e) {} }); n.remove(); } this.nodes.delete(id); },
  clear() { for (const id of [...this.nodes.keys()]) this.unmount(id); },
  place(n, it) {
    n.style.transform = `translate(${it.x}px,${it.y}px)` + (it.r ? ` rotate(${it.r}deg)` : '');
    n.style.width = it.w + 'px';
    if (it.type === 'text') { n.style.height = 'auto'; n.style.minHeight = '20px'; } else n.style.height = it.h + 'px';
    let zi = it.type === 'frame' ? 0 : (it.z || 1);
    // v2.4: anything attached to a note (ink, highlighter, shapes, text) always stays visible above its host
    if (it.parent) { const hst = Store.get(it.parent); if (hst && (hst.z || 1) >= zi) zi = (hst.z || 1) + 1; }
    n.style.zIndex = zi; n.classList.toggle('on-host', !!it.parent);
    if (it.type === 'emoji') { const e = n.firstChild; if (e) e.style.fontSize = Math.min(it.w, it.h) * 0.86 + 'px'; }
  },
  sig(it) { const { x, y, w, h, r, z, ...rest } = it; return JSON.stringify(rest); },
  render(n, it) {
    const sig = this.sig(it) + '|' + (it.type === 'image' ? Canvas.lodFor(it) : '');
    if (n._sig === sig) return; n._sig = sig;
    if (n.contains(document.activeElement) && document.activeElement.isContentEditable) return; // don't clobber active edit
    n.className = 'item t-' + it.type + (it.locked ? ' locked' : '') + (it.sticker ? ' sticker' : '') + (it.style ? ' st-' + it.style : '') + (it.parent ? ' on-host' : '') + (it.kind === 'highlighter' ? ' ink-hl' : '');
    const R = this.R[it.type] || this.R.unknown;
    n.innerHTML = '';
    R(n, it);
    const badges = [];
    if (it.reminder?.on) badges.push(`<span class="bdg bell" title="${esc(fmtDate(it.reminder.at))}">${iconSvg('bell-ring', 12)}</span>`);
    if (it.pinned) badges.push(`<span class="bdg pin">${iconSvg('pin', 12)}</span>`);
    if (it.locked) badges.push(`<span class="bdg lock">${iconSvg('lock', 12)}</span>`);
    if (badges.length) n.insertAdjacentHTML('beforeend', `<div class="badges">${badges.join('')}</div>`);
  },
  txtStyle(it) { return `font-family:'${it.font || 'Inter'}';font-size:${it.size || 18}px;color:${it.color || 'var(--card-text)'};text-align:${it.align || 'left'};`; },
  R: {
    unknown(n, it) { n.innerHTML = `<div class="card">${esc(it.type)}</div>`; },
    text(n, it) { n.innerHTML = `<div class="txt" style="${Items.txtStyle(it)}${it.bg ? 'background:' + it.bg + ';' : ''}">${it.html || ''}</div>`; },
    sticky(n, it) {
      const k = PAPER_KINDS.some(([x]) => x === it.paperKind) ? it.paperKind : ''; const paper = k === 'kraft' && !it.paper ? '#c8a27a' : (it.paper || '#ffe66d');
      const dark = k === 'glass' ? !document.body.classList.contains('light-ui') : paperDark(paper);
      n.innerHTML = `<div class="paper${k ? ' pk-' + k : ''}${dark ? ' dark' : ''}" style="--paper:${paper}">${k === 'pin' ? '<i class="pin-head"></i>' : ''}<div class="txt" style="${Items.txtStyle({ ...it, color: it.color || (dark ? '#f2f2f2' : '#1d1b16') })}">${it.html || ''}</div></div>`;
    },
    shape(n, it) {
      const w = it.w, hh = it.h, sw = it.sw ?? 2.5, f = it.fill || 'transparent', s = it.stroke || 'var(--accent)';
      let shp = '';
      const k = it.shape || 'rect';
      if (k === 'rect') shp = `<rect x="${sw / 2}" y="${sw / 2}" width="${Math.max(0, w - sw)}" height="${Math.max(0, hh - sw)}" rx="${Math.min(18, w / 6, hh / 6)}"/>`;
      else if (k === 'ellipse') shp = `<ellipse cx="${w / 2}" cy="${hh / 2}" rx="${Math.max(0, w / 2 - sw / 2)}" ry="${Math.max(0, hh / 2 - sw / 2)}"/>`;
      else if (k === 'diamond') shp = `<polygon points="${w / 2},${sw} ${w - sw},${hh / 2} ${w / 2},${hh - sw} ${sw},${hh / 2}"/>`;
      else if (k === 'triangle') shp = `<polygon points="${w / 2},${sw} ${w - sw},${hh - sw} ${sw},${hh - sw}"/>`;
      else if (k === 'star') { const pts = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? .42 : 1; pts.push(`${w / 2 + Math.cos(a) * rr * (w / 2 - sw)},${hh / 2 + Math.sin(a) * rr * (hh / 2 - sw)}`); } shp = `<polygon points="${pts.join(' ')}"/>`; }
      else if (k === 'heart') shp = `<path d="M${w / 2} ${hh * .92} C ${w * .05} ${hh * .6}, ${w * .02} ${hh * .12}, ${w * .28} ${hh * .1} C ${w * .4} ${hh * .08}, ${w * .48} ${hh * .2}, ${w / 2} ${hh * .28} C ${w * .52} ${hh * .2}, ${w * .6} ${hh * .08}, ${w * .72} ${hh * .1} C ${w * .98} ${hh * .12}, ${w * .95} ${hh * .6}, ${w / 2} ${hh * .92} Z"/>`;
      n.innerHTML = `<svg class="shape-svg" width="${w}" height="${hh}" viewBox="0 0 ${w} ${hh}"><g fill="${f}" stroke="${s}" stroke-width="${sw}" stroke-linejoin="round" ${it.dash ? 'stroke-dasharray="8 7"' : ''}>${shp}</g></svg><div class="txt center" style="${Items.txtStyle({ ...it, align: 'center' })}">${it.html || ''}</div>`;
    },
    ink(n, it) { n.innerHTML = `<svg class="ink-svg" viewBox="0 0 ${it.ow} ${it.oh}" preserveAspectRatio="none"><path d="${Ink.path(it)}" fill="${it.color}" opacity="${it.opacity ?? 1}"/></svg>`; },
    arrow(n, it) { n.innerHTML = Arrow.svg(it); },
    line(n, it) { n.innerHTML = Arrow.svg(it); },
    image(n, it) {
      const src = Store.media(Canvas.lodFor(it) === 'thumb' && it.thumb ? it.thumb : it.file);
      n.innerHTML = `<img draggable="false" src="${esc(src)}" alt="" decoding="async" loading="lazy">` + (it.caption ? `<div class="cap">${esc(it.caption)}</div>` : '');
    },
    video(n, it) { n.innerHTML = `<div class="card media-card"><div class="grip">${iconSvg('film', 14)}<span>${esc(it.name || 'video')}</span></div><video class="live" src="${esc(Store.media(it.file))}" controls preload="metadata" ${it.loop ? 'loop' : ''}></video></div>`; },
    audio(n, it) {
      n.innerHTML = `<div class="card audio-card ${it.voice ? 'voice' : ''}"><div class="a-ico">${iconSvg(it.voice ? 'mic' : 'music', 22)}</div><div class="a-body"><div class="a-title">${esc(it.title || it.name || t('voice_memo'))}</div><div class="a-sub">${it.voice ? fmtDate(it.created) : ''}</div><audio class="live" src="${esc(Store.media(it.file))}" controls preload="metadata"></audio></div></div>`;
    },
    link(n, it) {
      n.innerHTML = `<div class="card link-card">${it.image ? `<div class="l-img" style="background-image:url('${esc(rimg(it.image))}')"></div>` : `<div class="l-img ph">${iconSvg('globe', 34)}</div>`}<div class="l-body"><div class="l-title">${esc(it.title || hostOf(it.url))}</div><div class="l-desc">${esc(it.desc || '')}</div><div class="l-host"><img src="${esc(favicon(it.url))}" data-err="remove">${esc(hostOf(it.url))}<button class="live mini act" data-act="open-link">${iconSvg('external-link', 14)}</button></div></div></div>`;
    },
    file(n, it) { n.innerHTML = `<div class="card file-card"><div class="f-ico">${iconSvg(/pdf$/i.test(it.name) ? 'file-text' : 'file', 30)}</div><div class="f-body"><div class="f-name">${esc(it.name)}</div><div class="f-sub">${it.size ? (it.size / 1048576).toFixed(1) + ' MB' : ''}</div></div><button class="live mini act" data-act="open-file">${iconSvg('external-link', 14)}</button></div>`; },
    emoji(n, it) { n.innerHTML = `<div class="emo" style="font-size:${Math.min(it.w, it.h) * 0.86}px">${esc(it.char)}</div>`; },
    sticker(n, it) { n.innerHTML = `<img draggable="false" class="stk" src="assets/twemoji/${esc(it.hex)}.svg" alt="">`; },
    reaction(n, it) { n.innerHTML = `<div class="reaction r-${it.variant || 0}" style="--rc:${it.color || '#ff3d6e'}"><span>${esc(it.text)}</span></div>`; },
    icon(n, it) {
      const pack = NYX_DATA[it.pack] || NYX_DATA.lucide; const d = pack && pack[it.name];
      const filled = it.pack === 'tablerFilled';
      n.innerHTML = `<svg class="icon-svg" viewBox="0 0 24 24" fill="${filled ? it.color : 'none'}" stroke="${filled ? 'none' : it.color}" stroke-width="${it.sw || 1.75}" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 ${it.glow ? 10 : 0}px ${it.color})">${d ? d[0] : ''}</svg>`;
      if (!d) Library.ensurePack(it.pack).then(() => { n._sig = ''; Items.render(n, it); });
    },
    frame(n, it) { n.innerHTML = `<div class="frame-box" style="--fc:${it.color || 'var(--accent)'}"><div class="frame-title">${esc(it.title || t('items.007'))}</div></div>`; },
    countdown(n, it) {
      n.innerHTML = `<div class="card cd-card" style="--cc:${it.color || 'var(--accent)'}"><div class="cd-top"><span class="cd-emo">${esc(it.emoji || '⏳')}</span><span class="cd-title">${esc(it.title || 'Countdown')}</span></div><div class="cd-digits" data-cd="${esc(it.target)}"></div><div class="cd-date">${fmtDate(it.target)}</div></div>`;
      Canvas.tickCountdowns(n);
    },
    show(n, it) {
      const nx = it.next;
      const target = nx?.airstamp || it.target;
      const poster = it.poster ? Store.media(it.poster) : '';
      const sub = it.kind === 'movie' ? (it.target ? fmtDate(it.target, false) : '') : nx ? `${t('show_next')}: S${pad(nx.season)}E${pad(nx.number)} · ${esc(nx.name || '')}` : (it.status === 'Ended' ? t('show_ended') : t('show_none'));
      n.innerHTML = `<div class="card show-card">${poster ? `<div class="s-poster" style="background-image:url('${esc(poster)}')"></div>` : `<div class="s-poster ph">${iconSvg(it.kind === 'movie' ? 'clapperboard' : 'tv', 34)}</div>`}<div class="s-body"><div class="s-kind">${it.kind === 'movie' ? '🎬 ' + t('show_movie') : '📺 ' + t('show_tv')}${it.network ? ' · ' + esc(it.network) : ''}</div><div class="s-title">${esc(it.title)}</div><div class="s-sub">${sub}</div>${target ? `<div class="cd-digits small" data-cd="${esc(target)}"></div><div class="s-date">${fmtDate(target)}</div>` : ''}${it.source === 'tvmaze' ? t('items.008', { v0: iconSvg('refresh-cw', 13) }) : ''}</div></div>`;
      Canvas.tickCountdowns(n);
    },
    subs(n, it) { n.innerHTML = Subs.cardHtml(it); },
    tracker(n, it) {
      const hl = (s) => { let out = esc(s); for (const kw of String(it.keyword || '').split(',').map(x => x.trim()).filter(Boolean)) out = out.replace(new RegExp('(' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark>$1</mark>'); return out; };
      n.innerHTML = `<div class="card tr-card ${it.changed ? 'changed' : ''}"><div class="tr-head"><img src="${esc(favicon(it.url))}" data-err="remove"><span class="tr-host">${esc(hostOf(it.url))}</span>${it.changed ? `<span class="tr-new">${t('tr_changed')}</span>` : ''}<button class="live mini act" data-act="check-tracker" title="${t('tr_check')}">${iconSvg('refresh-cw', 13)}</button><button class="live mini act" data-act="open-link">${iconSvg('external-link', 13)}</button></div>
        <div class="tr-kw">${String(it.keyword || '').split(',').filter(x => x.trim()).map(k => `<span class="chip">${esc(k.trim())}</span>`).join('')}</div>
        <div class="tr-count"><b>${it.count ?? '–'}</b> ${t('tr_mentions')}${it.error ? ` <span class="err">⚠ ${esc(it.error)}</span>` : ''}</div>
        <div class="tr-snips">${(it.snippets || []).slice(0, 3).map(s => `<p>…${hl(s)}…</p>`).join('')}</div>
        <div class="tr-foot">${it.checkedAt ? '⟳ ' + fmtDate(it.checkedAt) : t('tr_never')} · ${it.interval || 60}′</div></div>`;
    },
    reminder(n, it) {
      const r = it.reminder || {};
      n.innerHTML = `<div class="card rem-card ${r.on ? '' : 'off'}"><div class="rem-ico">${iconSvg('alarm-clock', 26)}</div><div class="rem-body"><div class="txt" style="${Items.txtStyle(it)}">${it.html || t('features.007')}</div><div class="rem-when">${r.at ? fmtDate(r.at) : '—'} ${r.repeat && r.repeat !== 'none' ? '· ' + t('rep_' + r.repeat) : ''}</div></div></div>`;
    },
  }
};

// Freehand ink
const Ink = {
  opts(it) {
    const base = { size: it.size || 4, thinning: .6, smoothing: .55, streamline: .45, simulatePressure: !it.realPressure, start: { taper: it.size * 3, cap: true }, end: { taper: it.size * 3, cap: true } };
    if (it.kind === 'marker') return { ...base, thinning: .1, start: { cap: true }, end: { cap: true } };
    if (it.kind === 'highlighter') return { ...base, thinning: 0, smoothing: .7, start: { cap: true }, end: { cap: true } };
    return base;
  },
  path(it) {
    const pts = PF.getStroke(it.pts, this.opts(it));
    if (!pts.length) return '';
    const d = pts.reduce((acc, [x0, y0], i, arr) => { const [x1, y1] = arr[(i + 1) % arr.length]; acc.push(x0.toFixed(1), y0.toFixed(1), ((x0 + x1) / 2).toFixed(1), ((y0 + y1) / 2).toFixed(1)); return acc; }, ['M', ...pts[0].map(v => v.toFixed(1)), 'Q']);
    return d.join(' ') + ' Z';
  }
};
// Arrows & lines (endpoints stored in world coords)
const Arrow = {
  bbox(it) { const p = 24; const x = Math.min(it.x1, it.x2) - p, y = Math.min(it.y1, it.y2) - p; return { x, y, w: Math.abs(it.x2 - it.x1) + p * 2, h: Math.abs(it.y2 - it.y1) + p * 2 }; },
  fit(it) { Object.assign(it, this.bbox(it)); },
  svg(it) {
    const ax = it.x1 - it.x, ay = it.y1 - it.y, bx = it.x2 - it.x, by = it.y2 - it.y, sw = it.sw || 3, c = it.stroke || 'var(--accent)';
    const head = (x1, y1, x2, y2) => { const a = Math.atan2(y2 - y1, x2 - x1), L = 10 + sw * 2.4, s = .45; return `<path d="M${x2 - L * Math.cos(a - s)} ${y2 - L * Math.sin(a - s)} L${x2} ${y2} L${x2 - L * Math.cos(a + s)} ${y2 - L * Math.sin(a + s)}" fill="none"/>`; };
    let mid = ''; let d = `M${ax} ${ay} L${bx} ${by}`;
    if (it.curve) { const mx = (ax + bx) / 2, my = (ay + by) / 2, nx = -(by - ay) * .25, ny = (bx - ax) * .25; d = `M${ax} ${ay} Q${mx + nx} ${my + ny} ${bx} ${by}`; }
    const heads = it.type === 'arrow' ? (it.curve ? head((ax + bx) / 2 - (by - ay) * .25, (ay + by) / 2 + (bx - ax) * .25, bx, by) : head(ax, ay, bx, by)) + (it.both ? head(bx, by, ax, ay) : '') : '';
    return `<svg class="arrow-svg" width="${it.w}" height="${it.h}"><g stroke="${c}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" fill="none" ${it.dash ? 'stroke-dasharray="9 8"' : ''}><path d="${d}"/>${heads}</g><path class="hit" d="${d}" stroke="transparent" stroke-width="${sw + 16}" fill="none"/></svg>`;
  },
  distTo(it, x, y) { // distance from world point to segment
    const { x1, y1, x2, y2 } = it; const dx = x2 - x1, dy = y2 - y1; const L = dx * dx + dy * dy || 1; const tt = clamp(((x - x1) * dx + (y - y1) * dy) / L, 0, 1);
    return Math.hypot(x - (x1 + tt * dx), y - (y1 + tt * dy));
  }
};
