const SUBFOLDER = "BulkPDFGrabber";
const DELAY_MS = 350; // stagger between downloads so Chrome doesn't throttle/flag them
const DOWNLOAD_TIMEOUT_MS = 25000; // safety net if onChanged never fires

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Minimal ZIP writer (store method -- no compression, no dependency) --
// PDFs are already internally compressed, so "store" loses nothing over
// "deflate" while keeping this dependency-free -- MV3 extensions can't pull
// in a library from a CDN (no remote code allowed), and bundling something
// like JSZip just for this is overkill when the ZIP format itself is simple
// enough to write directly.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() >> 1) & 0x1f);
  const dateVal =
    (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0xf) << 5) | (date.getDate() & 0x1f);
  return { time, dateVal };
}

// entries: [{ name: string, data: Uint8Array }]
function buildZip(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, dateVal } = dosDateTime(new Date());

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = entry.data;
    const crc = crc32(data);
    const size = data.length;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 filename flag
    local.setUint16(8, 0, true); // method: store
    local.setUint16(10, time, true);
    local.setUint16(12, dateVal, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    localParts.push(new Uint8Array(local.buffer), nameBytes, data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, time, true);
    central.setUint16(14, dateVal, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, size, true);
    central.setUint32(24, size, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint16(30, 0, true);
    central.setUint16(32, 0, true);
    central.setUint16(34, 0, true);
    central.setUint16(36, 0, true);
    central.setUint32(38, 0, true);
    central.setUint32(42, offset, true);
    centralParts.push(new Uint8Array(central.buffer), nameBytes);

    offset += 30 + nameBytes.length + size;
  }

  const centralStart = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, centralStart, true);

  return new Blob([...localParts, ...centralParts, new Uint8Array(eocd.buffer)], { type: "application/zip" });
}

function uniqueZipName(used, name) {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let n = 2;
  let candidate = `${base} (${n})${ext}`;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${base} (${n})${ext}`;
  }
  used.add(candidate);
  return candidate;
}

// Build the candidate download URL(s) for a file. Generic v1 items already
// carry a direct `url` and get returned as-is. Classroom/Drive items carry
// `id` + `type` and get resolved here.
function candidateUrls(file) {
  if (file.urls && file.urls.length) return file.urls; // pre-resolved by caller
  if (file.url) return [file.url]; // v1-style generic item

  const { id, type } = file;
  switch (type) {
    case "doc":
      return [`https://docs.google.com/document/d/${id}/export?format=pdf`];
    case "slides":
      return [`https://docs.google.com/presentation/d/${id}/export/pdf`];
    case "sheet":
      return [`https://docs.google.com/spreadsheets/d/${id}/export?format=pdf`];
    case "pdf":
    case "unknown":
    default:
      // Native Drive file. Try the classic endpoint first, then the
      // large-file "skip virus scan warning" endpoint if that one turns
      // out to have served an HTML interstitial instead of real bytes.
      // NOTE: the drive.usercontent.google.com fallback is the current
      // (2024+) replacement for the old confirm=<token> flow, but Google
      // has changed this endpoint more than once historically -- if this
      // fallback stops working, that's the first thing to re-check.
      return [
        `https://drive.google.com/uc?export=download&id=${id}`,
        `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`,
      ];
  }
}

function attemptDownload(url, filename) {
  return new Promise((resolve) => {
    chrome.downloads.download(
      { url, filename, saveAs: false, conflictAction: "uniquify" },
      (downloadId) => {
        if (chrome.runtime.lastError || downloadId === undefined) {
          resolve({ ok: false, reason: chrome.runtime.lastError?.message || "download-failed" });
          return;
        }

        let settled = false;
        const finish = (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          chrome.downloads.onChanged.removeListener(listener);
          resolve(result);
        };

        const timer = setTimeout(() => finish({ ok: true, downloadId, reason: "timeout-assumed-ok" }), DOWNLOAD_TIMEOUT_MS);

        const listener = (delta) => {
          if (delta.id !== downloadId) return;
          if (delta.state && delta.state.current === "interrupted") {
            finish({ ok: false, reason: "interrupted" });
          } else if (delta.state && delta.state.current === "complete") {
            chrome.downloads.search({ id: downloadId }, (results) => {
              const info = results[0];
              const isHtmlInterstitial = info && info.mime && info.mime.startsWith("text/html");
              if (isHtmlInterstitial) {
                // This is almost certainly Drive's "can't scan this file for
                // viruses" warning page, not the actual PDF -- remove it and
                // report failure so the caller can try the next candidate.
                chrome.downloads.removeFile(downloadId, () => {
                  finish({ ok: false, reason: "interstitial" });
                });
              } else {
                finish({ ok: true, downloadId });
              }
            });
          }
        };
        chrome.downloads.onChanged.addListener(listener);
      }
    );
  });
}

