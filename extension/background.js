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
  sessions: new Map(),
  settings: { ...DEFAULT_SETTINGS },
  viewerWindowByTrackedTab: new Map(),
  trackedTabByViewerWindow: new Map(),
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

  const tabUrl = String(tab.url || "");
  return tabUrl.startsWith(chrome.runtime.getURL(""));
}

function parseTabId(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : -1;
}

function extractTargetTabIdFromUrl(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    return -1;
  }

  try {
    const parsed = new URL(rawUrl);
    return parseTabId(parsed.searchParams.get("targetTabId"));
  } catch {
    return -1;
  }
}

function createSession(logs = []) {
  const safeLogs = sanitizeLogs(logs, state.settings.maxLogs);
  return {
    logs: safeLogs,
    summary: computeSummary(safeLogs)
  };
}

function sanitizeSessions(maybeSessions, maxLogs) {
  const sessions = new Map();
  if (!maybeSessions || typeof maybeSessions !== "object") {
    return sessions;
  }

  for (const [tabKey, rawSession] of Object.entries(maybeSessions)) {
    const tabId = parseTabId(tabKey);
    if (tabId < 0) {
      continue;
    }

    const logs = sanitizeLogs(rawSession?.logs, maxLogs);
    sessions.set(tabId, {
      logs,
      summary: computeSummary(logs)
    });
  }

  return sessions;
}

function serializeSessions() {
  const serialized = {};

  for (const [tabId, session] of state.sessions.entries()) {
    serialized[String(tabId)] = {
      logs: session.logs,
      summary: session.summary
    };
  }

  return serialized;
}

function getSession(tabId) {
  const safeTabId = parseTabId(tabId);
  if (safeTabId < 0) {
    return null;
  }

  return state.sessions.get(safeTabId) || null;
}

function ensureSession(tabId) {
  const safeTabId = parseTabId(tabId);
  if (safeTabId < 0) {
    return null;
  }

  let session = state.sessions.get(safeTabId);
  if (!session) {
    session = createSession();
    state.sessions.set(safeTabId, session);
  }

  return session;
}

function resolveTargetTabIdFromMessage(message, sender) {
  const directTargetTabId = parseTabId(message?.targetTabId);
  if (directTargetTabId >= 0) {
    return directTargetTabId;
  }

  const senderTargetTabId = extractTargetTabIdFromUrl(sender?.url);
  if (senderTargetTabId >= 0) {
    return senderTargetTabId;
  }

  const senderTabUrlTargetTabId = extractTargetTabIdFromUrl(sender?.tab?.url);
  if (senderTabUrlTargetTabId >= 0) {
    return senderTabUrlTargetTabId;
  }

  const senderWindowId = sender?.tab?.windowId;
  if (Number.isInteger(senderWindowId)) {
    const mappedTargetTabId = state.trackedTabByViewerWindow.get(senderWindowId);
    if (Number.isInteger(mappedTargetTabId)) {
      return mappedTargetTabId;
    }
  }

  return -1;
}

function getStateSnapshot(targetTabId) {
  const safeTabId = parseTabId(targetTabId);
  const session = safeTabId >= 0 ? getSession(safeTabId) : null;

  return {
    targetTabId: session ? safeTabId : -1,
    logs: session ? session.logs : [],
    summary: session ? session.summary : createEmptySummary(),
    settings: state.settings,
    slowThresholdMs: SLOW_THRESHOLD_MS
  };
}

function removeViewerWindowMapping(windowId) {
  if (!Number.isInteger(windowId)) {
    return -1;
  }

  const trackedTabId = state.trackedTabByViewerWindow.get(windowId);
  if (!Number.isInteger(trackedTabId)) {
    return -1;
  }

  state.trackedTabByViewerWindow.delete(windowId);

  const mappedWindowId = state.viewerWindowByTrackedTab.get(trackedTabId);
  if (mappedWindowId === windowId) {
    state.viewerWindowByTrackedTab.delete(trackedTabId);
  }

  return trackedTabId;
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

  const activeCurrentWindowTabs = await chrome.tabs.query({ active: true, currentWindow: true });
  for (const tab of activeCurrentWindowTabs) {
    if (isTrackableTab(tab)) {
      return tab;
    }
  }

  const activeLastFocusedWindowTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  for (const tab of activeLastFocusedWindowTabs) {
    if (isTrackableTab(tab)) {
      return tab;
    }
  }

  return null;
}

function createMonitorUrlForTab(tabId) {
  const monitorUrl = new URL(chrome.runtime.getURL(MONITOR_WINDOW_PATH));
  monitorUrl.searchParams.set("targetTabId", String(tabId));
  return monitorUrl.toString();
}

