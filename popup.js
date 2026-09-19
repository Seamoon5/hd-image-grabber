// Popup logic for HD Image Grabber (v3)

let allImages = [];
let filteredImages = [];
let activeDownloads = [];

document.addEventListener('DOMContentLoaded', () => {
    // Load saved settings
    chrome.storage.local.get(['minWidth', 'minHeight', 'folderName', 'formatFilter', 'viewMode'], (result) => {
        if (result.minWidth !== undefined) document.getElementById('min-width').value = result.minWidth;
        if (result.minHeight !== undefined) document.getElementById('min-height').value = result.minHeight;
        if (result.folderName !== undefined) document.getElementById('folder-name').value = result.folderName;
        if (result.formatFilter !== undefined) document.getElementById('format-filter').value = result.formatFilter;
        if (result.viewMode !== undefined) document.getElementById('view-mode').value = result.viewMode;

        updateViewModeClass();
        scanImages();
    });

    // Bind buttons
    document.getElementById('btn-download').addEventListener('click', downloadSelected);
    document.getElementById('btn-stop').addEventListener('click', stopDownloads);
    document.getElementById('btn-copy').addEventListener('click', copyUrlsToClipboard);
    document.getElementById('btn-select-all').addEventListener('click', () => selectAll(true));
    document.getElementById('btn-deselect-all').addEventListener('click', () => selectAll(false));
    document.getElementById('btn-rescan').addEventListener('click', scanImages);

    // Bind settings change
    document.getElementById('min-width').addEventListener('input', () => { saveSettings(); filterImages(); });
    document.getElementById('min-height').addEventListener('input', () => { saveSettings(); filterImages(); });
    document.getElementById('folder-name').addEventListener('input', saveSettings);
    document.getElementById('format-filter').addEventListener('change', () => { saveSettings(); filterImages(); });
    document.getElementById('view-mode').addEventListener('change', () => {
        saveSettings();
        updateViewModeClass();
        renderGrid();
    });
});

function saveSettings() {
    const minWidth = parseInt(document.getElementById('min-width').value) || 0;
    const minHeight = parseInt(document.getElementById('min-height').value) || 0;
    const folderName = document.getElementById('folder-name').value.trim() || 'HD_Image_Grabber';
    const formatFilter = document.getElementById('format-filter').value;
    const viewMode = document.getElementById('view-mode').value;

    chrome.storage.local.set({ minWidth, minHeight, folderName, formatFilter, viewMode });
}

function updateViewModeClass() {
    const viewMode = document.getElementById('view-mode').value;
    const grid = document.getElementById('image-grid');
    grid.className = `grid-container mode-${viewMode}`;
}

function scanImages() {
    const grid = document.getElementById('image-grid');
    grid.innerHTML = '<div class="loading">Scanning page for images & HD links...</div>';

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) return;

        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: extractPageImages
        }, (results) => {
            if (chrome.runtime.lastError || !results || !results[0]) {
                grid.innerHTML = '<div class="loading">Could not scan this page.</div>';
                return;
            }

            allImages = results[0].result || [];
            allImages.forEach(img => img.selected = true);
            filterImages();
        });
    });
}