async function downloadFile(file) {
  const urls = candidateUrls(file);
  const folder = file.classFolder ? `${SUBFOLDER}/${file.classFolder}/` : `${SUBFOLDER}/`;
  const filename = folder + file.filename;

  let lastReason = "no-candidates";
  for (const url of urls) {
    const result = await attemptDownload(url, filename);
    if (result.ok) return result;
    lastReason = result.reason;
  }
  return { ok: false, reason: lastReason, file };
}

async function downloadIndividually(files) {
  let done = 0;
  let failed = 0;
  const failures = [];

  for (const file of files) {
    const result = await downloadFile(file);
    if (!result.ok) {
      failed += 1;
      failures.push({ filename: file.filename, reason: result.reason, viewUrl: file.viewUrl });
    }
    done += 1;
    chrome.runtime.sendMessage({ type: "DOWNLOAD_PROGRESS", done, total: files.length, asZip: false }).catch(() => {});
    await sleep(DELAY_MS);
  }

  chrome.runtime.sendMessage({ type: "DOWNLOAD_COMPLETE", done, failed, failures, asZip: false }).catch(() => {});
}

// Bundling requires the actual bytes (not just triggering a save-to-disk),
// so this path uses fetch() instead of chrome.downloads.download() -- it
// relies on the caller having already obtained (via chrome.permissions.
// request, prompted by the popup right before sending this message) host
// permission for the relevant origins, since a background-page fetch to a
// cross-origin URL without that permission would just fail/opaque-response.
async function fetchFileBytes(file) {
  const urls = candidateUrls(file);
  let lastReason = "no-candidates";
  for (const url of urls) {
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        lastReason = `http-${res.status}`;
        continue;
      }
      const contentType = res.headers.get("content-type") || "";
      if (contentType.startsWith("text/html")) {
        // Same interstitial signal as the individual-download path.
        lastReason = "interstitial";
        continue;
      }
      const data = new Uint8Array(await res.arrayBuffer());
      return { ok: true, data };
    } catch (e) {
      console.warn("Bulk PDF Grabber: fetch failed for", url, e);
      lastReason = "fetch-failed";
    }
  }
  return { ok: false, reason: lastReason };
}

async function downloadAsZip(files) {
  let done = 0;
  let failed = 0;
  const failures = [];
  const entries = [];
  const used = new Set();

  for (const file of files) {
    const result = await fetchFileBytes(file);
    if (result.ok) {
      const folder = file.classFolder ? `${file.classFolder}/` : "";
      entries.push({ name: uniqueZipName(used, folder + file.filename), data: result.data });
    } else {
      failed += 1;
      failures.push({ filename: file.filename, reason: result.reason, viewUrl: file.viewUrl });
    }
    done += 1;
    chrome.runtime.sendMessage({ type: "DOWNLOAD_PROGRESS", done, total: files.length, asZip: true }).catch(() => {});
  }

  if (entries.length > 0) {
    const zipUrl = URL.createObjectURL(buildZip(entries));
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await new Promise((resolve) => {
      chrome.downloads.download(
        { url: zipUrl, filename: `${SUBFOLDER}/BulkPDFGrabber-${stamp}.zip`, saveAs: false, conflictAction: "uniquify" },
        () => resolve()
      );
    });
    setTimeout(() => URL.revokeObjectURL(zipUrl), 60000);
  }

  chrome.runtime.sendMessage({ type: "DOWNLOAD_COMPLETE", done, failed, failures, asZip: true }).catch(() => {});
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "DOWNLOAD_PDFS") return;

  const files = message.files || [];
  (message.asZip ? downloadAsZip(files) : downloadIndividually(files)).catch((e) => {
    console.error("Bulk PDF Grabber: download run crashed", e);
    chrome.runtime
      .sendMessage({ type: "DOWNLOAD_COMPLETE", done: 0, failed: files.length, failures: [], asZip: !!message.asZip })
      .catch(() => {});
  });

  sendResponse({ started: true });
  return true;
});
