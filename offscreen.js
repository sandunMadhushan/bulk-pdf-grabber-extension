// Runs in an offscreen document (chrome.offscreen), a real DOM context the
// MV3 background service worker doesn't have. Its only job here is to
// create a Blob object URL for the zip file background.js builds --
// URL.createObjectURL is unavailable in some browsers' service worker
// context (confirmed missing in Edge, see DEVELOPMENT.md's v2.3.2 note).
//
// The zip bytes arrive as a sequence of small chunks rather than one big
// message -- sending the whole thing in a single runtime.sendMessage call
// was tried first and failed outright ("Could not serialize message") for
// a large zip. Collecting chunks into an array and building the Blob from
// that array at the end avoids ever needing one giant string or one giant
// message: `new Blob(chunks)` accepts an array of parts directly.
const pendingTransfers = new Map();

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "OFFSCREEN_ZIP_BEGIN") {
    pendingTransfers.set(message.transferId, []);
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === "OFFSCREEN_ZIP_CHUNK") {
    const chunks = pendingTransfers.get(message.transferId);
    if (chunks) chunks.push(base64ToBytes(message.base64));
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === "OFFSCREEN_ZIP_FINISH") {
    const chunks = pendingTransfers.get(message.transferId) || [];
    pendingTransfers.delete(message.transferId);
    const blob = new Blob(chunks, { type: message.mimeType || "application/octet-stream" });
    sendResponse({ url: URL.createObjectURL(blob) });
    return false;
  }
  if (message.type === "OFFSCREEN_REVOKE_BLOB_URL") {
    URL.revokeObjectURL(message.url);
    return false;
  }
});
