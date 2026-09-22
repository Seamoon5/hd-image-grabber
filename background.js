// Background service worker for HD Image Grabber (v4)

let currentDownloadIds = [];
let crcTable = null;
let lastScan = null;
const MAX_ANALYZE = 250;
const ANALYZE_CONCURRENCY = 6;

// ---------------------------------------------------------------
// Image size parsing (read width/height from image file header)
// ---------------------------------------------------------------
function parseImageSize(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const len = buf.byteLength;
    if (len < 24) return null;

    // --- PNG: signature + width/height at fixed offsets ---
    if (dv.getUint32(0) === 0x89504E47) {
        if (len < 24) return null;
        return { width: dv.getUint32(16), height: dv.getUint32(20) };
    }

    // --- GIF: "GIF87a"/"GIF89a", width/height little-endian at 6/8 ---
    if (dv.getUint32(0) === 0x47494638) {
        return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
    }

    // --- JPEG: walk markers until a SOF segment ---
    if (dv.getUint8(0) === 0xFF && dv.getUint8(1) === 0xD8) {
        let pos = 2;
        while (pos + 9 <= len) {
            if (dv.getUint8(pos) !== 0xFF) { pos++; continue; }
            const marker = dv.getUint8(pos + 1);
            if (marker === 0xD8) { pos += 2; continue; }
            if (marker === 0xD9 || marker === 0xDA) break; // EOI or SOS -> dimensions done before scan row
            const segLen = dv.getUint16(pos + 2);
            if (segLen < 2) break;
            const isSOF = marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;
            if (isSOF && pos + 9 <= len) {
                return { width: dv.getUint16(pos + 7), height: dv.getUint16(pos + 5) };
            }
            pos += 2 + segLen;
        }
        return null;
    }

    // --- WebP: "RIFF....WEBP", then VP8 / VP8L / VP8X chunk ---
    if (dv.getUint32(0) === 0x52494646 && dv.getUint32(8) === 0x57454250) {
        const tag = dv.getUint32(12);
        if (tag === 0x56503820 && len >= 30) {           // "VP8 " lossy
            return {
                width: dv.getUint16(26, true) & 0x3FFF,
                height: dv.getUint16(28, true) & 0x3FFF
            };
        }
        if (tag === 0x5650384C && len >= 25) {           // "VP8L" lossless
            const bits = dv.getUint32(21, true);
            return {
                width: (bits & 0x3FFF) + 1,
                height: ((bits >> 14) & 0x3FFF) + 1
            };
        }
        if (tag === 0x56503858 && len >= 30) {           // "VP8X" extended
            const width = dv.getUint8(24) | (dv.getUint8(25) << 8) | (dv.getUint8(26) << 16);
            const height = dv.getUint8(27) | (dv.getUint8(28) << 8) | (dv.getUint8(29) << 16);
            return { width: width + 1, height: height + 1 };
        }
        return null;
    }

    return null;
}

// ---------------------------------------------------------------
// HD source detection: build "original" URL candidates
// ---------------------------------------------------------------
const RESIZE_PARAMS = ['w', 'h', 'width', 'height', 's', 'resize', 'size', 'iw', 'ih', 'q', 'quality',
    'crop', 'fit', 'hmac', 'sign', 'ixid', 'ixlib', 'dpr', 'strip', 'bg', 'usm', 'v',
    'enhance', 'sharp', 'blur', 'rotate', 'a', 'type', 'format', 'progressive', 'output'];

function stripResizeQuery(u) {
    const qi = u.indexOf('?');
    if (qi < 0) return u;
    const base = u.slice(0, qi);
    const kept = u.slice(qi + 1).split('&').filter((p) => {
        const k = p.split('=')[0].toLowerCase();
        return !RESIZE_PARAMS.includes(k);
    });
    return kept.length ? base + '?' + kept.join('&') : base;
}

