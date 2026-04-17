const TYPE_FILTER_KEYS = new Set(["xhrfetch", "images", "media", "scripts", "documents"]);
const SOURCE_FILTER_KEYS = new Set(["all", "js", "image", "video", "other"]);
const SCRIPT_FILE_EXTENSIONS = new Set(["js", "mjs", "cjs"]);
const IMAGE_FILE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "bmp", "svg", "webp", "avif", "ico", "tif", "tiff"]);
const VIDEO_FILE_EXTENSIONS = new Set(["mp4", "m4v", "webm", "mov", "mkv", "avi", "flv", "wmv", "ogv", "m3u8", "mpd", "ts"]);
const ANALYSIS_SLOW_THRESHOLD_MS = 1000;
const ANALYSIS_DUPLICATE_LIMIT = 3;
const MAX_INSIGHT_ITEMS_PER_GROUP = 3;
const MIN_SCORE_BAR_WIDTH = 6;
const AUTO_REANALYZE_DELAY_MS = 600;
const BENIGN_ERROR_MARKERS = ["ERR_ABORTED", "NS_BINDING_ABORTED", "ERR_BLOCKED_BY_CLIENT"];

const state = {
  targetTabId: null,
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
  renderedRows: new Map(),
  autoReanalyzeTimer: null,
  analysis: {
    aiMode: true,
    deepMode: true,
    autoRefresh: true,
    result: null,
    stale: false,
    isOpen: false
  }
};

