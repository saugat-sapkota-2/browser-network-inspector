const TYPE_FILTER_KEYS = new Set(["xhrfetch", "images", "media", "scripts", "documents"]);
const SOURCE_FILTER_KEYS = new Set(["all", "js", "image", "video", "other"]);
const SCRIPT_FILE_EXTENSIONS = new Set(["js", "mjs", "cjs"]);
const IMAGE_FILE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "bmp", "svg", "webp", "avif", "ico", "tif", "tiff"]);
const VIDEO_FILE_EXTENSIONS = new Set(["mp4", "m4v", "webm", "mov", "mkv", "avi", "flv", "wmv", "ogv", "m3u8", "mpd", "ts"]);

const state = {
  allLogs: [],
  summary: {
    total: 0,
    success: 0,
    errors: 0,
    avgLatency: 0,
    totalData: 0
  },
  settings: {
    autoClearOnPopupClose: false,
    paused: false,
    maxLogs: 500
  },
  filters: {
    types: new Set(),
    errorsOnly: false,
    slowOnly: false
  },
  searchQuery: "",
  slowThresholdMs: 500,
  maxLogs: 500,
  pendingEntries: [],
  flushTimer: null,
  rerenderTimer: null,
  sourceRenderTimer: null,
  sourceFilter: "all",
  renderedRows: new Map()
};

const dom = {
  activeTabLabel: null,
  captureState: null,
  pauseToggle: null,
  autoClearToggle: null,
  statTotal: null,
  statSuccess: null,
  statErrors: null,
  statAvgLatency: null,
  statTotalData: null,
  searchInput: null,
  filterGroup: null,
  sourceFilterGroup: null,
  reloadTabBtn: null,
  reloadTabBtnSources: null,
  clearLogsBtn: null,
  exportJsonBtn: null,
  exportCsvBtn: null,
  sourceList: null,
  sourcesCount: null,
  logRows: null,
  emptyState: null
};

document.addEventListener("DOMContentLoaded", init);

function init() {
  bindDom();
  bindEvents();
  syncActiveTabLabel();
  requestInitialState();
}

function bindDom() {
  dom.activeTabLabel = document.getElementById("activeTabLabel");
  dom.captureState = document.getElementById("captureState");
  dom.pauseToggle = document.getElementById("pauseToggle");
  dom.autoClearToggle = document.getElementById("autoClearToggle");
  dom.statTotal = document.getElementById("statTotal");
  dom.statSuccess = document.getElementById("statSuccess");
  dom.statErrors = document.getElementById("statErrors");
  dom.statAvgLatency = document.getElementById("statAvgLatency");
  dom.statTotalData = document.getElementById("statTotalData");
  dom.searchInput = document.getElementById("searchInput");
  dom.filterGroup = document.getElementById("filterGroup");
  dom.sourceFilterGroup = document.getElementById("sourceFilterGroup");
  dom.reloadTabBtn = document.getElementById("reloadTabBtn");
  dom.reloadTabBtnSources = document.getElementById("reloadTabBtnSources");
  dom.clearLogsBtn = document.getElementById("clearLogsBtn");
  dom.exportJsonBtn = document.getElementById("exportJsonBtn");
  dom.exportCsvBtn = document.getElementById("exportCsvBtn");
  dom.sourceList = document.getElementById("sourceList");
  dom.sourcesCount = document.getElementById("sourcesCount");
  dom.logRows = document.getElementById("logRows");
  dom.emptyState = document.getElementById("emptyState");
}

