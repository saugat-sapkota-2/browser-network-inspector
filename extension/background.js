const STORAGE_KEY = "nml_state_v1";
const SLOW_THRESHOLD_MS = 500;
const MONITOR_WINDOW_PATH = "popup.html";
const MONITOR_WINDOW_WIDTH = 1180;
const MONITOR_WINDOW_HEIGHT = 860;

const DEFAULT_SETTINGS = Object.freeze({
  autoClearOnPopupClose: false,
  paused: false,
  maxLogs: 500
});

const MAX_PENDING_REQUEST_AGE_MS = 120000;
const REQUEST_ID_CLEANUP_BATCH = 200;

const encoder = new TextEncoder();

const state = {
  activeTabId: -1,
  logs: [],
  summary: createEmptySummary(),
  settings: { ...DEFAULT_SETTINGS },
  viewerWindowId: null,
  pendingRequests: new Map(),
  requestSizes: new Map(),
  responseSizes: new Map(),
  persistTimer: null
};

function createEmptySummary() {
  return {
    total: 0,
    success: 0,
    errors: 0,
    avgLatency: 0,
    totalData: 0
  };
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

function sanitizeLogs(logs, maxLogs) {
  if (!Array.isArray(logs)) {
    return [];
  }

  const sanitized = logs
    .filter((entry) => entry && typeof entry === "object")
    .slice(-maxLogs)
    .map((entry) => ({ ...entry }));

  return sanitized;
}

function sanitizeSettings(maybeSettings) {
  const safe = { ...DEFAULT_SETTINGS };
  if (!maybeSettings || typeof maybeSettings !== "object") {
    return safe;
  }

  if (Object.prototype.hasOwnProperty.call(maybeSettings, "autoClearOnPopupClose")) {
    safe.autoClearOnPopupClose = Boolean(maybeSettings.autoClearOnPopupClose);
  }

  if (Object.prototype.hasOwnProperty.call(maybeSettings, "paused")) {
    safe.paused = Boolean(maybeSettings.paused);
  }

  if (Object.prototype.hasOwnProperty.call(maybeSettings, "maxLogs")) {
    const maxLogs = Number(maybeSettings.maxLogs);
    if (Number.isFinite(maxLogs)) {
      safe.maxLogs = Math.max(100, Math.min(2000, Math.round(maxLogs)));
    }
  }

  return safe;
}

function normalizeResourceType(type) {
  if (type === "xmlhttprequest") {
    return "xhr";
  }

  if (type === "main_frame" || type === "sub_frame") {
    return "document";
  }

  return type;
}

function estimateRequestBodySize(requestBody) {
  if (!requestBody || typeof requestBody !== "object") {
    return null;
  }

  if (Array.isArray(requestBody.raw) && requestBody.raw.length > 0) {
    let total = 0;

    for (const chunk of requestBody.raw) {
      if (chunk && chunk.bytes) {
        total += chunk.bytes.byteLength;
      }
    }

    return total > 0 ? total : null;
  }

  if (requestBody.formData && typeof requestBody.formData === "object") {
    let total = 0;

    for (const [key, values] of Object.entries(requestBody.formData)) {
      total += encoder.encode(String(key)).byteLength;

      if (Array.isArray(values)) {
        for (const value of values) {
          total += encoder.encode(String(value)).byteLength;
        }
      }
    }

    return total > 0 ? total : null;
  }

  return null;
}

function extractContentLength(responseHeaders) {
  if (!Array.isArray(responseHeaders)) {
    return null;
  }

  for (const header of responseHeaders) {
    if (!header || typeof header !== "object") {
      continue;
    }

    if (String(header.name || "").toLowerCase() === "content-length") {
      const parsed = Number(header.value);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
      }
    }
  }

  return null;
}

function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
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

function pickSourceUrl(...candidates) {
  for (const candidate of candidates) {
    if (isHttpUrl(candidate)) {
      return candidate;
    }
  }

  return null;
}

function isInternalBrowserUrl(url) {
  const source = String(url || "").toLowerCase();
  return (
    source.startsWith("chrome://") ||
    source.startsWith("brave://") ||
    source.startsWith("edge://") ||
    source.startsWith("devtools://") ||
    source.startsWith("about:")
  );
}

