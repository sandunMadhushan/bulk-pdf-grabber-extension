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

## v2: Classroom/Drive detection — validated against a live page

I was able to check this against a real Classroom class (ICT3215) via a
connected browser session. What that confirmed, and what's still inferred:

**Confirmed and now built accordingly:**

1. **File type is in the aria-label, not just the icon.** Every attachment
   link carries `aria-label="Attachment: PDF: <filename>.pdf"` (confirmed
   exact wording for PDF). `content-classroom.js` now parses this directly
   (`parseAriaLabel` / `typeFromLabel`) as the primary signal, with the old
   icon-mimetype guess kept only as a fallback for attachments that somehow
   lack the label.
2. **Post captions are plain text, not headings.** My original
   `nearestHeadingText` (looking for `role="heading"`/`<h1-6>`) would have
   returned nothing on a real page — Stream posts render their caption as
   plain sibling text next to the attachment grid, with no heading markup at
   all. Replaced with `nearestCaptionText`, which walks up from the
   attachment link and takes the first ancestor with non-empty text once
   nested attachment-link text is stripped out. Verified correct on both a
   single-attachment post and a 5-attachment post (correctly returned
   "Practical Labsheets" for all five, not five different values).
3. **Lazy loading is real and matters.** On page load, only attachments in
   posts already in the viewport exist in the DOM — scrolling down caused
   entirely new `<a aria-label="Attachment: ...">` elements to appear that
   weren't there before. This confirms the Deep scan approach (auto-scroll +
   MutationObserver) is necessary, not just defensive over-engineering.

**Still inferred, not empirically confirmed:**

- The exact aria-label wording for Google Docs/Slides/Sheets attachments
  (assumed to follow the same `"Attachment: <Type>: <filename>"` pattern,
  e.g. `"Attachment: Google Docs: ..."`, based on Google's general
  accessibility conventions, but I only had PDF attachments to check against
  in this account). If detection misses Docs/Slides/Sheets specifically,
  run `window.__pdfGrabberDebug()` on a post that has one and check the
  actual `aria-label` string, then adjust the regex in `typeFromLabel`.
- The Classwork tab specifically — the class I checked had no assignments
  posted yet, so attachment detection there is untested (Stream attachments
  use the same underlying attachment-card component in Classroom generally,
  so it should work the same way, but worth a quick check).
- Whether Classroom ever scrolls an inner container instead of the whole
  page — I didn't hit this in my check, but `autoScroll()` still only
  scrolls `window` (see below).

**Not exercised in this check (didn't actually trigger a download or hit an
`aria-expanded` toggle):**

- The virus-scan-interstitial fallback (`drive.usercontent.google.com/
  download?id=...&export=download&confirm=t`) — still the least proven part
  of this build. `background.js` checks the completed download's MIME type
  and retries/reports failure if it got HTML instead of a PDF, and the popup
  surfaces a manual "open in Drive" link for anything that ultimately fails
  — but if failures are common, this endpoint having changed again is the
  first thing to check.
- `expandSafeToggles()`'s unsafe-word blocklist — the class I checked didn't
  have any collapsed/expandable sections to test against, so the blocklist
  (submit, delete, turn in, etc.) hasn't been exercised against real button
  labels yet.

## Known limitations

- **Moodle "Embed" display mode**: if a Moodle admin configures a resource
  to display embedded (inline PDF viewer on the resource page) rather than
  force-download, the wrapper URL might return an HTML page instead of the
  raw PDF. `background.js`'s existing MIME-type check (originally built for
  the Drive interstitial) also catches this case and reports it as a
  failure with a manual "open" link, but it hasn't been tested against a
  real Moodle instance set to Embed mode — only against `oulms.ou.ac.lk`'s
  default (which redirects straight to the file and works cleanly).
- **`mod_folder` resources** (Moodle's "Folder" activity, shown with a
  folder icon) aren't expanded — they contain multiple files behind a
  second page, out of scope for the current icon-based single-link
  detection. Worth a v3 feature if these come up often.
- **v2.1.0's Moodle icon detection was wrong, fixed in v2.2.0.** Confirmed
  against two live sites (`oulms.ou.ac.lk` and `lms.aps.rjt.ac.lk`, different
  Moodle themes) that the icon is never nested inside the resource `<a>` --
  it's a sibling several DOM levels up, inside a shared per-activity
  container (class starting with `activity`, e.g. `.activity-grid` on
  current Boost). `hasPdfIcon()` now walks up to that container before
  searching for the icon, instead of only looking inside the link. Also
  fixed: the icon `src` can carry a query string (`.../f/pdf?filtericon=1`)
  that the old regex, applied to the raw `src`, didn't handle -- now checks
  `new URL(src).pathname` instead. And: link text can include Moodle's
  screen-reader-only suffix (`<span class="accesshide"> File</span>`),
  which was leaking into suggested filenames -- `cleanLabel()` strips
  `.accesshide`/`.sr-only`/`.visually-hidden` elements before reading text.
