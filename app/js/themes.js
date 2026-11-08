'use strict';
// Full UI skins — each changes panels, shapes, fonts, icon weight, canvas atmosphere.
const THEMES = [
  { id: 'midnight', space: true, name: 'Midnight Glass', desc: t('themes.001'), shape: 'glass', icon: 'regular',
    vars: { bg: '#04050b', bg2: '#0a0d1d', panel: 'rgba(18,22,40,.62)', 'panel-solid': '#121628', border: 'rgba(160,170,255,.14)', text: '#e9ebff', muted: '#8d93b8', accent: '#7c8cff', accent2: '#b07cff', 'accent-ink': '#0b0d1a', radius: '14px', 'radius-lg': '20px', blur: '22px', 'font-ui': "'Inter'", 'font-display': "'Inter'", card: 'rgba(22,26,46,.92)', 'card-text': '#e9ebff', 'card-border': 'rgba(160,170,255,.16)', sel: '#7c8cff', bar: 'rgba(6,8,18,.55)', glow: '.55' },
    fx: { stars: .9, starColors: ['#ffffff', '#c9d2ff', '#9fb0ff'], nebula: ['rgba(88,80,255,.20)', 'rgba(170,90,255,.13)', 'rgba(40,140,255,.10)'], grid: 'dots', gridColor: 'rgba(150,160,255,.10)', aurora: false, scan: false } },
  { id: 'neon', space: true, name: 'Neon Noir', desc: t('themes.002'), shape: 'neon', icon: 'bold',
    vars: { bg: '#000000', bg2: '#07000c', panel: 'rgba(8,0,14,.86)', 'panel-solid': '#0c0012', border: 'rgba(255,46,160,.55)', text: '#fff0fb', muted: '#b383a6', accent: '#ff2ea0', accent2: '#16f2ff', 'accent-ink': '#14000a', radius: '3px', 'radius-lg': '4px', blur: '0px', 'font-ui': "'Tektur'", 'font-display': "'Tektur'", card: 'rgba(10,0,16,.94)', 'card-text': '#fff0fb', 'card-border': 'rgba(22,242,255,.45)', sel: '#16f2ff', bar: 'rgba(0,0,0,.85)', glow: '1' },
    fx: { stars: .65, starColors: ['#ff2ea0', '#16f2ff', '#ffffff'], nebula: ['rgba(255,46,160,.16)', 'rgba(22,242,255,.10)', 'rgba(120,0,255,.10)'], grid: 'lines', gridColor: 'rgba(255,46,160,.10)', aurora: false, scan: false } },
  { id: 'aurora', space: true, name: 'Aurora', desc: t('themes.003'), shape: 'pill', icon: 'regular',
    vars: { bg: '#020807', bg2: '#04110f', panel: 'rgba(8,26,24,.58)', 'panel-solid': '#0a1d1b', border: 'rgba(120,255,214,.16)', text: '#e8fff8', muted: '#86b3a6', accent: '#3cf0b4', accent2: '#8a7dff', 'accent-ink': '#02130d', radius: '22px', 'radius-lg': '28px', blur: '26px', 'font-ui': "'Comfortaa'", 'font-display': "'Comfortaa'", card: 'rgba(10,30,28,.9)', 'card-text': '#e8fff8', 'card-border': 'rgba(120,255,214,.18)', sel: '#3cf0b4', bar: 'rgba(2,10,9,.5)', glow: '.7' },
    fx: { stars: .75, starColors: ['#ffffff', '#bfffe9', '#d6ceff'], nebula: ['rgba(40,240,170,.12)', 'rgba(120,100,255,.12)', 'rgba(0,160,255,.08)'], grid: 'dots', gridColor: 'rgba(120,255,214,.08)', aurora: true, scan: false } },
  { id: 'graphite', name: 'Graphite Pro', desc: t('themes.004'), shape: 'solid', icon: 'thin',
    vars: { bg: '#0b0b0d', bg2: '#111114', panel: 'rgba(22,22,26,.96)', 'panel-solid': '#16161a', border: 'rgba(255,255,255,.08)', text: '#ededf0', muted: '#8a8a96', accent: '#6e7bf2', accent2: '#e5a54b', 'accent-ink': '#ffffff', radius: '8px', 'radius-lg': '12px', blur: '0px', 'font-ui': "'Inter'", 'font-display': "'Inter'", card: '#18181c', 'card-text': '#ededf0', 'card-border': 'rgba(255,255,255,.09)', sel: '#6e7bf2', bar: '#0b0b0d', glow: '0' },
    fx: { stars: 0, starColors: ['#ffffff'], nebula: [], grid: 'dots', gridColor: 'rgba(255,255,255,.07)', aurora: false, scan: false } },
  { id: 'cosmos', space: true, name: 'Purple Cosmos', desc: t('themes.005'), shape: 'glass', icon: 'duo',
    vars: { bg: '#05020c', bg2: '#0e0620', panel: 'rgba(28,14,52,.55)', 'panel-solid': '#1a0e30', border: 'rgba(200,150,255,.18)', text: '#f4ecff', muted: '#a690c9', accent: '#c084fc', accent2: '#f472b6', 'accent-ink': '#16052a', radius: '16px', 'radius-lg': '22px', blur: '24px', 'font-ui': "'Arima'", 'font-display': "'Arima'", card: 'rgba(30,16,56,.9)', 'card-text': '#f4ecff', 'card-border': 'rgba(200,150,255,.2)', sel: '#c084fc', bar: 'rgba(8,3,18,.5)', glow: '.8' },
    fx: { stars: 1, starColors: ['#ffffff', '#f1d9ff', '#ffd1ea', '#cdd6ff'], nebula: ['rgba(170,80,255,.22)', 'rgba(255,80,170,.12)', 'rgba(80,60,255,.16)'], grid: 'none', gridColor: 'rgba(200,150,255,.08)', aurora: false, scan: false } },
  { id: 'cyber', space: true, name: 'Cyber Terminal', desc: t('themes.006'), shape: 'terminal', icon: 'bold',
    vars: { bg: '#000300', bg2: '#001004', panel: 'rgba(0,14,4,.9)', 'panel-solid': '#000e04', border: 'rgba(51,255,102,.4)', text: '#c8ffd6', muted: '#4fa065', accent: '#33ff66', accent2: '#ffcc00', 'accent-ink': '#001a06', radius: '0px', 'radius-lg': '0px', blur: '0px', 'font-ui': "'JetBrains Mono'", 'font-display': "'JetBrains Mono'", card: 'rgba(0,16,5,.94)', 'card-text': '#c8ffd6', 'card-border': 'rgba(51,255,102,.35)', sel: '#33ff66', bar: '#000300', glow: '.7' },
    fx: { stars: .55, starColors: ['#33ff66', '#a8ffbf'], nebula: ['rgba(51,255,102,.06)'], grid: 'lines', gridColor: 'rgba(51,255,102,.08)', aurora: false, scan: true } },
  { id: 'mono', space: true, name: 'Minimal Mono', desc: t('themes.007'), shape: 'solid', icon: 'thin',
    vars: { bg: '#000000', bg2: '#050505', panel: 'rgba(12,12,12,.94)', 'panel-solid': '#0c0c0c', border: 'rgba(255,255,255,.14)', text: '#f5f5f5', muted: '#8c8c8c', accent: '#ffffff', accent2: '#9a9a9a', 'accent-ink': '#000000', radius: '10px', 'radius-lg': '14px', blur: '0px', 'font-ui': "'Inter'", 'font-display': "'Space Grotesk','Inter'", card: '#0f0f0f', 'card-text': '#f5f5f5', 'card-border': 'rgba(255,255,255,.14)', sel: '#ffffff', bar: '#000000', glow: '0' },
    fx: { stars: .4, starColors: ['#ffffff'], nebula: [], grid: 'dots', gridColor: 'rgba(255,255,255,.08)', aurora: false, scan: false } },
  { id: 'sunset', space: true, name: 'Synth Sunset', desc: t('themes.008'), shape: 'pill', icon: 'duo',
    vars: { bg: '#07020a', bg2: '#1a0620', panel: 'rgba(36,10,40,.62)', 'panel-solid': '#240a28', border: 'rgba(255,140,90,.25)', text: '#fff1ea', muted: '#c49aa8', accent: '#ff8a4c', accent2: '#ff3d9a', 'accent-ink': '#200608', radius: '18px', 'radius-lg': '24px', blur: '18px', 'font-ui': "'Ubuntu'", 'font-display': "'Dela Gothic One','Ubuntu'", card: 'rgba(40,12,44,.92)', 'card-text': '#fff1ea', 'card-border': 'rgba(255,140,90,.28)', sel: '#ff8a4c', bar: 'rgba(14,3,16,.6)', glow: '.8' },
    fx: { stars: .8, starColors: ['#fff', '#ffd2b8', '#ffb3d9'], nebula: ['rgba(255,110,60,.16)', 'rgba(255,60,160,.14)', 'rgba(120,40,255,.12)'], grid: 'lines', gridColor: 'rgba(255,61,154,.10)', aurora: false, scan: false } },
  // v2.3: non-space animated themes (fx.kind draws its own scene on #stars)
  { id: 'desk', name: 'Wooden Desk', desc: t('v23.th_desk'), shape: 'solid', icon: 'regular',
    vars: { bg: '#4a3324', bg2: '#2b1d14', panel: 'rgba(52,36,26,.9)', 'panel-solid': '#34241a', border: 'rgba(255,214,160,.18)', text: '#fbefdf', muted: '#c6a98a', accent: '#f0a95b', accent2: '#8fc7a0', 'accent-ink': '#2a1806', radius: '10px', 'radius-lg': '14px', blur: '10px', 'font-ui': "'Ubuntu'", 'font-display': "'Roboto Slab'", card: 'rgba(250,243,230,.96)', 'card-text': '#2b2118', 'card-border': 'rgba(80,50,20,.18)', sel: '#f0a95b', bar: 'rgba(30,20,12,.55)', glow: '.25' },
    fx: { stars: 0, kind: 'desk', starColors: ['#ffe2b0'], nebula: ['rgba(255,190,110,.14)'], grid: 'none', gridColor: 'rgba(255,220,180,.06)', aurora: false, scan: false } },
  { id: 'glass', name: 'Glass Light', desc: t('v23.th_glass'), shape: 'glass', icon: 'regular', light: true,
    vars: { bg: '#eef2fb', bg2: '#dbe3f6', panel: 'rgba(255,255,255,.58)', 'panel-solid': '#f7f9ff', border: 'rgba(40,60,120,.14)', text: '#1b2233', muted: '#5d6780', accent: '#4f6bff', accent2: '#ff6fae', 'accent-ink': '#ffffff', radius: '16px', 'radius-lg': '22px', blur: '26px', 'font-ui': "'Inter'", 'font-display': "'Inter'", card: 'rgba(255,255,255,.78)', 'card-text': '#1b2233', 'card-border': 'rgba(40,60,120,.14)', sel: '#4f6bff', bar: 'rgba(255,255,255,.5)', glow: '.15' },
    fx: { stars: 0, kind: 'bokeh', starColors: ['#8fa6ff', '#ffb3d6', '#9fe6ff', '#ffe08a'], nebula: ['rgba(120,150,255,.25)', 'rgba(255,140,200,.20)', 'rgba(100,220,255,.18)'], grid: 'dots', gridColor: 'rgba(40,60,120,.10)', aurora: false, scan: false } },
  { id: 'ocean', name: 'Ocean Deep', desc: t('v23.th_ocean'), shape: 'pill', icon: 'regular',
    vars: { bg: '#05405e', bg2: '#011522', panel: 'rgba(4,36,54,.66)', 'panel-solid': '#06283b', border: 'rgba(120,220,255,.18)', text: '#e6f8ff', muted: '#86b4c8', accent: '#38d6ff', accent2: '#5cffc8', 'accent-ink': '#00202c', radius: '20px', 'radius-lg': '26px', blur: '20px', 'font-ui': "'Comfortaa'", 'font-display': "'Comfortaa'", card: 'rgba(6,40,58,.9)', 'card-text': '#e6f8ff', 'card-border': 'rgba(120,220,255,.2)', sel: '#38d6ff', bar: 'rgba(0,20,32,.5)', glow: '.45' },
    fx: { stars: 0, kind: 'ocean', starColors: ['#bff3ff', '#e9fdff'], nebula: ['rgba(60,200,255,.14)', 'rgba(0,255,200,.08)'], grid: 'none', gridColor: 'rgba(120,220,255,.07)', aurora: false, scan: false } },
  { id: 'forest', name: 'Firefly Forest', desc: t('v23.th_forest'), shape: 'pill', icon: 'duo',
    vars: { bg: '#10281a', bg2: '#050f09', panel: 'rgba(14,34,22,.7)', 'panel-solid': '#0f2418', border: 'rgba(180,255,170,.15)', text: '#ecfbe6', muted: '#93b38a', accent: '#a6e86a', accent2: '#ffd36a', 'accent-ink': '#0c1a05', radius: '18px', 'radius-lg': '24px', blur: '18px', 'font-ui': "'Arima'", 'font-display': "'Arima'", card: 'rgba(16,38,24,.92)', 'card-text': '#ecfbe6', 'card-border': 'rgba(180,255,170,.16)', sel: '#a6e86a', bar: 'rgba(4,14,8,.5)', glow: '.4' },
    fx: { stars: 0, kind: 'forest', starColors: ['#fff6a0', '#d9ff8a'], nebula: ['rgba(120,200,90,.12)', 'rgba(255,220,120,.06)'], grid: 'none', gridColor: 'rgba(180,255,170,.06)', aurora: false, scan: false } },
  { id: 'minlight', name: 'Minimal Light', desc: t('v23.th_minlight'), shape: 'solid', icon: 'thin', light: true,
    vars: { bg: '#fafafa', bg2: '#f1f1f3', panel: 'rgba(255,255,255,.96)', 'panel-solid': '#ffffff', border: 'rgba(0,0,0,.09)', text: '#18181b', muted: '#71717a', accent: '#18181b', accent2: '#2563eb', 'accent-ink': '#ffffff', radius: '10px', 'radius-lg': '14px', blur: '0px', 'font-ui': "'Inter'", 'font-display': "'Inter'", card: '#ffffff', 'card-text': '#18181b', 'card-border': 'rgba(0,0,0,.1)', sel: '#2563eb', bar: 'rgba(250,250,250,.8)', glow: '0' },
    fx: { stars: 0, kind: 'bokeh', starColors: ['#000000'], nebula: [], grid: 'dots', gridColor: 'rgba(0,0,0,.12)', aurora: false, scan: false } },
  { id: 'retro', name: 'Retro OS', desc: t('v23.th_retro'), shape: 'retro', icon: 'bold', light: true,
    vars: { bg: '#0f8a8a', bg2: '#077070', panel: '#c3c3c3', 'panel-solid': '#c3c3c3', border: '#7b7b7b', text: '#111111', muted: '#444444', accent: '#0a1f9c', accent2: '#b0124f', 'accent-ink': '#ffffff', radius: '0px', 'radius-lg': '0px', blur: '0px', 'font-ui': "'Tektur'", 'font-display': "'Handjet'", card: '#ffffff', 'card-text': '#111111', 'card-border': '#7b7b7b', sel: '#0a1f9c', bar: '#c3c3c3', glow: '0' },
    fx: { stars: 0, kind: 'retro', starColors: ['#ffffff', '#ffff66', '#66ffff', '#ff66ff'], nebula: [], grid: 'none', gridColor: 'rgba(255,255,255,.08)', aurora: false, scan: false } },
  { id: 'sakura', name: 'Sakura', desc: t('v23.th_sakura'), shape: 'pill', icon: 'duo', light: true,
    vars: { bg: '#fff1f5', bg2: '#ffd9e6', panel: 'rgba(255,248,251,.72)', 'panel-solid': '#fff7fa', border: 'rgba(214,90,140,.18)', text: '#3a1f2c', muted: '#9b6a80', accent: '#ec4f8f', accent2: '#7c6cf0', 'accent-ink': '#ffffff', radius: '20px', 'radius-lg': '26px', blur: '18px', 'font-ui': "'Playpen Sans'", 'font-display': "'Playpen Sans'", card: 'rgba(255,255,255,.88)', 'card-text': '#3a1f2c', 'card-border': 'rgba(214,90,140,.18)', sel: '#ec4f8f', bar: 'rgba(255,240,246,.6)', glow: '.15' },
    fx: { stars: 0, kind: 'sakura', starColors: ['#ffb7cf', '#ffc9da', '#ff9fbf', '#fff0f5'], nebula: ['rgba(255,150,190,.25)', 'rgba(170,150,255,.14)'], grid: 'none', gridColor: 'rgba(214,90,140,.08)', aurora: false, scan: false } },
  { id: 'rain', name: 'Cyberpunk Rain', desc: t('v23.th_rain'), shape: 'neon', icon: 'bold',
    vars: { bg: '#090a1c', bg2: '#1b0a2c', panel: 'rgba(12,8,28,.84)', 'panel-solid': '#120a24', border: 'rgba(0,240,255,.4)', text: '#eefcff', muted: '#8f8fb8', accent: '#00f0ff', accent2: '#ff2a6d', 'accent-ink': '#00161a', radius: '4px', 'radius-lg': '6px', blur: '14px', 'font-ui': "'Tektur'", 'font-display': "'Tektur'", card: 'rgba(16,10,34,.92)', 'card-text': '#eefcff', 'card-border': 'rgba(0,240,255,.35)', sel: '#00f0ff', bar: 'rgba(8,6,20,.6)', glow: '.7' },
    fx: { stars: 0, kind: 'rain', starColors: ['#7fdcff', '#c6f2ff'], nebula: ['rgba(255,42,109,.20)', 'rgba(0,240,255,.14)', 'rgba(120,40,255,.16)'], grid: 'none', gridColor: 'rgba(0,240,255,.07)', aurora: false, scan: false } },
];
const ICON_SW = { thin: 1.25, regular: 1.75, bold: 2.4, duo: 1.75 };
const UI_FONTS = ['Inter', 'Comfortaa', 'Arima', 'Tektur', 'JetBrains Mono', 'Ubuntu', 'Playpen Sans', 'Noto Serif', 'Roboto Slab', 'Handjet'];