function isMonitorTab(tab) {
  if (!tab || typeof tab !== "object") {
    return false;
  }

  if (Number.isInteger(state.viewerWindowId) && tab.windowId === state.viewerWindowId) {
    return true;
  }

  const tabUrl = String(tab.url || "");
  return tabUrl.startsWith(chrome.runtime.getURL(""));
}

function isTrackableTab(tab) {
  if (!tab || typeof tab !== "object" || !Number.isInteger(tab.id)) {
    return false;
  }

  if (isMonitorTab(tab)) {
    return false;
  }

  const tabUrl = String(tab.url || "");
  if (tabUrl.startsWith("chrome-extension://") || isInternalBrowserUrl(tabUrl)) {
    return false;
  }

  // Allow unknown/empty URLs and regular web URLs.
  return true;
}

async function findTrackableActiveTab(preferredTab) {
  if (isTrackableTab(preferredTab)) {
    return preferredTab;
  }

  const activeTabs = await chrome.tabs.query({ active: true });
  for (const tab of activeTabs) {
    if (isTrackableTab(tab)) {
      return tab;
    }
  }

  return null;
}

async function openMonitorWindow() {
  const monitorUrl = chrome.runtime.getURL(MONITOR_WINDOW_PATH);

  if (Number.isInteger(state.viewerWindowId)) {
    try {
      await chrome.windows.update(state.viewerWindowId, {
        focused: true,
        drawAttention: true
      });
      return;
    } catch {
      state.viewerWindowId = null;
    }
  }

  try {
    const created = await chrome.windows.create({
      url: monitorUrl,
      type: "popup",
      width: MONITOR_WINDOW_WIDTH,
      height: MONITOR_WINDOW_HEIGHT,
      focused: true
    });

    if (Number.isInteger(created?.id)) {
      state.viewerWindowId = created.id;
    }
  } catch {
    const fallbackTab = await chrome.tabs.create({
      url: monitorUrl,
      active: true
    });

    if (Number.isInteger(fallbackTab?.windowId)) {
      state.viewerWindowId = fallbackTab.windowId;
    }
  }
}

async function closeMonitorWindow() {
  if (!Number.isInteger(state.viewerWindowId)) {
    return;
  }

  const windowId = state.viewerWindowId;
  state.viewerWindowId = null;

  try {
    await chrome.windows.remove(windowId);
  } catch {
    // Window may already be closed.
  }
}

async function reloadTrackedTab() {
  let targetTabId = state.activeTabId;

  if (!Number.isInteger(targetTabId) || targetTabId < 0) {
    const fallbackTab = await findTrackableActiveTab(null);
    if (fallbackTab && Number.isInteger(fallbackTab.id)) {
      targetTabId = fallbackTab.id;
      setActiveTab(targetTabId, "tracked-tab-reselected");
    }
  }

  if (!Number.isInteger(targetTabId) || targetTabId < 0) {
    return { ok: false, reason: "no-tracked-tab" };
  }

  try {
    await chrome.tabs.reload(targetTabId);
    return { ok: true, tabId: targetTabId };
  } catch {
    return { ok: false, reason: "reload-failed" };
  }
}

