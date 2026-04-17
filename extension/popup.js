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
const PERF_RELOAD_CAPTURE_WAIT_MS = 22000;
const PERF_RELOAD_POLL_INTERVAL_MS = 1200;
const PERF_RELOAD_NAV_CHANGE_GRACE_MS = 25;

const ELEMENT_SELECTOR_SCAN_LIMIT = 450;
const FULL_RENDER_CHUNK_SIZE = 72;
const FULL_RENDER_CHUNK_DELAY_MS = 0;
const ELEMENT_JS_EMPTY_MESSAGE = "No inline handlers or obvious JavaScript hooks detected for this element.";
const ELEMENT_ANIMATION_EMPTY_MESSAGE = "No CSS animations, transitions, or active Web Animations detected for this element.";
const ELEMENT_JS_LOADING_MESSAGE = "Loading JavaScript diagnostics for the selected element...";
const ELEMENT_ANIMATION_LOADING_MESSAGE = "Loading animation diagnostics for the selected element...";

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
  renderChunkTimer: null,
  renderToken: 0,
  sourceRenderTimer: null,
  sourceFilter: "all",
  renderedRows: new Map(),
  autoReanalyzeTimer: null,
  performance: {
    isOpen: false,
    isLoading: false,
    requestToken: 0,
    snapshot: null
  },
  elements: {
    isOpen: false,
    isLoading: false,
    requestToken: 0,
    detailsToken: 0,
    items: [],
    searchQuery: "",
    selectedKey: ""
  },
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
  openPerformanceBtn: null,
  openElementsBtn: null,
  aiModeToggle: null,
  aiModeLabel: null,
  performanceBackdrop: null,
  performancePanel: null,
  performanceMeta: null,
  closePerformanceBtn: null,
  recordPerformanceBtn: null,
  recordReloadPerformanceBtn: null,
  performanceInsights: null,
  perfCardLcp: null,
  perfCardCls: null,
  perfCardInp: null,
  perfCardFcp: null,
  perfLcpValue: null,
  perfClsValue: null,
  perfInpValue: null,
  perfFcpValue: null,
  perfLcpNote: null,
  perfClsNote: null,
  perfInpNote: null,
  perfFcpNote: null,
  elementsBackdrop: null,
  elementsPanel: null,
  elementsMeta: null,
  closeElementsBtn: null,
  scanElementsBtn: null,
  pickElementBtn: null,
  elementSelectorInput: null,
  applyElementSelectorBtn: null,
  elementSelectorList: null,
  elementsCount: null,
  elementsSearchInput: null,
  elementDetailsTitle: null,
  elementTagBadge: null,
  elementJsBadge: null,
  elementAnimationBadge: null,
  elementHtmlView: null,
  elementCssView: null,
  elementJsView: null,
  elementAnimationView: null,
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
  dom.openPerformanceBtn = document.getElementById("openPerformanceBtn");
  dom.openElementsBtn = document.getElementById("openElementsBtn");
  dom.aiModeToggle = document.getElementById("aiModeToggle");
  dom.aiModeLabel = document.getElementById("aiModeLabel");
  dom.performanceBackdrop = document.getElementById("performanceBackdrop");
  dom.performancePanel = document.getElementById("performancePanel");
  dom.performanceMeta = document.getElementById("performanceMeta");
  dom.closePerformanceBtn = document.getElementById("closePerformanceBtn");
  dom.recordPerformanceBtn = document.getElementById("recordPerformanceBtn");
  dom.recordReloadPerformanceBtn = document.getElementById("recordReloadPerformanceBtn");
  dom.performanceInsights = document.getElementById("performanceInsights");
  dom.perfCardLcp = document.getElementById("perfCardLcp");
  dom.perfCardCls = document.getElementById("perfCardCls");
  dom.perfCardInp = document.getElementById("perfCardInp");
  dom.perfCardFcp = document.getElementById("perfCardFcp");
  dom.perfLcpValue = document.getElementById("perfLcpValue");
  dom.perfClsValue = document.getElementById("perfClsValue");
  dom.perfInpValue = document.getElementById("perfInpValue");
  dom.perfFcpValue = document.getElementById("perfFcpValue");
  dom.perfLcpNote = document.getElementById("perfLcpNote");
  dom.perfClsNote = document.getElementById("perfClsNote");
  dom.perfInpNote = document.getElementById("perfInpNote");
  dom.perfFcpNote = document.getElementById("perfFcpNote");
  dom.elementsBackdrop = document.getElementById("elementsBackdrop");
  dom.elementsPanel = document.getElementById("elementsPanel");
  dom.elementsMeta = document.getElementById("elementsMeta");
  dom.closeElementsBtn = document.getElementById("closeElementsBtn");
  dom.scanElementsBtn = document.getElementById("scanElementsBtn");
  dom.pickElementBtn = document.getElementById("pickElementBtn");
  dom.elementSelectorInput = document.getElementById("elementSelectorInput");
  dom.applyElementSelectorBtn = document.getElementById("applyElementSelectorBtn");
  dom.elementSelectorList = document.getElementById("elementSelectorList");
  dom.elementsCount = document.getElementById("elementsCount");
  dom.elementsSearchInput = document.getElementById("elementsSearchInput");
  dom.elementDetailsTitle = document.getElementById("elementDetailsTitle");
  dom.elementTagBadge = document.getElementById("elementTagBadge");
  dom.elementJsBadge = document.getElementById("elementJsBadge");
  dom.elementAnimationBadge = document.getElementById("elementAnimationBadge");
  dom.elementHtmlView = document.getElementById("elementHtmlView");
  dom.elementCssView = document.getElementById("elementCssView");
  dom.elementJsView = document.getElementById("elementJsView");
  dom.elementAnimationView = document.getElementById("elementAnimationView");
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

  dom.openPerformanceBtn.addEventListener("click", () => {
    openPerformancePanel();
    void recordPerformanceSnapshot({ withReload: true });
  });

  dom.openElementsBtn.addEventListener("click", () => {
    openElementsPanel();
    void scanElementsSnapshot();
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

  dom.recordPerformanceBtn.addEventListener("click", () => {
    void recordPerformanceSnapshot();
  });

  dom.recordReloadPerformanceBtn.addEventListener("click", () => {
    void recordPerformanceSnapshot({ withReload: true });
  });

  dom.closePerformanceBtn.addEventListener("click", () => {
    closePerformancePanel();
  });

  dom.performanceBackdrop.addEventListener("click", () => {
    closePerformancePanel();
  });

  dom.scanElementsBtn.addEventListener("click", () => {
    void scanElementsSnapshot();
  });

  dom.pickElementBtn.addEventListener("click", () => {
    void pickElementFromPage();
  });

  dom.applyElementSelectorBtn.addEventListener("click", () => {
    void selectElementBySelectorInput();
  });

  dom.elementSelectorInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    void selectElementBySelectorInput();
  });

  dom.closeElementsBtn.addEventListener("click", () => {
    closeElementsPanel();
  });

  dom.elementsBackdrop.addEventListener("click", () => {
    closeElementsPanel();
  });

  dom.elementsSearchInput.addEventListener("input", () => {
    state.elements.searchQuery = dom.elementsSearchInput.value.trim().toLowerCase();
    renderElementSelectorList();
  });

  dom.elementSelectorList.addEventListener("click", (event) => {
    const button = event.target.closest(".element-selector-item");
    if (!button) {
      return;
    }

    selectElementByKey(button.dataset.key);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    if (state.elements.isOpen) {
      closeElementsPanel();
      return;
    }

    if (state.performance.isOpen) {
      closePerformancePanel();
      return;
    }

    if (state.analysis.isOpen) {
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
  closePerformancePanel();
  closeElementsPanel();
  resetAnalysisPanel("Run Analyze Network to generate actionable insights.");
  resetPerformancePanel("No performance data yet. Click Record.");
  resetElementsPanel("Click Scan Elements to load selectors, HTML, CSS, JavaScript hooks, and animations from the tracked tab.");
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
    closePerformancePanel();
    resetPerformancePanel("Tracked tab closed. Open a target tab and record again.");
    closeElementsPanel();
    resetElementsPanel("Tracked tab closed. Open a target tab and scan elements again.");
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
  if (state.renderChunkTimer !== null) {
    drainPendingEntriesIntoState();
    updateSummaryUi();
    scheduleSourceRender();
    scheduleFullRender();
    return;
  }

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
  cancelOngoingFullRender();
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

function cancelOngoingFullRender() {
  if (state.renderChunkTimer !== null) {
    clearTimeout(state.renderChunkTimer);
    state.renderChunkTimer = null;
  }

  state.renderToken += 1;
}

function fullRender() {
  if (state.flushTimer !== null) {
    clearTimeout(state.flushTimer);
    state.flushTimer = null;
  }

  cancelOngoingFullRender();
  drainPendingEntriesIntoState();
  state.renderedRows.clear();
  dom.logRows.textContent = "";

  const filteredEntries = [];
  for (const entry of state.allLogs) {
    if (!matchesAllFilters(entry)) {
      continue;
    }

    filteredEntries.push(entry);
  }

  if (filteredEntries.length === 0) {
    updateEmptyState();
    updateSourceListUi();
    return;
  }

  const renderToken = state.renderToken + 1;
  state.renderToken = renderToken;
  let index = 0;

  const appendChunk = () => {
    if (renderToken !== state.renderToken) {
      return;
    }

    const fragment = document.createDocumentFragment();
    const end = Math.min(index + FULL_RENDER_CHUNK_SIZE, filteredEntries.length);

    for (; index < end; index += 1) {
      const entry = filteredEntries[index];
      const row = createLogRow(entry);
      state.renderedRows.set(entry.id, row);
      fragment.appendChild(row);
    }

    if (fragment.childNodes.length > 0) {
      dom.logRows.appendChild(fragment);
    }

    updateEmptyState();

    if (index < filteredEntries.length) {
      state.renderChunkTimer = setTimeout(appendChunk, FULL_RENDER_CHUNK_DELAY_MS);
      return;
    }

    state.renderChunkTimer = null;
    updateSourceListUi();
  };

  appendChunk();
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
  if (state.performance.isOpen) {
    closePerformancePanel();
  }

  if (state.elements.isOpen) {
    closeElementsPanel();
  }

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

function openPerformancePanel() {
  if (state.analysis.isOpen) {
    closeAnalysisPanel();
  }

  if (state.elements.isOpen) {
    closeElementsPanel();
  }

  state.performance.isOpen = true;
  dom.performancePanel.classList.remove("hidden");
  dom.performanceBackdrop.classList.remove("hidden");
  dom.performancePanel.setAttribute("aria-hidden", "false");
  document.body.classList.add("performance-open");
  dom.closePerformanceBtn.focus();
}

function closePerformancePanel() {
  state.performance.isOpen = false;
  dom.performancePanel.classList.add("hidden");
  dom.performanceBackdrop.classList.add("hidden");
  dom.performancePanel.setAttribute("aria-hidden", "true");
  document.body.classList.remove("performance-open");
}

function openElementsPanel() {
  if (state.analysis.isOpen) {
    closeAnalysisPanel();
  }

  if (state.performance.isOpen) {
    closePerformancePanel();
  }

  state.elements.isOpen = true;
  dom.elementsPanel.classList.remove("hidden");
  dom.elementsBackdrop.classList.remove("hidden");
  dom.elementsPanel.setAttribute("aria-hidden", "false");
  document.body.classList.add("elements-open");
  dom.closeElementsBtn.focus();
}

function closeElementsPanel() {
  state.elements.isOpen = false;
  dom.elementsPanel.classList.add("hidden");
  dom.elementsBackdrop.classList.add("hidden");
  dom.elementsPanel.setAttribute("aria-hidden", "true");
  document.body.classList.remove("elements-open");
}

function resetElementsPanel(message) {
  state.elements.items = [];
  state.elements.searchQuery = "";
  state.elements.selectedKey = "";
  state.elements.detailsToken += 1;
  dom.elementSelectorInput.value = "";
  dom.elementsSearchInput.value = "";
  dom.elementsMeta.textContent = message;
  renderElementSelectorList();
  renderSelectedElementDetails(null);
}

function setElementsLoading(isLoading, message) {
  state.elements.isLoading = Boolean(isLoading);
  dom.scanElementsBtn.disabled = state.elements.isLoading;
  dom.scanElementsBtn.classList.toggle("is-running", state.elements.isLoading);
  dom.pickElementBtn.disabled = state.elements.isLoading;
  dom.pickElementBtn.classList.toggle("is-running", state.elements.isLoading);
  dom.applyElementSelectorBtn.disabled = state.elements.isLoading;
  dom.applyElementSelectorBtn.classList.toggle("is-running", state.elements.isLoading);
  dom.elementSelectorInput.disabled = state.elements.isLoading;

  if (typeof message === "string" && message.length > 0) {
    dom.elementsMeta.textContent = message;
  }
}

async function scanElementsSnapshot() {
  const targetTabId = Number(state.targetTabId);
  if (!Number.isInteger(targetTabId) || targetTabId < 0) {
    resetElementsPanel("No tracked tab available for element scan.");
    return;
  }

  const requestToken = state.elements.requestToken + 1;
  state.elements.requestToken = requestToken;
  setElementsLoading(true, "Scanning selectors with HTML, CSS, JavaScript hooks, and animation signals from the tracked tab...");

  const snapshot = await captureElementsSnapshotFromTrackedTab();

  if (requestToken !== state.elements.requestToken) {
    return;
  }

  if (!snapshot || !snapshot.ok) {
    const reason = snapshot && snapshot.error ? snapshot.error : "Unknown scan error.";
    setElementsLoading(false, `Elements scan failed: ${reason}`);
    return;
  }

  renderElementsSnapshot(snapshot);
  setElementsLoading(false, dom.elementsMeta.textContent);
}

async function selectElementBySelectorInput() {
  const selector = String(dom.elementSelectorInput.value || "").trim();
  if (selector.length === 0) {
    dom.elementsMeta.textContent = "Enter a CSS selector (for example: #app .btn-primary).";
    dom.elementSelectorInput.focus();
    return;
  }

  const targetTabId = Number(state.targetTabId);
  if (!Number.isInteger(targetTabId) || targetTabId < 0) {
    resetElementsPanel("No tracked tab available for selector lookup.");
    return;
  }

  const requestToken = state.elements.requestToken + 1;
  state.elements.requestToken = requestToken;
  setElementsLoading(true, `Locating selector \"${selector}\" in tracked tab...`);

  const snapshot = await captureElementBySelectorFromTrackedTab(selector);

  if (requestToken !== state.elements.requestToken) {
    return;
  }

  if (!snapshot || !snapshot.ok) {
    const reason = snapshot && snapshot.error ? snapshot.error : "Unknown selector lookup error.";
    setElementsLoading(false, `Selector lookup failed: ${reason}`);
    return;
  }

  renderElementSelectorSnapshot(snapshot);
  setElementsLoading(false, dom.elementsMeta.textContent);
}

async function pickElementFromPage() {
  const targetTabId = Number(state.targetTabId);
  if (!Number.isInteger(targetTabId) || targetTabId < 0) {
    resetElementsPanel("No tracked tab available for mouse element pick.");
    return;
  }

  const requestToken = state.elements.requestToken + 1;
  state.elements.requestToken = requestToken;
  setElementsLoading(
    true,
    "Pick mode active: move mouse over the tracked tab and click an element. Press Escape in tab to cancel."
  );

  try {
    await chrome.tabs.update(targetTabId, { active: true });
  } catch {
    // Ignore focus/activation errors and continue with picker flow.
  }

  const snapshot = await captureElementByMouseFromTrackedTab();

  if (requestToken !== state.elements.requestToken) {
    return;
  }

  if (!snapshot || !snapshot.ok) {
    const reason = snapshot && snapshot.error ? snapshot.error : "Unknown picker error.";
    setElementsLoading(false, `Element pick failed: ${reason}`);
    return;
  }

  renderElementSelectorSnapshot(snapshot);
  setElementsLoading(false, dom.elementsMeta.textContent);
}

async function captureElementsSnapshotFromTrackedTab() {
  const targetTabId = Number(state.targetTabId);
  if (!Number.isInteger(targetTabId) || targetTabId < 0) {
    return { ok: false, error: "No tracked tab selected." };
  }

  if (!chrome.scripting || typeof chrome.scripting.executeScript !== "function") {
    return { ok: false, error: "Scripting API unavailable. Add scripting permission and reload extension." };
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: collectElementsInPageContext,
      args: [ELEMENT_SELECTOR_SCAN_LIMIT]
    });

    const firstResult = Array.isArray(results) && results.length > 0 ? results[0].result : null;
    if (!firstResult || typeof firstResult !== "object") {
      return { ok: false, error: "No element data returned from page." };
    }

    return firstResult;
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : String(error)
    };
  }
}

async function captureElementBySelectorFromTrackedTab(selector) {
  const targetTabId = Number(state.targetTabId);
  if (!Number.isInteger(targetTabId) || targetTabId < 0) {
    return { ok: false, error: "No tracked tab selected." };
  }

  if (!chrome.scripting || typeof chrome.scripting.executeScript !== "function") {
    return { ok: false, error: "Scripting API unavailable. Add scripting permission and reload extension." };
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: collectElementBySelectorInPageContext,
      args: [selector]
    });

    const firstResult = Array.isArray(results) && results.length > 0 ? results[0].result : null;
    if (!firstResult || typeof firstResult !== "object") {
      return { ok: false, error: "No selector data returned from page." };
    }

    return firstResult;
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : String(error)
    };
  }
}