function bindEvents() {
  chrome.runtime.onMessage.addListener(onBackgroundMessage);

  dom.filterGroup.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter]");
    if (!button) {
      return;
    }

    toggleFilter(button.dataset.filter);
  });

  dom.searchInput.addEventListener("input", () => {
    state.searchQuery = dom.searchInput.value.trim().toLowerCase();
    scheduleFullRender();
  });

  dom.sourceFilterGroup.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-source-filter]");
    if (!button) {
      return;
    }

    setSourceFilter(button.dataset.sourceFilter);
  });

  const onReloadClick = async () => {
    const response = await sendMessage({ type: "reload-tracked-tab" });
    if (response && response.ok) {
      syncActiveTabLabel();
    }
  };

  dom.reloadTabBtn.addEventListener("click", onReloadClick);
  dom.reloadTabBtnSources.addEventListener("click", onReloadClick);

  dom.clearLogsBtn.addEventListener("click", () => {
    sendMessage({ type: "clear-logs" });
  });

  dom.exportJsonBtn.addEventListener("click", () => {
    exportLogs("json");
  });

  dom.exportCsvBtn.addEventListener("click", () => {
    exportLogs("csv");
  });

  dom.pauseToggle.addEventListener("change", () => {
    sendMessage({
      type: "set-setting",
      key: "paused",
      value: dom.pauseToggle.checked
    });
  });

  dom.autoClearToggle.addEventListener("change", () => {
    sendMessage({
      type: "set-setting",
      key: "autoClearOnPopupClose",
      value: dom.autoClearToggle.checked
    });
  });

  window.addEventListener("beforeunload", () => {
    sendMessage({ type: "popup-closed" });
  });
}

function sendMessage(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }

      resolve(response || null);
    });
  });
}

async function requestInitialState() {
  const response = await sendMessage({ type: "get-state" });
  if (!response) {
    return;
  }

  state.settings = {
    ...state.settings,
    ...(response.settings || {})
  };

  state.maxLogs = Number.isFinite(state.settings.maxLogs) ? state.settings.maxLogs : 500;
  state.slowThresholdMs = Number.isFinite(response.slowThresholdMs) ? response.slowThresholdMs : 500;
  state.allLogs = Array.isArray(response.logs) ? response.logs.slice(-state.maxLogs) : [];
  state.summary = response.summary && typeof response.summary === "object" ? response.summary : computeSummary(state.allLogs);

  syncSettingsUi();
  syncFilterUi();
  syncSourceFilterUi();
  fullRender();
  updateSummaryUi();
}

function onBackgroundMessage(message) {
  if (!message || typeof message !== "object") {
    return false;
  }

  if (message.type === "network-log-added") {
    if (message.summary) {
      state.summary = message.summary;
    }

    if (Number.isFinite(message.maxLogs)) {
      state.maxLogs = message.maxLogs;
      state.settings.maxLogs = message.maxLogs;
    }

    if (Number.isFinite(message.slowThresholdMs)) {
      state.slowThresholdMs = message.slowThresholdMs;
    }

    queueLogEntry(message.entry);
    return false;
  }

  if (message.type === "network-logs-cleared") {
    clearLocalLogs();

    if (message.summary && typeof message.summary === "object") {
      state.summary = message.summary;
    } else {
      state.summary = {
        total: 0,
        success: 0,
        errors: 0,
        avgLatency: 0,
        totalData: 0
      };
    }

    updateSummaryUi();
    return false;
  }

  if (message.type === "settings-updated") {
    state.settings = {
      ...state.settings,
      ...(message.settings || {})
    };

    state.maxLogs = Number.isFinite(state.settings.maxLogs) ? state.settings.maxLogs : state.maxLogs;
    syncSettingsUi();
    return false;
  }

  if (message.type === "active-tab-updated") {
    syncActiveTabLabel();
    return false;
  }

  return false;
}

function queueLogEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return;
  }

  state.pendingEntries.push(entry);

  if (state.flushTimer !== null) {
    return;
  }

  state.flushTimer = setTimeout(() => {
    state.flushTimer = null;
    flushPendingEntries();
  }, 80);
}

function flushPendingEntries() {
  if (state.rerenderTimer !== null) {
    drainPendingEntriesIntoState();
    updateSummaryUi();
    scheduleSourceRender();
    return;
  }

  if (state.pendingEntries.length === 0) {
    return;
  }

  const fragment = document.createDocumentFragment();

  while (state.pendingEntries.length > 0) {
    const entry = state.pendingEntries.shift();
    pushLogWithLimit(entry);

    if (matchesAllFilters(entry)) {
      const row = createLogRow(entry);
      state.renderedRows.set(entry.id, row);
      fragment.appendChild(row);
    }
  }

  if (fragment.childNodes.length > 0) {
    dom.logRows.appendChild(fragment);
  }

  updateEmptyState();
  updateSummaryUi();
  scheduleSourceRender();
}

function drainPendingEntriesIntoState() {
  while (state.pendingEntries.length > 0) {
    const entry = state.pendingEntries.shift();
    pushLogWithLimit(entry);
  }
}