function hdCandidates(url) {
    const out = [];
    const seen = new Set();
    const push = (u) => {
        if (u && u.startsWith('http') && !seen.has(u)) { seen.add(u); out.push(u); }
    };

    push(url);
    push(stripResizeQuery(url));

    const withoutHash = url.split('#')[0];
    let base = withoutHash;
    let query = '';
    const qIdx = withoutHash.indexOf('?');
    if (qIdx >= 0) {
        base = withoutHash.slice(0, qIdx);
        query = withoutHash.slice(qIdx + 1);
    }
    const withQuery = (b) => (query ? b + '?' + query : b);

    // Path token replacements — chained cumulatively so cleaning stacks
    const cleanSteps = [
        { re: /\/(thumb|thumbs|thumbnail|small|t|250x250|x150|150x150)\//ig, rep: '/' },
        { re: /[-_.](thumb|thumbs|thumbnail|small)\d*(?=\.(?:jpe?g|png|webp|gif|avif|svg))/ig, rep: '' },
        { re: /_\d+x\d+(?=\.(?:jpe?g|png|webp|gif|avif|svg))/ig, rep: '' },
        { re: /-\d{2,3}x\d{2,3}(?=\.(?:jpe?g|png|webp|gif|avif|svg))/ig, rep: '' },
        { re: /-\d{3,4}(?=\.(?:jpe?g|png|webp|gif|avif|svg))/ig, rep: '' },
        { re: /[-_.]orig(?:inal)?(?=\.(?:jpe?g|png|webp|gif|avif|svg))/ig, rep: '' }
    ];

    let current = base;
    cleanSteps.forEach(({ re, rep }) => {
        if (re.test(current)) {
            current = current.replace(re, rep);
            push(withQuery(current));
        }
    });

    // Strip resize params from every candidate too
    out.slice().forEach((u) => push(stripResizeQuery(u)));

    return out.slice(0, 6);
}

// ---------------------------------------------------------------
// Probe an image URL: fetch only the header, read size + bytes
// ---------------------------------------------------------------
async function probeImage(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
        const resp = await fetch(url, {
            headers: { 'Range': 'bytes=0-262143' },
            credentials: 'omit',
            cache: 'force-cache',
            signal: ctrl.signal
        });
        if (!resp.ok) return null;
        const buf = new Uint8Array(await resp.arrayBuffer());

        let totalSize = 0;
        const cr = resp.headers.get('content-range');
        if (cr) {
            const m = cr.match(/\/(\d+)\s*$/);
            if (m) totalSize = parseInt(m[1], 10);
        } else {
            const cl = resp.headers.get('content-length');
            totalSize = cl ? parseInt(cl, 10) : buf.byteLength;
        }

        const type = resp.headers.get('content-type') || '';
        const size = parseImageSize(buf);
        return { size, totalSize, type, len: buf.byteLength };
    } catch (e) {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

function formatFrom(url, type) {
    const t = (type || '').toLowerCase();
    const map = { 'image/jpeg': 'jpeg', 'image/jpg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp',
        'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg' };
    if (map[t]) return map[t];
    const m = url.match(/\.(jpe?g|png|webp|gif|avif|svg|bmp|ico)(\?|$)/i);
    return m ? m[1].toLowerCase() : 'unknown';
}

async function analyzeOne(url) {
    const fallback = { url, hdUrl: url, width: 0, height: 0, fileSize: 0, format: formatFrom(url, '') };
    const orig = await probeImage(url);
    if (!orig) return fallback;

    // If the URL already has no resize params/tokens to strip, it IS the original.
    const stripped = stripResizeQuery(url);
    if (stripped === url || hdCandidates(url).length <= 1) {
        return {
            url,
            hdUrl: url,
            width: orig.size ? orig.size.width : 0,
            height: orig.size ? orig.size.height : 0,
            fileSize: orig.totalSize || 0,
            format: orig.type ? formatFrom(url, orig.type) : formatFrom(url, '')
        };
    }

    let best = { size: orig.size, totalSize: orig.totalSize, type: orig.type, hdUrl: url };
    for (const cand of hdCandidates(url).slice(1)) {
        const r = await probeImage(cand);
        if (!r || !r.size) continue;
        const area = r.size.width * r.size.height;
        const bestArea = best.size ? best.size.width * best.size.height : 0;
        if (area > bestArea) best = { size: r.size, totalSize: r.totalSize, type: r.type || orig.type, hdUrl: cand };
    }

    return {
        url,
        hdUrl: best.hdUrl,
        width: best.size ? best.size.width : 0,
        height: best.size ? best.size.height : 0,
        fileSize: best.totalSize || 0,
        format: best.type ? formatFrom(best.hdUrl, best.type) : formatFrom(best.hdUrl, '')
    };
}

async function mapPool(items, limit, fn) {
    const results = new Array(items.length);
    let idx = 0;
    async function worker() {
        while (idx < items.length) {
            const i = idx++;
            try { results[i] = await fn(items[i], i); }
            catch (e) { results[i] = null; }
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

async function analyzeImageList(urls, onProgress) {
    const unique = [];
    const seen = new Set();
    urls.forEach((u) => { if (u && u.startsWith('http') && !seen.has(u)) { seen.add(u); unique.push(u); } });
    const limited = unique.slice(0, MAX_ANALYZE);
    let processed = 0;
    const onOne = async (u, i) => {
        const res = await analyzeOne(u);
        processed++;
        if (onProgress) onProgress(processed, limited.length);
        return res;
    };
    const analyzed = await mapPool(limited, ANALYZE_CONCURRENCY, onOne);
    return analyzed.filter(Boolean);
}

// ---------------------------------------------------------------
// Minimal ZIP writer (STORE = no compression) - pure JS, no deps
// ---------------------------------------------------------------
function makeCrcTable() {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        crcTable[n] = c >>> 0;
    }
}
function crc32(buf) {
    if (!crcTable) makeCrcTable();
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

function buildZip(entries) {
    const encoder = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    function write(b) { chunks.push(b); offset += b.length; }
    function pushU16(arr, v) { arr.push(v & 0xFF, (v >>> 8) & 0xFF); }
    function pushU32(arr, v) {
        arr.push(v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF);
    }

    entries.forEach((entry) => {
        const localOffset = offset;
        const nameBytes = encoder.encode(entry.name);
        const data = entry.data;
        const crc = crc32(data);

        // Local file header
        const lh = [];
        pushU32(lh, 0x04034b50);
        pushU16(lh, 20);
        pushU16(lh, 0x0800); // UTF-8 names
        pushU16(lh, 0);      // STORE
        pushU16(lh, dosTime);
        pushU16(lh, dosDate);
        pushU32(lh, crc);
        pushU32(lh, data.length);
        pushU32(lh, data.length);
        pushU16(lh, nameBytes.length);
        pushU16(lh, 0);
        write(new Uint8Array(lh));
        write(nameBytes);
        write(data);

        // Central directory header
        const ch = [];
        pushU32(ch, 0x02014b50);
        pushU16(ch, 20);
        pushU16(ch, 20);
        pushU16(ch, 0x0800);
        pushU16(ch, 0);
        pushU16(ch, dosTime);
        pushU16(ch, dosDate);
        pushU32(ch, crc);
        pushU32(ch, data.length);
        pushU32(ch, data.length);
        pushU16(ch, nameBytes.length);
        pushU16(ch, 0); // extra
        pushU16(ch, 0); // comment
        pushU16(ch, 0); // disk
        pushU16(ch, 0); // internal attrs
        pushU32(ch, 0); // external attrs
        pushU32(ch, localOffset);
        central.push({ bytes: new Uint8Array(ch), nameBytes });
    });

    // Write central directory
    const cdStart = offset;
    central.forEach((c) => { write(c.bytes); write(c.nameBytes); });
    const cdSize = offset - cdStart;

    // End of central directory
    const eocd = [];
    pushU32(eocd, 0x06054b50);
    pushU16(eocd, 0);
    pushU16(eocd, 0);
    pushU16(eocd, entries.length);
    pushU16(eocd, entries.length);
    pushU32(eocd, cdSize);
    pushU32(eocd, cdStart);
    pushU16(eocd, 0);
    write(new Uint8Array(eocd));

    const totalLen = chunks.reduce((a, c) => a + c.length, 0);
    const out = new Uint8Array(totalLen);
    let p = 0;
    chunks.forEach((c) => { out.set(c, p); p += c.length; });
    return out;
}

function safeName(name) {
    return name.replace(/[\/\\:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 120);
}

// Runs in the page context: lazy-scroll then collect all image URLs (injected via executeScript)
function extractPageImages() {
    return new Promise((resolveMain) => {
        const done = (arr) => resolveMain(arr || []);

        setTimeout(async () => {
            try {
                const body = document.body;
                const maxSteps = 30;
                const step = 500;
                let lastHeight = -1;
                if (body) {
                    for (let i = 0; i < maxSteps; i++) {
                        if (window.innerHeight + window.scrollY >= body.scrollHeight - 10) break;
                        window.scrollBy(0, step);
                        await new Promise(r => setTimeout(r, 250));
                        if (body.scrollHeight === lastHeight) break;
                        lastHeight = body.scrollHeight;
                    }
                    window.scrollTo(0, 0);
                }
            } catch (e) {}

            try {
                const map = new Map();
                function add(url) {
                    if (!url || typeof url !== 'string') return;
                    if (url.startsWith('data:') || url.startsWith('blob:')) return;
                    try {
                        const abs = new URL(url, window.location.href);
                        if (abs.protocol === 'http:' || abs.protocol === 'https:') {
                            if (!map.has(abs.href)) map.set(abs.href, abs.href);
                        }
                    } catch (e) {}
                }

                document.querySelectorAll('img').forEach(img => {
                    const src = img.currentSrc || img.src || img.dataset.src ||
                        img.getAttribute('data-original') || img.getAttribute('data-full') ||
                        img.getAttribute('data-hd') || img.getAttribute('data-zoom');
                    if (src) add(src);
                    if (img.srcset) {
                        img.srcset.split(',').forEach(part => {
                            const u = part.trim().split(/\s+/)[0];
                            if (u) add(u);
                        });
                    }
                });

                document.querySelectorAll('picture source').forEach(s => {
                    if (s.srcset) {
                        s.srcset.split(',').forEach(part => {
                            const u = part.trim().split(/\s+/)[0];
                            if (u) add(u);
                        });
                    }
                    if (s.src) add(s.src);
                });

                document.querySelectorAll('a').forEach(a => {
                    if (a.href && /\.(jpe?g|png|webp|gif|avif|svg|bmp)(\?.*)?$/i.test(a.href)) add(a.href);
                });

                document.querySelectorAll('meta').forEach(m => {
                    const prop = (m.getAttribute('property') || m.getAttribute('name') || '').toLowerCase();
                    if (prop === 'og:image' || prop === 'og:image:url' || prop === 'twitter:image') add(m.content);
                });

                document.querySelectorAll('div,span,section,li,a,figure,img').forEach(el => {
                    const bg = window.getComputedStyle(el).backgroundImage;
                    if (bg && bg !== 'none') {
                        (bg.match(/url\((['"]?)(.*?)\1\)/g) || []).forEach(m => {
                            const u = m.replace(/url\((['"]?)/, '').replace(/['"]?\)$/, '');
                            if (u) add(u);
                        });
                    }
                });

                done(Array.from(map.keys()));
            } catch (e) {
                done([]);
            }
        }, 50);
    });
}

// ---------------------------------------------------------------
// Message routing
// ---------------------------------------------------------------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'runScan') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs && tabs[0];
            if (!tab || !/^https?:/.test(tab.url || '')) {
                sendResponse({ ok: false, error: 'Open a normal http(s) page first.' });
                return;
            }
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: extractPageImages
            }, async (results) => {
                if (chrome.runtime.lastError || !results || !results[0] || !results[0].result) {
                    sendResponse({ ok: false, error: 'Could not scan this page.' });
                    return;
                }
                try {
                    const analyzed = await analyzeImageList(results[0].result || []);
                    lastScan = analyzed;
                    sendResponse({ ok: true, images: analyzed, fromCache: false });
                } catch (e) {
                    sendResponse({ ok: false, error: 'Analysis failed: ' + e.message });
                }
            });
        });
        return true; // async
    }

    if (request.action === 'getScan') {
        sendResponse(lastScan ? { ok: true, images: lastScan, fromCache: true } : { ok: false, error: 'No scan yet.' });
        return;
    }

    if (request.action === 'analyzeImages') {
        (async () => {
            try {
                const result = await analyzeImageList(request.urls || []);
                sendResponse({ ok: true, images: result });
            } catch (e) {
                sendResponse({ ok: false, error: 'Analysis failed: ' + e.message });
            }
        })();
        return true; // async
    }

    if (request.action === 'downloadImages') {
        const urls = request.urls;
        const baseFolder = request.folder || 'HD_Image_Grabber';
        const useFolder = request.useFolder !== false;
        const now = new Date();
        const timestamp = now.toISOString().replace(/[:T]/g, '-').slice(0, 19);
        const cleanBase = baseFolder.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim() || 'HD_Image_Grabber';

        currentDownloadIds = [];
        let completed = 0;

        urls.forEach((url, index) => {
            let filename = url.split('/').pop().split('?')[0] || `image_${index + 1}.jpg`;
            if (!filename.match(/\.(jpg|jpeg|png|webp|gif|svg|avif)$/i)) {
                filename += '.jpg';
            }
            const finalPath = useFolder
                ? `${cleanBase}/${timestamp}_${filename}`
                : filename;

            chrome.downloads.download({
                url: url,
                filename: finalPath,
                conflictAction: 'uniquify'
            }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    console.error('Download failed:', chrome.runtime.lastError.message);
                } else if (downloadId) {
                    currentDownloadIds.push(downloadId);
                }
                completed++;
                if (completed === urls.length) {
                    sendResponse({ status: 'started', downloadIds: currentDownloadIds });
                }
            });
        });
        return true;
    }

    if (request.action === 'stopDownloads') {
        const ids = request.downloadIds || currentDownloadIds;
        ids.forEach(id => {
            chrome.downloads.cancel(id, () => {});
        });
        currentDownloadIds = [];
        sendResponse({ status: 'stopped' });
    }
});

// ---------------------------------------------------------------
// ZIP download with progress via a long-lived port
// ---------------------------------------------------------------
chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'zipProgress') return;

    // Safely notify the popup; ignore errors if the popup was already closed.
    const notify = (msg) => {
        try { port.postMessage(msg); } catch (e) {}
    };
    const setBadge = (text) => {
        try { chrome.action.setBadgeText({ text }); } catch (e) {}
    };

    port.onMessage.addListener(async (request) => {
        if (request.action !== 'startZipDownload') return;

        const urls = request.urls || [];
        const useFolder = request.useFolder !== false;
        const cleanBase = (request.folder || 'HD_Image_Grabber').replace(/[^a-zA-Z0-9_\-\s]/g, '').trim() || 'HD_Image_Grabber';
        const now = new Date();
        const timestamp = now.toISOString().replace(/[:T]/g, '-').slice(0, 19);

        const total = urls.length;
        let done = 0;
        let failed = 0;
        const entries = [];

        for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            let name = url.split('/').pop().split('?')[0] || `image_${i + 1}.jpg`;
            name = safeName(name);
            if (!name.match(/\.\w{2,5}$/i)) name += '.jpg';

            try {
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), 20000);
                const resp = await fetch(url, { credentials: 'omit', signal: ctrl.signal });
                clearTimeout(timer);
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                const data = new Uint8Array(await resp.arrayBuffer());
                if (data.length === 0) throw new Error('empty');
                entries.push({ name: `${i + 1}_${name}`, data });
                done++;
            } catch (e) {
                failed++;
            }
            notify({ type: 'progress', done, failed, total, name: name });
            setBadge(String(done + failed));
        }

        if (entries.length === 0) {
            notify({ type: 'error', message: 'None of the images could be fetched.' });
            setBadge('!');
            return;
        }

        try {
            const zipBytes = buildZip(entries);
            const blob = new Blob([zipBytes], { type: 'application/zip' });
            const filename = useFolder
                ? `${cleanBase}/${timestamp}_images.zip`
                : `HD_Image_Grabber_${timestamp}.zip`;

            let dlUrl;
            let revoke = null;
            try {
                dlUrl = URL.createObjectURL(blob);
                revoke = dlUrl;
            } catch (e) {
                dlUrl = await new Promise((resolve) => {
                    const fr = new FileReader();
                    fr.onload = () => resolve(fr.result);
                    fr.onerror = () => resolve(null);
                    fr.readAsDataURL(blob);
                });
            }
            if (!dlUrl) throw new Error('Could not create a downloadable URL.');

            await new Promise((resolve) => {
                chrome.downloads.download({
                    url: dlUrl,
                    filename: filename,
                    conflictAction: 'uniquify'
                }, () => {
                    if (revoke) setTimeout(() => URL.revokeObjectURL(revoke), 30000);
                    resolve();
                });
            });

            notify({ type: 'done', filename, total, saved: done, failed });
            setBadge('OK');
            setTimeout(() => setBadge(''), 15000);
        } catch (e) {
            notify({ type: 'error', message: 'ZIP build failed: ' + e.message });
            setBadge('!');
            setTimeout(() => setBadge(''), 15000);
        }
    });
});