// v2.6.3 harness actions (API is a frozen contextBridge object, so links are counted, not clicked): open the AI Hub, check the model picks render, «Τι σημαίνει;» opens, Router vision warns without --mmproj.
// Run (sandbox on): cd tools/harness && NYX_REPO=<repo> NYX_ACTIONS=<repo>/tests/models-hub-actions.js NYX_WAIT=6000 NYX_TEST=1 NYX_DATA_DIR=/tmp/nyxdata264 xvfb-run -a electron .
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms)); const res = {}; const e0 = (window.__errs || []).length;
  Hub.open(); await sleep(1200);
  const cards = [...document.querySelectorAll('.recs .rec')];
  res.cards = cards.length; res.ids = cards.map(c => c.dataset.rec);
  res.fastFiles = [...(document.querySelector('.rec[data-rec="fast"]')?.querySelectorAll('.rec-files code') || [])].map(c => c.textContent);
  res.sizes = [...document.querySelectorAll('.rec[data-rec="fast"] .rec-files li')].map(li => li.textContent.replace(/\s+/g, ' ').trim());
  const d = document.querySelector('.rec[data-rec="vision"] details'); d?.querySelector('summary')?.click(); await sleep(200); res.whyOpen = !!d?.open; res.whyText = d?.textContent.slice(0, 80);
  res.hfButtons = [...document.querySelectorAll('.recs .rec .btn')].filter(b => /Hugging Face/.test(b.textContent)).length; res.copyButtons = document.querySelectorAll('.recs .rec-files .icon-btn').length;
  res.fitNote = [...document.querySelectorAll('.muted.small')].some(p => /δεν χωράνε|do not fit/.test(p.textContent));
  // Router vision slot warning
  const R = Store.state.settings.ai.router; const old = JSON.stringify(R.profiles.vision);
  R.profiles.vision.model = 'C:\\m\\Qwen3.8-27B-UD-Q4_K_M.gguf'; R.profiles.vision.extra = '';
  const sec = Hub25.routerSec ? Hub25.routerSec() : null;
  if (sec) { const w = sec.querySelector('.rt-prof .warn'); res.visionWarnShown = !!w && !w.hidden; const inp = [...sec.querySelectorAll('.rt-prof')][1].querySelectorAll('input.inp'); const ex = inp[inp.length - 1]; ex.value = '--mmproj C:\\m\\mmproj-F16.gguf'; ex.dispatchEvent(new Event('change')); res.visionWarnAfterMmproj = w.hidden; res.placeholder = ex.placeholder; res.hints = [...sec.querySelectorAll('.rt-prof small.muted')].map(s => s.textContent); }
  R.profiles.vision = JSON.parse(old);
  res.errs = (window.__errs || []).slice(e0);
  return res;
})()
