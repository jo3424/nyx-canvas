'use strict';
// v2.6.13.1: local voice (OmniVoice / vs-engine) is removed — it loads the GPU and Qwen drops to 13–17 t/s.
// Nyx NEVER starts vs-engine or omnivoice-tts by itself: not at app start, not when speaking, not on a settings change,
// not from a button. main/vsengine.js (which started vs-engine hidden) is gone; every remaining launcher in main
// (TTS «Εντολή», «--help», sys:launch, proc:start) asks here first and refuses with a clear message.
const EXE = /^(vs-engine|omnivoice[\w-]*)(\.exe)?$/i;
const CMD = /(^|[\\/\s"'])(vs-engine|omnivoice[\w-]*)(\.exe)?(?=["'\s]|$)/i;
function isLocalVoiceExe(p) { return EXE.test(String(p || '').trim().replace(/^"|"$/g, '').split(/[\\/]/).pop()); }
function mentionsLocalVoice(s) { return CMD.test(String(s || '')); }
function refuse(what) {
  let msg = 'Local voice (OmniVoice / vs-engine) is removed in Nyx 2.6.13.1 — Nyx does not start it.';
  try { msg = require('./i18n').t('v26131.blocked'); } catch (e) {}
  const e = new Error(msg + (what ? ' (' + String(what).split(/[\\/]/).pop() + ')' : '')); e.code = 'local_voice_off'; return e;
}
module.exports = { isLocalVoiceExe, mentionsLocalVoice, refuse };