function pushLogWithLimit(entry) {
  state.allLogs.push(entry);

  while (state.allLogs.length > state.maxLogs) {
    const removed = state.allLogs.shift();
    if (!removed) {
      break;
    }

    const existingRow = state.renderedRows.get(removed.id);
    if (existingRow) {
      existingRow.remove();
      state.renderedRows.delete(removed.id);
    }
  }
}

function clearLocalLogs() {
  state.allLogs = [];
  state.pendingEntries = [];
  state.renderedRows.clear();

  if (state.flushTimer !== null) {
    clearTimeout(state.flushTimer);
    state.flushTimer = null;
  }

  if (state.sourceRenderTimer !== null) {
    clearTimeout(state.sourceRenderTimer);
    state.sourceRenderTimer = null;
  }

  dom.logRows.textContent = "";
  updateEmptyState();
  updateSourceListUi();
}

function fullRender() {
  if (state.flushTimer !== null) {
    clearTimeout(state.flushTimer);
    state.flushTimer = null;
  }

  drainPendingEntriesIntoState();
  state.renderedRows.clear();
  dom.logRows.textContent = "";

  const fragment = document.createDocumentFragment();
  for (const entry of state.allLogs) {
    if (!matchesAllFilters(entry)) {
      continue;
    }

    const row = createLogRow(entry);
    state.renderedRows.set(entry.id, row);
    fragment.appendChild(row);
  }

  dom.logRows.appendChild(fragment);
  updateEmptyState();
  updateSourceListUi();
}

function scheduleFullRender() {
  if (state.rerenderTimer !== null) {
    clearTimeout(state.rerenderTimer);
  }

  state.rerenderTimer = setTimeout(() => {
    state.rerenderTimer = null;
    fullRender();
  }, 90);
}

function toggleFilter(filterKey) {
  if (filterKey === "all") {
    state.filters.types.clear();
    state.filters.errorsOnly = false;
    state.filters.slowOnly = false;
    syncFilterUi();
    scheduleFullRender();
    return;
  }

  if (TYPE_FILTER_KEYS.has(filterKey)) {
    if (state.filters.types.has(filterKey)) {
      state.filters.types.delete(filterKey);
    } else {
      state.filters.types.add(filterKey);
    }
  } else if (filterKey === "errors") {
    state.filters.errorsOnly = !state.filters.errorsOnly;
  } else if (filterKey === "slow") {
    state.filters.slowOnly = !state.filters.slowOnly;
  }

  syncFilterUi();
  scheduleFullRender();
}

function syncFilterUi() {
  const chips = dom.filterGroup.querySelectorAll(".filter-chip");
  const isAllActive =
    state.filters.types.size === 0 &&
    !state.filters.errorsOnly &&
    !state.filters.slowOnly;

  for (const chip of chips) {
    const key = chip.dataset.filter;
    let active = false;

    if (key === "all") {
      active = isAllActive;
    } else if (TYPE_FILTER_KEYS.has(key)) {
      active = state.filters.types.has(key);
    } else if (key === "errors") {
      active = state.filters.errorsOnly;
    } else if (key === "slow") {
      active = state.filters.slowOnly;
    }

    chip.classList.toggle("is-active", active);
  }
}

function setSourceFilter(filterKey) {
  if (!SOURCE_FILTER_KEYS.has(filterKey)) {
    return;
  }

  state.sourceFilter = filterKey;
  syncSourceFilterUi();
  scheduleSourceRender();
}

function syncSourceFilterUi() {
  const chips = dom.sourceFilterGroup.querySelectorAll(".source-filter-chip");
  for (const chip of chips) {
    chip.classList.toggle("is-active", chip.dataset.sourceFilter === state.sourceFilter);
  }
}

