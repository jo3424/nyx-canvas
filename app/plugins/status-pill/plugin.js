let tm = null;
module.exports = {
  deactivate(nyx) { clearTimeout(tm); },
  actions: {
    async set(a, nyx) { clearTimeout(tm); const min = Math.max(1, +a.min || 25); const end = new Date(Date.now() + min * 60e3); const t = String(a.text || 'Focus').slice(0, 40);
      nyx.setShared('focus', t + ' · έως ' + end.toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' }));
      tm = setTimeout(() => { nyx.setShared('focus', null); nyx.notify('Τέλος: ' + t, min + ' λεπτά ✓'); }, min * 60e3); return 'Status στο widget ✓'; },
    async clear(a, nyx) { clearTimeout(tm); nyx.setShared('focus', null); return 'OK'; },
  },
};
