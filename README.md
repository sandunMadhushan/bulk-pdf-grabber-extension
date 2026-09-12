# Bulk PDF Grabber

Scan any web page for PDF links, pick the ones you want, and download them
all in one click — no more clicking "Save As" 15 times in a row.

## Features

- Detects PDF links anywhere on the page you're viewing, including LMS
  wrapper links (e.g. Moodle's `mod/resource/view.php?id=...`) that don't
  end in `.pdf` but show a PDF file-type icon — works across Moodle
  themes/versions, tested against multiple live Moodle sites
- On Google Classroom, also detects Drive/Docs/Slides/Sheets attachments on
  Stream and Classwork posts and downloads them as PDFs, with a "Deep scan"
  that auto-expands and scrolls the page to catch lazy-loaded content
- Tick individual files, or use **Select All**
- Filter the list by filename, or (on Classroom) by file type
- **Downloading 10+ files bundles them into a single `.zip`** instead of
  triggering that many separate downloads — asks for one-time permission to
  read the file bytes the first time, and falls back to individual
  downloads if you decline
- Downloads go into a `BulkPDFGrabber/` folder inside your normal Downloads
  folder, organized into a subfolder per class when scanning Classroom
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
6. Files will appear in `Downloads/BulkPDFGrabber/` — as individual files,
   or as a single `.zip` if you selected 10 or more.

If PDFs load onto the page after you've already opened the popup (e.g. on an
infinite-scroll page), click the ⟳ button to rescan.

## Permissions & privacy

- **Active tab / scripting**: only used to look at the page you're currently
  viewing, only when you open the popup — it doesn't run in the background
  (except on Classroom — see below).
- **classroom.google.com (host permission)**: needed so the extension can
  keep watching a Classroom page for newly-loaded posts even while you
  scroll, without you needing to reopen the popup each time.
- **Downloads**: used to save the files you select to your computer.
- **Storage**: used to briefly cache the list of files found on a Classroom
  page so switching tabs and back doesn't lose your scan.
- **Optional host permission (requested on demand)**: only asked for when
  you download 10+ files at once, to read those specific files' bytes so
  they can be bundled into a `.zip`. It's a normal Chrome permission prompt
  triggered by that click — decline it and the extension just downloads the
  files individually instead.

This extension does not collect, store, or transmit any personal data to any
server. All scanning and downloading happens entirely on your own device,
using your own already-signed-in Google session.

## Author

[Sandun Madhushan](https://github.com/sandunMadhushan)

## License

MIT — see [LICENSE](LICENSE).