function notifyPopup(message) {
  try {
    chrome.runtime.sendMessage(message, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // Ignore send failures when popup is closed.
  }
}

function persistStateSoon() {
  if (state.persistTimer !== null) {
    return;
  }

  state.persistTimer = setTimeout(() => {
    state.persistTimer = null;
    chrome.storage.local.set({
      [STORAGE_KEY]: {
        activeTabId: state.activeTabId,
        logs: state.logs,
        summary: state.summary,
        settings: state.settings,
        savedAt: Date.now()
      }
    });
  }, 250);
}

function clearRuntimeRequestBuffers() {
  state.pendingRequests.clear();
  state.requestSizes.clear();
  state.responseSizes.clear();
}

function clearLogs(reason, options = {}) {
  const shouldResetPending = Boolean(options.resetPending);

  state.logs = [];
  state.summary = createEmptySummary();

  if (shouldResetPending) {
    clearRuntimeRequestBuffers();
  }

  persistStateSoon();

  notifyPopup({
    type: "network-logs-cleared",
    reason,
    summary: state.summary
  });
}

function enforceLogLimit() {
  const maxLogs = state.settings.maxLogs;
  if (state.logs.length <= maxLogs) {
    return;
  }

  state.logs.splice(0, state.logs.length - maxLogs);
}

function addLogEntry(entry) {
  state.logs.push(entry);
  enforceLogLimit();
  state.summary = computeSummary(state.logs);

  persistStateSoon();

  notifyPopup({
    type: "network-log-added",
    entry,
    summary: state.summary,
    maxLogs: state.settings.maxLogs,
    slowThresholdMs: SLOW_THRESHOLD_MS
  });
}

function setActiveTab(tabId, reason) {
  const safeTabId = Number.isInteger(tabId) ? tabId : -1;

  if (safeTabId === state.activeTabId) {
    return;
  }

  state.activeTabId = safeTabId;
  clearLogs(reason, { resetPending: true });
  persistStateSoon();

  notifyPopup({
    type: "active-tab-updated",
    activeTabId: state.activeTabId
  });
}

async function refreshActiveTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const preferredTab = tabs.length > 0 ? tabs[0] : null;
    const targetTab = await findTrackableActiveTab(preferredTab);

    if (targetTab && Number.isInteger(targetTab.id)) {
      setActiveTab(targetTab.id, "active-tab-context-changed");
      return;
    }

    if (state.activeTabId === -1) {
      setActiveTab(-1, "active-tab-context-missing");
    }
  } catch {
    if (state.activeTabId === -1) {
      setActiveTab(-1, "active-tab-context-missing");
    }
  }
}

async function ensureTrackedTabReady() {
  if (!Number.isInteger(state.activeTabId) || state.activeTabId < 0) {
    return;
  }

  try {
    const trackedTab = await chrome.tabs.get(state.activeTabId);
    if (!isTrackableTab(trackedTab)) {
      setActiveTab(-1, "tracked-tab-invalid");
    }
  } catch {
    setActiveTab(-1, "tracked-tab-missing");
  }
}

function isTrackedRequest(details) {
  return Number.isInteger(details.tabId) && details.tabId >= 0 && details.tabId === state.activeTabId;
}

function cleanupStalePendingRequests(now) {
  if (state.pendingRequests.size === 0) {
    return;
  }

  let inspected = 0;
  for (const [requestId, pending] of state.pendingRequests.entries()) {
    inspected += 1;

    if (now - pending.startTime > MAX_PENDING_REQUEST_AGE_MS) {
      state.pendingRequests.delete(requestId);
      state.requestSizes.delete(requestId);
      state.responseSizes.delete(requestId);
    }

    if (inspected >= REQUEST_ID_CLEANUP_BATCH) {
      break;
    }
  }
}

function onBeforeRequest(details) {
  if (state.settings.paused) {
    return;
  }

  if (!isTrackedRequest(details)) {
    return;
  }

  cleanupStalePendingRequests(details.timeStamp);

  const requestSize = estimateRequestBodySize(details.requestBody);
  if (Number.isFinite(requestSize)) {
    state.requestSizes.set(details.requestId, requestSize);
  }

  state.pendingRequests.set(details.requestId, {
    requestId: details.requestId,
    tabId: details.tabId,
    url: details.url,
    method: details.method,
    type: normalizeResourceType(details.type),
    initiator: details.initiator || null,
    originUrl: details.originUrl || null,
    documentUrl: details.documentUrl || null,
    startTime: details.timeStamp,
    startedAt: Date.now()
  });
}

function onHeadersReceived(details) {
  if (!state.pendingRequests.has(details.requestId)) {
    return;
  }

  const responseSize = extractContentLength(details.responseHeaders);
  if (Number.isFinite(responseSize)) {
    state.responseSizes.set(details.requestId, responseSize);
  }
}

