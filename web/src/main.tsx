import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./index.css";
import { App } from "./App";
import { PrefsProvider } from "./lib/prefs";
import { SessionProvider } from "./lib/session";
import { registerSW } from "./lib/passkey";
import { initLang, useLang } from "./i18n";

/** B1.3: the root follows the language; because the tree is created here, every screen re-renders in place. */
function Root() {
  useLang();
  return (
    <BrowserRouter>
      <PrefsProvider>
        <SessionProvider>
          <App />
        </SessionProvider>
      </PrefsProvider>
    </BrowserRouter>
  );
}

void initLang().then(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  ),
);
void registerSW();