function matchesAllFilters(entry) {
  if (!entry || typeof entry !== "object") {
    return false;
  }

  const normalizedType = normalizeType(entry.type);

  if (state.filters.types.size > 0) {
    let typeMatched = false;

    for (const key of state.filters.types) {
      if (key === "xhrfetch" && (normalizedType === "xhr" || normalizedType === "fetch")) {
        typeMatched = true;
      }

      if (key === "images" && normalizedType === "image") {
        typeMatched = true;
      }

      if (key === "media" && (normalizedType === "media" || normalizedType === "video")) {
        typeMatched = true;
      }

      if (key === "media" && isLikelyVideoUrl(entry.url)) {
        typeMatched = true;
      }

      if (key === "scripts" && normalizedType === "script") {
        typeMatched = true;
      }

      if (key === "documents" && normalizedType === "document") {
        typeMatched = true;
      }
    }

    if (!typeMatched) {
      return false;
    }
  }

  if (state.filters.errorsOnly) {
    const statusCode = Number(entry.statusCode);
    const isError = statusCode >= 400 || Boolean(entry.error);
    if (!isError) {
      return false;
    }
  }

  if (state.filters.slowOnly) {
    if (!Number.isFinite(entry.latency) || entry.latency <= state.slowThresholdMs) {
      return false;
    }
  }

  if (state.searchQuery.length > 0) {
    const normalizedUrl = String(entry.url || "").toLowerCase();
    const normalizedDomain = String(entry.domain || "").toLowerCase();

    if (!normalizedUrl.includes(state.searchQuery) && !normalizedDomain.includes(state.searchQuery)) {
      return false;
    }
  }

  return true;
}

function createLogRow(entry) {
  const row = document.createElement("tr");

  const methodCell = document.createElement("td");
  methodCell.textContent = String(entry.method || "-");

  const urlCell = document.createElement("td");
  urlCell.className = "url-cell";
  urlCell.title = String(entry.url || "");

  const urlMain = document.createElement("div");
  urlMain.className = "url-main";
  if (isHttpUrl(entry.url)) {
    const urlLink = createResourceLink(entry.url, truncate(entry.url || "", 110));
    urlMain.appendChild(urlLink);
  } else {
    urlMain.textContent = truncate(entry.url || "", 110);
  }

  const urlMeta = document.createElement("div");
  urlMeta.className = "url-meta";
  urlMeta.textContent = `${entry.domain || "-"}  |  req ${formatBytes(entry.requestSize)}  /  res ${formatBytes(entry.responseSize)}`;

  urlCell.append(urlMain, urlMeta);

  const sourceCell = document.createElement("td");
  sourceCell.className = "source-cell";
  sourceCell.title = String(entry.sourceUrl || "");

  if (isHttpUrl(entry.sourceUrl)) {
    const sourceLink = createResourceLink(entry.sourceUrl, truncate(entry.sourceUrl, 82));
    sourceCell.appendChild(sourceLink);
  } else {
    sourceCell.textContent = "-";
    sourceCell.classList.add("status-info");
  }

  const statusCell = document.createElement("td");
  const statusCode = Number(entry.statusCode);
  const hasError = Boolean(entry.error);

  if (hasError) {
    statusCell.textContent = "ERR";
  } else if (Number.isFinite(statusCode) && statusCode > 0) {
    statusCell.textContent = String(statusCode);
  } else {
    statusCell.textContent = "-";
  }

  if (hasError || statusCode >= 400) {
    statusCell.className = "status-error";
  } else if (statusCode >= 200 && statusCode <= 299) {
    statusCell.className = "status-success";
  } else {
    statusCell.className = "status-info";
  }

  const typeCell = document.createElement("td");
  typeCell.textContent = normalizeType(entry.type);

  const timeCell = document.createElement("td");
  timeCell.textContent = formatTime(entry.timestamp);

  const latencyCell = document.createElement("td");
  if (Number.isFinite(entry.latency)) {
    latencyCell.textContent = `${Math.round(entry.latency)} ms`;
    if (entry.latency > state.slowThresholdMs) {
      latencyCell.className = "latency-slow";
    }
  } else {
    latencyCell.textContent = "-";
  }

  row.append(methodCell, urlCell, sourceCell, statusCell, typeCell, timeCell, latencyCell);
  return row;
}

function syncSettingsUi() {
  dom.pauseToggle.checked = Boolean(state.settings.paused);
  dom.autoClearToggle.checked = Boolean(state.settings.autoClearOnPopupClose);

  if (state.settings.paused) {
    dom.captureState.textContent = "Capture paused";
    dom.captureState.classList.add("paused");
  } else {
    dom.captureState.textContent = "Live capture";
    dom.captureState.classList.remove("paused");
  }
}