async function openMonitorWindow(tabId) {
  const safeTabId = parseTabId(tabId);
  if (safeTabId < 0) {
    return;
  }

  const existingWindowId = state.viewerWindowByTrackedTab.get(safeTabId);
  if (Number.isInteger(existingWindowId)) {
    try {
      await chrome.windows.update(existingWindowId, {
        focused: true,
        drawAttention: true
      });
      return;
    } catch {
      removeViewerWindowMapping(existingWindowId);
    }
  }

  const monitorUrl = createMonitorUrlForTab(safeTabId);



  try {
    const created = await chrome.windows.create({
      url: monitorUrl,
      type: "popup",
      width: MONITOR_WINDOW_WIDTH,
      height: MONITOR_WINDOW_HEIGHT,
      focused: true
    });

    if (Number.isInteger(created?.id)) {
      state.viewerWindowByTrackedTab.set(safeTabId, created.id);
      state.trackedTabByViewerWindow.set(created.id, safeTabId);
    }
  } catch {
    const fallbackTab = await chrome.tabs.create({
      url: monitorUrl,
      active: true
    });

    if (Number.isInteger(fallbackTab?.windowId)) {
      state.viewerWindowByTrackedTab.set(safeTabId, fallbackTab.windowId);
      state.trackedTabByViewerWindow.set(fallbackTab.windowId, safeTabId);
    }
  }
}

async function reloadTrackedTab(tabId) {
  const safeTabId = parseTabId(tabId);
  if (safeTabId < 0) {
    return { ok: false, reason: "no-tracked-tab" };
  }

  try {
    await chrome.tabs.reload(safeTabId);
    return { ok: true, tabId: safeTabId };
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
        sessions: serializeSessions(),
        settings: state.settings,
        savedAt: Date.now()
      }
    });
  }, 250);
}

function clearRuntimeRequestBuffers(options = {}) {
  const targetTabId = parseTabId(options.targetTabId);

  if (targetTabId < 0) {
    state.pendingRequests.clear();
    state.requestSizes.clear();
    state.responseSizes.clear();
    return;
  }

  for (const [requestId, pending] of state.pendingRequests.entries()) {
    if (!pending || pending.tabId !== targetTabId) {
      continue;
    }

    state.pendingRequests.delete(requestId);
    state.requestSizes.delete(requestId);
    state.responseSizes.delete(requestId);
  }
}

function clearLogsForTab(tabId, reason, options = {}) {
  const safeTabId = parseTabId(tabId);
  if (safeTabId < 0) {
    return;
  }

  const session = getSession(safeTabId);
  if (!session) {
    return;
  }

  const shouldResetPending = Boolean(options.resetPending);

  session.logs = [];
  session.summary = createEmptySummary();

  if (shouldResetPending) {
    clearRuntimeRequestBuffers({ targetTabId: safeTabId });
  }

  persistStateSoon();

  notifyPopup({
    type: "network-logs-cleared",
    targetTabId: safeTabId,
    reason,
    summary: session.summary
  });
}

function enforceLogLimitForSession(session) {
  if (!session || !Array.isArray(session.logs)) {
    return;
  }

  const maxLogs = state.settings.maxLogs;
  if (session.logs.length <= maxLogs) {
    return;
  }

  session.logs.splice(0, session.logs.length - maxLogs);
}

function addLogEntryForTab(tabId, entry) {
  const session = ensureSession(tabId);
  if (!session) {
    return;
  }

  session.logs.push(entry);
  enforceLogLimitForSession(session);
  session.summary = computeSummary(session.logs);

  persistStateSoon();

  notifyPopup({
    type: "network-log-added",
    targetTabId: parseTabId(tabId),
    entry,
    summary: session.summary,
    maxLogs: state.settings.maxLogs,
    slowThresholdMs: SLOW_THRESHOLD_MS
  });
}

