'use strict';
// UI strings live in app/locales/{el,en}.json (loaded synchronously through the preload).
// LANG is read from localStorage before any other script runs, because many modules build
// their labels at load time. Changing the language saves it and reloads the window.
(function () {
  const load = (l) => { try { return (window.nyxAPI && nyxAPI.locale && nyxAPI.locale(l)) || {}; } catch (e) { return {}; } };
  let lang = 'el';
  try { lang = localStorage.getItem('nyx.lang') === 'en' ? 'en' : 'el'; } catch (e) {}
  window.I18N = { el: load('el') };
  I18N.en = lang === 'en' ? load('en') : {};
  window.LANG = lang;
  const fill = (s, vars) => {
    if (vars) for (const [a, b] of Object.entries(vars)) s = s.split('{' + a + '}').join(b == null ? '' : String(b));
    return s.replace(/｛/g, '{').replace(/｝/g, '}');
  };
  window.t = (k, vars) => fill(String((I18N[LANG] && I18N[LANG][k]) ?? I18N.el[k] ?? k), vars);
  window.tr = window.t;
  window.hydrateL = (root = document) => {
    for (const e of root.querySelectorAll('[data-l]')) e.textContent = t(e.dataset.l);
    for (const e of root.querySelectorAll('[data-l-title]')) e.title = t(e.dataset.lTitle);
    for (const e of root.querySelectorAll('[data-l-ph]')) e.placeholder = t(e.dataset.lPh);
  };
  const run = () => { document.documentElement.lang = LANG; hydrateL(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
  window.setNyxLang = (l) => { try { localStorage.setItem('nyx.lang', l === 'en' ? 'en' : 'el'); } catch (e) {} };
})();