async function captureElementByMouseFromTrackedTab() {
  const targetTabId = Number(state.targetTabId);
  if (!Number.isInteger(targetTabId) || targetTabId < 0) {
    return { ok: false, error: "No tracked tab selected." };
  }

  if (!chrome.scripting || typeof chrome.scripting.executeScript !== "function") {
    return { ok: false, error: "Scripting API unavailable. Add scripting permission and reload extension." };
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: pickElementInPageContext,
      args: [45000]
    });

    const firstResult = Array.isArray(results) && results.length > 0 ? results[0].result : null;
    if (!firstResult || typeof firstResult !== "object") {
      return { ok: false, error: "No picker data returned from page." };
    }

    return firstResult;
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : String(error)
    };
  }
}

function renderElementsSnapshot(snapshot) {
  const rawElements = Array.isArray(snapshot.elements) ? snapshot.elements : [];
  const elements = rawElements
    .map((item, index) => normalizeElementInspectorItem(item, `scan:${index}`))
    .filter((item) => Boolean(item));
  const pageUrl = String(snapshot.page?.url || "");
  const host = isHttpUrl(pageUrl) ? getDomain(pageUrl) : "tracked tab";
  const capturedAtText = formatTime(snapshot.capturedAt || Date.now());

  state.elements.items = elements;
  state.elements.searchQuery = "";
  dom.elementsSearchInput.value = "";

  const filteredItems = getFilteredElementItems();
  if (filteredItems.length > 0) {
    state.elements.selectedKey = filteredItems[0].key;
  } else {
    state.elements.selectedKey = "";
  }

  dom.elementsMeta.textContent = `Captured ${formatInteger(elements.length)} elements from ${host} at ${capturedAtText}.`;
  renderElementSelectorList();
  renderSelectedElementDetails(filteredItems[0] || null);
}

