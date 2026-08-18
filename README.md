# Bulk PDF Grabber

Scan any web page for PDF links, pick the ones you want, and download them
all in one click — no more clicking "Save As" 15 times in a row.

## Features

- Detects PDF links anywhere on the page you're viewing
- Tick individual files, or use **Select All**
- Filter the list by filename
- Downloads go into a `BulkPDFGrabber/` folder inside your normal Downloads
  folder
- Nothing is uploaded anywhere — everything happens locally in your browser

## Install

**From the Chrome Web Store:** *(link goes here once published)*

**From a downloaded release (manual install):**

1. Download the latest `.zip` from the
   [Releases page](https://github.com/sandunMadhushan/bulk-pdf-grabber-extension/releases)
   and unzip it.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right toggle).
4. Click **Load unpacked** and select the unzipped folder.
5. The extension icon will appear in your toolbar.

## How to use

1. Open a page that has PDF links on it.
2. Click the Bulk PDF Grabber icon in your toolbar.
3. Review the list of PDFs it found — everything is selected by default.
4. Uncheck anything you don't want, or use the filter box to narrow the list.
5. Click **Download selected**.
6. Files will appear in `Downloads/BulkPDFGrabber/`.

If PDFs load onto the page after you've already opened the popup (e.g. on an
infinite-scroll page), click the ⟳ button to rescan.

## Permissions & privacy

- **Active tab / scripting**: only used to look at the page you're currently
  viewing, only when you open the popup — it doesn't run in the background.
- **Downloads**: used to save the files you select to your computer.

This extension does not collect, store, or transmit any personal data. All
scanning and downloading happens entirely on your own device.

## Author

Sandun Madhushan

## License

MIT — see [LICENSE](LICENSE).