function extractPageImages() {
    const imagesMap = new Map();

    function addImage(url, width = 0, height = 0) {
        if (!url || url.startsWith('data:') || url.startsWith('blob:')) return;
        try {
            const absoluteUrl = new URL(url, window.location.href).href;
            if (!imagesMap.has(absoluteUrl)) {
                imagesMap.set(absoluteUrl, {
                    url: absoluteUrl,
                    width: width,
                    height: height,
                    selected: true
                });
            }
        } catch (e) {}
    }

    document.querySelectorAll('img').forEach(img => {
        let src = img.currentSrc || img.src || img.dataset.src || img.getAttribute('data-original');
        addImage(src, img.naturalWidth || img.width, img.naturalHeight || img.height);
    });

    document.querySelectorAll('a').forEach(a => {
        const href = a.href;
        if (href && /\.(jpg|jpeg|png|webp|gif|svg)(\?.*)?$/i.test(href)) {
            addImage(href);
        }
    });

    document.querySelectorAll('*').forEach(el => {
        const bg = window.getComputedStyle(el).backgroundImage;
        if (bg && bg !== 'none') {
            const match = bg.match(/url\(['"]?(.*?)['"]?\)/);
            if (match && match[1]) {
                addImage(match[1]);
            }
        }
    });

    return Array.from(imagesMap.values());
}

function filterImages() {
    const minWidth = parseInt(document.getElementById('min-width').value) || 0;
    const minHeight = parseInt(document.getElementById('min-height').value) || 0;
    const format = document.getElementById('format-filter').value;

    filteredImages = allImages.filter(img => {
        // Resolution check
        if (img.width > 0 && img.height > 0) {
            if (img.width < minWidth || img.height < minHeight) return false;
        }

        // Format check
        if (format !== 'all') {
            const lowerUrl = img.url.toLowerCase();
            if (format === 'jpg' && !lowerUrl.match(/\.(jpg|jpeg)(\?.*)?$/)) return false;
            if (format === 'png' && !lowerUrl.match(/\.png(\?.*)?$/)) return false;
            if (format === 'webp' && !lowerUrl.match(/\.webp(\?.*)?$/)) return false;
            if (format === 'gif' && !lowerUrl.match(/\.gif(\?.*)?$/)) return false;
        }

        return true;
    });

    renderGrid();
}

function renderGrid() {
    const grid = document.getElementById('image-grid');
    const totalFound = allImages.length;
    const filteredCount = filteredImages.length;
    const selectedCount = filteredImages.filter(i => i.selected).length;

    document.getElementById('stats-text').innerText = `Found: ${totalFound} | Filtered: ${filteredCount}`;
    document.getElementById('selected-text').innerText = `Selected: ${selectedCount}`;
    document.getElementById('btn-download').innerText = `Download (${selectedCount})`;

    if (filteredImages.length === 0) {
        grid.innerHTML = '<div class="loading">No images found matching criteria.</div>';
        return;
    }

    const viewMode = document.getElementById('view-mode').value;

    grid.innerHTML = filteredImages.map((img, index) => {
        const filename = img.url.split('/').pop().split('?')[0] || `image_${index}.jpg`;
        const sizeText = img.width && img.height ? `${img.width}x${img.height}` : 'HD';

        if (viewMode === 'text-only') {
            return `
                <div class="img-card ${img.selected ? 'selected' : ''}" data-index="${index}">
                    <input type="checkbox" ${img.selected ? 'checked' : ''} data-index="${index}" class="img-checkbox">
                    <div class="img-info"><b>${filename}</b> (${sizeText})</div>
                </div>
            `;
        } else if (viewMode === 'list') {
            return `
                <div class="img-card ${img.selected ? 'selected' : ''}" data-index="${index}">
                    <input type="checkbox" ${img.selected ? 'checked' : ''} data-index="${index}" class="img-checkbox">
                    <img src="${img.url}" alt="img" loading="lazy" onerror="this.src='icon.png'">
                    <div class="img-info"><b>${filename}</b> (${sizeText})</div>
                </div>
            `;
        } else {
            // Grid big or small
            return `
                <div class="img-card ${img.selected ? 'selected' : ''}" data-index="${index}">
                    <input type="checkbox" ${img.selected ? 'checked' : ''} data-index="${index}" class="img-checkbox">
                    <img src="${img.url}" alt="img" loading="lazy" onerror="this.src='icon.png'">
                    <div class="img-badge">${sizeText}</div>
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
}

function selectAll(select) {
    filteredImages.forEach(img => img.selected = select);
    renderGrid();
}

function copyUrlsToClipboard() {
    const selectedUrls = filteredImages.filter(i => i.selected).map(i => i.url);
    if (selectedUrls.length === 0) {
        alert('No images selected to copy.');
        return;
    }

    navigator.clipboard.writeText(selectedUrls.join('\n')).then(() => {
        alert(`Copied ${selectedUrls.length} image URLs to clipboard!`);
    }).catch(err => {
        alert('Failed to copy URLs: ' + err);
    });
}

function downloadSelected() {
    const selectedUrls = filteredImages.filter(i => i.selected).map(i => i.url);
    const folderName = document.getElementById('folder-name').value.trim() || 'HD_Image_Grabber';

    if (selectedUrls.length === 0) {
        alert('Please select at least one image to download.');
        return;
    }

    document.getElementById('btn-download').classList.add('hidden');
    document.getElementById('btn-stop').classList.remove('hidden');

    chrome.runtime.sendMessage({
        action: 'downloadImages',
        urls: selectedUrls,
        folder: folderName
    }, (response) => {
        if (chrome.runtime.lastError) {
            alert('Error starting download: ' + chrome.runtime.lastError.message);
            resetDownloadButtons();
        } else {
            activeDownloads = response.downloadIds || [];
            alert(`Started downloading ${selectedUrls.length} images!`);
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
    }, (response) => {
        alert('Active downloads stopped.');
        resetDownloadButtons();
    });
}

function resetDownloadButtons() {
    document.getElementById('btn-download').classList.remove('hidden');
    document.getElementById('btn-stop').classList.add('hidden');
    activeDownloads = [];
}