const Theme = {
  current: null,
  get(id) { return THEMES.find(x => x.id === id) || THEMES[0]; },
  apply(settings) {
    const th = this.get(settings.theme);
    const all = settings.customs ||= {}; const g = settings.custom ||= {};
    if (Object.keys(g).some(k => !['font', 'icon'].includes(k))) { all[settings.theme || th.id] = { ...g }; delete all[settings.theme || th.id].font; delete all[settings.theme || th.id].icon; settings.custom = { font: g.font, icon: g.icon }; } // v2.3 migration
    const c = { ...(all[th.id] || {}), font: settings.custom.font, icon: settings.custom.icon };
    const v = { ...th.vars };
    if (c.accent) v.accent = c.accent; if (c.accent2) v.accent2 = c.accent2; if (c.text) v.text = c.text;
    if (c.bg) { v.bg = c.bg; v.bg2 = c.bg; }
    if (c.panel) { v.panel = hexA(c.panel, .78); v['panel-solid'] = c.panel; }
    if (c.card) { v.card = c.card; }
    if (c.radius != null) { v.radius = c.radius + 'px'; v['radius-lg'] = Math.round(c.radius * 1.4) + 'px'; }
    if (c.blur != null) v.blur = c.blur + 'px';
    if (c.glow != null) v.glow = String(c.glow);
    if (c.font) { v['font-ui'] = `'${c.font}'`; }
    const root = document.documentElement;
    for (const [k, val] of Object.entries(v)) root.style.setProperty('--' + k, val);
    const iconStyle = c.icon || th.icon;
    root.style.setProperty('--icon-sw', ICON_SW[iconStyle] || 1.75);
    document.body.classList.toggle('light-ui', !!th.light); root.style.colorScheme = th.light ? 'light' : 'dark';
    document.body.dataset.theme = th.id; document.body.dataset.shape = th.shape; document.body.dataset.icons = iconStyle;
    document.body.classList.toggle('no-anim', settings.anim === false);
    const fx = { ...th.fx };
    if (c.stars != null) fx.stars = c.stars; if (c.grid) fx.grid = c.grid;
    this.current = { ...th, vars: v, fx };
    $$('.aurora').forEach(e => e.style.display = fx.aurora ? '' : 'none');
    const sc = $('.scan'); if (sc) sc.style.display = fx.scan ? '' : 'none';
    API?.setTitlebar({ bar: '#00000000', text: v.text });
    window.dispatchEvent(new CustomEvent('nyx-theme'));
  }
};
function hexA(hex, a) { const m = hex.replace('#', ''); const n = parseInt(m.length === 3 ? m.split('').map(x => x + x).join('') : m, 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }
