// Popup logic for HD Image Grabber (v4)

let allImages = [];
let filteredImages = [];
let activeDownloads = [];
let zipPort = null;

document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(['minWidth', 'minHeight', 'minKb', 'urlFilter', 'folderName', 'formatFilter', 'viewMode', 'saveFolder'], (result) => {
        if (result.minWidth !== undefined) document.getElementById('min-width').value = result.minWidth;
        if (result.minHeight !== undefined) document.getElementById('min-height').value = result.minHeight;
        if (result.minKb !== undefined) document.getElementById('min-kb').value = result.minKb;
        if (result.urlFilter !== undefined) document.getElementById('url-filter').value = result.urlFilter;
        if (result.folderName !== undefined) document.getElementById('folder-name').value = result.folderName;
        if (result.formatFilter !== undefined) document.getElementById('format-filter').value = result.formatFilter;
        if (result.viewMode !== undefined) document.getElementById('view-mode').value = result.viewMode;
        if (result.saveFolder !== undefined) document.getElementById('save-folder').checked = result.saveFolder;

        updateViewModeClass();
        scanImages();
    });

    document.getElementById('btn-download').addEventListener('click', downloadZip);
    document.getElementById('btn-download-files').addEventListener('click', downloadSelected);
    document.getElementById('btn-stop').addEventListener('click', stopDownloads);
    document.getElementById('btn-copy').addEventListener('click', copyUrlsToClipboard);
    document.getElementById('btn-select-all').addEventListener('click', () => selectAll(true));
    document.getElementById('btn-deselect-all').addEventListener('click', () => selectAll(false));
    document.getElementById('btn-rescan').addEventListener('click', () => scanImages(true));

    ['min-width', 'min-height', 'min-kb', 'url-filter'].forEach(id => {
        document.getElementById(id).addEventListener('input', () => { saveSettings(); filterImages(); });
    });
    document.getElementById('save-folder').addEventListener('change', () => { saveSettings(); });
    document.getElementById('format-filter').addEventListener('change', () => { saveSettings(); filterImages(); });
    document.getElementById('view-mode').addEventListener('change', () => {
        saveSettings();
        updateViewModeClass();
        renderGrid();
    });
});

function saveSettings() {
    chrome.storage.local.set({
        minWidth: parseInt(document.getElementById('min-width').value) || 0,
        minHeight: parseInt(document.getElementById('min-height').value) || 0,
        minKb: parseInt(document.getElementById('min-kb').value) || 0,
        urlFilter: document.getElementById('url-filter').value.trim(),
        folderName: document.getElementById('folder-name').value.trim() || 'HD_Image_Grabber',
        formatFilter: document.getElementById('format-filter').value,
        viewMode: document.getElementById('view-mode').value,
        saveFolder: document.getElementById('save-folder').checked
    });
}

function updateViewModeClass() {
    const grid = document.getElementById('image-grid');
    grid.className = `grid-container mode-${document.getElementById('view-mode').value}`;
}

// ---------- Scanning (driven by the background worker so it survives popup close) ----------

function scanImages(forceRefresh) {
    const grid = document.getElementById('image-grid');
    grid.innerHTML = '<div class="loading">Scrolling page & grabbing images...</div>';

    // If we already have a scan cached in the background, show it instantly first.
    const showCached = () => {
        chrome.runtime.sendMessage({ action: 'getScan' }, (response) => {
            if (response && response.ok && !forceRefresh) {
                const found = response.images || [];
                loadResults(found);
            }
        });
    };

    showCached();

    chrome.runtime.sendMessage({ action: 'runScan' }, (response) => {
        if (chrome.runtime.lastError || !response || !response.ok) {
            const err = response && response.error ? response.error : chrome.runtime.lastError;
            grid.innerHTML = `<div class="loading">Could not scan: ${err}</div>`;
            return;
        }
        loadResults(response.images || []);
    });
}

function loadResults(images) {
    const grid = document.getElementById('image-grid');
    if (images.length === 0) {
        grid.innerHTML = '<div class="loading">No images found on this page.</div>';
        return;
    }

    // Show the found images IMMEDIATELY using their own URLs (they work on the page),
    // so the user sees results right away instead of a silent wait.
    allImages = images.map(img => ({
        url: img.url,
        hdUrl: img.hdUrl || img.url,
        width: img.width || 0,
        height: img.height || 0,
        fileSize: img.fileSize || 0,
        format: img.format || 'unknown',
        selected: true
    }));
    filterImages();
    document.getElementById('selected-text').innerText = `Found ${allImages.length} images`;
}

// ---------- Filtering ----------

function filterImages() {
    const minWidth = parseInt(document.getElementById('min-width').value) || 0;
    const minHeight = parseInt(document.getElementById('min-height').value) || 0;
    const minKb = parseInt(document.getElementById('min-kb').value) || 0;
    const urlFilter = document.getElementById('url-filter').value.trim();
    const format = document.getElementById('format-filter').value;

    filteredImages = allImages.filter(img => {
        if (img.width > 0 && img.height > 0) {
            if (img.width < minWidth || img.height < minHeight) return false;
        }
        if (img.fileSize > 0 && img.fileSize < minKb * 1024) return false;
        if (urlFilter) {
            if (!img.hdUrl.toLowerCase().includes(urlFilter.toLowerCase()) &&
                !img.url.toLowerCase().includes(urlFilter.toLowerCase())) return false;
        }
        if (format !== 'all' && img.format !== format) return false;
        return true;
    });

    renderGrid();
}

function fallbackIcon(imgEl) {
    if (imgEl.dataset.fb) return;
    imgEl.dataset.fb = '1';
    imgEl.src = 'icon.png';
}

function renderGrid() {
    const grid = document.getElementById('image-grid');
    const totalFound = allImages.length;
    const filteredCount = filteredImages.length;
    const selectedCount = filteredImages.filter(i => i.selected).length;

    document.getElementById('stats-text').innerText = `Found: ${totalFound} | Filtered: ${filteredCount}`;
    document.getElementById('selected-text').innerText = `Selected: ${selectedCount}`;
    document.getElementById('btn-download-files').innerText = `⬇ Download (${selectedCount})`;

    if (filteredImages.length === 0) {
        grid.innerHTML = '<div class="loading">No images found matching criteria.</div>';
        return;
    }

    const viewMode = document.getElementById('view-mode').value;

    grid.innerHTML = filteredImages.map((img, index) => {
        const filename = img.hdUrl.split('/').pop().split('?')[0] || `image_${index}.jpg`;
        const sizeText = img.width && img.height ? `${img.width}x${img.height}` : 'HD?';
        const kbText = img.fileSize ? ` ~${Math.round(img.fileSize / 1024)}KB` : '';
        const isHd = img.hdUrl !== img.url;
        const hdFlag = isHd ? ' <span class="badge-hd">⬆HD</span>' : '';
        const info = `${filename} (${sizeText}${kbText})${hdFlag}`;

        if (viewMode === 'text-only') {
            return `
                <div class="img-card ${img.selected ? 'selected' : ''}" data-index="${index}">
                    <input type="checkbox" ${img.selected ? 'checked' : ''} data-index="${index}" class="img-checkbox">
                    <div class="img-info">${info}</div>
                </div>
            `;
        } else if (viewMode === 'list') {
            return `
                <div class="img-card ${img.selected ? 'selected' : ''}" data-index="${index}">
                    <input type="checkbox" ${img.selected ? 'checked' : ''} data-index="${index}" class="img-checkbox">
                    <img src="${img.url}" alt="img" loading="lazy">
                    <div class="img-info">${info}</div>
                </div>
            `;
        } else {
            const badge = isHd
                ? `<div class="img-badge hd">⬆</div><div class="img-badge">${sizeText}</div>`
                : `<div class="img-badge">${sizeText}</div>`;
            return `
                <div class="img-card ${img.selected ? 'selected' : ''}" data-index="${index}">
                    <input type="checkbox" ${img.selected ? 'checked' : ''} data-index="${index}" class="img-checkbox">
                    <img src="${img.url}" alt="img" loading="lazy">
                    ${badge}
                </div>
            `;
        }
    }).join('');

    document.querySelectorAll('.img-card').forEach(card => {
        const index = parseInt(card.getAttribute('data-index'));
        card.addEventListener('click', () => {
            filteredImages[index].selected = !filteredImages[index].selected;
            renderGrid();
        });
    });

    grid.querySelectorAll('img').forEach(im => {
        im.addEventListener('error', () => fallbackIcon(im));
    });
}

