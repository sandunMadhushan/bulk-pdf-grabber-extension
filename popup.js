// ---- Generic page scan (v1 behavior, extended in v2.1/2.2 for LMS pages) --
// Runs inside the target page. Must be fully self-contained (no outside
// references) because chrome.scripting.executeScript injects it as-is.
function scanPageForPdfs() {
  function isPdfUrl(url) {
    const clean = url.split("#")[0].split("?")[0];
    return clean.toLowerCase().endsWith(".pdf");
  }

  // CONFIRMED against a live Moodle 4.x/Boost course page (real console
  // output) that class-name matching (anything starting with "activity")
  // is NOT reliable: the title wrapper itself uses classes like
  // "activityname" / "activitytitle", which also start with "activity" and
  // sit BETWEEN the link and the actual shared container -- so matching by
  // class prefix stops one or two levels too early, before ever reaching
  // an ancestor that has the icon as a descendant. The icon
  // (div.activity-icon) and the title (div.activity-name-area) are
  // siblings under a common wrapper (div.activity-grid) several levels up;
  // there's no reliable class name to target directly across themes, so
  // instead walk up until an ancestor actually *contains* an <img>
  // anywhere inside it -- structural, not name-based, so it isn't tripped
  // up by any particular theme's class-naming scheme.
  function findIconContainer(el) {
    let node = el;
    for (let d = 0; node && d < 10; d++, node = node.parentElement) {
      if (node.querySelector && node.querySelector("img[src]")) return node;
    }
    return null;
  }

  function hasPdfIcon(a) {
    const container = findIconContainer(a) || a;
    const img = container.querySelector("img[src]");
    if (!img) return false;
    // Use the URL's pathname, not the raw src string -- Moodle's icon URLs
    // often carry a query string (e.g. ".../f/pdf?filtericon=1") that a
    // plain substring/regex check on the full src can trip over.
    let path;
    try {
      path = new URL(img.src, location.href).pathname;
    } catch (e) {
      path = img.src || "";
    }
    if (/\/f\/pdf(?:[-_.]|$)/i.test(path)) return true;
    const alt = (img.alt || "").toLowerCase();
    return /\bpdf\b/i.test(alt);
  }

  // Moodle appends screen-reader-only text to activity links (e.g.
  // `<span class="accesshide"> File</span>`), which would otherwise leak
  // into the suggested filename as a trailing "File"/"Folder"/etc.
  function cleanLabel(a) {
    const clone = a.cloneNode(true);
    clone.querySelectorAll(".accesshide, .sr-only, .visually-hidden").forEach((n) => n.remove());
    return clone.textContent.replace(/\s+/g, " ").trim();
  }

  const found = new Map();

  document.querySelectorAll("a[href]").forEach((a) => {
    let url;
    try {
      url = new URL(a.getAttribute("href"), location.href).href;
    } catch (e) {
      return; // ignore malformed URLs
    }
    const label = cleanLabel(a);
    if (isPdfUrl(url)) {
      found.set(url, label || decodeURIComponent(url.split("/").pop()));
    } else if (label && hasPdfIcon(a)) {
      // e.g. a Moodle "mod/resource/view.php?id=123" wrapper link
      found.set(url, label);
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

// ---- Shared UI state ----------------------------------------------------
const listEl = document.getElementById("pdfList");
const emptyStateEl = document.getElementById("emptyState");
const selectAllEl = document.getElementById("selectAllCheckbox");
const countLabelEl = document.getElementById("countLabel");
const filterEl = document.getElementById("filterInput");
const downloadBtn = document.getElementById("downloadBtn");
const statusEl = document.getElementById("statusText");
const rescanBtn = document.getElementById("rescanBtn");
const titleEl = document.getElementById("titleText");
const typeChipsEl = document.getElementById("typeChips");
const deepScanBtn = document.getElementById("deepScanBtn");
const failuresBox = document.getElementById("failuresBox");
const failuresHeading = document.getElementById("failuresHeading");
const failuresList = document.getElementById("failuresList");

let mode = "generic"; // 'generic' | 'classroom'
let activeTabId = null;
let items = []; // normalized: { key, filename, type, postTitle, selected, payload }
let activeTypeFilter = "all";

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 150);
}

function suggestFilename(label, index) {
  let base = label && label.length > 0 ? label : `document-${index + 1}`;
  if (!base.toLowerCase().endsWith(".pdf")) base += ".pdf";
  return sanitizeFilename(base);
}

// ---- Rendering ------------------------------------------------------------
function badgeLabel(type) {
  return { pdf: "PDF", doc: "Doc", slides: "Slides", sheet: "Sheet", unknown: "Other" }[type] || "";
}

function render() {
  const filterText = filterEl.value.trim().toLowerCase();
  listEl.innerHTML = "";

  const visible = items.filter((it) => {
    if (activeTypeFilter !== "all" && it.type !== activeTypeFilter) return false;
    if (filterText && !it.filename.toLowerCase().includes(filterText)) return false;
    return true;
  });

  emptyStateEl.style.display = items.length === 0 ? "block" : "none";
  emptyStateEl.textContent =
    items.length === 0
      ? mode === "classroom"
        ? "No PDFs/Docs found yet — try Deep scan to load lazy content."
        : "No PDF links found on this page."
      : "No matches.";
  if (items.length > 0 && visible.length === 0) emptyStateEl.style.display = "block";

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

    const nameRow = document.createElement("span");
    nameRow.className = "pdfName";
    nameRow.textContent = item.filename;
    nameRow.title = item.filename;
    if (item.type) {
      const badge = document.createElement("span");
      badge.className = `pdfBadge ${item.type}`;
      badge.textContent = badgeLabel(item.type);
      nameRow.appendChild(badge);
    }

    const subLine = document.createElement("span");
    subLine.className = mode === "classroom" ? "pdfPostTitle" : "pdfUrl";
    subLine.textContent = mode === "classroom" ? item.postTitle || "" : item.payload.url || "";
    subLine.title = subLine.textContent;

    meta.appendChild(nameRow);
    meta.appendChild(subLine);
    li.appendChild(checkbox);
    li.appendChild(meta);
    listEl.appendChild(li);
  });

  countLabelEl.textContent = `${items.length} file${items.length === 1 ? "" : "s"} found`;
}