function updateSummaryUi() {
  dom.statTotal.textContent = formatInteger(state.summary.total);
  dom.statSuccess.textContent = formatInteger(state.summary.success);
  dom.statErrors.textContent = formatInteger(state.summary.errors);
  dom.statAvgLatency.textContent = `${Math.round(Number(state.summary.avgLatency) || 0)} ms`;
  dom.statTotalData.textContent = formatBytes(state.summary.totalData);
}

function updateEmptyState() {
  const hasRows = dom.logRows.children.length > 0;
  dom.emptyState.classList.toggle("hidden", hasRows);
}

function scheduleSourceRender() {
  if (state.sourceRenderTimer !== null) {
    return;
  }

  state.sourceRenderTimer = setTimeout(() => {
    state.sourceRenderTimer = null;
    updateSourceListUi();
  }, 120);
}

function updateSourceListUi() {
  const uniqueSources = new Map();

  for (let index = state.allLogs.length - 1; index >= 0; index -= 1) {
    const entry = state.allLogs[index];
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const candidates = [entry.url, entry.sourceUrl];
    for (const candidate of candidates) {
      if (!isHttpUrl(candidate) || uniqueSources.has(candidate)) {
        continue;
      }

      uniqueSources.set(candidate, {
        type: normalizeType(entry.type),
        statusCode: Number(entry.statusCode),
        category: getSourceCategory(entry, candidate)
      });
    }
  }

  const allSourceEntries = Array.from(uniqueSources.entries());
  const filteredEntries = allSourceEntries
    .filter(([, metadata]) => state.sourceFilter === "all" || metadata.category === state.sourceFilter)
    .slice(0, 200);

  dom.sourcesCount.textContent = `${formatInteger(filteredEntries.length)} / ${formatInteger(allSourceEntries.length)}`;
  dom.sourceList.textContent = "";

  if (allSourceEntries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "source-empty";
    empty.textContent = "No source links captured yet.";
    dom.sourceList.appendChild(empty);
    return;
  }

  if (filteredEntries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "source-empty";
    empty.textContent = "No source links for the selected filter.";
    dom.sourceList.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const [url, metadata] of filteredEntries) {
    const item = document.createElement("div");
    item.className = "source-item";

    const link = createResourceLink(url, truncate(url, 86));
    const meta = document.createElement("div");
    meta.className = "url-meta";

    const statusText = Number.isFinite(metadata.statusCode) && metadata.statusCode > 0
      ? String(metadata.statusCode)
      : "-";
    meta.textContent = `${metadata.type} | ${metadata.category} | status ${statusText}`;

    item.append(link, meta);
    fragment.appendChild(item);
  }

  dom.sourceList.appendChild(fragment);
}

function exportLogs(kind) {
  const logsToExport = state.allLogs.filter((entry) => matchesAllFilters(entry));

  if (logsToExport.length === 0) {
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  if (kind === "json") {
    const payload = JSON.stringify(logsToExport, null, 2);
    downloadFile(`network-monitor-lite-${stamp}.json`, payload, "application/json;charset=utf-8");
    return;
  }

  const columns = [
    "timestamp",
    "method",
    "url",
    "sourceUrl",
    "statusCode",
    "type",
    "latencyMs",
    "requestSizeBytes",
    "responseSizeBytes",
    "domain",
    "error"
  ];

  const lines = [columns.join(",")];

  for (const entry of logsToExport) {
    const row = [
      formatTime(entry.timestamp),
      entry.method || "",
      entry.url || "",
      entry.sourceUrl || "",
      Number.isFinite(entry.statusCode) ? entry.statusCode : "",
      normalizeType(entry.type),
      Number.isFinite(entry.latency) ? entry.latency : "",
      Number.isFinite(entry.requestSize) ? entry.requestSize : "",
      Number.isFinite(entry.responseSize) ? entry.responseSize : "",
      entry.domain || "",
      entry.error || ""
    ];

    lines.push(row.map((value) => toCsvField(value)).join(","));
  }

  downloadFile(`network-monitor-lite-${stamp}.csv`, lines.join("\n"), "text/csv;charset=utf-8");
}

function downloadFile(fileName, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.style.display = "none";

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 1000);
}

