// Runs inside the target page. Must be fully self-contained (no outside
// references) because chrome.scripting.executeScript injects it as-is.
function scanPageForPdfs() {
  function isPdfUrl(url) {
    const clean = url.split("#")[0].split("?")[0];
    return clean.toLowerCase().endsWith(".pdf");
  }

  const found = new Map();

  document.querySelectorAll("a[href]").forEach((a) => {
    try {
      const url = new URL(a.getAttribute("href"), location.href).href;
      if (isPdfUrl(url)) {
        const label = (a.textContent || "").trim();
        found.set(url, label || decodeURIComponent(url.split("/").pop()));
      }
    } catch (e) {
      /* ignore malformed URLs */
    }
  });

  document.querySelectorAll("embed[src], object[data], iframe[src]").forEach((el) => {
    const raw = el.getAttribute("src") || el.getAttribute("data");
    if (!raw) return;
    try {
      const url = new URL(raw, location.href).href;
      if (isPdfUrl(url) && !found.has(url)) {
        found.set(url, decodeURIComponent(url.split("/").pop()));
      }
    } catch (e) {
      /* ignore */
    }
  });

  return Array.from(found.entries()).map(([url, label]) => ({ url, label }));
}

const listEl = document.getElementById("pdfList");
const emptyStateEl = document.getElementById("emptyState");
const selectAllEl = document.getElementById("selectAllCheckbox");
const countLabelEl = document.getElementById("countLabel");
const filterEl = document.getElementById("filterInput");
const downloadBtn = document.getElementById("downloadBtn");
const statusEl = document.getElementById("statusText");
const rescanBtn = document.getElementById("rescanBtn");

let items = []; // { url, label, filename, selected }

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 150);
}

function suggestFilename(item, index) {
  let base = item.label && item.label.length > 0 ? item.label : `document-${index + 1}`;
  if (!base.toLowerCase().endsWith(".pdf")) base += ".pdf";
  return sanitizeFilename(base);
}

function render() {
  const filterText = filterEl.value.trim().toLowerCase();
  listEl.innerHTML = "";

  const visible = items.filter(
    (it) => !filterText || it.filename.toLowerCase().includes(filterText)
  );

  emptyStateEl.style.display = items.length === 0 ? "block" : "none";
  emptyStateEl.textContent =
    items.length === 0 ? "No PDF links found on this page." : "No matches.";
  if (items.length > 0 && visible.length === 0) {
    emptyStateEl.style.display = "block";
  }

  visible.forEach((item) => {
    const li = document.createElement("li");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = item.selected;
    checkbox.addEventListener("change", () => {
      item.selected = checkbox.checked;
      updateFooterAndSelectAll();
    });

    const meta = document.createElement("div");
    meta.className = "pdfMeta";
    const name = document.createElement("span");
    name.className = "pdfName";
    name.textContent = item.filename;
    name.title = item.filename;
    const url = document.createElement("span");
    url.className = "pdfUrl";
    url.textContent = item.url;
    url.title = item.url;
    meta.appendChild(name);
    meta.appendChild(url);

    li.appendChild(checkbox);
    li.appendChild(meta);
    listEl.appendChild(li);
  });

  countLabelEl.textContent = `${items.length} PDF${items.length === 1 ? "" : "s"} found`;
}

function updateFooterAndSelectAll() {
  const selectedCount = items.filter((it) => it.selected).length;
  downloadBtn.textContent = `Download selected (${selectedCount})`;
  downloadBtn.disabled = selectedCount === 0;
  selectAllEl.checked = items.length > 0 && selectedCount === items.length;
  selectAllEl.indeterminate = selectedCount > 0 && selectedCount < items.length;
}

async function scan() {
  statusEl.textContent = "";
  emptyStateEl.style.display = "block";
  emptyStateEl.textContent = "Scanning page…";
  listEl.innerHTML = "";
  items = [];
  downloadBtn.disabled = true;
  downloadBtn.textContent = "Download selected (0)";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    statusEl.textContent = "No active tab.";
    return;
  }
  if (!/^https?:/i.test(tab.url || "")) {
    emptyStateEl.textContent = "This page can't be scanned (not http/https).";
    return;
  }

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scanPageForPdfs,
    });
    const found = (result && result.result) || [];
    items = found.map((f, i) => ({
      url: f.url,
      label: f.label,
      filename: suggestFilename(f, i),
      selected: true,
    }));
    render();
    updateFooterAndSelectAll();
  } catch (e) {
    emptyStateEl.textContent = "Couldn't scan this page (permissions or restricted URL).";
    statusEl.textContent = String(e.message || e);
  }
}

selectAllEl.addEventListener("change", () => {
  items.forEach((it) => (it.selected = selectAllEl.checked));
  render();
  updateFooterAndSelectAll();
});

filterEl.addEventListener("input", render);
rescanBtn.addEventListener("click", scan);

downloadBtn.addEventListener("click", async () => {
  const selected = items.filter((it) => it.selected);
  if (selected.length === 0) return;
  downloadBtn.disabled = true;
  statusEl.textContent = `Downloading 0 / ${selected.length}…`;

  chrome.runtime.sendMessage(
    {
      type: "DOWNLOAD_PDFS",
      files: selected.map((it) => ({ url: it.url, filename: it.filename })),
    },
    () => {}
  );
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "DOWNLOAD_PROGRESS") {
    statusEl.textContent = `Downloading ${msg.done} / ${msg.total}…`;
  } else if (msg.type === "DOWNLOAD_COMPLETE") {
    statusEl.textContent = `Done — ${msg.done} saved${msg.failed ? `, ${msg.failed} failed` : ""}.`;
    updateFooterAndSelectAll();
  }
});

scan();
