# HD Image Grabber (Chrome Extension)

A powerful, Fatkun-style Chrome extension for batch downloading images and HD image links from any webpage.

---

## Version History

### Version 2 (Current)
- **Resolution Filtering**: Manually set minimum width and height to filter out low-resolution images.
- **Settings Persistence**: Automatically remembers your last entered resolution and custom folder name using Chrome storage.
- **Session-Specific Subfolders**: Creates a unique timestamped subfolder (`Session_YYYY-MM-DD_HH-MM-SS`) for every download batch so your downloads stay organized and never overwrite or mix together.
- **Live Statistics**: Displays total images found, matched resolution count, and number of selected images ready for download.
- **Unified Gallery Grid**: Displays all grabbed `<img>` tags, CSS background images, and linked HD image anchors in a single clean grid.

### Version 1
- Initial release with Manifest V3 support.
- Basic image scraping (`<img>`, `<a>` tags, CSS backgrounds).
- Basic thumbnail preview and batch download capability.

---

## How to Install & Test
1. Open Chrome and navigate to `chrome://extensions`.
2. Turn on **Developer mode** in the top-right corner.
3. Click **Load unpacked** in the top-left corner.
4. Select the `hd-image-grabber` folder from your computer.
5. Open any webpage with images, click the extension icon, set your desired resolution, and batch download!