function renderElementSelectorSnapshot(snapshot) {
  const rawItem = snapshot.element && typeof snapshot.element === "object" ? snapshot.element : null;
  if (!rawItem) {
    dom.elementsMeta.textContent = "Selector lookup returned no element details.";
    return;
  }

  const selector = String(rawItem.selector || "").trim();
  if (selector.length === 0) {
    dom.elementsMeta.textContent = "Selector lookup returned an invalid selector value.";
    return;
  }

  const item = normalizeElementInspectorItem(rawItem, "manual");
  if (!item) {
    dom.elementsMeta.textContent = "Selector lookup returned incomplete element details.";
    return;
  }

  upsertElementItem(item);
  state.elements.selectedKey = item.key;
  state.elements.searchQuery = "";
  dom.elementSelectorInput.value = selector;
  dom.elementsSearchInput.value = "";

  const pageUrl = String(snapshot.page?.url || "");
  const host = isHttpUrl(pageUrl) ? getDomain(pageUrl) : "tracked tab";
  const capturedAtText = formatTime(snapshot.capturedAt || Date.now());
  dom.elementsMeta.textContent = `Selector ${selector} captured from ${host} at ${capturedAtText}.`;

  renderElementSelectorList();
  renderSelectedElementDetails(item);
  void previewElementBySelectorInTrackedTab(item.selector);
}

function upsertElementItem(item) {
  const normalizedItem = normalizeElementInspectorItem(item, "upsert");
  if (!normalizedItem) {
    return;
  }

  const existingIndex = state.elements.items.findIndex((existingItem) => {
    return existingItem && (existingItem.key === normalizedItem.key || existingItem.selector === normalizedItem.selector);
  });

  if (existingIndex >= 0) {
    state.elements.items[existingIndex] = normalizedItem;

    if (existingIndex > 0) {
      state.elements.items.splice(existingIndex, 1);
      state.elements.items.unshift(normalizedItem);
    }
  } else {
    state.elements.items.unshift(normalizedItem);
  }

  if (state.elements.items.length > ELEMENT_SELECTOR_SCAN_LIMIT) {
    state.elements.items = state.elements.items.slice(0, ELEMENT_SELECTOR_SCAN_LIMIT);
  }
}

function getFilteredElementItems() {
  const query = state.elements.searchQuery;
  if (!query) {
    return state.elements.items;
  }

  return state.elements.items.filter((item) => {
    const selector = String(item.selector || "").toLowerCase();
    const tagName = String(item.tagName || "").toLowerCase();
    const textSnippet = String(item.textSnippet || "").toLowerCase();
    return selector.includes(query) || tagName.includes(query) || textSnippet.includes(query);
  });
}

function renderElementSelectorList() {
  const filteredItems = getFilteredElementItems();
  dom.elementsCount.textContent = formatInteger(filteredItems.length);
  dom.elementSelectorList.textContent = "";

  if (filteredItems.length === 0) {
    const empty = document.createElement("div");
    empty.className = "analysis-empty";
    empty.textContent = state.elements.items.length === 0
      ? "No elements loaded yet. Click Scan Elements."
      : "No selectors match your filter.";
    dom.elementSelectorList.appendChild(empty);
    renderSelectedElementDetails(null);
    return;
  }

  if (!filteredItems.some((item) => item.key === state.elements.selectedKey)) {
    state.elements.selectedKey = filteredItems[0].key;
  }

  const fragment = document.createDocumentFragment();
  for (const item of filteredItems) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "element-selector-item";
    button.dataset.key = item.key;
    button.classList.toggle("is-active", item.key === state.elements.selectedKey);

    const selector = document.createElement("span");
    selector.className = "element-selector-main";
    selector.textContent = item.selector;

    const meta = document.createElement("span");
    meta.className = "element-selector-meta";
    meta.textContent = item.textSnippet
      ? `${item.tagName} | ${item.textSnippet}`
      : `${item.tagName}`;

    const statusRow = document.createElement("div");
    statusRow.className = "element-selector-status";
    statusRow.append(
      createElementSelectorStatusBadge("JS", item.hasJs),
      createElementSelectorStatusBadge("ANIM", item.hasAnimations)
    );

    button.append(selector, meta, statusRow);
    fragment.appendChild(button);
  }

  dom.elementSelectorList.appendChild(fragment);

  const selectedItem = filteredItems.find((item) => item.key === state.elements.selectedKey) || filteredItems[0];
  renderSelectedElementDetails(selectedItem);
}

function selectElementByKey(key) {
  if (typeof key !== "string" || key.length === 0) {
    return;
  }

  state.elements.selectedKey = key;
  renderElementSelectorList();

  const selectedItem = state.elements.items.find((item) => item && item.key === key);
  if (selectedItem && selectedItem.selector) {
    dom.elementSelectorInput.value = selectedItem.selector;
    void previewElementBySelectorInTrackedTab(selectedItem.selector);
  }
}

async function previewElementBySelectorInTrackedTab(selector) {
  const trimmedSelector = String(selector || "").trim();
  if (trimmedSelector.length === 0) {
    return;
  }

  const targetTabId = Number(state.targetTabId);
  if (!Number.isInteger(targetTabId) || targetTabId < 0) {
    return;
  }

  if (!chrome.scripting || typeof chrome.scripting.executeScript !== "function") {
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: flashElementBySelectorInPageContext,
      args: [trimmedSelector]
    });
  } catch {
    // Ignore highlight preview failures.
  }
}

function renderSelectedElementDetails(item) {
  if (!item || typeof item !== "object") {
    dom.elementDetailsTitle.textContent = "Selected Element";
    dom.elementHtmlView.textContent = "Select an element selector to view HTML.";
    dom.elementCssView.textContent = "Select an element selector to view computed CSS.";
    dom.elementJsView.textContent = "Select an element selector to inspect JavaScript handlers and hooks.";
    dom.elementAnimationView.textContent = "Select an element selector to inspect CSS animations and transitions.";
    applyElementInsightBadges(null);
    return;
  }

  dom.elementDetailsTitle.textContent = item.selector;
  dom.elementHtmlView.textContent = item.html || "HTML is not available for this element.";
  dom.elementCssView.textContent = item.css || "CSS is not available for this element.";
  dom.elementJsView.textContent = item.diagnosticsPending
    ? ELEMENT_JS_LOADING_MESSAGE
    : item.js || (item.diagnosticsLoaded ? ELEMENT_JS_EMPTY_MESSAGE : ELEMENT_JS_LOADING_MESSAGE);
  dom.elementAnimationView.textContent = item.diagnosticsPending
    ? ELEMENT_ANIMATION_LOADING_MESSAGE
    : item.animations || (item.diagnosticsLoaded ? ELEMENT_ANIMATION_EMPTY_MESSAGE : ELEMENT_ANIMATION_LOADING_MESSAGE);
  applyElementInsightBadges(item);

  if (!item.diagnosticsLoaded && !item.diagnosticsPending) {
    void ensureElementDiagnosticsForSelected(item);
  }
}

function normalizeElementInspectorItem(rawItem, fallbackPrefix = "element") {
  if (!rawItem || typeof rawItem !== "object") {
    return null;
  }

  const selector = String(rawItem.selector || "").trim();
  if (selector.length === 0) {
    return null;
  }

  const jsTextRaw = typeof rawItem.js === "string" ? rawItem.js.trim() : "";
  const animationTextRaw = typeof rawItem.animations === "string" ? rawItem.animations.trim() : "";
  const diagnosticsLoaded = Boolean(rawItem.diagnosticsLoaded);

  return {
    key: String(rawItem.key || `${fallbackPrefix}:${selector}`),
    selector,
    tagName: String(rawItem.tagName || "element").toLowerCase(),
    textSnippet: String(rawItem.textSnippet || ""),
    html: String(rawItem.html || ""),
    css: String(rawItem.css || ""),
    js: jsTextRaw || (diagnosticsLoaded ? ELEMENT_JS_EMPTY_MESSAGE : ELEMENT_JS_LOADING_MESSAGE),
    animations: animationTextRaw || (diagnosticsLoaded ? ELEMENT_ANIMATION_EMPTY_MESSAGE : ELEMENT_ANIMATION_LOADING_MESSAGE),
    hasJs: Boolean(rawItem.hasJs),
    hasAnimations: Boolean(rawItem.hasAnimations),
    diagnosticsLoaded,
    diagnosticsPending: Boolean(rawItem.diagnosticsPending)
  };
}

