// Background service worker for HD Image Grabber (v3)

let currentDownloadIds = [];

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'downloadImages') {
        const urls = request.urls;
        const baseFolder = request.folder || 'HD_Image_Grabber';

        const now = new Date();
        const timestamp = now.toISOString().replace(/[:T]/g, '-').slice(0, 19);
        const cleanBase = baseFolder.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim() || 'HD_Image_Grabber';
        const sessionFolder = `${cleanBase}/Session_${timestamp}`;

        currentDownloadIds = [];
        let completed = 0;

        urls.forEach((url, index) => {
            let filename = url.split('/').pop().split('?')[0] || `image_${index + 1}.jpg`;
            if (!filename.match(/\.(jpg|jpeg|png|webp|gif|svg)$/i)) {
                filename += '.jpg';
            }
            const finalPath = `${sessionFolder}/${index + 1}_${filename}`;

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

        return true; // Keep message channel open for async response
    }

    if (request.action === 'stopDownloads') {
        const ids = request.downloadIds || currentDownloadIds;
        ids.forEach(id => {
            chrome.downloads.cancel(id, () => {
                if (chrome.runtime.lastError) {
                    // Already finished or invalid id
                }
            });
        });
        currentDownloadIds = [];
        sendResponse({ status: 'stopped' });
    }
});
