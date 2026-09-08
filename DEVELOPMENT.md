# Development notes

Internal notes for building on / publishing this extension. Not part of the
public-facing README.

## How it works

- **popup.js** injects a self-contained scan function into the active tab
  only when you open the popup (via `chrome.scripting.executeScript` +
  the `activeTab` permission) — it does **not** run on every page you visit,
  and it does not need broad `<all_urls>` host permissions.
- The scan looks at `<a href>` links, and `<embed>` / `<object>` / `<iframe>`
  elements, and keeps anything whose URL ends in `.pdf`.
- **background.js** (a service worker) receives the selected list and calls
  `chrome.downloads.download()` for each one, spaced ~350ms apart, saving
  everything into a `BulkPDFGrabber/` subfolder in your Downloads folder.

## v2: Classroom/Drive detection — things to verify live

I built this without being able to log into an actual Google Classroom
account, so the detection logic deliberately avoids depending on Classroom's
CSS class names (which are minified and change across deploys) and instead
keys off stable signals: URL shape, `aria-expanded`, and heading roles. That
said, these are the specific things to check against a real Classroom
Stream/Classwork page before shipping:

1. **File-type detection accuracy** (`guessType` in `content-classroom.js`).
   For links that are `drive.google.com/file/d/...` (ambiguous — could be a
   PDF, image, video, zip, anything), it currently looks for a mimetype
   string inside a nearby `<img src>` icon, then falls back to checking if
   the visible label ends in `.pdf`. Run `window.__pdfGrabberDebug()` in the
   Classroom page's console and check the `type` column against what you
   know each attachment actually is. If accuracy is poor, the fastest fix is
   usually widening what counts as "nearby" (the `card` selector) or
   inspecting one real attachment's DOM in DevTools to find a better icon
   selector.
2. **Post/assignment title extraction** (`nearestHeadingText`). This walks
   up from the link looking for the nearest `role="heading"` or `<h1-6>`.
   Classroom does use heading roles for post titles, but confirm the text
   it captures isn't something unrelated (like the class name repeated on
   every item, or truncated/empty for some posts).
3. **The virus-scan-interstitial fallback** — `drive.usercontent.google.com/
   download?id=...&export=download&confirm=t`. This is the current (2024+)
   replacement for Drive's old `confirm=<token>` cookie flow, but Google has
   changed this mechanism more than once over the years, so treat it as the
   least stable part of this build. `background.js` already checks the
   downloaded file's MIME type and retries/fails over if it detects an HTML
   page instead of a real file, and the popup surfaces a manual "open in
   Drive" link for anything that ultimately fails — but if you start seeing
   a lot of failures, that endpoint having changed again is the first thing
   to check.
4. **Auto-expand safety** (`expandSafeToggles`). It clicks any
   `[aria-expanded="false"]` element whose label doesn't match an unsafe-word
   blocklist (submit, delete, turn in, etc.). Skim that blocklist against
   whatever labels your real Classroom UI uses before relying on it — it's a
   best-effort safety net, not a guarantee.
5. **Auto-scroll container**. It scrolls `window`/`document.body` rather
   than a specific Classroom container, since I don't know whether Classroom
   scrolls the whole page or an inner `overflow: auto` div. If posts aren't
   loading during Deep scan, Classroom is probably using an inner scroll
   container — find it in DevTools and swap the `window.scrollBy` call in
   `autoScroll()` for `container.scrollBy`.

## Known limitations

- **Cross-origin iframes**: if a PDF is embedded inside an `<iframe>` from a
  different domain, the script can usually still read its `src` attribute,
  but it can't reach into the iframe's own DOM — so PDFs linked *inside*
  a cross-origin iframe's content (not just the iframe's own src) won't be
  found. This is a browser security boundary, not something permissions can
  fix.
- **Infinite-scroll / SPA pages**: new PDFs that load in after the popup
  opened won't appear until the user clicks rescan (⟳).
- **Chrome PDF viewer tabs**: if a PDF is already open full-page in a tab
  (URL ends in `.pdf` and Chrome's viewer is showing it), that's not a
  "page with links" — there's nothing to scan. Consider special-casing this:
  if `tab.url` itself ends in `.pdf`, just offer to download that one file
  directly instead of scanning.

## Possible next features

1. **Smarter filenames**: currently uses the link text, falling back to the
   URL's last segment. Could add a "rename pattern" option, e.g.
   `{site}-{n}.pdf`, for when link text is junk like "Download".
2. **Persist last scan per-tab**: cache results in `chrome.storage.session`
   keyed by tab ID so reopening the popup on the same tab doesn't re-scan.
3. **"Only new since last visit" toggle**: store previously-downloaded URLs
   in `chrome.storage.local` and let users skip duplicates across sessions.
4. **Zip-and-download option**: bundle selected PDFs into a single `.zip`
   client-side (e.g. with JSZip) instead of N separate downloads — nicer for
   very large batches, at the cost of holding all files in memory first.
5. **Group by domain / folder mirroring**: if scanning a page with PDFs
   from multiple sub-sites, group them in the popup list under collapsible
   headers.
6. **Keyboard shortcuts**: `Ctrl+A` to select all while the popup is
   focused, `Enter` to trigger download.
7. **Dark mode**: match `prefers-color-scheme` for the popup.

## Publishing to the Chrome Web Store

1. **Icons**: already included at 16/48/128px in `icons/` (simple placeholder
   design — swap in your own branding before publishing).
2. **Zip it**: from inside the `pdf-grabber/` folder, zip the *contents*
   (not the folder itself) — the zip's root must contain `manifest.json`
   directly:
   ```
   cd pdf-grabber
   zip -r ../pdf-grabber.zip . -x ".git/*"
   ```
3. **Developer account**: go to the
   [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole),
   pay the one-time $5 registration fee if you haven't already.
4. **New item** → upload the zip.
5. Fill in the store listing: name, short/long description, at least one
   1280x800 (or 640x400) screenshot, and a category (e.g. "Productivity" or
   "Tools").
6. **Privacy practices tab**: you'll be asked to justify each permission.
   - `activeTab` + `scripting`: "used to scan the currently open tab for PDF
     links only when the user opens the extension popup."
   - `downloads`: "used to save the PDF files the user selects to their
     Downloads folder."
   Since this extension collects no personal data and sends nothing to any
   server, you can state "This extension does not collect or transmit user
   data" — you technically don't need a hosted privacy policy for that
   declaration, but the dashboard may still prompt for a policy URL; a short
   one-line policy page works fine.
7. Submit for review. Simple, single-purpose extensions like this typically
   clear review in a few days, faster than ones requesting broad host
   permissions — which is why this build avoids `<all_urls>`.

## Testing checklist before submitting

- [ ] Test on a page with 15+ real PDF links (e.g. a university course page
      or an academic papers index).
- [ ] Test on a page with zero PDFs (empty state shows correctly).
- [ ] Test filter box narrows the list.
- [ ] Test Select All / individual unchecking / partial-selection
      (indeterminate) state.
- [ ] Test on `chrome://` or `file://` pages (should show the "can't be
      scanned" message instead of erroring).
- [ ] Confirm downloaded files land in `Downloads/BulkPDFGrabber/`.