function isTrackedRequest(details) {
  const tabId = parseTabId(details?.tabId);
  return tabId >= 0 && state.sessions.has(tabId);
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

  addLogEntryForTab(pending.tabId, {
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
  if (!state.sessions.has(tabId)) {
    return;
  }

  if (changeInfo.status === "loading") {
    clearLogsForTab(tabId, "tracked-tab-refresh", { resetPending: true });
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

      for (const session of state.sessions.values()) {
        enforceLogLimitForSession(session);
        session.summary = computeSummary(session.logs);
      }
    }
  }

  persistStateSoon();

  notifyPopup({
    type: "settings-updated",
    settings: state.settings
  });
}

async function pruneStaleSessions() {
  const trackedTabIds = Array.from(state.sessions.keys());
  if (trackedTabIds.length === 0) {
    return;
  }

  const tabChecks = await Promise.all(
    trackedTabIds.map(async (tabId) => {
      try {
        const tab = await chrome.tabs.get(tabId);
        return { tabId, tab, ok: true };
      } catch {
        return { tabId, tab: null, ok: false };
      }
    })
  );

  let changed = false;

  for (const check of tabChecks) {
    if (check.ok && isTrackableTab(check.tab)) {
      continue;
    }

    state.sessions.delete(check.tabId);
    clearRuntimeRequestBuffers({ targetTabId: check.tabId });
    changed = true;
  }

  if (changed) {
    persistStateSoon();
  }
}

async function rebuildViewerWindowMappings() {
  state.viewerWindowByTrackedTab.clear();
  state.trackedTabByViewerWindow.clear();

  const monitorPattern = `${chrome.runtime.getURL(MONITOR_WINDOW_PATH)}*`;
  const monitorTabs = await chrome.tabs.query({ url: monitorPattern });

  for (const monitorTab of monitorTabs) {
    if (!monitorTab || typeof monitorTab !== "object") {
      continue;
    }

    if (!Number.isInteger(monitorTab.windowId)) {
      continue;
    }

    const trackedTabId = extractTargetTabIdFromUrl(String(monitorTab.url || ""));
    if (trackedTabId < 0) {
      continue;
    }

    state.viewerWindowByTrackedTab.set(trackedTabId, monitorTab.windowId);
    state.trackedTabByViewerWindow.set(monitorTab.windowId, trackedTabId);
  }
}

const initPromise = (async () => {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const savedState = stored[STORAGE_KEY];

  if (savedState && typeof savedState === "object") {
    state.settings = sanitizeSettings(savedState.settings);
    state.sessions = sanitizeSessions(savedState.sessions, state.settings.maxLogs);

    if (state.sessions.size === 0 && Number.isInteger(savedState.activeTabId)) {
      const legacyTabId = parseTabId(savedState.activeTabId);
      if (legacyTabId >= 0) {
        state.sessions.set(legacyTabId, createSession(savedState.logs));
      }
    }
  }

  await rebuildViewerWindowMappings();
})();

initPromise
  .then(() => {
    // Maintenance runs after critical init so monitor window opens quickly.
    void pruneStaleSessions();
  })
  .catch(() => {
    // Ignore startup maintenance failures.
  });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return false;
  }

  (async () => {
    await initPromise;

    const targetTabId = resolveTargetTabIdFromMessage(message, sender);

    if (message.type === "get-state") {
      sendResponse(getStateSnapshot(targetTabId));
      return;
    }

    if (message.type === "clear-logs") {
      if (targetTabId < 0) {
        sendResponse({ ok: false, reason: "no-tracked-tab" });
        return;
      }

      clearLogsForTab(targetTabId, "manual-clear", { resetPending: true });
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "set-setting") {
      updateSetting(message.key, message.value);
      sendResponse({ ok: true, settings: state.settings });
      return;
    }

    if (message.type === "popup-closed") {
      if (state.settings.autoClearOnPopupClose && targetTabId >= 0) {
        clearLogsForTab(targetTabId, "popup-closed", { resetPending: true });
      }

      sendResponse({ ok: true });
      return;
    }

    if (message.type === "open-monitor-window") {
      if (targetTabId < 0) {
        sendResponse({ ok: false, reason: "no-tracked-tab" });
        return;
      }

      ensureSession(targetTabId);
      await openMonitorWindow(targetTabId);
      sendResponse({ ok: true, targetTabId });
      return;
    }

    if (message.type === "reload-tracked-tab") {
      const result = await reloadTrackedTab(targetTabId);
      sendResponse(result);
      return;
    }

    sendResponse(null);
  })().catch(() => {
    sendResponse({ ok: false, reason: "internal-error" });
  });

  return true;
});

chrome.action.onClicked.addListener(async (tab) => {
  await initPromise;

  let targetTab = tab;

  if (!isTrackableTab(targetTab)) {
    targetTab = await findTrackableActiveTab(targetTab);
  }

  if (!targetTab || !Number.isInteger(targetTab.id)) {
    return;
  }

  ensureSession(targetTab.id);
  persistStateSoon();
  await openMonitorWindow(targetTab.id);
});

chrome.windows.onRemoved.addListener((windowId) => {
  const trackedTabId = removeViewerWindowMapping(windowId);
  if (trackedTabId < 0) {
    return;
  }

  if (state.settings.autoClearOnPopupClose) {
    clearLogsForTab(trackedTabId, "monitor-window-closed", { resetPending: true });
  }
});

chrome.tabs.onUpdated.addListener(onTabUpdated);

chrome.tabs.onRemoved.addListener((tabId) => {
  if (!state.sessions.has(tabId)) {
    return;
  }

  clearLogsForTab(tabId, "tracked-tab-closed", { resetPending: true });
  state.sessions.delete(tabId);
  persistStateSoon();

  const viewerWindowId = state.viewerWindowByTrackedTab.get(tabId);
  if (Number.isInteger(viewerWindowId)) {
    state.viewerWindowByTrackedTab.delete(tabId);
    state.trackedTabByViewerWindow.delete(viewerWindowId);

    chrome.windows.remove(viewerWindowId).catch(() => {
      // Window may already be closed.
    });
  }

  notifyPopup({
    type: "tracked-tab-closed",
    targetTabId: tabId
  });
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
