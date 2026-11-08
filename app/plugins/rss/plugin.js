const dec = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).trim();
function parse(xml) {
  const items = []; const feedTitle = dec((/<title[^>]*>([\s\S]*?)<\/title>/.exec(xml) || [])[1]);
  for (const m of xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/g)) { const x = m[0];
    const t = dec((/<title[^>]*>([\s\S]*?)<\/title>/.exec(x) || [])[1]);
    const link = (/<link[^>]*href="([^"]+)"/.exec(x) || [])[1] || dec((/<link>([\s\S]*?)<\/link>/.exec(x) || [])[1]);
    const d = dec((/<(pubDate|updated|published|dc:date)>([\s\S]*?)<\/\1>/.exec(x) || [])[2]);
    items.push({ title: t, url: link, date: d ? new Date(d) : null, feed: feedTitle }); }
  return { title: feedTitle, items };
}
module.exports = {
  parse,
  cards: { feed: { async refresh(cfg, nyx) {
    const feeds = String(nyx.config.feeds || '').split(/\s+/).filter(u => /^https?:/.test(u)); if (!feeds.length) throw new Error('Πρόσθεσε feeds στις ρυθμίσεις');
    let all = []; for (const f of feeds) { try { const r = await nyx.fetch(f, { headers: { 'User-Agent': 'NyxCanvas/2 RSS' } }); all = all.concat(parse(await r.text()).items); } catch (e) { nyx.log(f, e.message); } }
    all.sort((a, b) => (b.date || 0) - (a.date || 0));
    const seen = nyx.storage.get('seen', []); const fresh = all.filter(i => i.url && !seen.includes(i.url));
    if (seen.length && fresh.length && nyx.config.notify) nyx.notify('RSS: ' + fresh.length + ' νέα', fresh[0].title);
    nyx.storage.set('seen', all.slice(0, 300).map(i => i.url));
    return { title: '📰 ' + (feeds.length === 1 && all[0] ? all[0].feed : 'Feeds'), rows: all.slice(0, 30).map(i => ({ label: i.title, url: i.url, sub: (i.feed ? i.feed + ' · ' : '') + (i.date && !isNaN(i.date) ? i.date.toLocaleString('el-GR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '') })) };
  } } },
};
