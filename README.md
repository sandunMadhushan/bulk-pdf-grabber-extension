# Bulk PDF Grabber

Scan any web page for PDF links, pick the ones you want, and download them
all in one click — no more clicking "Save As" 15 times in a row.

## Features

- Detects PDF links anywhere on the page you're viewing, including LMS
  wrapper links (e.g. Moodle's `mod/resource/view.php?id=...`) that don't
  end in `.pdf` but show a PDF file-type icon
- **New in v2:** on Google Classroom, also detects Drive/Docs/Slides/Sheets
  attachments on Stream and Classwork posts and downloads them as PDFs, with
  a "Deep scan" that auto-expands and scrolls the page to catch lazy-loaded
  content
- Tick individual files, or use **Select All**
- Filter the list by filename, or (on Classroom) by file type
- Downloads go into a `BulkPDFGrabber/` folder inside your normal Downloads
  folder, organized into a subfolder per class when scanning Classroom
- Nothing is uploaded anywhere — everything happens locally in your browser

## Install

**From the Chrome Web Store:** *(link goes here once published)*

**From a downloaded release (manual install):**

1. Download the latest `.zip` from the
   [Releases page](https://github.com/YOUR_USERNAME/bulk-pdf-grabber/releases)
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
  viewing, only when you open the popup — it doesn't run in the background
  (except on Classroom — see below).
- **classroom.google.com (host permission)**: needed so the extension can
  keep watching a Classroom page for newly-loaded posts even while you
  scroll, without you needing to reopen the popup each time.
- **Downloads**: used to save the files you select to your computer.
- **Storage**: used to briefly cache the list of files found on a Classroom
  page so switching tabs and back doesn't lose your scan.

This extension does not collect, store, or transmit any personal data to any
server. All scanning and downloading happens entirely on your own device,
using your own already-signed-in Google session.

## Author

Sandun Madhushan

## License

MIT — see [LICENSE](LICENSE).
