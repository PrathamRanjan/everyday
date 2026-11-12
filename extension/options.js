import { getJson, saveSettings, SERVERS, settings } from "./lib/api.js";

const form = document.getElementById("form");
const server = document.getElementById("server");
const keyInput = document.getElementById("key");
const result = document.getElementById("result");

const say = (text) => {
  result.hidden = false;
  result.textContent = text;
};

async function test() {
  try {
    const s = await getJson("/api/ui/session");
    const { key } = await settings();
    if (s.who?.kind === "shopper") say(`Connected as ${s.who.name}, ${key ? "with the device key" : "through the site's sign-in"}.`);
    else say(key ? "That key isn't accepted. Make a new one on Everyday → Messages." : "Not signed in. Sign in to Everyday in this browser, or paste a device key.");
  } catch (e) {
    say(e.message);
  }
}

(async () => {
  const s = await settings();
  server.value = s.base === SERVERS.local ? "local" : "live";
  keyInput.value = "";
  keyInput.placeholder = s.key ? "A key is saved (hidden). Paste a new one to replace it." : "evd_…";
})();

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const next = { base: SERVERS[server.value] };
  const typed = keyInput.value.trim();
  if (typed) {
    if (!/^evd_[A-Za-z0-9_-]{20,}$/.test(typed)) return say("That doesn't look like an Everyday device key (it starts with evd_).");
    next.key = typed;
  }
  await saveSettings(next);
  keyInput.value = "";
  keyInput.placeholder = (await settings()).key ? "A key is saved (hidden). Paste a new one to replace it." : "evd_…";
  await test();
});

document.getElementById("forget").addEventListener("click", async () => {
  await saveSettings({ key: "" });
  keyInput.placeholder = "evd_…";
  await test();
});

// Hands-free in the extension: the popup can listen only after an extension page was allowed the microphone.
document.getElementById("mic").addEventListener("click", async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    say("Microphone allowed. Press Talk in the popup.");
  } catch {
    say("The microphone wasn't allowed. Allow it for this extension in Chrome's site settings, then try again.");
  }
});
