# HD Image Grabber (Chrome Extension)

A powerful, Fatkun-style Chrome extension for batch downloading images and HD image links from any webpage.

---

## Version History

### Version 4.0 (Current) — "True HD + ZIP"
- **HD Source Detection**: Automatically probes image URLs, strips size/quality query params (`w=`, `h=`, `q=`, `resize=`, `fit=`...) and thumbnail path tokens (`/thumb/`, `-thumb`, `_150x150`...) to find the original full-resolution file. Picks the highest-resolution valid source and shows an `⬆HD` badge.
- **Lazy-Load Auto-Scroll**: Scans lazy-loaded pages (Instagram, Google Images, stores) by automatically scrolling to the bottom before collecting images.
- **ZIP Download**: Pack all selected images into a single `Session_YYYY-MM-DD_HH-MM-SS_images.zip` file with a live progress bar.
- **URL Contains Filter**: Keep only images whose URL contains a keyword (e.g. `photo`, `/large/`).
- **Min File Size Filter**: Filter by minimum file size in KB.
- **Image Header Parsing**: Real width/height detection directly from the image file bytes (JPEG/PNG/GIF/WebP) — no UI guesses.
- **AVIF Format Filter** added (plus JPG/PNG/WebP/GIF).
- Better extraction: `<picture><source>` srcset, `srcset`, `og:image`/`twitter:image` meta tags, and multiple CSS background URLs.

### Version 3
- Copy URLs to Clipboard: Quickly copy all selected image links with one click.
- Format Filtering: Filter grabbed images by format (JPG, PNG, WebP, GIF, or All).
- Custom View Modes: Switch between Grid (Big), Grid (Small), List View, and Text Only (Name & Size) for ultra-fast browsing.
- Stop/Cancel Downloads: Ability to cancel active batch downloads instantly.
- Persistent Settings: Remembers your custom resolution, folder name, format filter, and view mode preferences.

### Version 2
- Resolution filtering and persistence via Chrome storage.
- Session-specific timestamped subfolders (`Session_YYYY-MM-DD_HH-MM-SS`) for organized downloads.
- Detailed live statistics (Total vs Filtered vs Selected).

### Version 1
- Initial release with Manifest V3 support.
- Basic image scraping (`<img>`, `<a>` tags, CSS backgrounds) and thumbnail preview.

---

## How to Install & Test
1. Open Chrome and navigate to `chrome://extensions`.
2. Turn on **Developer mode** in the top-right corner.
3. Click **Load unpacked** in the top-left corner.
4. Select the `hd-image-grabber` folder from your computer.
5. Open any webpage with images, click the extension icon, configure your preferences, and batch download!