function finalizeRequest(details, isError) {
  const pending = state.pendingRequests.get(details.requestId);
  if (!pending) {
    return;
  }

  state.pendingRequests.delete(details.requestId);

  const responseSize = state.responseSizes.get(details.requestId);
  const requestSize = state.requestSizes.get(details.requestId);

  state.responseSizes.delete(details.requestId);
  state.requestSizes.delete(details.requestId);

  const latency =
    Number.isFinite(details.timeStamp) && Number.isFinite(pending.startTime)
      ? Math.max(0, Math.round(details.timeStamp - pending.startTime))
      : null;

  const sourceUrl = pickSourceUrl(
    details.initiator,
    details.originUrl,
    details.documentUrl,
    pending.initiator,
    pending.originUrl,
    pending.documentUrl
  );

  addLogEntry({
    id: `${details.requestId}:${pending.startTime}`,
    requestId: details.requestId,
    tabId: pending.tabId,
    url: pending.url,
    sourceUrl,
    domain: getDomain(pending.url),
    method: pending.method,
    statusCode: isError ? 0 : details.statusCode,
    type: pending.type,
    timestamp: pending.startTime,
    completedAt: details.timeStamp,
    latency,
    requestSize: Number.isFinite(requestSize) ? requestSize : null,
    responseSize: Number.isFinite(responseSize) ? responseSize : null,
    fromCache: Boolean(details.fromCache),
    error: isError ? details.error || "REQUEST_FAILED" : null
  });
}

function onCompleted(details) {
  finalizeRequest(details, false);
}

function onErrorOccurred(details) {
  finalizeRequest(details, true);
}

function onTabUpdated(tabId, changeInfo) {
  if (tabId !== state.activeTabId) {
    return;
  }

  if (changeInfo.status === "loading") {
    clearLogs("active-tab-refresh", { resetPending: true });
  }
}

function updateSetting(key, value) {
  if (key === "autoClearOnPopupClose") {
    state.settings.autoClearOnPopupClose = Boolean(value);
  } else if (key === "paused") {
    state.settings.paused = Boolean(value);
  } else if (key === "maxLogs") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      state.settings.maxLogs = Math.max(100, Math.min(2000, Math.round(parsed)));
      enforceLogLimit();
      state.summary = computeSummary(state.logs);
    }
  }

  persistStateSoon();

  notifyPopup({
    type: "settings-updated",
    settings: state.settings
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return false;
  }

  if (message.type === "get-state") {
    sendResponse({
      activeTabId: state.activeTabId,
      logs: state.logs,
      summary: state.summary,
      settings: state.settings,
      slowThresholdMs: SLOW_THRESHOLD_MS
    });
    return false;
  }

  if (message.type === "clear-logs") {
    clearLogs("manual-clear", { resetPending: true });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "set-setting") {
    updateSetting(message.key, message.value);
    sendResponse({ ok: true, settings: state.settings });
    return false;
  }

  if (message.type === "popup-closed") {
    if (state.settings.autoClearOnPopupClose) {
      clearLogs("popup-closed", { resetPending: true });
    }

    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "open-monitor-window") {
    openMonitorWindow();
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "reload-tracked-tab") {
    reloadTrackedTab().then((result) => {
      sendResponse(result);
    });
    return true;
  }

  return false;
});

chrome.action.onClicked.addListener(async (tab) => {
  if (isTrackableTab(tab) && Number.isInteger(tab.id)) {
    setActiveTab(tab.id, "monitor-opened-from-tab");
  } else {
    await refreshActiveTab();
  }

  openMonitorWindow();
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === state.viewerWindowId) {
    state.viewerWindowId = null;
  }
});

chrome.tabs.onUpdated.addListener(onTabUpdated);

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId !== state.activeTabId) {
    return;
  }

  closeMonitorWindow();
  setActiveTab(-1, "active-tab-closed");
});

chrome.webRequest.onBeforeRequest.addListener(
  onBeforeRequest,
  { urls: ["<all_urls>"] },
  ["requestBody"]
);

chrome.webRequest.onHeadersReceived.addListener(
  onHeadersReceived,
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

chrome.webRequest.onCompleted.addListener(onCompleted, { urls: ["<all_urls>"] });
chrome.webRequest.onErrorOccurred.addListener(onErrorOccurred, { urls: ["<all_urls>"] });

(async function init() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const savedState = stored[STORAGE_KEY];

  if (savedState && typeof savedState === "object") {
    state.settings = sanitizeSettings(savedState.settings);
    state.logs = sanitizeLogs(savedState.logs, state.settings.maxLogs);
    state.summary = computeSummary(state.logs);

    if (Number.isInteger(savedState.activeTabId)) {
      state.activeTabId = savedState.activeTabId;
    }
  }

  await ensureTrackedTabReady();
})();
