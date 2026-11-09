import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/public-sans";
import "./index.css";
import { App } from "./App";
import { PrefsProvider } from "./lib/prefs";
import { SessionProvider } from "./lib/session";
import { registerSW } from "./lib/passkey";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <PrefsProvider>
        <SessionProvider>
          <App />
        </SessionProvider>
      </PrefsProvider>
    </BrowserRouter>
  </StrictMode>,
);
void registerSW();
