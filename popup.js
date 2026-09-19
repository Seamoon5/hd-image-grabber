// Popup logic for HD Image Grabber (v2)

let allImages = [];
let filteredImages = [];

document.addEventListener('DOMContentLoaded', () => {
    // Load saved settings from chrome.storage.local
    chrome.storage.local.get(['minWidth', 'minHeight', 'folderName'], (result) => {
        if (result.minWidth !== undefined) document.getElementById('min-width').value = result.minWidth;
        if (result.minHeight !== undefined) document.getElementById('min-height').value = result.minHeight;
        if (result.folderName !== undefined) document.getElementById('folder-name').value = result.folderName;

        scanImages();
    });

    // Bind buttons
    document.getElementById('btn-download').addEventListener('click', downloadSelected);
    document.getElementById('btn-select-all').addEventListener('click', () => selectAll(true));
    document.getElementById('btn-deselect-all').addEventListener('click', () => selectAll(false));
    document.getElementById('btn-rescan').addEventListener('click', scanImages);

    // Bind settings change to save automatically and re-filter
    document.getElementById('min-width').addEventListener('input', () => {
        saveSettings();
        filterImages();
    });
    document.getElementById('min-height').addEventListener('input', () => {
        saveSettings();
        filterImages();
    });
    document.getElementById('folder-name').addEventListener('input', saveSettings);
});

function saveSettings() {
    const minWidth = parseInt(document.getElementById('min-width').value) || 0;
    const minHeight = parseInt(document.getElementById('min-height').value) || 0;
    const folderName = document.getElementById('folder-name').value.trim() || 'HD_Image_Grabber';

    chrome.storage.local.set({ minWidth, minHeight, folderName });
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

// Runs inside inspected webpage
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

    // 1. Grab <img> tags
    document.querySelectorAll('img').forEach(img => {
        let src = img.currentSrc || img.src || img.dataset.src || img.getAttribute('data-original');
        addImage(src, img.naturalWidth || img.width, img.naturalHeight || img.height);
    });

    // 2. Grab <a> tags pointing to images or HD versions
    document.querySelectorAll('a').forEach(a => {
        const href = a.href;
        if (href && /\.(jpg|jpeg|png|webp|gif|svg)(\?.*)?$/i.test(href)) {
            addImage(href);
        }
    });

    // 3. Grab CSS background images
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

    filteredImages = allImages.filter(img => {
        // If dimensions unknown (0x0), keep by default
        if (img.width === 0 && img.height === 0) return true;
        return img.width >= minWidth && img.height >= minHeight;
    });

    renderGrid();
}

function renderGrid() {
    const grid = document.getElementById('image-grid');
    const totalFound = allImages.length;
    const filteredCount = filteredImages.length;
    const selectedCount = filteredImages.filter(i => i.selected).length;

    document.getElementById('stats-text').innerText = `Total: ${totalFound} | Matched: ${filteredCount}`;
    document.getElementById('selected-text').innerText = `Selected to download: ${selectedCount}`;
    document.getElementById('btn-download').innerText = `Download Selected (${selectedCount})`;

    if (filteredImages.length === 0) {
        grid.innerHTML = '<div class="loading">No images found matching minimum resolution.</div>';
        return;
    }

    grid.innerHTML = filteredImages.map((img, index) => `
        <div class="img-card ${img.selected ? 'selected' : ''}" data-index="${index}">
            <input type="checkbox" ${img.selected ? 'checked' : ''} data-index="${index}" class="img-checkbox">
            <img src="${img.url}" alt="image" loading="lazy" onerror="this.src='icon.png'">
            <div class="img-badge">${img.width && img.height ? `${img.width}x${img.height}` : 'HD'}</div>
        </div>
    `).join('');

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

function downloadSelected() {
    const selectedUrls = filteredImages.filter(i => i.selected).map(i => i.url);
    const folderName = document.getElementById('folder-name').value.trim() || 'HD_Image_Grabber';

    if (selectedUrls.length === 0) {
        alert('Please select at least one image to download.');
        return;
    }

    chrome.runtime.sendMessage({
        action: 'downloadImages',
        urls: selectedUrls,
        folder: folderName
    }, (response) => {
        if (chrome.runtime.lastError) {
            alert('Error starting download: ' + chrome.runtime.lastError.message);
        } else {
            alert(`Started downloading ${selectedUrls.length} images into a new session folder inside "${folderName}"!`);
        }
    });
}