function createElementSelectorStatusBadge(label, isActive) {
  const badge = document.createElement("span");
  badge.className = `element-selector-status-badge ${isActive ? "is-active" : "is-inactive"}`;
  badge.textContent = `${label}: ${isActive ? "ON" : "OFF"}`;
  return badge;
}

function applyElementInsightBadges(item) {
  if (!item) {
    setElementInsightBadge(dom.elementTagBadge, "Tag: --", { active: false, variant: "tag" });
    setElementInsightBadge(dom.elementJsBadge, "JavaScript: none", { active: false, variant: "js" });
    setElementInsightBadge(dom.elementAnimationBadge, "Animation: none", { active: false, variant: "animation" });
    return;
  }

  setElementInsightBadge(dom.elementTagBadge, `Tag: ${String(item.tagName || "--").toUpperCase()}`, {
    active: true,
    variant: "tag"
  });
  setElementInsightBadge(dom.elementJsBadge, `JavaScript: ${item.hasJs ? "detected" : "none"}`, {
    active: item.hasJs,
    variant: "js"
  });
  setElementInsightBadge(dom.elementAnimationBadge, `Animation: ${item.hasAnimations ? "detected" : "none"}`, {
    active: item.hasAnimations,
    variant: "animation"
  });
}

function setElementInsightBadge(node, text, options = {}) {
  if (!node) {
    return;
  }

  const active = Boolean(options.active);
  const variant = String(options.variant || "").toLowerCase();

  node.textContent = text;
  node.classList.remove("is-active", "is-inactive", "is-tag", "is-js", "is-animation");
  node.classList.add(active ? "is-active" : "is-inactive");

  if (variant === "tag") {
    node.classList.add("is-tag");
  } else if (variant === "js") {
    node.classList.add("is-js");
  } else if (variant === "animation") {
    node.classList.add("is-animation");
  }
}

async function ensureElementDiagnosticsForSelected(item) {
  if (!item || typeof item !== "object" || item.diagnosticsLoaded || item.diagnosticsPending) {
    return;
  }

  const selector = String(item.selector || "").trim();
  if (selector.length === 0) {
    return;
  }

  const detailsToken = state.elements.detailsToken + 1;
  state.elements.detailsToken = detailsToken;
  item.diagnosticsPending = true;

  if (state.elements.selectedKey === item.key) {
    renderSelectedElementDetails(item);
  }

  const snapshot = await captureElementBySelectorFromTrackedTab(selector);

  if (detailsToken !== state.elements.detailsToken) {
    item.diagnosticsPending = false;
    return;
  }

  if (!snapshot || !snapshot.ok || !snapshot.element || typeof snapshot.element !== "object") {
    item.diagnosticsLoaded = true;
    item.diagnosticsPending = false;
    item.js = "Unable to load JavaScript diagnostics for this selector right now.";
    item.animations = "Unable to load animation diagnostics for this selector right now.";

    if (state.elements.selectedKey === item.key) {
      renderElementSelectorList();
    }
    return;
  }

  const enriched = normalizeElementInspectorItem(
    {
      ...snapshot.element,
      key: item.key,
      selector: item.selector,
      diagnosticsLoaded: true
    },
    "selected"
  );

  if (!enriched) {
    item.diagnosticsPending = false;
    return;
  }

  item.tagName = enriched.tagName;
  item.textSnippet = enriched.textSnippet;
  item.html = enriched.html;
  item.css = enriched.css;
  item.js = enriched.js;
  item.animations = enriched.animations;
  item.hasJs = enriched.hasJs;
  item.hasAnimations = enriched.hasAnimations;
  item.diagnosticsLoaded = true;
  item.diagnosticsPending = false;

  if (state.elements.selectedKey === item.key) {
    renderElementSelectorList();
  }
}

function resetPerformancePanel(message) {
  dom.performanceMeta.textContent = message;
  setPerformanceMetricCard(dom.perfCardLcp, dom.perfLcpValue, dom.perfLcpNote, "--", "Waiting for data...", "unknown");
  setPerformanceMetricCard(dom.perfCardCls, dom.perfClsValue, dom.perfClsNote, "--", "Waiting for data...", "unknown");
  setPerformanceMetricCard(dom.perfCardInp, dom.perfInpValue, dom.perfInpNote, "--", "Waiting for data...", "unknown");
  setPerformanceMetricCard(dom.perfCardFcp, dom.perfFcpValue, dom.perfFcpNote, "--", "Waiting for data...", "unknown");

  dom.performanceInsights.textContent = "";
  const empty = document.createElement("li");
  empty.className = "analysis-empty";
  empty.textContent = "No performance data yet. Click Record.";
  dom.performanceInsights.appendChild(empty);
}

function setPerformanceLoading(isLoading, message) {
  state.performance.isLoading = Boolean(isLoading);
  dom.recordPerformanceBtn.disabled = state.performance.isLoading;
  dom.recordReloadPerformanceBtn.disabled = state.performance.isLoading;
  dom.recordPerformanceBtn.classList.toggle("is-running", state.performance.isLoading);
  dom.recordReloadPerformanceBtn.classList.toggle("is-running", state.performance.isLoading);

  if (typeof message === "string" && message.length > 0) {
    dom.performanceMeta.textContent = message;
  }
}

async function recordPerformanceSnapshot(options = {}) {
  const withReload = Boolean(options.withReload);
  const targetTabId = Number(state.targetTabId);

  if (!Number.isInteger(targetTabId) || targetTabId < 0) {
    resetPerformancePanel("No tracked tab available for performance capture.");
    return;
  }

  const requestToken = state.performance.requestToken + 1;
  state.performance.requestToken = requestToken;

  setPerformanceLoading(
    true,
    withReload
      ? "Reloading tracked tab and capturing performance metrics..."
      : "Recording performance metrics from tracked tab..."
  );

  let snapshot = null;

  if (withReload) {
    const baselineSnapshot = await capturePerformanceSnapshotFromTrackedTab();
    const baselineTimeOrigin = Number(baselineSnapshot?.page?.timeOrigin);

    const reloadResult = await sendMessage({ type: "reload-tracked-tab" });
    if (!reloadResult || !reloadResult.ok) {
      if (requestToken === state.performance.requestToken) {
        setPerformanceLoading(false, "Unable to reload tracked tab for performance capture.");
      }
      return;
    }

    const startedAt = Date.now();
    let gotFreshNavigationSnapshot = false;

    while (Date.now() - startedAt < PERF_RELOAD_CAPTURE_WAIT_MS) {
      await sleep(PERF_RELOAD_POLL_INTERVAL_MS);
      snapshot = await capturePerformanceSnapshotFromTrackedTab();

      if (isFreshPerformanceReloadSnapshot(snapshot, baselineTimeOrigin, startedAt)) {
        gotFreshNavigationSnapshot = true;
        break;
      }
    }

    if (!gotFreshNavigationSnapshot) {
      snapshot = {
        ok: false,
        error: "Fresh reload metrics not ready yet. Wait a moment and click Record and Reload again."
      };
    }
  } else {
    snapshot = await capturePerformanceSnapshotFromTrackedTab();
  }

  if (requestToken !== state.performance.requestToken) {
    return;
  }

  if (!snapshot || !snapshot.ok) {
    const reason = snapshot && snapshot.error ? snapshot.error : "Unknown capture error.";
    setPerformanceLoading(false, `Performance capture failed: ${reason}`);
    return;
  }

  state.performance.snapshot = snapshot;
  renderPerformanceSnapshot(snapshot, { withReload });
  setPerformanceLoading(false, dom.performanceMeta.textContent);
}

function isFreshPerformanceReloadSnapshot(snapshot, baselineTimeOrigin, reloadStartedAt) {
  if (!snapshot || !snapshot.ok) {
    return false;
  }

  const readyState = String(snapshot.page?.readyState || "").toLowerCase();
  const hasPaintMetrics = Number.isFinite(snapshot.metrics?.lcp) || Number.isFinite(snapshot.metrics?.fcp);

  if (readyState !== "complete" || !hasPaintMetrics) {
    return false;
  }

  const captureTs = Number(snapshot.capturedAt);
  if (Number.isFinite(captureTs) && captureTs < reloadStartedAt) {
    return false;
  }

  const snapshotTimeOrigin = Number(snapshot.page?.timeOrigin);
  if (Number.isFinite(baselineTimeOrigin) && Number.isFinite(snapshotTimeOrigin)) {
    if (snapshotTimeOrigin <= baselineTimeOrigin + PERF_RELOAD_NAV_CHANGE_GRACE_MS) {
      return false;
    }
  }

  return true;
}

async function capturePerformanceSnapshotFromTrackedTab() {
  const targetTabId = Number(state.targetTabId);
  if (!Number.isInteger(targetTabId) || targetTabId < 0) {
    return { ok: false, error: "No tracked tab selected." };
  }

  if (!chrome.scripting || typeof chrome.scripting.executeScript !== "function") {
    return { ok: false, error: "Scripting API unavailable. Add scripting permission and reload extension." };
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: collectPerformanceInPageContext
    });

    const firstResult = Array.isArray(results) && results.length > 0 ? results[0].result : null;
    if (!firstResult || typeof firstResult !== "object") {
      return { ok: false, error: "No metrics returned from page." };
    }

    return firstResult;
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : String(error)
    };
  }
}