function selectAll(select) {
    filteredImages.forEach(img => img.selected = select);
    renderGrid();
}

function copyUrlsToClipboard() {
    const selectedUrls = filteredImages.filter(i => i.selected).map(i => i.hdUrl);
    if (selectedUrls.length === 0) {
        alert('No images selected to copy.');
        return;
    }
    navigator.clipboard.writeText(selectedUrls.join('\n')).then(() => {
        alert(`Copied ${selectedUrls.length} HD image URLs to clipboard!`);
    }).catch(err => {
        alert('Failed to copy URLs: ' + err);
    });
}

function getSelectedUrls() {
    return filteredImages.filter(i => i.selected).map(i => i.hdUrl);
}

function getFolderName() {
    return document.getElementById('folder-name').value.trim() || 'HD_Image_Grabber';
}

// ---------- Downloads ----------

function downloadZip() {
    const urls = getSelectedUrls();
    if (urls.length === 0) {
        alert('Please select at least one image to download.');
        return;
    }

    showZipProgress(urls.length);
    try { zipPort && zipPort.disconnect(); } catch (e) {}
    zipPort = chrome.runtime.connect({ name: 'zipProgress' });

    zipPort.onMessage.addListener((msg) => {
        if (msg.type === 'progress') {
            updateZipProgress(msg.done + (msg.failed || 0), msg.total, msg.name);
        } else if (msg.type === 'done') {
            hideZipProgress();
            alert(`ZIP ready! Saved ${msg.saved} of ${msg.total} images. File: ${msg.filename}`);
            zipPort.disconnect();
        } else if (msg.type === 'error') {
            hideZipProgress();
            alert('ZIP failed: ' + msg.message);
            zipPort.disconnect();
        }
    });

    zipPort.postMessage({
        action: 'startZipDownload',
        urls,
        folder: getFolderName(),
        useFolder: document.getElementById('save-folder').checked
    });
}

function downloadSelected() {
    const urls = getSelectedUrls();
    if (urls.length === 0) {
        alert('Please select at least one image to download.');
        return;
    }

    document.getElementById('btn-download-files').classList.add('hidden');
    document.getElementById('btn-stop').classList.remove('hidden');

    chrome.runtime.sendMessage({
        action: 'downloadImages',
        urls,
        folder: getFolderName(),
        useFolder: document.getElementById('save-folder').checked
    }, (response) => {
        if (chrome.runtime.lastError) {
            alert('Error starting download: ' + chrome.runtime.lastError.message);
            resetDownloadButtons();
        } else {
            activeDownloads = (response && response.downloadIds) || [];
            const where = document.getElementById('save-folder').checked ? `into "${getFolderName()}" folder` : 'directly into Downloads';
            alert(`Started downloading ${urls.length} images ${where}!`);
            resetDownloadButtons();
        }
    });
}

function stopDownloads() {
    if (activeDownloads.length === 0) {
        resetDownloadButtons();
        return;
    }
    chrome.runtime.sendMessage({
        action: 'stopDownloads',
        downloadIds: activeDownloads
    }, () => {
        alert('Active downloads stopped.');
        resetDownloadButtons();
    });
}

function resetDownloadButtons() {
    document.getElementById('btn-download-files').classList.remove('hidden');
    document.getElementById('btn-stop').classList.add('hidden');
    activeDownloads = [];
}

function showZipProgress(total) {
    document.getElementById('zip-progress').classList.remove('hidden');
    document.getElementById('zip-bar-fill').style.width = '0%';
    document.getElementById('zip-text').innerText = `Packing 0 / ${total} images...`;
    document.getElementById('btn-download').disabled = true;
}

function updateZipProgress(done, total, name) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    document.getElementById('zip-bar-fill').style.width = pct + '%';
    document.getElementById('zip-text').innerText = `Packed ${done} / ${total}: ${name}`;
}

function hideZipProgress() {
    document.getElementById('zip-progress').classList.add('hidden');
    document.getElementById('btn-download').disabled = false;
}