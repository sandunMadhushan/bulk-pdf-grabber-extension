const SUBFOLDER = "BulkPDFGrabber";
const DELAY_MS = 350; // stagger between downloads so Chrome doesn't throttle/flag them
const DOWNLOAD_TIMEOUT_MS = 25000; // safety net if onChanged never fires

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "DOWNLOAD_PDFS") return;

  (async () => {
    const files = message.files || [];
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
      chrome.runtime.sendMessage({ type: "DOWNLOAD_PROGRESS", done, total: files.length }).catch(() => {});
      await sleep(DELAY_MS);
    }

    chrome.runtime.sendMessage({ type: "DOWNLOAD_COMPLETE", done, failed, failures }).catch(() => {});
  })();

  sendResponse({ started: true });
  return true;
});
