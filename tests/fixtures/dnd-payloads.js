'use strict';
// v2.6.2 — DataTransfer payloads as Windows browsers deliver them to a Chromium/Electron drop target.
// Sources: Firefox widget/windows/nsDataObj.cpp (CF_HDROP temp copy of the image in %TEMP%, deleted 0.5 s after the drop;
// random-named .png/.bmp when only the decoded image exists; .URL virtual file for links), Chromium
// web_contents_view_aura.cc PrepareDropData (virtual files dropped when a URL is present, FileContents only when there are
// no filenames), MDN drag data store (moz flavours). Runs in a renderer: makeCases(env) → [{ name, dt, expect }].
// env: { png, jpg, bmp, gif } Uint8Arrays, file(bytes, name, type, { path, broken }) → File (path via the test API stub).
function makeCases(env) {
  const { png, jpg, bmp, file } = env; const IMG = 'https://img.example.com/photos/sunset.jpg';
  const sc = new TextEncoder().encode('[InternetShortcut]\r\nURL=https://news.example.org/story\r\n');
  const TMP = 'C:\\Users\\jonh\\AppData\\Local\\Temp\\';
  const dt = ({ types, data = {}, files = [], items, effectAllowed = 'all' }) => ({
    types, effectAllowed, files, getData: (k) => data[k] ?? '',
    items: items || [...types.filter(t => t !== 'Files').map(t => ({ kind: 'string', type: t, getAsFile: () => null })), ...files.map(f => ({ kind: 'file', type: f.type, getAsFile: () => f }))],
  });
  return [
    // ---------------- Firefox (Windows) ----------------
    { name: 'firefox: image → CF_HDROP temp copy with the real name', dt: dt({ types: ['text/uri-list', 'text/html', 'text/plain', 'Files'], data: { 'text/uri-list': IMG, 'text/plain': IMG, 'text/html': `<img src="${IMG}" alt="Ηλιοβασίλεμα">` }, files: [file(jpg, 'sunset.jpg', 'image/jpeg', { path: TMP + 'sunset.jpg' })] }), expect: { types: ['image'], via: 'fileImage', source: IMG } },
    { name: 'firefox: image, temp copy already deleted → download the src', dt: dt({ types: ['text/uri-list', 'text/html', 'text/plain', 'Files'], data: { 'text/uri-list': IMG, 'text/plain': IMG, 'text/html': `<img src="${IMG}">` }, files: [file(jpg, 'sunset.jpg', 'image/jpeg', { path: TMP + 'sunset.jpg', broken: true })] }), expect: { types: ['image'], via: 'urlImage' } },
    { name: 'firefox: decoded image only → random-named .bmp in %TEMP%', dt: dt({ types: ['Files', 'text/plain', 'text/uri-list', 'text/html'], data: { 'text/uri-list': 'https://img.example.com/x?id=7', 'text/html': '<img src="https://img.example.com/x?id=7">' }, files: [file(bmp, 'k3j4h5g6.bmp', 'image/bmp', { path: TMP + 'k3j4h5g6.bmp' })] }), expect: { types: ['image'], via: 'fileImage' } },
    { name: 'firefox: relative <img src> in html, absolute uri-list', dt: dt({ types: ['text/uri-list', 'text/html'], data: { 'text/uri-list': 'https://site.example.gr/media/pic.png', 'text/html': '<img src="/media/pic.png">' } }), expect: { types: ['image'], via: 'urlImage', src: 'https://site.example.gr/media/pic.png' } },
    { name: 'firefox: link (uri-list + <a> + plain), virtual .URL dropped by Chromium', dt: dt({ types: ['text/uri-list', 'text/html', 'text/plain'], data: { 'text/uri-list': 'https://example.org/article', 'text/plain': 'https://example.org/article', 'text/html': '<a href="https://example.org/article">Άρθρο</a>' } }), expect: { types: ['link'], title: 'Άρθρο' } },
    { name: 'firefox: link with moz flavours only (text/x-moz-url)', dt: dt({ types: ['text/x-moz-url', 'text/x-moz-url-data', 'text/x-moz-url-desc', 'text/plain'], data: { 'text/x-moz-url': 'https://example.org/moz\nΤίτλος moz', 'text/x-moz-url-data': 'https://example.org/moz', 'text/x-moz-url-desc': 'Τίτλος moz', 'text/plain': 'https://example.org/moz' } }), expect: { types: ['link'], title: 'Τίτλος moz' } },
    { name: 'firefox: image as x-moz-url-data + application/x-moz-nativeimage, no file', dt: dt({ types: ['application/x-moz-nativeimage', 'text/x-moz-url-data', 'text/x-moz-url'], data: { 'text/x-moz-url-data': 'https://img.example.com/raw/42', 'text/x-moz-url': 'https://img.example.com/raw/42\nhttps://img.example.com/raw/42' } }), expect: { types: ['image'], via: 'urlImage' } },
    { name: 'firefox: selected text', dt: dt({ types: ['text/html', 'text/plain'], data: { 'text/plain': 'Γεια σου κόσμε', 'text/html': '<p>Γεια σου <a href="https://x.gr">κόσμε</a></p>' } }), expect: { types: ['text'] } },
    { name: 'firefox: image inside a link → image card, source = link', dt: dt({ types: ['text/uri-list', 'text/html', 'text/plain', 'Files'], data: { 'text/uri-list': 'https://shop.example.com/item/9', 'text/plain': 'https://shop.example.com/item/9', 'text/html': '<a href="https://shop.example.com/item/9"><img src="https://shop.example.com/t/9.webp" alt=""></a>' }, files: [file(png, '9.png', 'image/png', { path: TMP + '9.png' })] }), expect: { types: ['image'], via: 'fileImage', source: 'https://shop.example.com/item/9' } },
    { name: 'firefox: Files only, temp copy without extension (PNG bytes)', dt: dt({ types: ['Files'], files: [file(png, 'image', '', { path: TMP + 'image' })] }), expect: { types: ['image'], via: 'files' } },
    { name: 'firefox: file item with no name and no type (items only) + uri-list', dt: dt({ types: ['Files', 'text/uri-list'], data: { 'text/uri-list': 'https://img.example.com/q/abc' }, files: [], items: [{ kind: 'string', type: 'text/uri-list', getAsFile: () => null }, { kind: 'file', type: '', getAsFile: () => file(png, '', '', {}) }] }), expect: { types: ['image'], via: 'fileImage' } },
    { name: 'firefox: image, temp copy gone AND server 403 → link + message', dt: dt({ types: ['text/uri-list', 'text/html', 'Files'], data: { 'text/uri-list': 'https://img.example.com/403/a.jpg', 'text/html': '<img src="https://img.example.com/403/a.jpg">' }, files: [file(jpg, 'a.jpg', 'image/jpeg', { path: TMP + 'a.jpg', broken: true })] }), expect: { types: ['link'], toast: 'v26.dnd_img_fail' } },
    // ---------------- Brave (Chromium, Windows) ----------------
    { name: 'brave: image → %TEMP% file with no extension and empty type', dt: dt({ types: ['text/uri-list', 'text/html', 'Files'], data: { 'text/uri-list': 'https://cdn.example.com/i/abc', 'text/html': '<img src="https://cdn.example.com/i/abc">' }, files: [file(jpg, 'abc', '', { path: TMP + 'abc' })] }), expect: { types: ['image'], via: 'fileImage' } },
    { name: 'brave: image → only text/uri-list (no extension)', dt: dt({ types: ['text/uri-list'], data: { 'text/uri-list': 'https://cdn.example.com/img/xyz' } }), expect: { types: ['image'], via: 'urlImage' } },
    { name: 'brave: page link → only text/uri-list → quiet image probe fails → link, no error', dt: dt({ types: ['text/uri-list'], data: { 'text/uri-list': 'https://example.org/page.html' } }), expect: { types: ['link'], noToast: true } },
    { name: 'brave: DownloadURL image + uri-list', dt: dt({ types: ['DownloadURL', 'text/uri-list'], data: { DownloadURL: 'image/png:pic.png:https://cdn.example.com/dl/pic', 'text/uri-list': 'https://example.org/gallery' } }), expect: { types: ['image'], via: 'urlImage' } },
    { name: 'brave: link with virtual Title.url (kept by some builds) + uri-list', dt: dt({ types: ['text/uri-list', 'text/plain', 'Files'], data: { 'text/uri-list': 'https://news.example.org/story', 'text/plain': 'https://news.example.org/story' }, files: [file(sc, 'Story.url', '', { path: TMP + 'Story.url' })] }), expect: { types: ['link'] } },
    { name: 'brave: Files only, extension-less temp file that is an InternetShortcut', dt: dt({ types: ['Files'], files: [file(sc, 'Story', '', { path: TMP + 'Story' })] }), expect: { types: ['link'] } },
    { name: 'brave: image bytes as application/octet-stream "image" + data: src', dt: dt({ types: ['text/html', 'Files'], data: { 'text/html': '<img src="data:image/png;base64,iVBORw0KGgo=">' }, files: [file(jpg, 'image', 'application/octet-stream', {})] }), expect: { types: ['image'], via: 'fileImage' } },
    // ---------------- Chrome / Explorer (regressions) ----------------
    { name: 'chrome: image (FileContents, no path)', dt: dt({ types: ['text/uri-list', 'text/html', 'Files'], data: { 'text/uri-list': IMG, 'text/html': `<img src="${IMG}" alt="φωτο">` }, files: [file(jpg, 'sunset.jpg', 'image/jpeg', {})] }), expect: { types: ['image'], via: 'fileImage', source: IMG } },
    { name: 'chrome: link', dt: dt({ types: ['text/plain', 'text/uri-list', 'text/html'], data: { 'text/uri-list': 'https://example.org/a', 'text/plain': 'https://example.org/a', 'text/html': '<a href="https://example.org/a">Παράδειγμα</a>' } }), expect: { types: ['link'], title: 'Παράδειγμα' } },
    { name: 'explorer: pdf', dt: dt({ types: ['Files'], files: [file(new TextEncoder().encode('%PDF-1.4 xxxxxxxx'), 'a.pdf', 'application/pdf', { path: 'C:\\Docs\\a.pdf' })] }), expect: { types: ['file'], via: 'files' } },
    { name: 'explorer: image without extension (not temp)', dt: dt({ types: ['Files'], files: [file(png, 'scan', '', { path: 'C:\\Docs\\scan' })] }), expect: { types: ['image'], via: 'files' } },
    // ---------------- security / junk ----------------
    { name: 'sec: file:// uri only', dt: dt({ types: ['text/uri-list'], data: { 'text/uri-list': 'file:///C:/Windows/win.ini' } }), expect: { types: [] } },
    { name: 'sec: javascript: uri', dt: dt({ types: ['text/uri-list'], data: { 'text/uri-list': 'javascript:alert(1)' } }), expect: { types: [] } },
    { name: 'sec: <img src=file:> and data:text/html are ignored', dt: dt({ types: ['text/html', 'text/uri-list'], data: { 'text/html': '<img src="file:///C:/secret.png">', 'text/uri-list': 'data:text/html,<script>alert(1)</script>' } }), expect: { types: [] } },
    { name: 'sec: Nyx own drag (nyx/self)', dt: dt({ types: ['nyx/self', 'text/uri-list'], data: { 'nyx/self': '1', 'text/uri-list': 'https://example.org' } }), expect: { types: [] } },
    { name: 'sec: html image that is not an image (download says text/html), file unreadable → link', dt: dt({ types: ['text/html', 'text/uri-list'], data: { 'text/html': '<img src="https://evil.example.com/fake.png">', 'text/uri-list': 'https://evil.example.com/fake.png' } }), expect: { types: ['link'], toast: 'v26.dnd_img_fail' } },
  ];
}
if (typeof module !== 'undefined') module.exports = { makeCases };