function renderPerformanceSnapshot(snapshot, options = {}) {
  const metrics = snapshot.metrics && typeof snapshot.metrics === "object" ? snapshot.metrics : {};
  const pageUrl = String(snapshot.page?.url || "");
  const pageHost = isHttpUrl(pageUrl) ? getDomain(pageUrl) : "tracked tab";
  const pagePath = getPerformancePathLabel(pageUrl);
  const capturedAtText = formatTime(snapshot.capturedAt || Date.now());

  const lcpState = classifyDurationMetric(metrics.lcp, 2500, 4000);
  const clsState = classifyClsMetric(metrics.cls);
  const inpState = classifyDurationMetric(metrics.inp, 200, 500);
  const fcpState = classifyDurationMetric(metrics.fcp, 1800, 3000);

  setPerformanceMetricCard(
    dom.perfCardLcp,
    dom.perfLcpValue,
    dom.perfLcpNote,
    formatDurationMetric(metrics.lcp),
    describeMetricState("LCP", lcpState, "<= 2.5s is good"),
    lcpState
  );

  setPerformanceMetricCard(
    dom.perfCardCls,
    dom.perfClsValue,
    dom.perfClsNote,
    formatClsMetric(metrics.cls),
    describeMetricState("CLS", clsState, "<= 0.10 is good"),
    clsState
  );

  setPerformanceMetricCard(
    dom.perfCardInp,
    dom.perfInpValue,
    dom.perfInpNote,
    formatDurationMetric(metrics.inp),
    describeMetricState("INP", inpState, "<= 200ms is good"),
    inpState
  );

  setPerformanceMetricCard(
    dom.perfCardFcp,
    dom.perfFcpValue,
    dom.perfFcpNote,
    formatDurationMetric(metrics.fcp),
    describeMetricState("FCP", fcpState, "<= 1.8s is good"),
    fcpState
  );

  const modeLabel = options.withReload ? "after reload" : "live snapshot";
  dom.performanceMeta.textContent = `Captured ${modeLabel} for ${pageHost}${pagePath} at ${capturedAtText}.`;

  const insights = buildPerformanceInsights(metrics, snapshot, pageHost);
  renderPerformanceInsights(insights);
}

function getPerformancePathLabel(url) {
  if (!isHttpUrl(url)) {
    return "";
  }

  try {
    const parsed = new URL(url);
    const path = parsed.pathname || "/";
    return path === "/" ? "" : path;
  } catch {
    return "";
  }
}

function setPerformanceMetricCard(card, valueNode, noteNode, valueText, noteText, stateClass) {
  valueNode.textContent = valueText;
  noteNode.textContent = noteText;

  card.classList.remove("is-good", "is-warning", "is-error");
  if (stateClass === "good") {
    card.classList.add("is-good");
  } else if (stateClass === "warning") {
    card.classList.add("is-warning");
  } else if (stateClass === "error") {
    card.classList.add("is-error");
  }
}

function classifyDurationMetric(value, goodLimit, warningLimit) {
  if (!Number.isFinite(value)) {
    return "unknown";
  }

  if (value <= goodLimit) {
    return "good";
  }

  if (value <= warningLimit) {
    return "warning";
  }

  return "error";
}

function classifyClsMetric(value) {
  if (!Number.isFinite(value)) {
    return "unknown";
  }

  if (value <= 0.1) {
    return "good";
  }

  if (value <= 0.25) {
    return "warning";
  }

  return "error";
}

function describeMetricState(metricName, stateClass, fallback) {
  if (stateClass === "good") {
    return `${metricName} is good.`;
  }

  if (stateClass === "warning") {
    return `${metricName} needs improvement.`;
  }

  if (stateClass === "error") {
    return `${metricName} is poor.`;
  }

  return `${metricName} not available (${fallback}).`;
}

