'use strict';
// UI panels: tabs, drawer (library / subs / reminders / themes / settings), command palette, modal, context menu, stylebar
const GR_SYN = { 'καρδια': 'heart love', 'αγαπη': 'love heart kiss', 'γελιο': 'laugh joy lol', 'γελω': 'laugh joy', 'χαρα': 'happy smile joy', 'χαμογελο': 'smile', 'λυπη': 'sad cry', 'κλαμα': 'cry tear sob', 'θυμος': 'angry rage mad', 'φωτια': 'fire flame', 'αστερι': 'star', 'αστερια': 'star sparkle', 'φεγγαρι': 'moon', 'ηλιος': 'sun', 'βροχη': 'rain umbrella', 'χιονι': 'snow', 'συννεφο': 'cloud', 'σκυλος': 'dog', 'σκυλι': 'dog puppy', 'γατα': 'cat', 'πουλι': 'bird', 'ψαρι': 'fish', 'λουλουδι': 'flower', 'δεντρο': 'tree', 'φαγητο': 'food', 'πιτσα': 'pizza', 'καφες': 'coffee', 'μπυρα': 'beer', 'κρασι': 'wine', 'τουρτα': 'cake birthday', 'γενεθλια': 'birthday cake party', 'παρτι': 'party tada', 'μουσικη': 'music note', 'ταινια': 'movie film clapper', 'σειρα': 'tv television', 'τηλεοραση': 'tv television', 'παιχνιδι': 'game video controller', 'αυτοκινητο': 'car', 'αεροπλανο': 'airplane', 'ταξιδι': 'travel airplane luggage', 'σπιτι': 'house home', 'δουλεια': 'work briefcase office', 'λεφτα': 'money dollar euro', 'χρηματα': 'money', 'ευρω': 'euro', 'κλειδι': 'key', 'κλειδαρια': 'lock', 'τηλεφωνο': 'phone', 'κινητο': 'mobile phone', 'υπολογιστης': 'computer laptop', 'βιβλιο': 'book', 'σημειωση': 'note memo', 'ημερολογιο': 'calendar', 'ρολοι': 'clock watch', 'ξυπνητηρι': 'alarm clock', 'καμπανα': 'bell', 'ειδοποιηση': 'bell notification', 'προσοχη': 'warning alert', 'ερωτηση': 'question', 'ναι': 'check yes', 'οχι': 'cross no x', 'σωστο': 'check', 'λαθος': 'cross x', 'σημαια': 'flag', 'ελλαδα': 'greece', 'κουπα': 'trophy', 'νικη': 'trophy victory win', 'δυναμη': 'muscle strong', 'χερι': 'hand', 'μπραβο': 'clap thumbs', 'λαικ': 'thumbs up like', 'φιλι': 'kiss', 'υπνος': 'sleep zzz', 'κουραση': 'tired sleepy', 'ιδεα': 'bulb idea light', 'λαμπα': 'bulb light', 'ρουκετα': 'rocket', 'διαστημα': 'space rocket planet', 'πλανητης': 'planet', 'φαντασμα': 'ghost', 'κρανιο': 'skull', 'εξωγηινος': 'alien', 'ρομποτ': 'robot', 'ποδοσφαιρο': 'soccer football', 'μπασκετ': 'basketball', 'γυμναστικη': 'gym weight muscle', 'υγεια': 'health heart medical', 'φαρμακο': 'pill medicine', 'γιατρος': 'doctor', 'σχολειο': 'school', 'αγορες': 'shopping cart bag', 'καλαθι': 'cart basket', 'δωρο': 'gift present', 'χριστουγεννα': 'christmas tree santa', 'πασχα': 'easter egg', 'καλοκαιρι': 'summer sun beach', 'θαλασσα': 'sea wave beach', 'βουνο': 'mountain', 'φωτογραφια': 'camera photo', 'βιντεο': 'video camera', 'μικροφωνο': 'microphone', 'ακουστικα': 'headphones', 'αναζητηση': 'search magnifying', 'ρυθμισεις': 'settings gear', 'χρηστης': 'user person', 'φιλος': 'friend people', 'οικογενεια': 'family', 'μωρο': 'baby', 'αστειο': 'funny laugh joke', 'cool': 'cool sunglasses', 'κουλ': 'cool sunglasses', 'σοκ': 'shock scream', 'σκεψη': 'thinking', 'μυαλο': 'brain mind' };
function expandQuery(q) { const n = norm(q).trim(); if (!n) return []; const parts = n.split(/\s+/); return parts.map(p => { const ex = Object.entries(GR_SYN).filter(([k]) => k.startsWith(p) || (p.length > 3 && k.includes(p))).map(([, v]) => v).join(' '); return [p, ...ex.split(' ').filter(Boolean)]; }); }
function matchQ(groups, hay) { return groups.every(alts => alts.some(a => hay.includes(a))); }

const REACTIONS = [t('app.010'), 'WOW', 'LOL', t('panels.001'), 'OMG', t('panels.002'), t('panels.003'), 'TODO', 'DONE ✓', t('panels.004'), 'NOPE', 'YES!', t('panels.005'), t('panels.006'), t('panels.007'), t('panels.008'), 'FIRE 🔥', 'HYPE', 'BRB', t('panels.009'), t('panels.010'), t('panels.011'), t('panels.012'), 'GG', 'NEW', 'SALE', 'URGENT', 'IDEA 💡'];
const REACT_COLORS = ['#ff3d6e', '#ffb020', '#22d3ee', '#9be15d', '#b07cff', '#ffffff'];

const SUB_PRESETS = [
  ['Netflix', 'https://www.netflix.com/YourAccount', '#e50914', '🎬', 'Streaming'], ['Spotify', 'https://www.spotify.com/account/subscription/', '#1db954', '🎧', t('panels.013')], ['YouTube Premium', 'https://www.youtube.com/paid_memberships', '#ff0033', '▶️', 'Streaming'],
  ['Disney+', 'https://www.disneyplus.com/account/subscription', '#113ccf', '🏰', 'Streaming'], ['Prime Video', 'https://www.amazon.com/yourmembershipsandsubscriptions', '#00a8e1', '📦', 'Streaming'], ['HBO Max', 'https://auth.max.com/subscription', '#7b2cff', '🎞️', 'Streaming'],
  ['ChatGPT Plus', 'https://chatgpt.com/#settings/Subscription', '#10a37f', '🤖', 'AI'], ['Claude Pro', 'https://claude.ai/settings/billing', '#d97757', '✳️', 'AI'], ['Grok / X Premium', 'https://x.com/settings/premium', '#e7e9ea', '✖️', 'AI'], ['Midjourney', 'https://www.midjourney.com/account', '#ffffff', '🎨', 'AI'],
  ['Xbox Game Pass', 'https://account.microsoft.com/services', '#107c10', '🎮', 'Gaming'], ['PlayStation Plus', 'https://www.playstation.com/acct/management', '#0070d1', '🎮', 'Gaming'], ['Nintendo Online', 'https://accounts.nintendo.com/', '#e60012', '🍄', 'Gaming'],
  ['Microsoft 365', 'https://account.microsoft.com/services', '#d83b01', '📄', t('panels.014')], ['Google One', 'https://one.google.com/storage', '#4285f4', '☁️', 'Cloud'], ['iCloud+', 'https://www.icloud.com/settings/', '#3693f3', '☁️', 'Cloud'], ['Adobe CC', 'https://account.adobe.com/plans', '#fa0f00', '🅰️', t('panels.014')],
  ['Cosmote TV', 'https://www.cosmotetv.gr/', '#00a651', '📺', 'TV'], ['Vodafone TV', 'https://www.vodafone.gr/', '#e60000', '📺', 'TV'], ['Nova', 'https://www.nova.gr/', '#ff6a00', '📺', 'TV'], ['Discord Nitro', 'https://discord.com/channels/@me', '#5865f2', '💬', 'Social'], [t('panels.015'), '', '#ffb020', '🏋️', t('panels.016')],
];
const CYCLE_FACTOR = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };

