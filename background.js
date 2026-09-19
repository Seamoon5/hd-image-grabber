// Background service worker for HD Image Grabber

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'downloadImages') {
        const urls = request.urls;
        const folder = request.folder || 'HD_Image_Grabber';

        urls.forEach((url, index) => {
            let filename = url.split('/').pop().split('?')[0] || `image_${Date.now()}_${index}.jpg`;
            if (!filename.match(/\.(jpg|jpeg|png|webp|gif|svg)$/i)) {
                filename += '.jpg';
            }
            // Sanitize folder name and filename
            const cleanFolder = folder.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim() || 'HD_Image_Grabber';
            const finalPath = `${cleanFolder}/${index + 1}_${filename}`;

            chrome.downloads.download({
                url: url,
                filename: finalPath,
                conflictAction: 'uniquify'
            }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    console.error('Download failed:', chrome.runtime.lastError.message);
                }
            });
        });

        sendResponse({ status: 'started', total: urls.length });
    }
});