function formatDurationMetric(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)} s`;
  }

  return `${Math.round(value)} ms`;
}

function formatClsMetric(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  return Number(value).toFixed(2);
}

function buildPerformanceInsights(metrics, snapshot, pageHost) {
  const insights = [];
  const resourceCount = Number(metrics.resourceCount);
  const transferSizeBytes = Number(metrics.transferSize);

  if (Number.isFinite(metrics.lcp) && metrics.lcp > 2500) {
    insights.push({
      severity: metrics.lcp > 4000 ? "error" : "warning",
      text: `LCP is elevated on ${pageHost}. Consider optimizing hero image, critical CSS, and server response timing.`
    });
  }

  if (Number.isFinite(metrics.cls) && metrics.cls > 0.1) {
    insights.push({
      severity: metrics.cls > 0.25 ? "error" : "warning",
      text: "Layout shifts detected. Reserve space for media/ads and avoid late font swaps to reduce CLS."
    });
  }

  if (Number.isFinite(metrics.inp) && metrics.inp > 200) {
    insights.push({
      severity: metrics.inp > 500 ? "error" : "warning",
      text: "Interaction latency is high. Reduce main-thread work during user input and split long tasks."
    });
  }

  if (Number.isFinite(resourceCount) && resourceCount > 120) {
    insights.push({
      severity: "warning",
      text: `${resourceCount} resources loaded. Consider bundling, caching, and lazy-loading to reduce startup pressure.`
    });
  }

  if (Number.isFinite(transferSizeBytes) && transferSizeBytes > 0) {
    insights.push({
      severity: "good",
      text: `Approx transfer size: ${formatBytes(transferSizeBytes)} across current navigation.`
    });
  }

  if (
    Number.isFinite(metrics.lcp) && metrics.lcp <= 2500 &&
    Number.isFinite(metrics.cls) && metrics.cls <= 0.1 &&
    Number.isFinite(metrics.inp) && metrics.inp <= 200
  ) {
    insights.push({
      severity: "good",
      text: `Core web vitals look healthy for ${pageHost}. Keep this as your baseline.`
    });
  }

  const navDcl = Number(metrics.domContentLoaded);
  const navLoad = Number(metrics.load);
  if (Number.isFinite(navDcl) || Number.isFinite(navLoad)) {
    const dclText = Number.isFinite(navDcl) ? formatDurationMetric(navDcl) : "--";
    const loadText = Number.isFinite(navLoad) ? formatDurationMetric(navLoad) : "--";
    insights.push({
      severity: "good",
      text: `Navigation timings: DOMContentLoaded ${dclText}, load ${loadText}.`
    });
  }

  insights.push({
    severity: "good",
    text: "CPU/network throttling controls match DevTools UI but are display-only in this extension panel."
  });

  if (insights.length === 0) {
    insights.push({
      severity: "warning",
      text: "Performance metrics not yet available for this page. Try Record and Reload."
    });
  }

  return insights;
}

function renderPerformanceInsights(insights) {
  dom.performanceInsights.textContent = "";

  if (!Array.isArray(insights) || insights.length === 0) {
    const empty = document.createElement("li");
    empty.className = "analysis-empty";
    empty.textContent = "No performance insights available.";
    dom.performanceInsights.appendChild(empty);
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

  dom.performanceInsights.appendChild(fragment);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function collectPerformanceInPageContext() {
  try {
    const storeKey = "__nmlPerfVitals";
    const store = window[storeKey] || (window[storeKey] = {
      installed: false,
      lcp: null,
      cls: 0,
      inp: null,
      fcp: null
    });

    if (!store.installed) {
      store.installed = true;

      try {
        const lcpObserver = new PerformanceObserver((entryList) => {
          const entries = entryList.getEntries();
          if (entries.length > 0) {
            const latest = entries[entries.length - 1];
            const startTime = Number(latest.startTime);
            if (Number.isFinite(startTime)) {
              store.lcp = startTime;
            }
          }
        });
        lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });
      } catch {
        // Unsupported on current page.
      }

      try {
        const clsObserver = new PerformanceObserver((entryList) => {
          for (const entry of entryList.getEntries()) {
            if (entry && !entry.hadRecentInput) {
              store.cls += Number(entry.value) || 0;
            }
          }
        });
        clsObserver.observe({ type: "layout-shift", buffered: true });
      } catch {
        // Unsupported on current page.
      }

      try {
        const inpObserver = new PerformanceObserver((entryList) => {
          for (const entry of entryList.getEntries()) {
            const duration = Number(entry.duration);
            if (Number.isFinite(duration) && (!Number.isFinite(store.inp) || duration > store.inp)) {
              store.inp = duration;
            }
          }
        });
        inpObserver.observe({ type: "event", buffered: true, durationThreshold: 16 });
      } catch {
        // Unsupported on current page.
      }
    }

    const lcpEntries = performance.getEntriesByType("largest-contentful-paint");
    if (lcpEntries.length > 0) {
      const latestLcp = lcpEntries[lcpEntries.length - 1];
      const startTime = Number(latestLcp.startTime);
      if (Number.isFinite(startTime)) {
        store.lcp = startTime;
      }
    }

    const layoutShiftEntries = performance.getEntriesByType("layout-shift");
    let clsTotal = 0;
    for (const entry of layoutShiftEntries) {
      if (entry && !entry.hadRecentInput) {
        clsTotal += Number(entry.value) || 0;
      }
    }
    if (clsTotal > store.cls) {
      store.cls = clsTotal;
    }

    const eventEntries = performance.getEntriesByType("event");
    for (const entry of eventEntries) {
      const duration = Number(entry.duration);
      if (Number.isFinite(duration) && (!Number.isFinite(store.inp) || duration > store.inp)) {
        store.inp = duration;
      }
    }

    if (!Number.isFinite(store.inp)) {
      const firstInputEntries = performance.getEntriesByType("first-input");
      for (const firstInput of firstInputEntries) {
        const delay = Number(firstInput.processingStart) - Number(firstInput.startTime);
        if (Number.isFinite(delay) && (!Number.isFinite(store.inp) || delay > store.inp)) {
          store.inp = delay;
        }
      }
    }

    const paintEntries = performance.getEntriesByType("paint");
    for (const paintEntry of paintEntries) {
      if (paintEntry && paintEntry.name === "first-contentful-paint") {
        const fcp = Number(paintEntry.startTime);
        if (Number.isFinite(fcp)) {
          store.fcp = fcp;
        }
      }
    }

    const navigationEntry = performance.getEntriesByType("navigation")[0] || null;

    return {
      ok: true,
      capturedAt: Date.now(),
      page: {
        url: location.href,
        title: document.title,
        readyState: document.readyState,
        timeOrigin: performance.timeOrigin,
        navigationType: navigationEntry ? navigationEntry.type : null
      },
      metrics: {
        lcp: Number.isFinite(store.lcp) ? store.lcp : null,
        cls: Number.isFinite(store.cls) ? store.cls : 0,
        inp: Number.isFinite(store.inp) ? store.inp : null,
        fcp: Number.isFinite(store.fcp) ? store.fcp : null,
        ttfb: navigationEntry ? Number(navigationEntry.responseStart) : null,
        domContentLoaded: navigationEntry ? Number(navigationEntry.domContentLoadedEventEnd) : null,
        load: navigationEntry ? Number(navigationEntry.loadEventEnd) : null,
        transferSize: navigationEntry ? Number(navigationEntry.transferSize) : null,
        resourceCount: performance.getEntriesByType("resource").length
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : String(error)
    };
  }
}

function flashElementBySelectorInPageContext(selectorInput) {
  try {
    const selector = String(selectorInput || "").trim();
    if (!selector) {
      return false;
    }

    const target = document.querySelector(selector);
    if (!target) {
      return false;
    }

    const rect = target.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    target.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });

    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.zIndex = "2147483647";
    overlay.style.pointerEvents = "none";
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    overlay.style.border = "2px solid rgba(77, 231, 154, 0.95)";
    overlay.style.background = "rgba(77, 231, 154, 0.12)";
    overlay.style.boxShadow = "0 0 0 1px rgba(6, 15, 24, 0.85), 0 0 0 3px rgba(77, 231, 154, 0.2)";
    overlay.style.borderRadius = "4px";
    overlay.style.transition = "opacity 180ms ease";
    overlay.style.opacity = "1";

    document.documentElement.appendChild(overlay);

    setTimeout(() => {
      overlay.style.opacity = "0";
    }, 1400);

    setTimeout(() => {
      if (overlay.isConnected) {
        overlay.remove();
      }
    }, 1800);

    return true;
  } catch {
    return false;
  }
}

function pickElementInPageContext(timeoutMs = 45000) {
  return new Promise((resolve) => {
    try {
      const safeTimeoutMs = Number.isFinite(timeoutMs)
        ? Math.max(5000, Math.min(120000, Math.round(timeoutMs)))
        : 45000;
      const textPreviewLimit = 84;
      const htmlPreviewLimit = 2400;
      const cssProperties = [
        "display",
        "position",
        "top",
        "right",
        "bottom",
        "left",
        "width",
        "height",
        "margin",
        "padding",
        "color",
        "background-color",
        "font-size",
        "font-family",
        "font-weight",
        "line-height",
        "border",
        "border-radius",
        "box-shadow",
        "opacity",
        "z-index"
      ];

      const normalizeWhitespace = (value) => {
        return String(value || "").replace(/\s+/g, " ").trim();
      };

      const escapeIdentifier = (value) => {
        const source = String(value || "");
        if (!source) {
          return "";
        }

        if (typeof CSS !== "undefined" && CSS && typeof CSS.escape === "function") {
          return CSS.escape(source);
        }

        return source.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
      };

      const getNthOfType = (element) => {
        let index = 1;
        let sibling = element.previousElementSibling;

        while (sibling) {
          if (sibling.tagName === element.tagName) {
            index += 1;
          }
          sibling = sibling.previousElementSibling;
        }

        return index;
      };

      const buildSelector = (element) => {
        const segments = [];
        let current = element;
        let depth = 0;

        while (current && depth < 5) {
          const tagName = String(current.tagName || "").toLowerCase();
          if (!tagName || tagName === "html") {
            break;
          }

          if (current.id) {
            segments.unshift(`#${escapeIdentifier(current.id)}`);
            break;
          }

          let segment = tagName;
          const classes = Array.from(current.classList || [])
            .filter(Boolean)
            .slice(0, 2)
            .map((name) => escapeIdentifier(name));

          if (classes.length > 0) {
            segment += `.${classes.join(".")}`;
          }

          segment += `:nth-of-type(${getNthOfType(current)})`;
          segments.unshift(segment);

          current = current.parentElement;
          depth += 1;
        }

        return segments.join(" > ") || String(element.tagName || "element").toLowerCase();
      };

      const buildElementPayload = (element) => {
        const selector = buildSelector(element);
        let html = String(element.outerHTML || "").trim();
        html = html.replace(/></g, ">\n<");
        if (html.length > htmlPreviewLimit) {
          html = `${html.slice(0, htmlPreviewLimit - 3)}...`;
        }

        const computedStyle = window.getComputedStyle(element);
        const cssLines = cssProperties.map((property) => {
          return `${property}: ${computedStyle.getPropertyValue(property)};`;
        });

        const inlineStyle = normalizeWhitespace(element.getAttribute("style") || "");
        if (inlineStyle) {
          cssLines.push(`inline-style: ${inlineStyle};`);
        }

        return {
          key: `pick:${selector}`,
          selector,
          tagName: String(element.tagName || "").toLowerCase(),
          textSnippet: normalizeWhitespace(element.textContent || "").slice(0, textPreviewLimit),
          html,
          css: cssLines.join("\n")
        };
      };

      const isSelectableElement = (element) => {
        if (!element || !(element instanceof Element)) {
          return false;
        }

        const tagName = String(element.tagName || "").toLowerCase();
        return tagName !== "html";
      };

      const overlay = document.createElement("div");
      overlay.style.position = "fixed";
      overlay.style.zIndex = "2147483647";
      overlay.style.pointerEvents = "none";
      overlay.style.border = "2px solid rgba(82, 216, 255, 0.95)";
      overlay.style.background = "rgba(82, 216, 255, 0.12)";
      overlay.style.boxShadow = "0 0 0 1px rgba(6, 15, 24, 0.9), 0 0 0 3px rgba(82, 216, 255, 0.2)";
      overlay.style.borderRadius = "4px";
      overlay.style.display = "none";

      const label = document.createElement("div");
      label.style.position = "fixed";
      label.style.zIndex = "2147483647";
      label.style.pointerEvents = "none";
      label.style.maxWidth = "min(78vw, 560px)";
      label.style.padding = "6px 9px";
      label.style.borderRadius = "7px";
      label.style.border = "1px solid rgba(82, 216, 255, 0.85)";
      label.style.background = "rgba(6, 15, 24, 0.96)";
      label.style.color = "#d9f4ff";
      label.style.font = "600 11px/1.35 'JetBrains Mono', 'Consolas', monospace";
      label.style.whiteSpace = "nowrap";
      label.style.overflow = "hidden";
      label.style.textOverflow = "ellipsis";
      label.style.display = "none";

      document.documentElement.append(overlay, label);

      let settled = false;
      let timeoutId = null;

      const cleanup = () => {
        document.removeEventListener("pointermove", onPointerMove, true);
        document.removeEventListener("pointerdown", onPointerDown, true);
        window.removeEventListener("keydown", onKeyDown, true);

        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        if (overlay.isConnected) {
          overlay.remove();
        }

        if (label.isConnected) {
          label.remove();
        }
      };

      const finalize = (result) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        resolve(result);
      };

      const setOverlayTarget = (element, pointerX, pointerY) => {
        if (!isSelectableElement(element)) {
          overlay.style.display = "none";
          label.style.display = "none";
          return;
        }

        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          overlay.style.display = "none";
          label.style.display = "none";
          return;
        }

        overlay.style.display = "block";
        overlay.style.left = `${Math.max(0, rect.left)}px`;
        overlay.style.top = `${Math.max(0, rect.top)}px`;
        overlay.style.width = `${Math.max(0, rect.width)}px`;
        overlay.style.height = `${Math.max(0, rect.height)}px`;

        const selectorLabel = buildSelector(element);
        label.textContent = `${selectorLabel} | click to select | Esc to cancel`;
        label.style.display = "block";

        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        let left = Number.isFinite(pointerX) ? pointerX + 12 : rect.left;
        let top = Number.isFinite(pointerY) ? pointerY + 14 : rect.top;

        left = Math.max(8, Math.min(left, Math.max(8, viewportWidth - 320)));
        top = Math.max(8, Math.min(top, Math.max(8, viewportHeight - 28)));

        label.style.left = `${left}px`;
        label.style.top = `${top}px`;
      };

      const onPointerMove = (event) => {
        const element = document.elementFromPoint(event.clientX, event.clientY);
        setOverlayTarget(element, event.clientX, event.clientY);
      };

      const onPointerDown = (event) => {
        if (event.pointerType !== "touch" && event.button !== 0) {
          return;
        }

        const element = document.elementFromPoint(event.clientX, event.clientY);
        if (!isSelectableElement(element)) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
          event.stopImmediatePropagation();
        }

        finalize({
          ok: true,
          capturedAt: Date.now(),
          page: {
            url: location.href,
            title: document.title
          },
          element: buildElementPayload(element)
        });
      };

      const onKeyDown = (event) => {
        if (event.key !== "Escape") {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        finalize({ ok: false, error: "Selection canceled." });
      };

      document.addEventListener("pointermove", onPointerMove, true);
      document.addEventListener("pointerdown", onPointerDown, true);
      window.addEventListener("keydown", onKeyDown, true);

      timeoutId = setTimeout(() => {
        finalize({ ok: false, error: "Selection timed out. Start pick mode again." });
      }, safeTimeoutMs);

      const centerX = Math.max(1, Math.round(window.innerWidth / 2));
      const centerY = Math.max(1, Math.round(window.innerHeight / 2));
      const initialTarget = document.elementFromPoint(centerX, centerY);
      setOverlayTarget(initialTarget, centerX, centerY);
    } catch (error) {
      resolve({
        ok: false,
        error: error && error.message ? error.message : String(error)
      });
    }
  });
}