const dom = {
  activeTabLabel: null,
  captureState: null,
  pauseToggle: null,
  pauseStateLabel: null,
  autoClearToggle: null,
  autoClearStateLabel: null,
  analyzeNetworkBtn: null,
  aiModeToggle: null,
  aiModeLabel: null,
  statTotal: null,
  statSuccess: null,
  statErrors: null,
  statAvgLatency: null,
  statTotalData: null,
  analysisMeta: null,
  analysisPanel: null,
  analysisBackdrop: null,
  reAnalyzeBtn: null,
  deepAnalysisToggle: null,
  deepAnalysisLabel: null,
  autoReAnalyzeToggle: null,
  autoReAnalyzeLabel: null,
  closeAnalysisBtn: null,
  analysisScoreCard: null,
  analysisScore: null,
  analysisScoreDetail: null,
  analysisScoreBar: null,
  analysisTotalRequests: null,
  analysisErrorCount: null,
  analysisAvgResponse: null,
  analysisSlowCount: null,
  analysisDuplicateCount: null,
  analysisInsights: null,
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

function parseTargetTabIdFromQuery() {
  try {
    const url = new URL(window.location.href);
    const raw = url.searchParams.get("targetTabId");
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  } catch {
    return null;
  }
}

function matchesTargetTab(messageTargetTabId) {
  if (!Number.isInteger(state.targetTabId) || state.targetTabId < 0) {
    return false;
  }

  return Number.isInteger(messageTargetTabId) && messageTargetTabId === state.targetTabId;
}

async function init() {
  state.targetTabId = parseTargetTabIdFromQuery();
  bindDom();
  bindEvents();

  await requestInitialState();
  syncActiveTabLabel();
}

function bindDom() {
  dom.activeTabLabel = document.getElementById("activeTabLabel");
  dom.captureState = document.getElementById("captureState");
  dom.pauseToggle = document.getElementById("pauseToggle");
  dom.pauseStateLabel = document.getElementById("pauseStateLabel");
  dom.autoClearToggle = document.getElementById("autoClearToggle");
  dom.autoClearStateLabel = document.getElementById("autoClearStateLabel");
  dom.analyzeNetworkBtn = document.getElementById("analyzeNetworkBtn");
  dom.aiModeToggle = document.getElementById("aiModeToggle");
  dom.aiModeLabel = document.getElementById("aiModeLabel");
  dom.statTotal = document.getElementById("statTotal");
  dom.statSuccess = document.getElementById("statSuccess");
  dom.statErrors = document.getElementById("statErrors");
  dom.statAvgLatency = document.getElementById("statAvgLatency");
  dom.statTotalData = document.getElementById("statTotalData");
  dom.analysisMeta = document.getElementById("analysisMeta");
  dom.analysisPanel = document.getElementById("analysisPanel");
  dom.analysisBackdrop = document.getElementById("analysisBackdrop");
  dom.reAnalyzeBtn = document.getElementById("reAnalyzeBtn");
  dom.deepAnalysisToggle = document.getElementById("deepAnalysisToggle");
  dom.deepAnalysisLabel = document.getElementById("deepAnalysisLabel");
  dom.autoReAnalyzeToggle = document.getElementById("autoReAnalyzeToggle");
  dom.autoReAnalyzeLabel = document.getElementById("autoReAnalyzeLabel");
  dom.closeAnalysisBtn = document.getElementById("closeAnalysisBtn");
  dom.analysisScoreCard = document.getElementById("analysisScoreCard");
  dom.analysisScore = document.getElementById("analysisScore");
  dom.analysisScoreDetail = document.getElementById("analysisScoreDetail");
  dom.analysisScoreBar = document.getElementById("analysisScoreBar");
  dom.analysisTotalRequests = document.getElementById("analysisTotalRequests");
  dom.analysisErrorCount = document.getElementById("analysisErrorCount");
  dom.analysisAvgResponse = document.getElementById("analysisAvgResponse");
  dom.analysisSlowCount = document.getElementById("analysisSlowCount");
  dom.analysisDuplicateCount = document.getElementById("analysisDuplicateCount");
  dom.analysisInsights = document.getElementById("analysisInsights");
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

  dom.analyzeNetworkBtn.addEventListener("click", () => {
    runNetworkAnalysis();
    openAnalysisPanel();
  });

  dom.reAnalyzeBtn.addEventListener("click", () => {
    runNetworkAnalysis();
    openAnalysisPanel();
  });

  dom.deepAnalysisToggle.addEventListener("change", () => {
    state.analysis.deepMode = Boolean(dom.deepAnalysisToggle.checked);
    syncDeepModeUi();

    if (state.analysis.result) {
      renderAnalysisResult(state.analysis.result);
    }
  });

  dom.autoReAnalyzeToggle.addEventListener("change", () => {
    state.analysis.autoRefresh = Boolean(dom.autoReAnalyzeToggle.checked);
    syncAutoRefreshUi();

    if (!state.analysis.autoRefresh) {
      clearAutoReanalyzeTimer();
      return;
    }

    if (state.analysis.stale && state.analysis.isOpen) {
      scheduleAutoReanalyze();
    }
  });

  dom.closeAnalysisBtn.addEventListener("click", () => {
    closeAnalysisPanel();
  });

  dom.analysisBackdrop.addEventListener("click", () => {
    closeAnalysisPanel();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.analysis.isOpen) {
      closeAnalysisPanel();
    }
  });

  dom.aiModeToggle.addEventListener("change", () => {
    state.analysis.aiMode = Boolean(dom.aiModeToggle.checked);
    syncAiModeUi();

    if (state.analysis.result) {
      renderAnalysisResult(state.analysis.result);
    }
  });

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
  const withContext =
    Number.isInteger(state.targetTabId) && state.targetTabId >= 0
      ? {
          ...payload,
          targetTabId: state.targetTabId
        }
      : payload;

  return new Promise((resolve) => {
    chrome.runtime.sendMessage(withContext, (response) => {
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
    dom.activeTabLabel.textContent = "Unable to load monitor state";
    dom.activeTabLabel.title = "";
    return;
  }

  if (Number.isInteger(response.targetTabId) && response.targetTabId >= 0) {
    state.targetTabId = response.targetTabId;
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
  syncAiModeUi();
  syncDeepModeUi();
  syncAutoRefreshUi();
  syncFilterUi();
  syncSourceFilterUi();
  closeAnalysisPanel();
  resetAnalysisPanel("Run Analyze Network to generate actionable insights.");
  fullRender();
  updateSummaryUi();
}

function onBackgroundMessage(message) {
  if (!message || typeof message !== "object") {
    return false;
  }

  const messageTargetTabId = Number(message.targetTabId);

  if (message.type === "network-log-added") {
    if (!matchesTargetTab(messageTargetTabId)) {
      return false;
    }

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
    markAnalysisStale();
    return false;
  }

  if (message.type === "network-logs-cleared") {
    if (!matchesTargetTab(messageTargetTabId)) {
      return false;
    }

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

  if (message.type === "tracked-tab-closed") {
    if (!matchesTargetTab(messageTargetTabId)) {
      return false;
    }

    clearLocalLogs();
    state.summary = {
      total: 0,
      success: 0,
      errors: 0,
      avgLatency: 0,
      totalData: 0
    };
    updateSummaryUi();

    dom.activeTabLabel.textContent = "Tracked tab was closed";
    dom.activeTabLabel.title = "";
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
  state.analysis.result = null;
  state.analysis.stale = false;
  clearAutoReanalyzeTimer();
  setReAnalyzeAttention(false);
  closeAnalysisPanel();

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
  resetAnalysisPanel("No logs available. Capture traffic and run Analyze Network.");
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
  dom.pauseStateLabel.textContent = state.settings.paused ? "ON" : "OFF";
  dom.autoClearStateLabel.textContent = state.settings.autoClearOnPopupClose ? "ON" : "OFF";

  const captureText = dom.captureState.querySelector(".capture-text");

  if (state.settings.paused) {
    if (captureText) {
      captureText.textContent = "Capture Paused";
    }
    dom.captureState.classList.add("paused");
  } else {
    if (captureText) {
      captureText.textContent = "Live Capture";
    }
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

function syncAiModeUi() {
  dom.aiModeToggle.checked = Boolean(state.analysis.aiMode);
  dom.aiModeLabel.textContent = state.analysis.aiMode ? "ON" : "OFF";
}

function syncDeepModeUi() {
  dom.deepAnalysisToggle.checked = Boolean(state.analysis.deepMode);
  dom.deepAnalysisLabel.textContent = state.analysis.deepMode ? "Deep Scan ON" : "Deep Scan OFF";
}

function syncAutoRefreshUi() {
  dom.autoReAnalyzeToggle.checked = Boolean(state.analysis.autoRefresh);
  dom.autoReAnalyzeLabel.textContent = state.analysis.autoRefresh ? "Auto Refresh ON" : "Auto Refresh OFF";
}

function markAnalysisStale() {
  if (!state.analysis.result || state.analysis.stale) {
    return;
  }

  state.analysis.stale = true;
  dom.analysisMeta.textContent = buildAnalysisMeta(state.analysis.result, { stale: true });
  setReAnalyzeAttention(true);

  if (state.analysis.autoRefresh && state.analysis.isOpen) {
    scheduleAutoReanalyze();
  }
}

function runNetworkAnalysis() {
  clearAutoReanalyzeTimer();

  if (state.flushTimer !== null) {
    clearTimeout(state.flushTimer);
    state.flushTimer = null;
  }

  const hadPendingEntries = state.pendingEntries.length > 0;
  if (hadPendingEntries) {
    drainPendingEntriesIntoState();
    fullRender();
    state.summary = computeSummary(state.allLogs);
    updateSummaryUi();
  }

  const analysis = analyzeNetworkLogs(state.allLogs);
  state.analysis.result = analysis;
  state.analysis.stale = false;
  renderAnalysisResult(analysis);
}

function setReAnalyzeAttention(enabled) {
  dom.reAnalyzeBtn.classList.toggle("is-attention", Boolean(enabled));
}

function clearAutoReanalyzeTimer() {
  if (state.autoReanalyzeTimer === null) {
    return;
  }

  clearTimeout(state.autoReanalyzeTimer);
  state.autoReanalyzeTimer = null;
}

function scheduleAutoReanalyze() {
  if (!state.analysis.autoRefresh || !state.analysis.isOpen) {
    return;
  }

  clearAutoReanalyzeTimer();
  state.autoReanalyzeTimer = setTimeout(() => {
    state.autoReanalyzeTimer = null;

    if (!state.analysis.autoRefresh || !state.analysis.isOpen || !state.analysis.stale) {
      return;
    }

    runNetworkAnalysis();
  }, AUTO_REANALYZE_DELAY_MS);
}

function openAnalysisPanel() {
  state.analysis.isOpen = true;
  dom.analysisPanel.classList.remove("hidden");
  dom.analysisBackdrop.classList.remove("hidden");
  dom.analysisPanel.setAttribute("aria-hidden", "false");
  document.body.classList.add("analysis-open");

  if (state.analysis.stale && state.analysis.autoRefresh) {
    scheduleAutoReanalyze();
  }

  dom.closeAnalysisBtn.focus();
}

function closeAnalysisPanel() {
  state.analysis.isOpen = false;
  clearAutoReanalyzeTimer();
  dom.analysisPanel.classList.add("hidden");
  dom.analysisBackdrop.classList.add("hidden");
  dom.analysisPanel.setAttribute("aria-hidden", "true");
  document.body.classList.remove("analysis-open");
}

function analyzeNetworkLogs(logs) {
  const safeLogs = Array.isArray(logs) ? logs : [];
  const slowRequests = [];
  const failedRequests = [];
  const ignoredFailures = [];
  const urlHits = new Map();
  const failedStatusHistogram = new Map();
  const ignoredStatusHistogram = new Map();
  const domainHits = new Map();
  const endpointKeys = new Set();
  const slowEndpointBuckets = new Map();
  const failedEndpointBuckets = new Map();
  const latencyValues = [];

  let latencyTotal = 0;
  let latencyCount = 0;

  for (const entry of safeLogs) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const url = String(entry.url || "");
    const method = String(entry.method || "GET");
    const statusCode = Number(entry.statusCode);
    const latencyMs = getEntryLatencyMs(entry);
    const resourceType = normalizeType(entry.resourceType || entry.type);
    const domain = String(entry.domain || getDomain(url) || "");
    const errorMessage = String(entry.error || "");
    const endpointKey = getEndpointKey(url);
    const endpointLabel = getEndpointLabel(url);

    if (domain.length > 0) {
      domainHits.set(domain, (domainHits.get(domain) || 0) + 1);
    }

    endpointKeys.add(endpointKey);

    if (url.length > 0) {
      urlHits.set(url, (urlHits.get(url) || 0) + 1);
    }

    if ((Number.isFinite(statusCode) && statusCode >= 400) || errorMessage.length > 0) {
      const failureInfo = classifyFailure(statusCode, errorMessage);
      const failureCode = failureInfo.code;

      if (failureInfo.actionable) {
        failedRequests.push({
          url,
          method,
          statusCode: Number.isFinite(statusCode) ? statusCode : 0,
          resourceType,
          errorMessage
        });

        failedStatusHistogram.set(failureCode, (failedStatusHistogram.get(failureCode) || 0) + 1);

        const failureBucket = getOrCreateFailedEndpointBucket(failedEndpointBuckets, endpointKey, endpointLabel);
        failureBucket.count += 1;
        failureBucket.statuses.set(failureCode, (failureBucket.statuses.get(failureCode) || 0) + 1);
      } else {
        ignoredFailures.push({
          url,
          method,
          statusCode: Number.isFinite(statusCode) ? statusCode : 0,
          resourceType,
          errorMessage,
          reason: failureInfo.reason
        });

        ignoredStatusHistogram.set(failureCode, (ignoredStatusHistogram.get(failureCode) || 0) + 1);
      }
    }

    if (Number.isFinite(latencyMs)) {
      latencyTotal += latencyMs;
      latencyCount += 1;
      latencyValues.push(latencyMs);

      if (latencyMs > ANALYSIS_SLOW_THRESHOLD_MS) {
        slowRequests.push({ url, method, statusCode, latencyMs, resourceType });

        const slowBucket = getOrCreateSlowEndpointBucket(slowEndpointBuckets, endpointKey, endpointLabel);
        slowBucket.count += 1;
        slowBucket.maxLatencyMs = Math.max(slowBucket.maxLatencyMs, latencyMs);
        slowBucket.totalLatencyMs += latencyMs;
      }
    }
  }

  const duplicateClusters = [];
  for (const [url, count] of urlHits.entries()) {
    if (count > ANALYSIS_DUPLICATE_LIMIT) {
      duplicateClusters.push({ url, count });
    }
  }

  duplicateClusters.sort((left, right) => right.count - left.count);
  slowRequests.sort((left, right) => right.latencyMs - left.latencyMs);

  const totalRequests = safeLogs.length;
  const errorCount = failedRequests.length;
  const ignoredFailureCount = ignoredFailures.length;
  const totalFailureCount = errorCount + ignoredFailureCount;
  const avgResponseTimeMs = latencyCount > 0 ? latencyTotal / latencyCount : 0;
  const primaryDomain = getPrimaryDomain(domainHits);
  const endpointCount = endpointKeys.size;
  const errorRate = totalRequests > 0 ? errorCount / totalRequests : 0;
  const latencyP95Ms = calculatePercentile(latencyValues, 95);
  const slowEndpointInsights = Array.from(slowEndpointBuckets.values())
    .map((bucket) => ({
      endpoint: bucket.endpoint,
      count: bucket.count,
      maxLatencyMs: bucket.maxLatencyMs,
      avgLatencyMs: bucket.count > 0 ? bucket.totalLatencyMs / bucket.count : 0
    }))
    .sort((left, right) => right.maxLatencyMs - left.maxLatencyMs);

  const failedEndpointInsights = Array.from(failedEndpointBuckets.values())
    .map((bucket) => ({
      endpoint: bucket.endpoint,
      count: bucket.count,
      statuses: bucket.statuses
    }))
    .sort((left, right) => right.count - left.count);

  const penaltySlow = slowRequests.length * 10;
  const penaltyErrors = errorCount * 15;
  const penaltyDuplicates = duplicateClusters.length * 5;

  const rawScore =
    100 -
    penaltySlow -
    penaltyErrors -
    penaltyDuplicates;

  return {
    generatedAt: Date.now(),
    totalRequests,
    errorCount,
    totalFailureCount,
    ignoredFailureCount,
    errorRate,
    avgResponseTimeMs,
    latencyP95Ms,
    primaryDomain,
    endpointCount,
    slowRequests,
    slowEndpointInsights,
    failedRequests,
    failedEndpointInsights,
    ignoredFailures,
    duplicateClusters,
    failedStatusHistogram,
    ignoredStatusHistogram,
    penaltySlow,
    penaltyErrors,
    penaltyDuplicates,
    totalPenalty: penaltySlow + penaltyErrors + penaltyDuplicates,
    score: clampScore(rawScore)
  };
}

function renderAnalysisResult(analysis) {
  dom.analysisTotalRequests.textContent = formatInteger(analysis.totalRequests);
  dom.analysisErrorCount.textContent = formatInteger(analysis.errorCount);
  dom.analysisAvgResponse.textContent = `${Math.round(analysis.avgResponseTimeMs)} ms`;
  dom.analysisSlowCount.textContent = formatInteger(analysis.slowRequests.length);
  dom.analysisDuplicateCount.textContent = formatInteger(analysis.duplicateClusters.length);

  dom.analysisScore.textContent = `Performance Score: ${analysis.score}/100`;
  const scoreBarWidth = analysis.totalRequests > 0 ? Math.max(MIN_SCORE_BAR_WIDTH, analysis.score) : 0;
  dom.analysisScoreBar.style.width = `${scoreBarWidth}%`;
  dom.analysisScoreDetail.textContent =
    `Penalties: slow ${analysis.penaltySlow}, errors ${analysis.penaltyErrors}, duplicates ${analysis.penaltyDuplicates}` +
    (analysis.ignoredFailureCount > 0 ? ` | ignored benign failures ${analysis.ignoredFailureCount}` : "") +
    ".";

  dom.analysisScoreCard.classList.remove("is-good", "is-warning", "is-error");
  if (analysis.score >= 80) {
    dom.analysisScoreCard.classList.add("is-good");
  } else if (analysis.score >= 50) {
    dom.analysisScoreCard.classList.add("is-warning");
  } else {
    dom.analysisScoreCard.classList.add("is-error");
  }

  dom.analysisMeta.textContent = buildAnalysisMeta(analysis, { stale: false });
  setReAnalyzeAttention(false);

  const insights = buildInsights(analysis, state.analysis.aiMode);
  renderInsightList(insights);
}

function buildInsights(analysis, aiModeEnabled) {
  const insights = [];
  const scopeLabel = getAnalysisScopeLabel(analysis);
  const deepModeEnabled = Boolean(state.analysis.deepMode);

  if (deepModeEnabled) {
    const errorRatePct = formatPercent(analysis.errorRate);
    const p95Text = Number.isFinite(analysis.latencyP95Ms) ? `${Math.round(analysis.latencyP95Ms)} ms` : "n/a";
    const failureContext = analysis.ignoredFailureCount > 0
      ? `, actionable failures ${formatInteger(analysis.errorCount)} (ignored ${formatInteger(analysis.ignoredFailureCount)} benign)`
      : `, failures ${formatInteger(analysis.errorCount)}`;

    insights.push({
      severity: analysis.errorRate >= 0.2 ? "warning" : "good",
      text: `Deep Scan: ${formatInteger(analysis.endpointCount)} endpoints${failureContext}, actionable error rate ${errorRatePct}, p95 latency ${p95Text} ${scopeLabel}.`
    });
  }

  for (const slowEndpoint of analysis.slowEndpointInsights.slice(0, MAX_INSIGHT_ITEMS_PER_GROUP)) {
    insights.push({
      severity: "warning",
      text: `${slowEndpoint.endpoint} is slow (${slowEndpoint.count} hits, max ${formatInsightLatency(slowEndpoint.maxLatencyMs)}, avg ${Math.round(slowEndpoint.avgLatencyMs)}ms).`
    });
  }

  if (analysis.slowRequests.length > MAX_INSIGHT_ITEMS_PER_GROUP) {
    insights.push({
      severity: "warning",
      text: `${analysis.slowRequests.length} slow requests found above ${ANALYSIS_SLOW_THRESHOLD_MS} ms.`
    });
  }

  if (analysis.errorCount > 0) {
    insights.push({
      severity: "error",
      text: `${analysis.errorCount} actionable failed requests detected ${scopeLabel} (${formatStatusHistogram(analysis.failedStatusHistogram)}).`
    });

    for (const failedEndpoint of analysis.failedEndpointInsights.slice(0, 2)) {
      insights.push({
        severity: "error",
        text: `Failure hotspot: ${failedEndpoint.endpoint} failed ${failedEndpoint.count} times (${formatStatusHistogram(failedEndpoint.statuses)}).`
      });
    }
  }

  if (analysis.ignoredFailureCount > 0) {
    insights.push({
      severity: "good",
      text: `${analysis.ignoredFailureCount} aborted/blocked requests were detected ${scopeLabel} and excluded from scoring (${formatStatusHistogram(analysis.ignoredStatusHistogram)}).`
    });
  }

  for (const cluster of analysis.duplicateClusters.slice(0, MAX_INSIGHT_ITEMS_PER_GROUP)) {
    insights.push({
      severity: "warning",
      text: `Repeated calls to ${getEndpointLabel(cluster.url)} detected (${cluster.count} requests, possible optimization).`
    });
  }

  if (analysis.avgResponseTimeMs >= 800) {
    insights.push({
      severity: "warning",
      text: `Average response time is high ${scopeLabel} (${Math.round(analysis.avgResponseTimeMs)} ms).`
    });
  }

  if (
    analysis.totalRequests > 0 &&
    analysis.errorCount === 0 &&
    analysis.slowRequests.length === 0 &&
    analysis.duplicateClusters.length === 0
  ) {
    insights.push({
      severity: "good",
      text: `Network traffic ${scopeLabel} looks healthy (${formatInteger(analysis.totalRequests)} requests across ${formatInteger(analysis.endpointCount)} endpoints).`
    });
  }

  if (aiModeEnabled) {
    appendAiRecommendations(insights, analysis);
  }

  if (insights.length === 0) {
    if (analysis.totalRequests === 0) {
      insights.push({
        severity: "warning",
        text: "No requests captured yet. Reload the tracked tab, then run Analyze Network again."
      });
    } else {
      insights.push({
        severity: "good",
        text: "No significant issues detected in the current request sample."
      });
    }
  }

  return insights;
}

function appendAiRecommendations(insights, analysis) {
  const scopeLabel = getAnalysisScopeLabel(analysis);

  if (analysis.duplicateClusters.length > 0) {
    const hottestCluster = analysis.duplicateClusters[0];
    insights.push({
      severity: "warning",
      text: `Recommendation: Consider caching or debouncing calls to ${getEndpointLabel(hottestCluster.url)} ${scopeLabel}.`
    });
  }

  if (analysis.slowRequests.length > 0) {
    const worstSlowEndpoint = analysis.slowEndpointInsights[0];
    const endpointHint = worstSlowEndpoint ? ` Focus on ${worstSlowEndpoint.endpoint} first.` : "";

    insights.push({
      severity: "warning",
      text: `Optimization tip: Profile server endpoints and reduce payload size for high-latency requests ${scopeLabel}.${endpointHint}`
    });
  }

  if (analysis.errorCount > 0) {
    insights.push({
      severity: "error",
      text: `Recommendation: Investigate recurring 4xx/5xx or ERR failures ${scopeLabel}, and add retries only where safe.`
    });
  }

  if (
    analysis.totalRequests > 0 &&
    analysis.errorCount === 0 &&
    analysis.slowRequests.length === 0 &&
    analysis.duplicateClusters.length === 0
  ) {
    insights.push({
      severity: "good",
      text: `Recommendation: Current API behavior ${scopeLabel} is stable; maintain this baseline in future releases.`
    });
  }
}

function renderInsightList(insights) {
  dom.analysisInsights.textContent = "";

  if (!Array.isArray(insights) || insights.length === 0) {
    const empty = document.createElement("li");
    empty.className = "analysis-empty";
    empty.textContent = "No insights available.";
    dom.analysisInsights.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const insight of insights) {
    const item = document.createElement("li");
    item.className = `analysis-insight is-${insight.severity}`;

    const badge = document.createElement("span");
    badge.className = "analysis-insight-badge";
    badge.textContent = getInsightBadge(insight.severity);

    const text = document.createElement("p");
    text.textContent = insight.text;

    item.append(badge, text);
    fragment.appendChild(item);
  }

  dom.analysisInsights.appendChild(fragment);
}

function resetAnalysisPanel(message) {
  dom.analysisMeta.textContent = message;
  dom.analysisTotalRequests.textContent = "0";
  dom.analysisErrorCount.textContent = "0";
  dom.analysisAvgResponse.textContent = "0 ms";
  dom.analysisSlowCount.textContent = "0";
  dom.analysisDuplicateCount.textContent = "0";
  dom.analysisScore.textContent = "Performance Score: --/100";
  dom.analysisScoreBar.style.width = "0%";
  dom.analysisScoreDetail.textContent = "Penalties: slow 0, errors 0, duplicates 0.";
  dom.analysisScoreCard.classList.remove("is-good", "is-warning", "is-error");
  setReAnalyzeAttention(false);

  dom.analysisInsights.textContent = "";
  const empty = document.createElement("li");
  empty.className = "analysis-empty";
  empty.textContent = "No analysis yet. Click Analyze Network.";
  dom.analysisInsights.appendChild(empty);
}

function getEntryLatencyMs(entry) {
  const candidates = [entry?.latency, entry?.responseTime, entry?.responseTimeMs];

  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return null;
}

function clampScore(score) {
  if (!Number.isFinite(score)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildAnalysisMeta(analysis, options = {}) {
  const stale = Boolean(options.stale);
  const analyzedAt = formatTime(analysis.generatedAt);
  const aiModeStatus = state.analysis.aiMode ? "AI Mode ON" : "AI Mode OFF";
  const deepModeStatus = state.analysis.deepMode ? "Deep Scan ON" : "Deep Scan OFF";
  const autoStatus = state.analysis.autoRefresh ? "Auto Refresh ON" : "Auto Refresh OFF";
  const scope = analysis.primaryDomain ? ` for ${analysis.primaryDomain}` : "";

  if (stale) {
    return `New requests captured ${scope}. Showing previous analysis from ${analyzedAt}. Click Re-Analyze to refresh (${aiModeStatus}, ${deepModeStatus}, ${autoStatus}).`;
  }

  return `Analyzed ${formatInteger(analysis.totalRequests)} requests${scope} at ${analyzedAt} (${aiModeStatus}, ${deepModeStatus}, ${autoStatus}).`;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return "0%";
  }

  return `${(value * 100).toFixed(1)}%`;
}

function calculatePercentile(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const sorted = values
    .filter((value) => Number.isFinite(value))
    .slice()
    .sort((left, right) => left - right);

  if (sorted.length === 0) {
    return null;
  }

  const safePercentile = Math.max(0, Math.min(100, Number(percentile)));
  const index = Math.ceil((safePercentile / 100) * sorted.length) - 1;
  const safeIndex = Math.max(0, Math.min(sorted.length - 1, index));
  return sorted[safeIndex];
}

function classifyFailure(statusCode, errorMessage) {
  if (Number.isFinite(statusCode) && statusCode >= 400) {
    return {
      actionable: true,
      code: String(statusCode),
      reason: "http"
    };
  }

  const normalizedError = String(errorMessage || "").toUpperCase();
  if (normalizedError.length === 0) {
    return {
      actionable: false,
      code: "ERR",
      reason: "unknown"
    };
  }

  for (const marker of BENIGN_ERROR_MARKERS) {
    if (normalizedError.includes(marker)) {
      return {
        actionable: false,
        code: marker,
        reason: "benign"
      };
    }
  }

  return {
    actionable: true,
    code: "ERR",
    reason: "network"
  };
}

function getOrCreateSlowEndpointBucket(bucketMap, endpointKey, endpointLabel) {
  let bucket = bucketMap.get(endpointKey);
  if (bucket) {
    return bucket;
  }

  bucket = {
    endpoint: endpointLabel,
    count: 0,
    maxLatencyMs: 0,
    totalLatencyMs: 0
  };

  bucketMap.set(endpointKey, bucket);
  return bucket;
}

function getOrCreateFailedEndpointBucket(bucketMap, endpointKey, endpointLabel) {
  let bucket = bucketMap.get(endpointKey);
  if (bucket) {
    return bucket;
  }

  bucket = {
    endpoint: endpointLabel,
    count: 0,
    statuses: new Map()
  };

  bucketMap.set(endpointKey, bucket);
  return bucket;
}

function getEndpointLabel(url) {
  if (!isHttpUrl(url)) {
    return truncate(url || "unknown endpoint", 46);
  }

  try {
    const parsed = new URL(url);
    if (parsed.pathname && parsed.pathname !== "/") {
      return truncate(parsed.pathname, 46);
    }

    return parsed.hostname;
  } catch {
    return truncate(url || "unknown endpoint", 46);
  }
}

function formatInsightLatency(latencyMs) {
  if (!Number.isFinite(latencyMs)) {
    return "n/a";
  }

  if (latencyMs >= 1000) {
    return `${(latencyMs / 1000).toFixed(1)}s`;
  }

  return `${Math.round(latencyMs)}ms`;
}

function formatStatusHistogram(statusHistogram) {
  if (!(statusHistogram instanceof Map) || statusHistogram.size === 0) {
    return "HTTP errors";
  }

  const parts = Array.from(statusHistogram.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([statusCode, count]) => `${statusCode} x${count}`);

  return parts.join(", ");
}

function getPrimaryDomain(domainHits) {
  if (!(domainHits instanceof Map) || domainHits.size === 0) {
    return "";
  }

  let winner = "";
  let winnerCount = -1;

  for (const [domain, count] of domainHits.entries()) {
    if (!Number.isFinite(count) || count <= winnerCount) {
      continue;
    }

    winner = domain;
    winnerCount = count;
  }

  return winner;
}

function getAnalysisScopeLabel(analysis) {
  if (analysis.primaryDomain) {
    return `for ${analysis.primaryDomain}`;
  }

  return "for this monitored tab";
}

function getEndpointKey(url) {
  if (!isHttpUrl(url)) {
    return String(url || "unknown");
  }

  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname || "/"}`;
  } catch {
    return String(url || "unknown");
  }
}

function getDomain(url) {
  if (!isHttpUrl(url)) {
    return "";
  }

  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function getInsightBadge(severity) {
  if (severity === "error") {
    return "Error";
  }

  if (severity === "warning") {
    return "Warning";
  }

  return "Healthy";
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
  const targetTabId = Number(state.targetTabId);
  if (!Number.isInteger(targetTabId) || targetTabId < 0) {
    dom.activeTabLabel.textContent = "Tracking: No monitored tab selected";
    dom.activeTabLabel.title = "";
    return;
  }

  try {
    const tab = await chrome.tabs.get(targetTabId);
    const title = truncate(tab.title || "Untitled tab", 56);
    let trackingName = title;

    if (isHttpUrl(tab.url)) {
      try {
        const host = new URL(tab.url).hostname;
        if (host) {
          trackingName = host;
        }
      } catch {
        trackingName = truncate(tab.url, 56);
      }
    }

    dom.activeTabLabel.textContent = `Tracking: ${trackingName}`;
    dom.activeTabLabel.title = isHttpUrl(tab.url)
      ? `${tab.title || "Untitled tab"}\n${tab.url}`
      : title;
  } catch {
    dom.activeTabLabel.textContent = "Tracking: Tab is not available";
    dom.activeTabLabel.title = "";
  }
}
