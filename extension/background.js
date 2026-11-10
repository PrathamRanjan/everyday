import { getJson } from "./lib/api.js";

// The toolbar badge shows how many approvals are waiting for you in Everyday. Checked every 5 minutes, when the
// browser starts, and when the popup asks; any error (signed out, offline) just clears the badge.
const POLL = "everyday-poll";

async function refreshBadge() {
  try {
    const t = await getJson("/api/ui/today");
    const n = t.held?.length ?? 0;
    await chrome.action.setBadgeBackgroundColor({ color: "#b13a0d" });
    await chrome.action.setBadgeText({ text: n ? String(n) : "" });
    await chrome.action.setTitle({ title: n ? `Everyday: ${n} approval${n === 1 ? "" : "s"} waiting` : "Everyday" });
  } catch {
    await chrome.action.setBadgeText({ text: "" });
    await chrome.action.setTitle({ title: "Everyday" });
  }
}

const schedule = () => chrome.alarms.create(POLL, { periodInMinutes: 5 });
chrome.runtime.onInstalled.addListener(() => {
  schedule();
  void refreshBadge();
});
chrome.runtime.onStartup.addListener(() => {
  schedule();
  void refreshBadge();
});
chrome.alarms.onAlarm.addListener((a) => a.name === POLL && void refreshBadge());
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "refresh-badge") void refreshBadge();
});
