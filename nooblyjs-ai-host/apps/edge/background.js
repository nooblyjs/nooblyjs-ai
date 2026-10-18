// The service worker: the toolbar button opens the NooblyJS side panel. It keeps no state of its own
// (Edge stops a service worker when it is idle), so everything it needs comes from chrome.storage.

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