const Panels = {
  drawerKind: null,
  // ---------- tabs ----------
  tabs() {
    const T = $('#tabs'); T.innerHTML = ''; const S = Store.state;
    for (const b of S.boards) {
      // v2.6.11: role=tab + roving tabindex (the active tab is the one reachable with Tab; ←/→ Home/End move between boards)
      const tab = h('div', { class: 'tab' + (b.id === S.active ? ' on' : ''), draggable: 'false', 'data-drag': 'bar', style: { '--tc': b.color || 'var(--accent)' }, title: b.name, role: 'tab', 'aria-selected': b.id === S.active ? 'true' : 'false', tabindex: b.id === S.active ? '0' : '-1', 'data-board': b.id },
        h('span', { class: 'tab-emo' }, b.emoji || '•'), h('span', { class: 'tab-name' }, b.name), h('span', { class: 'tab-count' }, String(b.items.length || '')),
        S.boards.length > 1 ? h('button', { class: 'tab-x', title: t('del'), html: iconSvg('x', 11), onpointerdown: (e) => e.stopPropagation(), onclick: (e) => { e.stopPropagation(); App.deleteBoard(b); } }) : null);
      tab.onauxclick = (e) => { if (e.button === 1 && S.boards.length > 1) { e.preventDefault(); App.deleteBoard(b); } };
      tab.onclick = () => App.switchBoard(b.id);
      tab.ondblclick = () => this.renameBoard(b);
      tab.oncontextmenu = (e) => { e.preventDefault(); this.menu(e.clientX, e.clientY, this.tabMenuRows(b)); };
      // v2.6.12.2: drag / reorder with pointer events in TabDrag (tabdrag26122.js) — the same order rule as before (drop = before that tab)
      T.append(tab);
    }
    // v2.6.11: tabs shrink to a useful minimum, then «+N ▾» holds the rest; the active tab always stays visible (look2611.js)
    if (typeof TabStrip !== 'undefined') TabStrip.layout({ follow: true });
    else { const on = T.querySelector('.on'); on?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    if (this.drawerKind === 'boards' && typeof BoardTabs !== 'undefined') BoardTabs.renderManage(); // v2.6.12.1: «Διαχείριση πινάκων» follows
  },
  // the tab's right-click menu — v2.6.12.1: ONE source, used by the bar, the «+N ▾» rows and «Διαχείριση πινάκων»
  tabMenuRows(b) {
    return [
      [iconSvg('pencil', 15), t('rename'), () => this.renameBoard(b)], [iconSvg('copy', 15), t('duplicate'), () => App.duplicateBoard(b)],
      ['', '', null, h('div', { class: 'sw-row' }, ...PALETTE.slice(4).map(c => h('button', { class: 'sw', style: { '--c': c }, onclick: () => { b.color = c; Store.save(); this.tabs(); this.closeMenu(); } })))],
      [iconSvg('trash-2', 15), t('del'), () => App.deleteBoard(b), 'danger']];
  },
  renameBoard(b) {
    const f = form([['name', t('rename'), 'text', b.name], ['emoji', 'Emoji', 'text', b.emoji || '']]);
    this.modal(t('rename'), f.el, { ok: () => { const v = f.val(); b.name = v.name.trim() || b.name; b.emoji = v.emoji.trim(); Store.save(); this.tabs(); } });
  },
  // ---------- drawer ----------
  openDrawer(kind, title, build) {
    const d = $('#drawer');
    if (this.drawerKind === kind && !d.hidden) return this.closeDrawer();
    this.drawerKind = kind; $('#drawer-title').innerHTML = title; const body = $('#drawer-body'); body.innerHTML = ''; body.scrollTop = 0;
    d.hidden = false; d.dataset.kind = kind; document.body.classList.add('drawer-open'); requestAnimationFrame(() => d.classList.add('in'));
    $$('.tb-btn.on').forEach(b => b.classList.remove('on')); ({ subs: '#btn-subs', reminders: '#btn-reminders', themes: '#btn-theme', settings: '#btn-settings', ai: '#btn-ai', tools: '#btn-tools', store: '#btn-store' })[kind] && $(({ subs: '#btn-subs', reminders: '#btn-reminders', themes: '#btn-theme', settings: '#btn-settings', ai: '#btn-ai', tools: '#btn-tools', store: '#btn-store' })[kind]).classList.add('on');
    build(body);
  },
  closeDrawer() { const d = $('#drawer'); d.classList.remove('in'); this.drawerKind = null; document.body.classList.remove('drawer-open'); $$('.tb-btn.on').forEach(b => b.classList.remove('on')); setTimeout(() => { if (!this.drawerKind) d.hidden = true; }, 220); },
  refreshDrawer() { const k = this.drawerKind; if (!k) return; this.drawerKind = null; ({ subs: () => this.subs(), reminders: () => this.reminders(), themes: () => this.themes(), settings: () => this.settings(), library: () => this.library(this.libTab), bin: () => Bin.open(), boards: () => BoardTabs.manage() })[k]?.(); },

  // ---------- library (emoji / stickers / reactions / icons / memes) ----------
  libTab: 'emoji', libQ: '', libGroup: 'all', iconPack: 'lucide', iconColor: '#ffffff',
  library(tab) {
    if (tab) this.libTab = tab;
    // v2.6.11: right drawer in the widgets-v1 look, real counter in the footer.
    // v2.6.12 (mockup 05): tabs = outline icon + name, one line (horizontal scroll, never wrap); compact chips with outline
    // icons; 8 columns; search with a «/» hint («/» focuses it); arrows move a visible selection, Enter inserts it;
    // footer = real counter + «Enter εισαγωγή». No shortcut fires while you type in another field.
    this.openDrawer('library', `${iconSvg('smile-plus', 18)} <span class="dh-t">${LANG === 'el' ? t('panels.017') : 'Library'}</span> <kbd class="dh-kbd">Ctrl+E</kbd>`, (body) => {
      const TABS = [['emoji', 'smile'], ['stickers', 'sticky-note'], ['reactions', 'heart'], ['icons', 'star'], ['memes', 'image']];
      const tabs = h('div', { class: 'seg lib-tabs lib-tabs2', role: 'tablist' }, ...TABS.map(([k, ic]) => h('button', { class: this.libTab === k ? 'on' : '', role: 'tab', 'aria-selected': this.libTab === k ? 'true' : 'false', 'data-lib-tab': k, title: t('lib_' + k), 'aria-label': t('lib_' + k), onclick: () => { this.libTab = k; this.libSel = 0; this.drawerKind = null; this.library(); } }, h('span', { class: 'lt-i', 'aria-hidden': 'true', html: iconSvg(ic, 14) }), h('span', { class: 'lt-l' }, t('lib_' + k)))));
      tabs.addEventListener('wheel', (e) => { if (tabs.scrollWidth > tabs.clientWidth) { e.preventDefault(); tabs.scrollLeft += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY); } }, { passive: false });
      const q = h('input', { class: 'inp search', placeholder: t('v2612.lib_search'), value: this.libQ, 'aria-label': t('lib_search'), 'aria-keyshortcuts': '/', 'aria-controls': 'lib-grid' });
      const extra = h('div', { class: 'lib-extra' }); const grid = h('div', { class: 'lib-grid ' + this.libTab, id: 'lib-grid', role: 'grid', 'aria-label': t('lib_' + this.libTab) });
      const more = h('span', { class: 'lib-count', 'data-lib-count': '1' });
      const foot = h('div', { class: 'lib-more lib-foot' }, more, h('span', { class: 'lib-enter' }, h('kbd', {}, 'Enter'), ' ' + t('v2612.lib_enter')));
      body.append(tabs, h('div', { class: 'lib-search' }, h('span', { html: iconSvg('search', 15) }), q, h('kbd', { class: 'lib-slash', title: t('v2612.lib_slash'), 'aria-hidden': 'true' }, '/')), extra, grid, foot);
      requestAnimationFrame(() => { tabs.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
      q.oninput = debounce(() => { this.libQ = q.value; this.libSel = 0; this.fillLib(grid, extra, more); }, 120);
      q.addEventListener('keydown', (e) => this.libKey(e, grid, q));
      grid.addEventListener('keydown', (e) => this.libKey(e, grid, q));
      grid.addEventListener('focusin', (e) => { const c = e.target.closest('.lib-grid > button'); if (c) this.libSelect(grid, [...grid.children].indexOf(c), false); });
      setTimeout(() => q.focus(), 50);
      this.fillLib(grid, extra, more);
    });
  },
  // v2.6.12: keyboard in the Library — arrows move the selection (in the search field only ↑/↓/PgUp/PgDn, ←/→ stay in the
  // text), Enter inserts the selected item, Home/End in the grid. Never acts for keys typed in another field.
  libSel: 0,
  libCols(grid) { const cs = getComputedStyle(grid).gridTemplateColumns; return Math.max(1, cs && cs !== 'none' ? cs.split(' ').length : 1); },
  libSelect(grid, i, focus) {
    const cells = [...grid.children].filter(c => c.tagName === 'BUTTON'); if (!cells.length) { this.libSel = -1; return; }
    i = Math.min(Math.max(0, i), cells.length - 1); this.libSel = i;
    cells.forEach((c, k) => { const on = k === i; c.classList.toggle('sel', on); c.setAttribute('aria-selected', on ? 'true' : 'false'); c.tabIndex = on ? 0 : -1; });
    const c = cells[i]; if (focus) c.focus({ preventScroll: true }); c.scrollIntoView({ block: 'nearest' });
  },
  libKey(e, grid, q) {
    const inSearch = e.target === q;
    const act = NyxUI.libShortcut({ key: e.key, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, drawerOpen: true, inSearch, typingElsewhere: false });
    if (!act || act === 'focus-search') return;
    if (inSearch && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return; // caret moves in the text
    const cells = [...grid.children].filter(c => c.tagName === 'BUTTON'); if (!cells.length) return;
    e.preventDefault(); e.stopPropagation();
    if (act === 'insert') { const c = cells[Math.max(0, Math.min(this.libSel, cells.length - 1))]; c?.click(); return; }
    const i = NyxUI.libGridMove(this.libSel, cells.length, this.libCols(grid), e.key, this.libCols(grid) * 4);
    this.libSelect(grid, i, !inSearch);
  },
  // «/» focuses the Library search (drawer open, nobody typing in another field)
  libSlash(e) {
    if (this.drawerKind !== 'library' || $('#drawer').hidden) return false;
    const q = $('#drawer .lib-search input'); if (!q) return false;
    const tgt = e.target; const typing = NyxUI.isTyping(tgt) || NyxUI.isTyping(document.activeElement) || !!(typeof Canvas !== 'undefined' && Canvas.editing);
    const act = NyxUI.libShortcut({ key: e.key, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, drawerOpen: true, inSearch: document.activeElement === q, typingElsewhere: typing && document.activeElement !== q });
    if (act !== 'focus-search') return false;
    e.preventDefault(); e.stopPropagation(); q.focus(); q.select(); return true;
  },
  async fillLib(grid, extra, more) {
    const tab = this.libTab; grid.innerHTML = '<div class="loading"></div>'; extra.innerHTML = ''; more.innerHTML = '';
    const Q = expandQuery(this.libQ);
    if (tab === 'emoji' || tab === 'stickers') {
      await loadScript('assets/data/emoji.js');
      // v2.6.12: compact chips with outline icons (mockup 05)
      const groups = [['all', 'layout-grid'], ['recent', 'clock'], [0, 'smile'], [1, 'user'], [3, 'paw-print'], [4, 'utensils'], [5, 'plane'], [6, 'trophy'], [7, 'lightbulb'], [8, 'heart'], [9, 'flag']];
      extra.append(h('div', { class: 'chips lib-chips' }, ...groups.map(([g, ic]) => h('button', { class: 'chip' + (String(this.libGroup) === String(g) ? ' on' : ''), 'data-lib-group': String(g), onclick: () => { this.libGroup = g; this.libSel = 0; this.fillLib(grid, extra, more); } }, h('span', { class: 'lc-i', 'aria-hidden': 'true', html: iconSvg(ic, 12) }), t('v2611.lg_' + g)))));
      let list = NYX_DATA.emoji;
      if (this.libGroup === 'recent') { const rec = Store.state.settings.recentEmoji || []; list = rec.map(c => list.find(x => x[0] === c)).filter(Boolean); }
      else if (this.libGroup !== 'all') list = list.filter(x => x[2] === this.libGroup);
      if (Q.length) list = list.filter(x => matchQ(Q, x[1] + ' ' + x[3]));
      this.pagedGrid(grid, more, list, (x) => {
        const b = tab === 'emoji' ? h('button', { class: 'emo-cell', title: x[1], draggable: 'true' }, x[0]) : h('button', { class: 'stk-cell', title: x[1], draggable: 'true', html: `<img loading="lazy" src="assets/twemoji/${x[4]}.svg" data-err="parent">` });
        const payload = tab === 'emoji' ? { type: 'emoji', char: x[0], w: 96, h: 96 } : { type: 'sticker', hex: x[4], w: 150, h: 150, sticker: true };
        b.onclick = () => { Features.addAtCenter(payload); this.recentEmoji(x[0]); };
        b.ondragstart = (e) => { e.dataTransfer.setData('nyx/item', JSON.stringify(payload)); this.recentEmoji(x[0]); };
        return b;
      }, tab === 'emoji' ? 320 : 160);
    } else if (tab === 'reactions') {
      grid.innerHTML = '';
      let i = 0; for (const txt of REACTIONS.filter(r => !Q.length || matchQ(Q, norm(r)))) for (const v of [0, 1, 2]) {
        const c = REACT_COLORS[(i++) % REACT_COLORS.length]; const payload = { type: 'reaction', text: txt, variant: v, color: c, w: 220, h: 110 };
        const b = h('button', { class: 'react-cell', draggable: 'true', html: `<div class="reaction r-${v}" style="--rc:${c}"><span>${esc(txt)}</span></div>` });
        b.onclick = () => Features.addAtCenter(payload); b.ondragstart = (e) => e.dataTransfer.setData('nyx/item', JSON.stringify(payload)); grid.append(b);
      }
      this.libCount(more, grid.children.length, grid.children.length);
      extra.append(h('button', { class: 'btn ghost sm', onclick: () => { const f = form([['text', LANG === 'el' ? t('panels.018') : 'Your text', 'text', '']]); this.modal(t('lib_reactions'), f.el, { ok: () => { const v = f.val().text.trim(); if (v) Features.addAtCenter({ type: 'reaction', text: v, variant: 1, color: '#ff3d6e', w: 240, h: 110 }); } }); } }, '+ ' + (LANG === 'el' ? t('panels.019') : 'Custom reaction')));
    } else if (tab === 'icons') {
      const packs = [['lucide', 'Lucide', 'assets/data/lucide.js'], ['tabler', 'Tabler', 'assets/data/tabler.js'], ['tablerFilled', 'Tabler Filled', 'assets/data/tablerFilled.js']];
      const p = packs.find(x => x[0] === this.iconPack); await Library.ensurePack(p[0]);
      extra.append(h('div', { class: 'chips' }, ...packs.map(([k, n]) => h('button', { class: 'chip' + (k === this.iconPack ? ' on' : ''), onclick: () => { this.iconPack = k; this.fillLib(grid, extra, more); } }, n + ' · ' + (NYX_DATA[k] ? Object.keys(NYX_DATA[k]).length : '…')))),
        h('div', { class: 'sw-row' }, ...PALETTE.slice(0, 1).concat(PALETTE.slice(4)).map(c => h('button', { class: 'sw' + (this.iconColor === c ? ' on' : ''), style: { '--c': c }, onclick: () => { this.iconColor = c; this.fillLib(grid, extra, more); } })), colorInput(this.iconColor, (c) => { this.iconColor = c; grid.style.color = c; })));
      grid.style.color = this.iconColor;
      const data = NYX_DATA[this.iconPack]; let list = Object.entries(data);
      if (Q.length) list = list.filter(([n, d]) => matchQ(Q, n.replace(/-/g, ' ') + ' ' + (d[1] || '')));
      const filled = this.iconPack === 'tablerFilled';
      this.pagedGrid(grid, more, list, ([n, d]) => {
        const payload = { type: 'icon', pack: this.iconPack, name: n, color: this.iconColor, w: 96, h: 96 };
        const b = h('button', { class: 'ico-cell', title: n, draggable: 'true', html: `<svg viewBox="0 0 24 24" width="26" height="26" fill="${filled ? 'currentColor' : 'none'}" stroke="${filled ? 'none' : 'currentColor'}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${d[0]}</svg>` });
        b.onclick = () => Features.addAtCenter({ ...payload, color: this.iconColor }); b.ondragstart = (e) => e.dataTransfer.setData('nyx/item', JSON.stringify({ ...payload, color: this.iconColor })); return b;
      }, 240);
    } else if (tab === 'memes') {
      extra.append(h('div', { class: 'row gap' }, h('button', { class: 'btn sm', onclick: () => Features.importMemes(false).then(() => this.fillLib(grid, extra, more)) }, iconSvg('image-plus', 15), ' ' + t('lib_import')), h('button', { class: 'btn ghost sm', onclick: () => Features.importMemes(true).then(() => this.fillLib(grid, extra, more)) }, iconSvg('folder-input', 15), ' ' + t('lib_import_folder'))),
        h('p', { class: 'muted small' }, LANG === 'el' ? t('panels.020') : 'Your own collection: add images/GIFs. Right-click = remove.'));
      let list = Store.state.library.memes; if (Q.length) list = list.filter(m => matchQ(Q, norm(m.name)));
      if (!list.length) { grid.innerHTML = `<div class="empty">🖼️<br>${LANG === 'el' ? t('panels.021') : 'No memes yet'}</div>`; this.libCount(more, 0, 0); return; }
      this.pagedGrid(grid, more, list.slice().reverse(), (m) => {
        const payload = { type: 'image', file: m.file, thumb: m.thumb, w: m.w || 320, h: m.h || 240, name: m.name };
        const b = h('button', { class: 'meme-cell', title: m.name, draggable: 'true', html: `<img loading="lazy" src="${esc(Store.media(m.thumb || m.file))}">` });
        b.onclick = () => Features.addAtCenter(payload); b.ondragstart = (e) => e.dataTransfer.setData('nyx/item', JSON.stringify(payload));
        b.oncontextmenu = (e) => { e.preventDefault(); Store.state.library.memes = Store.state.library.memes.filter(x => x !== m); Store.save(); b.remove(); };
        return b;
      }, 120);
    }
  },
  pagedGrid(grid, more, list, cell, page) {
    grid.innerHTML = ''; let i = 0;
    const add = () => { const frag = document.createDocumentFragment(); for (const end = Math.min(list.length, i + page); i < end; i++) { const c = cell(list[i]); c.setAttribute('role', 'gridcell'); c.tabIndex = -1; frag.append(c); } grid.append(frag); this.libCount(more, i, list.length); };
    add();
    if (grid.closest('#drawer') && list.length) this.libSelect(grid, Math.min(this.libSel > 0 ? this.libSel : 0, grid.children.length - 1), false); // v2.6.12: a visible selected item
    const body = $('#drawer-body'); body.onscroll = () => { if (i < list.length && body.scrollTop + body.clientHeight > body.scrollHeight - 300) add(); };
  },
  // v2.6.11: real counter — «shown of total» while more pages load on scroll, the exact total when all are shown
  libCount(el, shown, total) {
    if (!el) return; const nf = (n) => Number(n).toLocaleString(LANG === 'en' ? 'en-GB' : 'el-GR');
    el.dataset.shown = String(shown); el.dataset.total = String(total);
    // v2.6.12: compact «shown / total» like mockup 05 (real numbers), the full sentence in the tooltip
    const full = !total ? t('no_results') : shown < total ? t('v2611.lib_shown', { v0: nf(shown), v1: nf(total) }) : t('v2611.lib_total', { v0: nf(total) });
    el.textContent = !total ? t('no_results') : nf(shown) + ' / ' + nf(total); el.title = full; el.setAttribute('aria-label', full);
  },
  recentEmoji(c) { const S = Store.state.settings; S.recentEmoji = [c, ...(S.recentEmoji || []).filter(x => x !== c)].slice(0, 48); Store.save(); },

  // ---------- subscriptions ----------
  subs() {
    this.openDrawer('subs', `${iconSvg('credit-card', 20)} ${t('subs')}`, (body) => {
      const subs = Store.state.subs; const tot = Subs.totals();
      // v2.6.9.3: redesign (mockup 14/11) — «Αυτόν τον μήνα» = charges inside this month, paid / remaining + bar;
      // μέσος/μήνα, τον χρόνο, ενεργές; «Επόμενες χρεώσεις» with dates. Every amount from NyxCalc.subsSummary (code).
      body.append(Subs.heroEl());
      if (tot.cats.length) body.append(h('div', { class: 'catbar' }, ...tot.cats.map(([c, v, col]) => h('div', { style: { flex: v, background: col }, title: `${c}: ${Subs.money(v, tot.cur)}` }))), h('div', { class: 'chips small' }, ...tot.cats.map(([c, v, col]) => h('span', { class: 'chip' }, h('i', { class: 'dot', style: { background: col } }), `${c} ${Subs.money(v, tot.cur)}`))));
      body.append(h('div', { class: 'row gap' }, h('button', { class: 'btn', onclick: () => Subs.edit() }, iconSvg('plus', 16), ' ' + t('sub_add')), h('button', { class: 'btn ghost', onclick: () => Subs.toCanvas() }, iconSvg('layout-dashboard', 16), ' ' + t('sub_tocanvas'))));
      if (!subs.length) { body.append(h('div', { class: 'empty' }, '💳', h('p', {}, t('sub_empty'))), h('div', { class: 'preset-grid' }, ...SUB_PRESETS.slice(0, 12).map(p => h('button', { class: 'preset', style: { '--pc': p[2] }, onclick: () => Subs.edit(null, p) }, h('span', {}, p[3]), p[0])))); return; }
      const list = h('div', { class: 'sub-list' });
      for (const s of Subs.sorted()) {
        const days = Subs.daysTo(s.next);
        list.append(h('div', { class: 'sub-row' + (s.active === false ? ' off' : '') + (days != null && days <= (s.remindDays ?? 2) && days >= 0 ? ' soon' : ''), style: { '--pc': s.color || 'var(--accent)' } },
          h('div', { class: 'sub-ico' }, s.icon || s.name[0]),
          h('div', { class: 'sub-main' }, h('div', { class: 'sub-name' }, s.name, s.category ? h('span', { class: 'tag' }, s.category) : null), h('div', { class: 'sub-meta' }, `${Subs.money(s.price, s.currency)} · ${t('cyc_' + (s.cycle || 'monthly'))}`), h('div', { class: 'sub-next' }, s.next ? `${fmtDay(s.next)} · ${relDays(s.next)}` : '—')),
          h('div', { class: 'sub-acts' },
            s.url ? h('button', { class: 'icon-btn', title: t('sub_open'), html: iconSvg('external-link', 16), onclick: () => API?.openExternal(s.url) }) : null,
            h('button', { class: 'icon-btn', title: LANG === 'el' ? t('panels.023') : 'Paid → next period', html: iconSvg('check-check', 16), onclick: () => { Store.change(() => { s.next = Subs.addCycle(s.next || new Date().toISOString().slice(0, 10), s.cycle); }); this.refreshDrawer(); Features.refreshSubsCards(); toast('✓ ' + s.name + ' → ' + fmtDay(s.next)); } }),
            h('button', { class: 'icon-btn', title: t('edit'), html: iconSvg('pencil', 16), onclick: () => Subs.edit(s) }))));
      }
      body.append(h('div', { class: 'subx-lab subx-all' }, t('v2693.all')), list);
    });
  },
  // ---------- reminders ----------
  reminders() {
    this.openDrawer('reminders', `${iconSvg('bell', 20)} ${t('reminders')}`, (body) => {
      body.append(h('div', { class: 'row gap' }, h('button', { class: 'btn', onclick: () => Features.newReminderCard() }, iconSvg('alarm-clock-plus', 16), ' ' + (LANG === 'el' ? t('panels.024') : 'New reminder')), h('button', { class: 'btn ghost', onclick: () => Features.newCountdown() }, iconSvg('timer', 16), ' ' + t('ins_countdown'))));
      const all = []; for (const b of Store.state.boards) for (const it of b.items) if (it.reminder?.at) all.push({ it, b });
      all.sort((a, c) => (b2n(a.it.reminder.on) - b2n(c.it.reminder.on)) || new Date(a.it.reminder.at) - new Date(c.it.reminder.at));
      if (!all.length) { body.append(h('div', { class: 'empty' }, '⏰', h('p', {}, t('rem_none')))); }
      const list = h('div', { class: 'rem-list' });
      for (const { it, b } of all) {
        const r = it.reminder; const past = new Date(r.at) < Date.now();
        const tg = h('input', { type: 'checkbox', class: 'toggle', checked: r.on ? true : null, onchange: (e) => { Store.change(() => { r.on = e.target.checked; }); Items.nodes.get(it.id) && Items.mount(it); } });
        list.append(h('div', { class: 'rem-row' + (r.on ? '' : ' off') + (past && r.on ? ' past' : '') },
          h('div', { class: 'rem-time' }, h('b', {}, new Date(r.at).toLocaleTimeString(LANG === 'el' ? 'el-GR' : 'en-GB', { hour: '2-digit', minute: '2-digit' })), h('span', {}, fmtDay(r.at))),
          h('div', { class: 'rem-main', onclick: () => { this.closeDrawer(); Canvas.focusItem(it.id); } }, h('div', { class: 'rem-text' }, r.msg || Features.itemTitle(it)), h('div', { class: 'muted small' }, `${b.emoji || ''} ${b.name} · ${t('rep_' + (r.repeat || 'none'))} · 🔊 ${SOUNDS[r.sound] || r.sound || ''}`)),
          h('button', { class: 'icon-btn', title: t('edit'), html: iconSvg('pencil', 15), onclick: () => Features.reminderModal(it) }), tg, h('button', { class: 'icon-btn rem-x', title: t('v23.rem_remove'), 'aria-label': t('v23.rem_remove'), html: iconSvg('x', 15), onclick: (e) => { e.stopPropagation(); Features.removeReminder(it, b.id); } })));
      }
      body.append(list);
      body.append(Agenda.section());
      const subsSoon = Store.state.subs.filter(s => s.active !== false && s.next && Subs.daysTo(s.next) <= 7 && Subs.daysTo(s.next) >= 0);
      if (subsSoon.length) body.append(h('h4', {}, '💳 ' + (LANG === 'el' ? t('panels.025') : 'Renewals (7 days)')), ...subsSoon.map(s => h('div', { class: 'rem-row' }, h('div', { class: 'rem-time' }, h('b', {}, s.icon || '💳')), h('div', { class: 'rem-main' }, h('div', { class: 'rem-text' }, s.name), h('div', { class: 'muted small' }, `${Subs.money(s.price, s.currency)} · ${relDays(s.next)}`)))));
    });
  },
  // ---------- themes ----------
  themes() {
    this.openDrawer('themes', `${iconSvg('palette', 20)} ${t('themes')}`, (body) => {
      const S = Store.state.settings; const grid = h('div', { class: 'theme-grid' }); let lastSpace = null;
      for (const th of [...THEMES.filter(x => x.space), ...THEMES.filter(x => !x.space)]) {
        if (!!th.space !== lastSpace) { lastSpace = !!th.space; grid.append(h('h4', { class: 'tg-head' }, th.space ? '🌌 ' + t('v23.th_space') : '🎨 ' + t('v23.th_other'))); }
        const v = th.vars;
        const card = h('button', { class: 'theme-card' + (S.theme === th.id ? ' on' : ''), style: { '--tb': v.bg, '--tb2': v.bg2, '--tp': v['panel-solid'], '--ta': v.accent, '--ta2': v.accent2, '--tt': v.text, '--tr': v.radius, '--tf': v['font-ui'] }, onclick: () => { S.theme = th.id; Theme.apply(S); Store.save(); this.refreshDrawer(); } },
          h('div', { class: 'tc-prev' + (th.fx.kind ? ' k-' + th.fx.kind : '') }, h('div', { class: 'tc-bar' }, h('i'), h('i'), h('i')), h('div', { class: 'tc-dock' }), h('div', { class: 'tc-card c1' }), h('div', { class: 'tc-card c2' }), h('div', { class: 'tc-dot' })),
          h('div', { class: 'tc-name' }, th.name), h('div', { class: 'tc-desc' }, th.desc));
        grid.append(card);
      }
      body.append(grid);
      if (typeof UIStyle !== 'undefined') body.append(UIStyle.section()); // v2.6.11: optional panel styles
      const G = S.custom ||= {}; const C = { ...((S.customs ||= {})[S.theme] || {}), font: G.font, icon: G.icon }; const cur = Theme.current;
      const set = (k, v) => { if (k === 'font' || k === 'icon') G[k] = v; else { const tc = S.customs[S.theme] ||= {}; tc[k] = v; } C[k] = v; Theme.apply(S); Store.save(); };
      const colorRow = (k, label) => { const inp = h('input', { type: 'color', value: toHex(C[k] || cur.vars[k === 'panel' ? 'panel-solid' : k]) }); inp.oninput = () => set(k, inp.value); return h('label', { class: 'cfield' }, inp, h('span', {}, label)); };
      const slider = (k, label, min, max, step, def) => { const inp = h('input', { type: 'range', min, max, step, value: C[k] ?? def }); inp.oninput = () => set(k, +inp.value); return h('label', { class: 'sfield' }, h('span', {}, label), inp); };
      body.append(h('h4', {}, '🎛️ ' + t('th_custom')),
        h('div', { class: 'cgrid' }, colorRow('accent', t('th_accent')), colorRow('accent2', t('th_accent2')), colorRow('bg', t('th_bg')), colorRow('panel', t('th_panel')), colorRow('text', t('th_text')), colorRow('card', t('th_card'))),
        slider('radius', t('th_radius'), 0, 28, 1, parseInt(cur.vars.radius)), slider('blur', t('th_blur'), 0, 40, 1, parseInt(cur.vars.blur)), slider('glow', t('th_glow'), 0, 1, 0.05, +cur.vars.glow), slider('stars', t('th_stars'), 0, 1, 0.05, cur.fx.stars),
        selField(t('th_grid'), [['', '—'], ['dots', LANG === 'el' ? t('panels.026') : 'Dots'], ['lines', LANG === 'el' ? t('panels.027') : 'Lines'], ['none', LANG === 'el' ? t('panels.028') : 'None']], C.grid || '', (v) => set('grid', v || undefined)),
        selField(t('th_font'), [['', '—'], ...UI_FONTS.map(f => [f, f])], C.font || '', (v) => set('font', v || undefined)),
        selField(t('th_icons'), [['', '—'], ['thin', 'Thin'], ['regular', 'Regular'], ['bold', 'Bold'], ['duo', 'Duotone']], C.icon || '', (v) => set('icon', v || undefined)),
        h('button', { class: 'btn ghost', onclick: () => { S.custom = {}; if (S.customs) delete S.customs[S.theme]; Theme.apply(S); Store.save(); this.refreshDrawer(); } }, iconSvg('rotate-ccw', 15), ' ' + t('th_reset')));
    });
  },
  // ---------- settings ----------
  settings(tab) {
    if (tab) this.setTab = tab; const tb = this.setTab || 'general';
    if (tab) this.drawerKind = null;
    this.openDrawer('settings', `${iconSvg('settings-2', 20)} ${t('settings')}`, (body) => {
      body.append(h('div', { class: 'seg tabs3 set-tabs' }, ...[['general', t('set21.tab_general')], ['assistant', t('v267.set_assistant')], ['speech', t('v267.set_speech')], ['update', t('set21.tab_update')], ['tools', t('set21.tab_tools')]].map(([k, l]) => h('button', { class: tb === k ? 'on' : '', 'data-settab': k, onclick: () => { this.setTab = k; this.drawerKind = null; this.settings(); } }, l))));
      if (tb === 'update' || tb === 'tools') return loadScript('js/v2/settings-v21.js').then(() => tb === 'update' ? Settings21.update(body) : Settings21.tools(body)); // lazy: only when the tab opens
      if (tb === 'assistant') return body.append(h('h4', {}, t('v267.set_assistant')), Hub.assistantForm());
      if (tb === 'speech') return body.append(h('h4', {}, t('v267.set_speech')), Hub.speechForm());
      const S = Store.state.settings; const sv = () => Store.save();
      const chk = (label, val, cb) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', class: 'toggle', checked: val ? true : null, onchange: (e) => cb(e.target.checked) }), h('span', {}, label));
      body.append(
        selField(t('settings_lang'), [['el', t('panels.029')], ['en', 'English']], S.lang, (v) => { S.lang = v; sv(); App.setLang(v); this.refreshDrawer(); }),
        selField(t('set_wheel'), [['zoom', t('wheel_zoom')], ['scroll', t('wheel_scroll')]], S.wheel, (v) => { S.wheel = v; sv(); }),
        h('label', { class: 'sfield' }, h('span', {}, t('set_zoomspeed')), h('input', { type: 'range', min: .3, max: 2.5, step: .1, value: S.zoomSpeed || 1, oninput: (e) => { S.zoomSpeed = +e.target.value; sv(); } })),
        chk(t('set_snap'), S.snap, (v) => { S.snap = v; sv(); }),
        chk(t('set_anim'), S.anim !== false, (v) => { S.anim = v; sv(); Theme.apply(S); }),
        selField(t('v2711.lite'), [['auto', t('v2711.lite_auto')], ['always', t('v2711.lite_always')], ['never', t('v2711.lite_never')]], NyxLite.mode(), (v) => { S.liteMode = v; sv(); NyxLite.apply(); }), // v2.7.1.1
        h('p', { class: 'muted small set-lite-hint' }, t('v2711.lite_hint')),
        chk(t('set_tray'), S.closeToTray !== false, (v) => { S.closeToTray = v; sv(); }),
        chk(t('set_login'), Store.info.loginItem, async (v) => { if (API) Store.info.loginItem = await API.setLogin(v); }),
        selField(LANG === 'el' ? t('panels.030') : 'Subscription sound', Object.entries(SOUNDS), S.subSound || 'soft', (v) => { S.subSound = v; sv(); playSound(v); }),
        h('label', { class: 'field' }, h('span', {}, t('set_tmdb')), h('input', { class: 'inp', value: S.tmdbKey || '', placeholder: 'v3 API key', onchange: (e) => { S.tmdbKey = e.target.value.trim(); sv(); } })),
        h('h4', {}, '💾 ' + t('set_backup')),
        h('div', { class: 'row gap wrap' }, h('button', { class: 'btn', onclick: () => Features.exportBackup() }, iconSvg('download', 15), ' ' + t('set_export')), h('button', { class: 'btn ghost', onclick: () => Features.importBackup() }, iconSvg('upload', 15), ' ' + t('set_import')), h('button', { class: 'btn ghost', onclick: () => API?.openDataFolder() }, iconSvg('folder-open', 15), ' ' + t('set_folder'))),
        h('p', { class: 'muted small' }, (LANG === 'el' ? t('panels.031') : 'Autosave on every change + daily backup (14 days) in ') + (Store.info.userData || 'localStorage')),
        h('h4', {}, '⌨️ ' + t('set_keys')), h('div', { class: 'keys' }, ...KEYS.map(([k, d]) => h('div', { class: 'krow' }, h('kbd', {}, k), h('span', {}, d)))),
        h('h4', {}, t('hub.035')), Hub.dataLocBox(),
        h('p', { class: 'muted small' }, `Nyx Canvas v${Store.info.version || 'dev'} · Emoji/stickers: Twemoji (CC-BY 4.0) · Icons: Lucide (ISC), Tabler (MIT) · Fonts: OFL`));
    });
  },
  // ---------- command palette ----------
  palette() {
    const P = $('#palette'); const q = $('#pal-q'); const list = $('#pal-list');
    P.hidden = false; q.value = ''; q.placeholder = t('search_ph') + '…'; q.focus(); let idx = 0; let results = [];
    const cmds = () => [
      ['plus-square', t('new_board'), 'Ctrl+T', () => App.newBoard()], ['type', t('t_text'), 'T', () => { const c = Canvas.center(); Tools.createText(c.x, c.y); }], ['sticky-note', t('t_sticky'), 'N', () => Features.addAtCenter(stickyDefaults(), true)],
      ['smile-plus', t('t_library'), 'Ctrl+E', () => this.library()], ['image', t('ins_image'), '', () => Features.pickAndAdd('image')], ['video', t('ins_video'), '', () => Features.pickAndAdd('video')], ['music', t('ins_audio'), '', () => Features.pickAndAdd('audio')], ['link', t('ins_link'), '', () => Features.addLink()],
      ['timer', t('ins_countdown'), '', () => Features.newCountdown()], ['tv', t('ins_show'), '', () => Features.showSearch()], ['radar', t('ins_tracker'), '', () => Features.newTracker()], ['alarm-clock', t('ins_reminder'), '', () => Features.newReminderCard()], ['mic', t('ins_voice'), 'Ctrl+Shift+R', () => Voice.toggle()],
      ['credit-card', t('subs'), '', () => this.subs()], ['bell', t('reminders'), '', () => this.reminders()], ['palette', t('themes'), '', () => this.themes()], ['settings-2', t('settings'), '', () => this.settings()], ['app-window', t('widget'), 'Ctrl+Alt+N', () => API?.toggleWidget()],
      ['maximize', t('zoom_fit'), 'Shift+1', () => Canvas.fit()], ['download', t('set_export'), '', () => Features.exportBackup()], ['languages', LANG === 'el' ? 'English' : t('panels.029'), '', () => { Store.state.settings.lang = LANG === 'el' ? 'en' : 'el'; App.setLang(Store.state.settings.lang); Store.save(); }],
      ...THEMES.map(th => ['palette', (LANG === 'el' ? t('panels.032') : 'Theme: ') + th.name, '', () => { Store.state.settings.theme = th.id; Theme.apply(Store.state.settings); Store.save(); }]),
    ];
    const render = () => {
      const Q = expandQuery(q.value); results = [];
      for (const c of cmds()) if (!Q.length || matchQ(Q, norm(c[1]))) results.push({ kind: 'cmd', icon: c[0], title: c[1], sub: c[2], run: c[3] });
      if (Q.length) {
        for (const b of Store.state.boards) {
          if (matchQ(Q, norm(b.name))) results.push({ kind: 'board', icon: 'layout-grid', title: (b.emoji || '') + ' ' + b.name, sub: t('new_board').split(' ').pop(), run: () => App.switchBoard(b.id) });
          for (const it of b.items) { const txt = Features.searchText(it); if (txt && matchQ(Q, norm(txt))) results.push({ kind: 'item', icon: TYPE_ICON[it.type] || 'square', title: Features.itemTitle(it), sub: `${b.emoji || ''} ${b.name}`, run: () => Canvas.focusItem(it.id) }); }
        }
        for (const s of Store.state.subs) if (matchQ(Q, norm(s.name + ' ' + (s.notes || '') + ' ' + (s.category || '')))) results.push({ kind: 'sub', icon: 'credit-card', title: s.name, sub: Subs.money(s.price, s.currency), run: () => Subs.edit(s) });
      }
      results = results.slice(0, 80); idx = 0;
      if (q.value && results.filter(r => r.kind !== 'cmd').length === 0 && /^https?:\/\//.test(q.value.trim())) results.unshift({ kind: 'cmd', icon: 'link', title: (LANG === 'el' ? t('panels.033') : 'Add link: ') + q.value.trim(), run: () => Features.addLinkUrl(q.value.trim()) });
      list.innerHTML = '';
      if (!results.length) list.append(h('div', { class: 'empty small' }, t('no_results')));
      const order = q.value ? ['item', 'board', 'sub', 'cmd'] : ['cmd']; results.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
      results.forEach((r, i) => list.append(h('div', { class: 'pal-row' + (i === idx ? ' on' : ''), 'data-i': i, onclick: () => go(i), onpointermove: () => mark(i) }, h('span', { class: 'pi', html: iconSvg(r.icon, 17) }), h('span', { class: 'pt' }, r.title), r.sub ? h('span', { class: 'ps' }, r.sub) : null)));
    };
    const mark = (i) => { idx = i; $$('.pal-row', list).forEach((r, j) => r.classList.toggle('on', j === i)); $$('.pal-row', list)[i]?.scrollIntoView({ block: 'nearest' }); };
    const go = (i) => { const r = results[i]; this.closePalette(); r && r.run(); };
    q.oninput = render; render();
    q.onkeydown = (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); mark(Math.min(results.length - 1, idx + 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); mark(Math.max(0, idx - 1)); } else if (e.key === 'Enter') { e.preventDefault(); go(idx); } else if (e.key === 'Escape') this.closePalette(); e.stopPropagation(); };
    P.onpointerdown = (e) => { if (e.target === P) this.closePalette(); };
  },
  closePalette() { $('#palette').hidden = true; $('#viewport').focus({ preventScroll: true }); },
  // ---------- modal ----------
  modal(title, bodyEl, opts = {}) {
    const M = $('#modal'); $('#modal-title').innerHTML = title; const B = $('#modal-body'); B.innerHTML = ''; B.append(bodyEl);
    M.querySelector('.modal-box').classList.toggle('wide', !!opts.wide);
    if (opts.ok || opts.extra) {
      const foot = h('div', { class: 'modal-foot' }, ...(opts.extra || []), h('div', { class: 'grow' }));
      if (opts.ok) foot.append(h('button', { class: 'btn ghost', onclick: () => close() }, t('cancel')), h('button', { class: 'btn primary', onclick: async () => { if ((await opts.ok()) !== false) close(); } }, opts.okLabel || t('save')));
      B.append(foot);
    }
    const tok = M._tok = (M._tok || 0) + 1; let closed = false;
    M.hidden = false; requestAnimationFrame(() => M.classList.add('in'));
    const close = () => { if (closed) return; closed = true; if (M._tok !== tok) { opts.onClose && opts.onClose(); return; } M.classList.remove('in'); setTimeout(() => { if (M._tok === tok) M.hidden = true; }, 160); opts.onClose && opts.onClose(); $('#viewport').focus({ preventScroll: true }); };
    $('#modal-close').onclick = close; M.onpointerdown = (e) => { if (e.target === M) close(); };
    M.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); if (e.key === 'Enter' && opts.ok && e.target.tagName === 'INPUT') { e.preventDefault(); M.querySelector('.btn.primary')?.click(); } };
    setTimeout(() => B.querySelector('input:not([type=color]):not([type=checkbox]),textarea,select')?.focus(), 60);
    return close;
  },
  lightbox(it) {
    const img = h('img', { src: Store.media(it.file), class: 'lightbox-img' });
    this.modal(esc(it.name || ''), h('div', { class: 'lightbox' }, img), { wide: true, extra: [h('button', { class: 'btn ghost', onclick: () => API?.openMedia(it.file) }, iconSvg('external-link', 15), ' ' + t('open'))], ok: () => true, okLabel: t('close') });
  },
  // ---------- context menu ----------
  menu(x, y, rows) {
    const m = $('#ctxmenu'); m.innerHTML = ''; delete m.dataset.menu; m.removeAttribute('role'); // v2.6.12.1: a new menu never keeps the «+N ▾» look
    for (const r of rows) {
      if (r === '-') { m.append(h('div', { class: 'msep' })); continue; }
      const [ic, label, fn, cls] = r; if (r[3] && r[3].nodeType) { m.append(r[3]); continue; }
      m.append(h('button', { class: 'mi ' + (cls || ''), html: `${ic}<span>${esc(label)}</span>${r[4] ? `<kbd>${r[4]}</kbd>` : ''}`, onclick: () => { this.closeMenu(); fn(); } }));
    }
    m.hidden = false; const rr = m.getBoundingClientRect();
    m.style.left = Math.min(x, innerWidth - rr.width - 8) + 'px'; m.style.top = Math.min(y, innerHeight - rr.height - 8) + 'px';
    setTimeout(() => { const off = (e) => { if (!m.contains(e.target)) { this.closeMenu(); removeEventListener('pointerdown', off, true); } }; addEventListener('pointerdown', off, true); }, 0);
  },
  closeMenu() { $('#ctxmenu').hidden = true; },
  paperKindSub(at, existing) {
    const cur = existing ? (existing.paperKind || '') : (Store.state.settings.stickyKind || '');
    const kids = PAPER_KINDS.map(([k, ic]) => h('button', {
      class: 'chip' + (cur === k ? ' on' : ''),
      title: t('v23.pk_' + (k || 'classic')),
      'data-pk': k || 'classic',
      onclick: () => {
        this.closeMenu();
        if (existing) {
          Store.change(() => { if (k) existing.paperKind = k; else delete existing.paperKind; });
          Items.mount(existing); Canvas.drawSel(); Minimap.drawSoon();
        } else {
          Store.state.settings.stickyKind = k; Store.save();
          const p = at || Canvas.center();
          Features.addAt(stickyDefaults({ paperKind: k }), p.x, p.y, true);
        }
      },
    }, iconSvg(ic, 14), ' ' + t('v23.pk_' + (k || 'classic'))));
    return h('div', { class: 'msub pk-sub' }, h('span', {}, t('v23.paper_kind') + ':'), ...kids);
  },
  ctx(e) {

    const node = e.target.closest('.item'); const p = Canvas.s2w(e.clientX, e.clientY); const I = (n) => iconSvg(n, 15);
    if (!node) {
      return this.menu(e.clientX, e.clientY, [
        [I('clipboard-paste'), t('paste'), () => Clip.paste(p), '', 'Ctrl+V'], '-',
        [I('type'), t('t_text'), () => Tools.createText(p.x, p.y)], [I('sticky-note'), t('t_sticky'), () => Features.addAt(stickyDefaults(), p.x, p.y, true)], ['', '', null, this.paperKindSub(p)],
        [I('smile-plus'), t('t_library'), () => this.library()], [I('image'), t('ins_image'), () => Features.pickAndAdd('image', p)], [I('timer'), t('ins_countdown'), () => Features.newCountdown(p)], [I('alarm-clock'), t('ins_reminder'), () => Features.newReminderCard(p)], [I('tv'), t('ins_show'), () => Features.showSearch(p)], '-',
        [I('maximize'), t('zoom_fit'), () => Canvas.fit(), '', 'Shift+1'], [I('box-select'), LANG === 'el' ? t('panels.034') : 'Select all', () => Canvas.select(Store.items().map(i => i.id)), '', 'Ctrl+A']]);
    }
    const id = node.dataset.id; if (!Canvas.sel.has(id)) Canvas.select([id]); const items = Canvas.selItems(); const it = items[0]; const one = items.length === 1;
    const rows = [];
    if (one && ['text', 'sticky', 'shape', 'reminder'].includes(it.type)) rows.push([I('pencil'), t('edit'), () => Canvas.edit(it.id), '', '2×Click']);
    if (one && it.type === 'sticky') rows.push(['', '', null, this.paperKindSub(null, it)]);
    if (one && ['countdown', 'show', 'tracker', 'link', 'subs'].includes(it.type)) rows.push([I('pencil'), t('edit'), () => Features.editItem(it)]);
    if (one && ['image', 'video', 'audio', 'file'].includes(it.type)) rows.push([I('external-link'), t('open'), () => API?.openMedia(it.file)]);
    if (one && it.type === 'image') rows.push([I('smile'), LANG === 'el' ? t('panels.035') : 'Save to my memes', () => { Store.state.library.memes.push({ file: it.file, thumb: it.thumb, name: it.name || 'meme', w: it.w, h: it.h }); Store.save(); toast('🖼️ ✓'); }]);
    if (one) rows.push([I('alarm-clock'), t('rem_set') + '…', () => Features.reminderModal(it)]);
    rows.push([I(items.every(i => i.pinned) ? 'pin-off' : 'pin'), items.every(i => i.pinned) ? t('unpin') : t('pin'), () => Actions.togglePin()]);
    rows.push('-', [I('copy'), t('copy'), () => Clip.copy(), '', 'Ctrl+C'], [I('copy-plus'), t('duplicate'), () => Actions.duplicate(), '', 'Ctrl+D'],
      [I('bring-to-front'), t('front'), () => Actions.zorder(1), '', ']'], [I('send-to-back'), t('back'), () => Actions.zorder(-1), '', '['],
      [I(items.every(i => i.locked) ? 'lock-open' : 'lock'), items.every(i => i.locked) ? t('unlock') : t('lock'), () => Actions.toggleLock(), '', 'Ctrl+L']);
    if (items.length > 1) rows.push([I('group'), t('group'), () => Actions.group(), '', 'Ctrl+G']);
    if (items.some(i => i.group)) rows.push([I('ungroup'), t('ungroup'), () => Actions.ungroup(), '', 'Ctrl+Shift+G']);
    if (Store.state.boards.length > 1) rows.push(['', '', null, h('div', { class: 'msub' }, h('span', {}, LANG === 'el' ? t('panels.036') : 'Move to:'), ...Store.state.boards.filter(b => b.id !== Store.state.active).map(b => h('button', { class: 'chip', onclick: () => { this.closeMenu(); Actions.moveTo(b); } }, (b.emoji || '') + ' ' + b.name)))]);
    if (window.V2Ctx) V2Ctx.item(rows, items, I);
    rows.push('-', [I('trash-2'), t('del'), () => Actions.del(), 'danger', 'Del']);
    this.menu(e.clientX, e.clientY, rows);
  },
  insertMenu(anchor) {
    const r = anchor.getBoundingClientRect(); const I = (n) => iconSvg(n, 16);
    this.menu(r.right + 10, r.top - 120, [
      [I('image'), t('ins_image'), () => Features.pickAndAdd('image')], [I('video'), t('ins_video'), () => Features.pickAndAdd('video')], [I('music'), t('ins_audio'), () => Features.pickAndAdd('audio')], [I('paperclip'), t('ins_file'), () => Features.pickAndAdd('any')], [I('link'), t('ins_link'), () => Features.addLink()], '-',
      [I('timer'), t('ins_countdown'), () => Features.newCountdown()], [I('tv'), t('ins_show'), () => Features.showSearch()], [I('alarm-clock'), t('ins_reminder'), () => Features.newReminderCard()], [I('mic'), t('ins_voice'), () => Voice.toggle()], '-',
      [I('credit-card'), t('ins_subs'), () => Subs.toCanvas()], [I('radar'), t('ins_tracker'), () => Features.newTracker()], [I('frame'), t('ins_frame'), () => { const c = Canvas.center(); Features.addAt({ type: 'frame', w: 640, h: 420, title: LANG === 'el' ? t('items.007') : 'Frame', z: 0 }, c.x, c.y); }],
      '-', [I('layout-grid'), t('v270.ins_widget'), () => Widgets.gallery(), 'ins-widget']]); // v2.7.0: «Widget…» opens the gallery (mockup 09)
  },
  // ---------- contextual style bar ----------
  hideStylebar() { $('#stylebar').hidden = true; },
  stylebar() {
    const bar = $('#stylebar'); const items = Canvas.selItems();
    if (!items.length || Tools.cur !== 'select') { bar.hidden = true; return; }
    bar.innerHTML = ''; const I = (n) => iconSvg(n, 17); const one = items.length === 1 ? items[0] : null; const types = new Set(items.map(i => i.type));
    // v2.3: while typing, font/size/align apply live to the text being edited — no re-mount, focus & caret stay, keep typing
    const apply = (fn) => {
      const ed = Canvas.editing && items.length === 1 && items[0].id === Canvas.editing ? items[0] : null;
      if (ed) {
        const tx = Items.el(ed)?.querySelector('.txt'); const sel = getSelection(); const rng = sel.rangeCount && tx?.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : this._edRange;
        fn(ed); // part of the edit's undo step (Canvas.edit began it, endEdit commits)
        if (tx) { tx.style.fontFamily = `'${ed.font || 'Inter'}'`; tx.style.fontSize = (ed.size || 18) + 'px'; if (ed.type !== 'shape') tx.style.textAlign = ed.align || 'left'; if (ed.type === 'text') tx.style.background = ed.bg || ''; }
        const v = bar.querySelector('.sb-val'); if (v) v.textContent = String(ed.size || 18);
        const al = bar.querySelector('[data-k=align]'); if (al) al.innerHTML = I(({ left: 'align-left', center: 'align-center', right: 'align-right' })[ed.align || 'left']);
        if (tx) { tx.focus({ preventScroll: true }); if (rng) { sel.removeAllRanges(); sel.addRange(rng); } }
        Canvas.drawSel(); return;
      }
      Store.change(() => items.forEach(fn)); items.forEach(i => Items.mount(i)); Canvas.drawSel(); Minimap.drawSoon();
    };
    if (Canvas.editing && !this._edTrack) { this._edTrack = true; document.addEventListener('selectionchange', () => { const s = getSelection(); if (Canvas.editing && s.rangeCount && s.anchorNode?.parentElement?.closest?.('.editing .txt')) this._edRange = s.getRangeAt(0).cloneRange(); }); }
    const btn = (ic, tip, fn, on) => h('button', { class: 'sb' + (on ? ' on' : ''), title: tip, html: I(ic), onpointerdown: (e) => e.preventDefault(), onclick: fn });
    const colorKey = (i) => ({ sticky: 'paper', shape: 'stroke', arrow: 'stroke', line: 'stroke', ink: 'color', frame: 'color', icon: 'color', countdown: 'color', reaction: 'color', text: 'color' })[i.type];
    const ck = items.map(colorKey).filter(Boolean);
    if (Canvas.editing) {
      const ex = (cmd, v) => () => { document.execCommand(cmd, false, v); };
      bar.append(btn('bold', 'Bold', ex('bold')), btn('italic', 'Italic', ex('italic')), btn('underline', 'Underline', ex('underline')), btn('strikethrough', 'Strike', ex('strikeThrough')), btn('list', 'List', ex('insertUnorderedList')), btn('list-checks', 'Checklist', () => document.execCommand('insertText', false, '☐ ')), btn('highlighter', 'Mark', ex('hiliteColor', '#ffe14d55')), h('div', { class: 'sep' }),
        ...PALETTE.slice(0, 1).concat(PALETTE.slice(4, 13)).map(c => h('button', { class: 'sw', style: { '--c': c }, onpointerdown: (e) => e.preventDefault(), onclick: ex('foreColor', c) })));
    } else if (ck.length) {
      const cur = one ? one[colorKey(one)] : null; const pal = types.has('sticky') && types.size === 1 ? STICKY : PALETTE;
      const sw = h('button', { class: 'sb swatch', title: t('color'), style: { '--c': cur || 'var(--accent)' } }, h('i'));
      sw.onclick = () => this.pop(sw, h('div', { class: 'sw-row wrap' }, ...pal.map(c => h('button', { class: 'sw', style: { '--c': c }, onclick: () => apply(i => { const k = colorKey(i); if (k) i[k] = c; }) })), colorInput(cur, (c) => apply(i => { const k = colorKey(i); if (k) i[k] = c; }))));
      bar.append(sw);
    }
    if (!Canvas.editing && types.size === 1 && types.has('sticky')) { const pk = h('button', { class: 'sb', title: t('v23.paper_kind'), html: I('layers') }); pk.onclick = () => this.pop(pk, h('div', { class: 'sw-row wrap pk-row' }, ...PAPER_KINDS.map(([k, ic]) => h('button', { class: 'ob' + ((one?.paperKind || '') === k ? ' on' : ''), title: t('v23.pk_' + (k || 'classic')), html: iconSvg(ic, 18), onclick: () => apply(i => { if (k) i.paperKind = k; else delete i.paperKind; }) })))); bar.append(pk); }
    if (!Canvas.editing && types.has('shape')) { const fb = h('button', { class: 'sb', title: t('fill'), html: I('paint-bucket') }); fb.onclick = () => this.pop(fb, h('div', { class: 'sw-row wrap' }, h('button', { class: 'sw none', onclick: () => apply(i => { if (i.type === 'shape') i.fill = ''; }) }), ...PALETTE.map(c => h('button', { class: 'sw', style: { '--c': c }, onclick: () => apply(i => { if (i.type === 'shape') i.fill = c + '55'; }) })), ...PALETTE.slice(4).map(c => h('button', { class: 'sw solid', style: { '--c': c }, onclick: () => apply(i => { if (i.type === 'shape') i.fill = c; }) })))); bar.append(fb); }
    const hasText = [...types].some(x => ['text', 'sticky', 'shape', 'reminder'].includes(x));
    if (hasText) {
      const fsel = h('select', { class: 'sb-sel', title: t('font'), onchange: (e) => apply(i => { if ('html' in i || i.type === 'text') i.font = e.target.value; }) }, ...FONTS.map(([f, n]) => h('option', { value: f, selected: one && (one.font || 'Inter') === f ? true : null, style: { fontFamily: `'${f}'` } }, n)));
      bar.append(h('div', { class: 'sep' }), fsel, btn('a-arrow-down', t('size') + ' −', () => apply(i => { i.size = Math.max(8, Math.round((i.size || 18) / 1.15)); })), h('span', { class: 'sb-val' }, one ? String(one.size || 18) : ''), btn('a-arrow-up', t('size') + ' +', () => apply(i => { i.size = Math.min(400, Math.round((i.size || 18) * 1.15)); })),
        (() => { const b = btn(({ left: 'align-left', center: 'align-center', right: 'align-right' })[one?.align || 'left'], 'Align', () => apply(i => { i.align = ({ left: 'center', center: 'right', right: 'left' })[i.align || 'left']; })); b.dataset.k = 'align'; return b; })());
      if (types.has('text')) bar.append(btn('square-dashed', LANG === 'el' ? t('panels.037') : 'Text background', () => apply(i => { if (i.type === 'text') i.bg = i.bg ? '' : 'var(--card)'; }), one?.bg));
    }
    if (types.has('arrow') || types.has('line')) bar.append(h('div', { class: 'sep' }), btn('move-horizontal', LANG === 'el' ? t('panels.038') : 'Both ends', () => apply(i => { i.both = !i.both; }), one?.both), btn('spline', LANG === 'el' ? t('panels.039') : 'Curve', () => apply(i => { i.curve = !i.curve; }), one?.curve), btn('ellipsis', LANG === 'el' ? t('panels.040') : 'Dashed', () => apply(i => { i.dash = !i.dash; }), one?.dash), btn('minus', LANG === 'el' ? t('panels.041') : 'Width', () => apply(i => { i.sw = ({ 2: 3, 3: 5, 5: 8, 8: 2 })[i.sw || 3] || 3; })));
    if (types.has('shape') && !Canvas.editing) { const sh = h('button', { class: 'sb', title: t('t_shape'), html: I('shapes') }); sh.onclick = () => this.pop(sh, h('div', { class: 'sw-row' }, ...SHAPES.map(([k, ic]) => h('button', { class: 'ob', html: iconSvg(ic, 18), onclick: () => apply(i => { if (i.type === 'shape') i.shape = k; }) })), btn('ellipsis', 'Dashed', () => apply(i => { i.dash = !i.dash; })))); bar.append(sh); }
    if (one && one.type === 'ink') bar.append(btn('minus', LANG === 'el' ? t('panels.041') : 'Width', () => apply(i => { i.size = ({ 2: 4, 4: 7, 7: 12, 12: 20, 20: 2 })[i.size] || 4; })));
    if (one && one.type === 'image') bar.append(btn('sticker', LANG === 'el' ? t('panels.042') : 'Sticker style', () => apply(i => { i.sticker = !i.sticker; }), one.sticker), btn('type', LANG === 'el' ? t('panels.043') : 'Caption', () => { const f = form([['c', LANG === 'el' ? t('panels.043') : 'Caption', 'text', one.caption || '']]); this.modal('🖼️', f.el, { ok: () => apply(i => { i.caption = f.val().c; }) }); }));
    if (one && one.type === 'icon') bar.append(btn('sun', 'Glow', () => apply(i => { i.glow = !i.glow; }), one.glow));
    if (!Canvas.editing) {
      bar.append(h('div', { class: 'sep' }));
      if (one) bar.append(btn(one.reminder?.on ? 'bell-ring' : 'bell-plus', t('rem_set'), () => Features.reminderModal(one), one.reminder?.on));
      bar.append(btn('pin', t('pin'), () => Actions.togglePin(), items.every(i => i.pinned)), btn(items.every(i => i.locked) ? 'lock' : 'lock-open', t('lock'), () => Actions.toggleLock(), items.every(i => i.locked)),
        btn('bring-to-front', t('front'), () => Actions.zorder(1)), btn('copy-plus', t('duplicate'), () => Actions.duplicate()), btn('trash-2', t('del'), () => Actions.del()));
    }
    bar.hidden = false; this.positionStylebar();
  },
  positionStylebar() {
    const bar = $('#stylebar'); if (bar.hidden) return; const items = Canvas.selItems(); if (!items.length) return;
    const bb = bounds(items.map(i => ({ ...i, h: i.type === 'text' ? Canvas.itemH(i) : i.h }))); const a = Canvas.w2s(bb.x + bb.w / 2, bb.y), b = Canvas.w2s(bb.x, bb.y + bb.h);
    const r = Canvas.vp.getBoundingClientRect(); const bw = bar.offsetWidth, bh = bar.offsetHeight;
    let y = a.y + r.top - bh - 18; if (y < 56) y = b.y + r.top + 16; if (y > innerHeight - bh - 10) y = 60;
    bar.style.left = clamp(a.x + r.left - bw / 2, 70, innerWidth - bw - 10) + 'px'; bar.style.top = y + 'px';
  },
  pop(anchor, content) {
    $$('.pop').forEach(p => p.remove());
    const p = h('div', { class: 'pop' }, content); document.body.append(p); const r = anchor.getBoundingClientRect();
    p.style.left = clamp(r.left - 10, 6, innerWidth - p.offsetWidth - 6) + 'px'; p.style.top = (r.bottom + 8 + p.offsetHeight > innerHeight ? r.top - p.offsetHeight - 8 : r.bottom + 8) + 'px';
    setTimeout(() => { const off = (e) => { if (!p.contains(e.target)) { p.remove(); removeEventListener('pointerdown', off, true); } }; addEventListener('pointerdown', off, true); }, 0);
  },
};
const b2n = (b) => b ? 0 : 1;
function toHex(c) { if (/^#[0-9a-f]{6}$/i.test(c || '')) return c; const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); return m ? '#' + [m[1], m[2], m[3]].map(x => (+x).toString(16).padStart(2, '0')).join('') : '#888888'; }
function selField(label, opts, val, cb) { const s = h('select', { class: 'inp', onchange: (e) => cb(e.target.value) }, ...opts.map(([v, n]) => h('option', { value: v, selected: String(v) === String(val) ? true : null }, n))); return h('label', { class: 'field' }, h('span', {}, label), s); }
// simple form builder: [[key, label, type, value, extra]]
// v2.3: day-first date fields (30/11/2026 [18:30]) regardless of the Windows locale; .value stays ISO
// (YYYY-MM-DD / YYYY-MM-DDTHH:MM) so every caller keeps working. A calendar button opens the native picker.
function dmyParse(str, withTime) {
  const m = String(str || '').trim().match(/^(\d{1,2})\s*[\/.\-]\s*(\d{1,2})(?:\s*[\/.\-]\s*(\d{2,4}))?(?:[\s,T]+(\d{1,2})(?:[:.](\d{2}))?)?$/);
  if (!m) return /^\d{4}-\d\d-\d\d/.test(str) ? String(str).slice(0, withTime ? 16 : 10) : '';
  let y = m[3] ? +m[3] : new Date().getFullYear(); if (y < 100) y += 2000;
  const d = +m[1], mo = +m[2]; if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  const day = `${y}-${pad(mo)}-${pad(d)}`; return withTime ? `${day}T${pad(Math.min(23, +(m[4] || 9)))}:${pad(Math.min(59, +(m[5] || 0)))}` : day;
}
function dmyShow(iso, withTime) { if (!iso) return ''; const m = String(iso).match(/^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d))?/); if (!m) return String(iso); return `${m[3]}/${m[2]}/${m[1]}` + (withTime && m[4] ? ` ${m[4]}:${m[5]}` : ''); }
function dmyInput(type, val, extra) {
  const wt = type === 'datetime-local'; const nat = h('input', { type, class: 'dmy-nat', tabindex: '-1', 'aria-hidden': 'true' });
  const inp = h('input', { class: 'inp dmy', type: 'text', inputmode: 'numeric', placeholder: wt ? t('v23.dmyt_ph') : t('v23.dmy_ph'), ...(extra || {}) });
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  Object.defineProperty(inp, 'value', { configurable: true, get() { return dmyParse(desc.get.call(this), wt); }, set(v) { desc.set.call(this, dmyShow(v, wt)); } });
  inp.value = val || '';
  inp.addEventListener('blur', () => { const v = inp.value; inp.classList.toggle('bad', !!desc.get.call(inp).trim() && !v); if (v) inp.value = v; });
  nat.addEventListener('change', () => { if (nat.value) { inp.value = nat.value; inp.dispatchEvent(new Event('change', { bubbles: true })); } });
  const btn = h('button', { type: 'button', class: 'ib dmy-btn', title: t('v23.pick_date'), html: iconSvg('calendar', 15), onclick: (e) => { e.preventDefault(); nat.value = inp.value || (wt ? toLocalInput(Date.now()) : ymd(Date.now())); try { nat.showPicker(); } catch (er) { nat.focus(); } } });
  inp._wrap = h('span', { class: 'dmy-wrap' }, inp, btn, nat); return inp;
}
function form(fields) {
  const el = h('div', { class: 'form' }); const inputs = {};
  for (const [k, label, type, val, extra] of fields) {
    let inp;
    if (type === 'select') inp = h('select', { class: 'inp' }, ...(Array.isArray(extra) ? extra : extra?.options || []).map(o => Array.isArray(o) ? o : [o, o]).map(([v, n]) => h('option', { value: v, selected: String(v) === String(val) ? true : null }, n)));
    else if (type === 'textarea') inp = h('textarea', { class: 'inp', rows: 3 }, val || '');
    else if (type === 'checkbox') inp = h('input', { type: 'checkbox', class: 'toggle', checked: val ? true : null });
    else if (type === 'date' || type === 'datetime-local') { inp = dmyInput(type, val, extra); inputs[k] = inp; el.append(h('label', { class: 'field' }, h('span', {}, label), inp._wrap)); continue; }
    else inp = h('input', { class: 'inp', type, value: val ?? '', ...(extra || {}) });
    inputs[k] = inp;
    el.append(type === 'checkbox' ? h('label', { class: 'chk' }, inp, h('span', {}, label)) : h('label', { class: 'field' }, h('span', {}, label), inp));
  }
  return { el, inputs, val: () => Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.type === 'checkbox' ? i.checked : i.value])) };
}
const TYPE_ICON = { text: 'type', sticky: 'sticky-note', shape: 'shapes', ink: 'pen-tool', arrow: 'move-up-right', line: 'minus', image: 'image', video: 'video', audio: 'music', link: 'link', file: 'paperclip', emoji: 'smile', sticker: 'sticker', icon: 'star', frame: 'frame', countdown: 'timer', show: 'tv', subs: 'credit-card', tracker: 'radar', reminder: 'alarm-clock', reaction: 'message-circle' };
const KEYS = [['V', t('panels.044')], ['H / Space', t('panels.045')], ['P · M · I', t('panels.046')], ['E', t('panels.047')], ['T · N', t('panels.048')], ['R · A · L · F', t('panels.049')], ['Ctrl K', t('panels.050')], ['Ctrl E', t('panels.051')], ['Ctrl Z · Ctrl Y', t('panels.052')], ['Ctrl C · V · X · D', t('panels.053')], ['Del', t('panels.054')], ['Ctrl A', t('panels.034')], ['Ctrl G', t('panels.055')], ['Ctrl L', t('panels.056')], ['] · [', t('panels.057')], ['Shift 1', t('panels.058')], ['Ctrl 0', t('panels.059')], ['+ · −', t('panels.060')], ['Ctrl T · Ctrl Tab', t('panels.061')], ['Ctrl Shift R', t('panels.062')], ['Ctrl Alt N', t('panels.063')], ['Ctrl Alt Space', t('panels.064')], ['F11', t('panels.065')], [t('panels.066'), t('panels.067')], [t('panels.068'), t('panels.069')], [t('panels.070'), t('panels.071')]];