function updateFooterAndSelectAll() {
  const visible = items.filter((it) => activeTypeFilter === "all" || it.type === activeTypeFilter);
  const selectedCount = items.filter((it) => it.selected).length;
  downloadBtn.textContent = `Download selected (${selectedCount})`;
  downloadBtn.disabled = selectedCount === 0;
  const visSelected = visible.filter((it) => it.selected).length;
  selectAllEl.checked = visible.length > 0 && visSelected === visible.length;
  selectAllEl.indeterminate = visSelected > 0 && visSelected < visible.length;
}

// ---- Generic-page scanning ------------------------------------------------
async function scanGeneric(tab) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: scanPageForPdfs,
  });
  const found = (result && result.result) || [];
  items = found.map((f, i) => {
    const filename = suggestFilename(f.label, i);
    return {
      key: f.url,
      filename,
      type: "pdf",
      postTitle: "",
      selected: true,
      payload: { url: f.url, filename, viewUrl: f.url },
    };
  });
}

// ---- Classroom scanning ----------------------------------------------------
function toClassroomItems(rawItems) {
  return rawItems.map((r) => ({
    key: r.id,
    filename: r.filename,
    type: r.type,
    postTitle: r.postTitle,
    selected: r.type !== "unknown", // unknown files unselected by default -- may not be PDFs
    payload: {
      id: r.id,
      type: r.type,
      filename: r.filename,
      classFolder: r.className,
      viewUrl: `https://drive.google.com/file/d/${r.id}/view`,
    },
  }));
}

async function scanClassroom(tab, deep) {
  const messageType = deep ? "CLASSROOM_DEEP_SCAN" : "CLASSROOM_QUICK_SCAN";
  if (deep) {
    deepScanBtn.disabled = true;
    statusEl.textContent = "Expanding and scrolling the page…";
  }
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: messageType });
    items = toClassroomItems((response && response.items) || []);
  } catch (e) {
    // Content script may not have loaded yet (e.g. page just navigated) --
    // fall back to whatever was last cached for this tab, if anything.
    statusEl.textContent = "Couldn't reach the page scanner — try Deep scan.";
  }
  if (deep) deepScanBtn.disabled = false;
}