function collectElementBySelectorInPageContext(selectorInput) {
  try {
    const selector = String(selectorInput || "").trim();
    if (!selector) {
      return { ok: false, error: "Selector is empty." };
    }

    const cssProperties = [
      "display",
      "position",
      "top",
      "right",
      "bottom",
      "left",
      "width",
      "height",
      "margin",
      "padding",
      "color",
      "background-color",
      "font-size",
      "font-family",
      "font-weight",
      "line-height",
      "border",
      "border-radius",
      "box-shadow",
      "opacity",
      "z-index"
    ];
    const eventPropertyNames = [
      "onclick",
      "ondblclick",
      "onmousedown",
      "onmouseup",
      "onmouseenter",
      "onmouseleave",
      "onmouseover",
      "onmouseout",
      "onmousemove",
      "oninput",
      "onchange",
      "onsubmit",
      "onfocus",
      "onblur",
      "onkeydown",
      "onkeyup",
      "onkeypress",
      "ontouchstart",
      "ontouchend",
      "onpointerdown",
      "onpointerup",
      "onanimationstart",
      "onanimationend",
      "ontransitionend"
    ];
    const textPreviewLimit = 84;
    const htmlPreviewLimit = 2400;

    const normalizeWhitespace = (value) => {
      return String(value || "").replace(/\s+/g, " ").trim();
    };

    const truncateValue = (value, maxLength = 96) => {
      const source = String(value || "");
      if (source.length <= maxLength) {
        return source;
      }

      return `${source.slice(0, Math.max(0, maxLength - 3))}...`;
    };

    const parseDurationTokenMs = (token) => {
      const normalized = String(token || "").trim().toLowerCase();
      if (!normalized) {
        return 0;
      }

      if (normalized.endsWith("ms")) {
        const parsedMs = Number.parseFloat(normalized);
        return Number.isFinite(parsedMs) ? parsedMs : 0;
      }

      if (normalized.endsWith("s")) {
        const parsedSeconds = Number.parseFloat(normalized);
        return Number.isFinite(parsedSeconds) ? parsedSeconds * 1000 : 0;
      }

      const parsedRaw = Number.parseFloat(normalized);
      return Number.isFinite(parsedRaw) ? parsedRaw : 0;
    };

    const hasNonZeroDuration = (value) => {
      return String(value || "")
        .split(",")
        .some((token) => parseDurationTokenMs(token) > 0);
    };

    const formatMs = (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? `${Math.round(parsed)}ms` : "n/a";
    };

    const buildCssText = (targetElement, computedStyle) => {
      const cssLines = cssProperties.map((property) => {
        return `${property}: ${computedStyle.getPropertyValue(property)};`;
      });

      const inlineStyle = normalizeWhitespace(targetElement.getAttribute("style") || "");
      if (inlineStyle) {
        cssLines.push(`inline-style: ${inlineStyle};`);
      }

      return cssLines.join("\n");
    };

    const buildJavascriptDiagnostics = (targetElement) => {
      const attributeNames = typeof targetElement.getAttributeNames === "function"
        ? targetElement.getAttributeNames()
        : [];
      const inlineHandlers = [];
      const jsHookAttributes = [];

      for (const rawName of attributeNames) {
        const attributeName = String(rawName || "").toLowerCase();
        const attributeValue = normalizeWhitespace(targetElement.getAttribute(rawName) || "");
        if (!attributeName || !attributeValue) {
          continue;
        }

        if (attributeName.startsWith("on")) {
          inlineHandlers.push(`${attributeName}="${truncateValue(attributeValue)}"`);
          continue;
        }

        if (
          attributeName.startsWith("data-") &&
          /action|controller|handler|event|click|target|toggle|command|js/.test(attributeName)
        ) {
          jsHookAttributes.push(`${attributeName}="${truncateValue(attributeValue)}"`);
        }
      }

      const propertyHandlers = eventPropertyNames.filter((propertyName) => {
        return typeof targetElement[propertyName] === "function";
      });

      const hrefValue = normalizeWhitespace(targetElement.getAttribute("href") || "");
      const hasJavascriptHref = hrefValue.toLowerCase().startsWith("javascript:");

      const hasJs =
        inlineHandlers.length > 0 ||
        propertyHandlers.length > 0 ||
        jsHookAttributes.length > 0 ||
        hasJavascriptHref;

      if (!hasJs) {
        return {
          hasJs: false,
          text: "No inline handlers or obvious JavaScript hooks detected for this element."
        };
      }

      const lines = [];
      if (inlineHandlers.length > 0) {
        lines.push(`Inline handlers (${inlineHandlers.length}):`);
        for (const inlineHandler of inlineHandlers) {
          lines.push(`- ${inlineHandler}`);
        }
      }

      if (propertyHandlers.length > 0) {
        lines.push(`Bound event properties: ${propertyHandlers.join(", ")}`);
      }

      if (jsHookAttributes.length > 0) {
        lines.push(`JavaScript hook attributes (${jsHookAttributes.length}):`);
        for (const hookAttribute of jsHookAttributes) {
          lines.push(`- ${hookAttribute}`);
        }
      }

      if (hasJavascriptHref) {
        lines.push("javascript: URL detected in href.");
      }

      return {
        hasJs: true,
        text: lines.join("\n")
      };
    };

    const buildAnimationDiagnostics = (targetElement, computedStyle) => {
      const animationName = normalizeWhitespace(computedStyle.getPropertyValue("animation-name"));
      const animationDuration = normalizeWhitespace(computedStyle.getPropertyValue("animation-duration"));
      const animationDelay = normalizeWhitespace(computedStyle.getPropertyValue("animation-delay"));
      const animationTiming = normalizeWhitespace(computedStyle.getPropertyValue("animation-timing-function"));
      const animationIterationCount = normalizeWhitespace(computedStyle.getPropertyValue("animation-iteration-count"));
      const animationPlayState = normalizeWhitespace(computedStyle.getPropertyValue("animation-play-state"));
      const transitionProperty = normalizeWhitespace(computedStyle.getPropertyValue("transition-property"));
      const transitionDuration = normalizeWhitespace(computedStyle.getPropertyValue("transition-duration"));
      const transitionDelay = normalizeWhitespace(computedStyle.getPropertyValue("transition-delay"));

      let activeAnimations = [];
      if (typeof targetElement.getAnimations === "function") {
        try {
          activeAnimations = targetElement.getAnimations().filter((animation) => {
            return animation && animation.playState !== "idle";
          });
        } catch {
          activeAnimations = [];
        }
      }

      const hasAnimationStyle =
        animationName.length > 0 &&
        animationName !== "none" &&
        hasNonZeroDuration(animationDuration);
      const hasTransitionStyle =
        transitionProperty.length > 0 &&
        transitionProperty !== "none" &&
        hasNonZeroDuration(transitionDuration);
      const hasAnimations = hasAnimationStyle || hasTransitionStyle || activeAnimations.length > 0;

      if (!hasAnimations) {
        return {
          hasAnimations: false,
          text: "No CSS animations, transitions, or active Web Animations detected for this element."
        };
      }

      const lines = [
        `animation-name: ${animationName || "none"}`,
        `animation-duration: ${animationDuration || "0s"}`,
        `animation-delay: ${animationDelay || "0s"}`,
        `animation-timing-function: ${animationTiming || "initial"}`,
        `animation-iteration-count: ${animationIterationCount || "1"}`,
        `animation-play-state: ${animationPlayState || "running"}`,
        `transition-property: ${transitionProperty || "none"}`,
        `transition-duration: ${transitionDuration || "0s"}`,
        `transition-delay: ${transitionDelay || "0s"}`
      ];

      if (activeAnimations.length > 0) {
        lines.push(`Active Web Animations (${activeAnimations.length}):`);

        for (const animation of activeAnimations) {
          const timing =
            animation.effect && typeof animation.effect.getTiming === "function"
              ? animation.effect.getTiming()
              : null;
          const animationType =
            animation.constructor && animation.constructor.name
              ? animation.constructor.name
              : "Animation";

          lines.push(
            `- ${animationType} | state=${animation.playState || "unknown"} | current=${formatMs(animation.currentTime)} | duration=${formatMs(
              timing?.duration
            )} | delay=${formatMs(timing?.delay)}`
          );
        }
      }

      return {
        hasAnimations: true,
        text: lines.join("\n")
      };
    };

    let element = null;
    try {
      element = document.querySelector(selector);
    } catch (selectorError) {
      return {
        ok: false,
        error: selectorError && selectorError.message
          ? selectorError.message
          : "Invalid CSS selector."
      };
    }

    if (!element) {
      return { ok: false, error: "No element matches that selector." };
    }

    let html = String(element.outerHTML || "").trim();
    html = html.replace(/></g, ">\n<");
    if (html.length > htmlPreviewLimit) {
      html = `${html.slice(0, htmlPreviewLimit - 3)}...`;
    }

    const computedStyle = window.getComputedStyle(element);
    const javascriptDiagnostics = buildJavascriptDiagnostics(element);
    const animationDiagnostics = buildAnimationDiagnostics(element, computedStyle);

    return {
      ok: true,
      capturedAt: Date.now(),
      page: {
        url: location.href,
        title: document.title
      },
      element: {
        key: `manual:${selector}`,
        selector,
        tagName: String(element.tagName || "").toLowerCase(),
        textSnippet: normalizeWhitespace(element.textContent || "").slice(0, textPreviewLimit),
        html,
        css: buildCssText(element, computedStyle),
        js: javascriptDiagnostics.text,
        animations: animationDiagnostics.text,
        hasJs: javascriptDiagnostics.hasJs,
        hasAnimations: animationDiagnostics.hasAnimations,
        diagnosticsLoaded: true
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : String(error)
    };
  }
}

function collectElementsInPageContext(maxItems = 450) {
  try {
    const safeLimit = Number.isFinite(maxItems)
      ? Math.max(50, Math.min(1200, Math.round(maxItems)))
      : 450;
    const textPreviewLimit = 84;
    const htmlPreviewLimit = 2400;

    const cssProperties = [
      "display",
      "position",
      "top",
      "right",
      "bottom",
      "left",
      "width",
      "height",
      "margin",
      "padding",
      "color",
      "background-color",
      "font-size",
      "font-family",
      "font-weight",
      "line-height",
      "border",
      "border-radius",
      "box-shadow",
      "opacity",
      "z-index"
    ];
    const eventPropertyNames = [
      "onclick",
      "ondblclick",
      "onmousedown",
      "onmouseup",
      "onmouseenter",
      "onmouseleave",
      "onmouseover",
      "onmouseout",
      "onmousemove",
      "oninput",
      "onchange",
      "onsubmit",
      "onfocus",
      "onblur",
      "onkeydown",
      "onkeyup",
      "onkeypress",
      "ontouchstart",
      "ontouchend",
      "onpointerdown",
      "onpointerup",
      "onanimationstart",
      "onanimationend",
      "ontransitionend"
    ];

    const normalizeWhitespace = (value) => {
      return String(value || "").replace(/\s+/g, " ").trim();
    };

    const parseDurationTokenMs = (token) => {
      const normalized = String(token || "").trim().toLowerCase();
      if (!normalized) {
        return 0;
      }

      if (normalized.endsWith("ms")) {
        const parsedMs = Number.parseFloat(normalized);
        return Number.isFinite(parsedMs) ? parsedMs : 0;
      }

      if (normalized.endsWith("s")) {
        const parsedSeconds = Number.parseFloat(normalized);
        return Number.isFinite(parsedSeconds) ? parsedSeconds * 1000 : 0;
      }

      const parsedRaw = Number.parseFloat(normalized);
      return Number.isFinite(parsedRaw) ? parsedRaw : 0;
    };

    const hasNonZeroDuration = (value) => {
      return String(value || "")
        .split(",")
        .some((token) => parseDurationTokenMs(token) > 0);
    };

    const detectJsSignal = (element) => {
      const attributeNames = typeof element.getAttributeNames === "function"
        ? element.getAttributeNames()
        : [];

      for (const rawName of attributeNames) {
        const attributeName = String(rawName || "").toLowerCase();
        const attributeValue = normalizeWhitespace(element.getAttribute(rawName) || "");
        if (!attributeName || !attributeValue) {
          continue;
        }

        if (attributeName.startsWith("on")) {
          return true;
        }

        if (
          attributeName.startsWith("data-") &&
          /action|controller|handler|event|click|target|toggle|command|js/.test(attributeName)
        ) {
          return true;
        }
      }

      const hrefValue = normalizeWhitespace(element.getAttribute("href") || "");
      if (hrefValue.toLowerCase().startsWith("javascript:")) {
        return true;
      }

      for (const propertyName of eventPropertyNames) {
        if (typeof element[propertyName] === "function") {
          return true;
        }
      }

      return false;
    };

    const escapeIdentifier = (value) => {
      const source = String(value || "");
      if (!source) {
        return "";
      }

      if (typeof CSS !== "undefined" && CSS && typeof CSS.escape === "function") {
        return CSS.escape(source);
      }

      return source.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    };

    const getNthOfType = (element) => {
      let index = 1;
      let sibling = element.previousElementSibling;

      while (sibling) {
        if (sibling.tagName === element.tagName) {
          index += 1;
        }
        sibling = sibling.previousElementSibling;
      }

      return index;
    };

    const buildSelector = (element) => {
      const segments = [];
      let current = element;
      let depth = 0;

      while (current && depth < 5) {
        const tagName = String(current.tagName || "").toLowerCase();
        if (!tagName || tagName === "html") {
          break;
        }

        if (current.id) {
          segments.unshift(`#${escapeIdentifier(current.id)}`);
          break;
        }

        let segment = tagName;
        const classes = Array.from(current.classList || [])
          .filter(Boolean)
          .slice(0, 2)
          .map((name) => escapeIdentifier(name));

        if (classes.length > 0) {
          segment += `.${classes.join(".")}`;
        }

        segment += `:nth-of-type(${getNthOfType(current)})`;
        segments.unshift(segment);

        current = current.parentElement;
        depth += 1;
      }

      return segments.join(" > ") || String(element.tagName || "element").toLowerCase();
    };

    const formatComputedCss = (element) => {
      const computedStyle = window.getComputedStyle(element);
      const lines = cssProperties.map((property) => {
        return `${property}: ${computedStyle.getPropertyValue(property)};`;
      });

      const inlineStyle = normalizeWhitespace(element.getAttribute("style") || "");
      if (inlineStyle) {
        lines.push(`inline-style: ${inlineStyle};`);
      }

      const animationName = normalizeWhitespace(computedStyle.getPropertyValue("animation-name"));
      const animationDuration = normalizeWhitespace(computedStyle.getPropertyValue("animation-duration"));
      const transitionProperty = normalizeWhitespace(computedStyle.getPropertyValue("transition-property"));
      const transitionDuration = normalizeWhitespace(computedStyle.getPropertyValue("transition-duration"));

      const hasAnimations =
        (animationName.length > 0 && animationName !== "none" && hasNonZeroDuration(animationDuration)) ||
        (transitionProperty.length > 0 && transitionProperty !== "none" && hasNonZeroDuration(transitionDuration));

      return {
        cssText: lines.join("\n"),
        hasAnimations
      };
    };

    const allElements = Array.from(document.querySelectorAll("body *"));
    const ignoredTags = new Set(["script", "style", "noscript", "meta", "link"]);
    const items = [];

    for (let index = 0; index < allElements.length && items.length < safeLimit; index += 1) {
      const element = allElements[index];
      const tagName = String(element.tagName || "").toLowerCase();
      if (ignoredTags.has(tagName)) {
        continue;
      }

      const selector = buildSelector(element);
      const textSnippet = normalizeWhitespace(element.textContent || "").slice(0, textPreviewLimit);

      let html = String(element.outerHTML || "").trim();
      html = html.replace(/></g, ">\n<");
      if (html.length > htmlPreviewLimit) {
        html = `${html.slice(0, htmlPreviewLimit - 3)}...`;
      }

      const cssBundle = formatComputedCss(element);
      const hasJs = detectJsSignal(element);

      items.push({
        key: `${index}:${selector}`,
        selector,
        tagName,
        textSnippet,
        html,
        css: cssBundle.cssText,
        js: hasJs
          ? "Potential JavaScript hooks detected. Select this element to inspect detailed handlers and hooks."
          : "No inline handlers or obvious JavaScript hooks detected for this element.",
        animations: cssBundle.hasAnimations
          ? "Potential animation/transition styles detected. Select this element to inspect detailed animation diagnostics."
          : "No CSS animations, transitions, or active Web Animations detected for this element.",
        hasJs,
        hasAnimations: cssBundle.hasAnimations,
        diagnosticsLoaded: false
      });
    }

    return {
      ok: true,
      capturedAt: Date.now(),
      page: {
        url: location.href,
        title: document.title
      },
      elements: items
    };
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : String(error)
    };
  }
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