function toCsvField(value) {
  const normalized = String(value ?? "");
  if (!normalized.includes(",") && !normalized.includes("\"") && !normalized.includes("\n")) {
    return normalized;
  }

  return `"${normalized.replaceAll("\"", "\"\"")}"`;
}

function isHttpUrl(url) {
  if (typeof url !== "string" || url.length === 0) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function createResourceLink(url, label) {
  const anchor = document.createElement("a");
  anchor.className = "resource-link";
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.title = url;
  anchor.textContent = label;
  return anchor;
}

function isLikelyVideoUrl(url) {
  const source = String(url || "").toLowerCase();
  if (source.length === 0) {
    return false;
  }

  return /\.(mp4|m4v|webm|mov|mkv|avi|m3u8|mpd|ts)(\?|#|$)/i.test(source);
}

function getUrlExtension(url) {
  if (!isHttpUrl(url)) {
    return "";
  }

  try {
    const parsed = new URL(url);
    const path = String(parsed.pathname || "");
    const lastSlash = path.lastIndexOf("/");
    const fileName = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
    const lastDot = fileName.lastIndexOf(".");
    if (lastDot < 0 || lastDot === fileName.length - 1) {
      return "";
    }

    return fileName.slice(lastDot + 1).toLowerCase();
  } catch {
    return "";
  }
}

function getSourceCategory(entry, url) {
  const normalizedType = normalizeType(entry.type);
  const ext = getUrlExtension(url);

  if (normalizedType === "script" || SCRIPT_FILE_EXTENSIONS.has(ext)) {
    return "js";
  }

  if (normalizedType === "image" || IMAGE_FILE_EXTENSIONS.has(ext)) {
    return "image";
  }

  if (normalizedType === "media" || normalizedType === "video" || VIDEO_FILE_EXTENSIONS.has(ext) || isLikelyVideoUrl(url)) {
    return "video";
  }

  return "other";
}

function normalizeType(type) {
  const source = String(type || "").toLowerCase();

  if (source === "main_frame" || source === "sub_frame") {
    return "document";
  }

  if (source === "xmlhttprequest") {
    return "xhr";
  }

  return source || "other";
}

function formatTime(timestamp) {
  if (!Number.isFinite(timestamp)) {
    return "--:--:--.---";
  }

  const date = new Date(timestamp);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");

  return `${hh}:${mm}:${ss}.${ms}`;
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) {
    return "n/a";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  }

  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function truncate(text, maxLength) {
  const source = String(text || "");
  if (source.length <= maxLength) {
    return source;
  }

  return `${source.slice(0, maxLength - 3)}...`;
}

function formatInteger(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "0";
  }

  return Math.round(numeric).toLocaleString();
}

function computeSummary(logs) {
  let success = 0;
  let errors = 0;
  let latencyTotal = 0;
  let latencyCount = 0;
  let totalData = 0;

  for (const entry of logs) {
    const statusCode = Number(entry.statusCode);
    if (statusCode >= 200 && statusCode <= 299) {
      success += 1;
    }

    if (statusCode >= 400 || entry.error) {
      errors += 1;
    }

    if (Number.isFinite(entry.latency)) {
      latencyTotal += entry.latency;
      latencyCount += 1;
    }

    if (Number.isFinite(entry.requestSize)) {
      totalData += entry.requestSize;
    }

    if (Number.isFinite(entry.responseSize)) {
      totalData += entry.responseSize;
    }
  }

  return {
    total: logs.length,
    success,
    errors,
    avgLatency: latencyCount > 0 ? latencyTotal / latencyCount : 0,
    totalData
  };
}

async function syncActiveTabLabel() {
  try {
    const stateSnapshot = await sendMessage({ type: "get-state" });
    if (!stateSnapshot || !Number.isInteger(stateSnapshot.activeTabId) || stateSnapshot.activeTabId < 0) {
      dom.activeTabLabel.textContent = "No monitored tab selected";
      return;
    }

    const tab = await chrome.tabs.get(stateSnapshot.activeTabId);
    const title = truncate(tab.title || "Untitled tab", 56);
    dom.activeTabLabel.textContent = `Tracking: ${title} (tab ${tab.id})`;
  } catch {
    dom.activeTabLabel.textContent = "Unable to resolve monitored tab";
  }
}