// ---- Boot / mode detection --------------------------------------------------
async function boot() {
  statusEl.textContent = "";
  emptyStateEl.style.display = "block";
  emptyStateEl.textContent = "Scanning page…";
  listEl.innerHTML = "";
  items = [];
  failuresBox.classList.add("hidden");
  downloadBtn.disabled = true;
  downloadBtn.textContent = "Download selected (0)";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    statusEl.textContent = "No active tab.";
    return;
  }
  activeTabId = tab.id;

  let hostname = "";
  try {
    hostname = new URL(tab.url || "").hostname;
  } catch {
    /* ignore */
  }

  if (hostname === "classroom.google.com") {
    mode = "classroom";
    titleEl.textContent = "Bulk PDF Grabber — Classroom";
    typeChipsEl.classList.remove("hidden");
    deepScanBtn.classList.remove("hidden");
    await scanClassroom(tab, false);
  } else {
    mode = "generic";
    titleEl.textContent = "Bulk PDF Grabber";
    typeChipsEl.classList.add("hidden");
    deepScanBtn.classList.add("hidden");
    if (!/^https?:/i.test(tab.url || "")) {
      emptyStateEl.textContent = "This page can't be scanned (not http/https).";
      return;
    }
    try {
      await scanGeneric(tab);
    } catch (e) {
      emptyStateEl.textContent = "Couldn't scan this page (permissions or restricted URL).";
      statusEl.textContent = String(e.message || e);
      return;
    }
  }

  render();
  updateFooterAndSelectAll();
}

// ---- Event wiring -----------------------------------------------------------
selectAllEl.addEventListener("change", () => {
  const visible = items.filter((it) => activeTypeFilter === "all" || it.type === activeTypeFilter);
  visible.forEach((it) => (it.selected = selectAllEl.checked));
  render();
  updateFooterAndSelectAll();
});

filterEl.addEventListener("input", render);
rescanBtn.addEventListener("click", boot);

deepScanBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  await scanClassroom(tab, true);
  render();
  updateFooterAndSelectAll();
  statusEl.textContent = `Deep scan complete — ${items.length} file(s) found.`;
});

typeChipsEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  typeChipsEl.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
  btn.classList.add("active");
  activeTypeFilter = btn.dataset.type;
  render();
  updateFooterAndSelectAll();
});

downloadBtn.addEventListener("click", () => {
  const selected = items.filter((it) => it.selected);
  if (selected.length === 0) return;
  downloadBtn.disabled = true;
  failuresBox.classList.add("hidden");
  statusEl.textContent = `Downloading 0 / ${selected.length}…`;

  chrome.runtime.sendMessage(
    { type: "DOWNLOAD_PDFS", files: selected.map((it) => it.payload) },
    () => {}
  );
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "DOWNLOAD_PROGRESS") {
    statusEl.textContent = `Downloading ${msg.done} / ${msg.total}…`;
  } else if (msg.type === "DOWNLOAD_COMPLETE") {
    statusEl.textContent = `Done — ${msg.done - msg.failed} saved${msg.failed ? `, ${msg.failed} failed` : ""}.`;
    updateFooterAndSelectAll();

    if (msg.failed > 0 && msg.failures && msg.failures.length) {
      failuresBox.classList.remove("hidden");
      failuresHeading.textContent = `${msg.failed} file(s) need manual download:`;
      failuresList.innerHTML = "";
      msg.failures.forEach((f) => {
        const li = document.createElement("li");
        if (f.viewUrl) {
          const a = document.createElement("a");
          a.href = "#";
          a.textContent = f.filename;
          a.title = "Open in Drive so you can save it manually";
          a.addEventListener("click", (e) => {
            e.preventDefault();
            chrome.tabs.create({ url: f.viewUrl });
          });
          li.appendChild(a);
        } else {
          li.textContent = f.filename;
        }
        li.append(` — ${f.reason === "interstitial" ? "Drive blocked automatic download" : f.reason || "failed"}`);
        failuresList.appendChild(li);
      });
    }
  } else if (msg.type === "CLASSROOM_SCAN_PROGRESS" && mode === "classroom") {
    if (msg.status === "expanding") statusEl.textContent = "Expanding collapsed sections…";
    else if (msg.status === "scrolling") statusEl.textContent = "Scrolling to load more posts…";
  } else if (
    msg.type === "CLASSROOM_ITEMS_UPDATED" &&
    mode === "classroom" &&
    sender.tab &&
    sender.tab.id === activeTabId
  ) {
    // Live update while the popup is open and Classroom's own MutationObserver
    // picks up newly rendered content (e.g. user scrolling manually).
    items = toClassroomItems(msg.items);
    render();
    updateFooterAndSelectAll();
  }
});

boot();