- **v2.2.0's `findActivityContainer()` was still wrong, fixed in v2.2.1.**
  Confirmed via real DOM markup from `lms.aps.rjt.ac.lk` (Moodle 4.x/Boost):
  matching by "class name starts with `activity`" is unreliable because the
  *title* wrapper itself uses classes like `activityname` and
  `activitytitle`, which also start with `activity` and sit between the
  link and the actual shared row container (`div.activity-grid`) — so the
  walk-up stopped 2-3 levels too early, at a container that has no icon
  inside it at all (the icon is a sibling of the title's container, not a
  descendant of it). Result: `hasPdfIcon()` always returned false on this
  site, `0 files found` even though every row clearly had a PDF icon.
  Replaced with `findIconContainer()`, which ignores class names entirely
  and instead walks up until it finds an ancestor that structurally
  *contains* an `<img>` anywhere inside it — this doesn't depend on any
  particular theme's naming scheme, so it should be robust across Moodle
  versions/themes going forward.
- **Still not verified**: confirmed on Moodle Boost (current, `.activity-grid`
  structure) on two sites. Very old Moodle versions/themes (pre-Boost, using
  `<li class="activity">` markup with the icon and link as closer siblings)
  should also work with the new structural `findIconContainer()` approach,
  but haven't been checked directly.
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

## v2.3.0: zip-bundling for 10+ files

- Selecting 10+ files and clicking Download now bundles them into a single
  `.zip` (`BulkPDFGrabber/BulkPDFGrabber-<timestamp>.zip`) instead of
  triggering N separate downloads. Below that threshold, behavior is
  unchanged (N individual downloads via `chrome.downloads.download`, as
  before).
- Bundling needs the actual file *bytes*, not just a save-to-disk trigger,
  so `background.js` uses `fetch()` for this path instead of
  `chrome.downloads.download()`. A background-page fetch to a cross-origin
  URL needs host permission for that origin or it fails/returns an opaque
  response — and the possible origins aren't knowable ahead of time (any
  LMS domain, plus Drive/Docs export endpoints for Classroom) — so
  `"<all_urls>"` is declared as `optional_host_permissions` in
  manifest.json, and `popup.js` requests it via `chrome.permissions.request`
  right when the user clicks Download with 10+ files selected (must be a
  direct result of the click for Chrome to show the prompt). If the user
  denies it, this falls back to the normal per-file download path rather
  than failing outright.
- The ZIP itself is written by hand in `background.js` (`buildZip()` /
  `crc32()` / `dosDateTime()`) using the "store" (no compression) method —
  no external library. Two reasons: MV3 extensions can't load remote code
  (no CDN, so something like JSZip would need to be vendored/bundled
  in-repo anyway), and PDFs are already internally compressed, so "store"
  loses nothing over "deflate" while keeping the whole thing dependency-free.
  Verified by generating a zip with nested folder paths and extracting it
  with Windows' native `Expand-Archive` — files and content matched.
- Duplicate filenames within the same zip (e.g. two attachments named
  `Notes.pdf` in different `classFolder`s do NOT collide since the folder
  path is part of the zip entry name, but two in the *same* folder could)
  are disambiguated with a `Notes (2).pdf`-style suffix (`uniqueZipName()`),
  same idea as `conflictAction: "uniquify"` on the individual-download path.
- Files that fail to fetch (interstitial, HTTP error, etc.) are excluded
  from the zip and reported through the existing failures list/manual-open
  fallback, same as a failed individual download.

## v2.3.1 / v2.3.2: zip download crashed silently, then found the real bug

- **v2.3.1** exposed a design mistake: the `.catch()` wrapping the whole
  download run reported a generic failure back to the popup but never
  logged the actual error, so a real crash showed only as
  "N files failed" with zero way to diagnose it. Added `console.error`
  (top-level crash) / `console.warn` (per-file fetch failure) so the next
  one would actually be visible in the service worker's console.
- **v2.3.2**, with that logging in place, the real error surfaced on the
  first retry: `TypeError: URL.createObjectURL is not a function`,
  confirmed via a live test on Edge — its MV3 service worker context
  doesn't expose `URL.createObjectURL`/`revokeObjectURL` the way Chrome's
  does, and that's what `downloadAsZip()` was using to hand the built zip
  Blob to `chrome.downloads.download()`. Replaced with a base64
  `data:application/zip;base64,...` URL instead, which
  `chrome.downloads.download()` accepts directly and doesn't depend on
  that API at all. `String.fromCharCode.apply()` hits the call-stack limit
  on large arrays, so the Blob's bytes are base64-encoded in 32KB chunks;
  verified in Node that a ~2MB buffer round-trips through this chunked
  encode/decode byte-for-byte before shipping it.

## Possible next features

1. **Smarter filenames**: currently uses the link text, falling back to the
   URL's last segment. Could add a "rename pattern" option, e.g.
   `{site}-{n}.pdf`, for when link text is junk like "Download".
2. **Persist last scan per-tab**: cache results in `chrome.storage.session`
   keyed by tab ID so reopening the popup on the same tab doesn't re-scan.
3. **"Only new since last visit" toggle**: store previously-downloaded URLs
   in `chrome.storage.local` and let users skip duplicates across sessions.
4. **Group by domain / folder mirroring**: if scanning a page with PDFs
   from multiple sub-sites, group them in the popup list under collapsible
   headers.
5. **Keyboard shortcuts**: `Ctrl+A` to select all while the popup is
   focused, `Enter` to trigger download.
6. **Dark mode**: match `prefers-color-scheme` for the popup.

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
