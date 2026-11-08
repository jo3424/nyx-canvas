const fs=require('fs');const vm=require('vm');const ctx={};ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync('app/assets/data/lucide.js','utf8'),ctx);
const names=new Set(Object.keys(ctx.NYX_DATA.lucide));
const files=['app/index.html','app/widget.html',...fs.readdirSync('app/js').map(f=>'app/js/'+f),'app/widget.js'];
const src=files.map(f=>fs.readFileSync(f,'utf8')).join('\n');
const used=new Set();for(const re of [/data-i="([a-z0-9-]+)"/g,/(?:icon|iconSvg)\('([a-z0-9-]+)'/g,/'data-i': '([a-z0-9-]+)'/g,/\bic: '([a-z0-9-]+)'/g,/\bi: '([a-z0-9-]+)'/g,/icon: '([a-z0-9-]+)'/g]){let m;while((m=re.exec(src)))used.add(m[1]);}
console.log('icons used',used.size,'missing',[...used].filter(n=>!names.has(n)));
const pre=fs.readFileSync('preload.js','utf8'),main=fs.readFileSync('main.js','utf8');
const inv=[...pre.matchAll(/invoke\('([^']+)'/g)].map(m=>m[1]);console.log('no handler',inv.filter(c=>!main.includes("'"+c+"'")));
const ons=[...pre.matchAll(/on\('([^']+)'\)/g)].map(m=>m[1]);console.log('never sent',ons.filter(c=>!main.includes("send('"+c)));
const apis=new Set([...pre.matchAll(/^\s+(\w+):/gm)].map(m=>m[1]).concat([...pre.matchAll(/(on\w+): on/g)].map(m=>m[1])));
const usedApi=new Set([...src.matchAll(/API\??\.(\w+)/g)].map(m=>m[1]));console.log('API missing',[...usedApi].filter(a=>!apis.has(a)));
