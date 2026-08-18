const SUBFOLDER = "BulkPDFGrabber";
const DELAY_MS = 350; // small gap between downloads so Chrome doesn't throttle/flag them

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadOne(file) {
  const filename = `${SUBFOLDER}/${file.filename}`;
  return new Promise((resolve) => {
    chrome.downloads.download(
      { url: file.url, filename, saveAs: false, conflictAction: "uniquify" },
      (downloadId) => {
        if (chrome.runtime.lastError || downloadId === undefined) {
          resolve({ ok: false, error: chrome.runtime.lastError?.message });
        } else {
          resolve({ ok: true, downloadId });
        }
      }
    );
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "DOWNLOAD_PDFS") return;

  (async () => {
    const files = message.files || [];
    let done = 0;
    let failed = 0;

    for (const file of files) {
      const result = await downloadOne(file);
      if (!result.ok) failed += 1;
      done += 1;
      chrome.runtime.sendMessage({ type: "DOWNLOAD_PROGRESS", done, total: files.length });
      await sleep(DELAY_MS);
    }

    chrome.runtime.sendMessage({ type: "DOWNLOAD_COMPLETE", done, failed });
  })();

  sendResponse({ started: true });
  return true;
});
