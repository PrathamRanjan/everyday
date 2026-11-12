import qrcode from "qrcode-generator";
import { Download } from "lucide-react";
import { Panel } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { useSession } from "@/lib/session";

/** A QR code drawn as SVG squares (no image, no outside service). */
export function QR({ text, label, size = 168 }: { text: string; label: string; size?: number }) {
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  const cells: string[] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) cells.push(`M${c + 4} ${r + 4}h1v1h-1z`);
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${n + 8} ${n + 8}`} width={size} height={size} className="rounded-md bg-white" shapeRendering="crispEdges" data-testid="qr">
      <path d={cells.join("")} fill="#111" />
    </svg>
  );
}

/** C3: three steps each for the phone and the browser extension, with a QR code for the phone. */
export function InstallGuide() {
  const { session } = useSession();
  const join = session?.workspace?.join_url ?? null;
  return (
    <Panel title={t("Install on your phone and in your browser")} sub={t("Three steps each.")}>
      <div className="grid gap-6 md:grid-cols-2">
        <section aria-labelledby="install-phone">
          <h3 id="install-phone" className="mb-2 text-sm font-semibold">{t("Phone")}</h3>
          {join ? (
            <div className="mb-3 flex items-start gap-3">
              <QR text={join} label={t("QR code: opens this demo on your phone, signed in")} />
              <p className="text-xs text-ink-2">{t("Scan with the phone's camera. It opens this same demo there, signed in as you; the link works only for this demo.")}</p>
            </div>
          ) : (
            <p className="mb-3 text-xs text-ink-2">{t("Start a demo to get a code that opens it on your phone.")}</p>
          )}
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>{t("Scan the code (or open this site on the phone and sign in).")}</li>
            <li>{t("In the browser's menu, choose Add to Home Screen: Everyday opens like an app, and works offline for what it has already loaded.")}</li>
            <li>{t("Here in Messages, turn on notifications on the phone to hear about price drops and approvals.")}</li>
          </ol>
          <p className="mt-2 text-xs text-ink-2">{t("The native phone app isn't in the app stores; this is the web app on your phone.")}</p>
        </section>
        <section aria-labelledby="install-ext">
          <h3 id="install-ext" className="mb-2 text-sm font-semibold">{t("Chrome extension")}</h3>
          <Button asChild variant="outline" className="mb-3">
            <a href="/downloads/everyday-extension.zip" download data-testid="extension-zip">
              <Download />{" "}{t("Download the extension (.zip)")}
            </a>
          </Button>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>{t("Unzip it.")}</li>
            <li>
              {t("Open")} <code className="font-mono text-xs">chrome://extensions</code>
              {t(", turn on Developer mode, press Load unpacked, and pick the unzipped everyday-extension folder.")}
            </li>
            <li>{t("Signed in to Everyday in that browser? Nothing more to do. Otherwise press Connect the extension below and paste the key into the extension's Settings.")}</li>
          </ol>
          <p className="mt-2 text-xs text-ink-2">{t("It isn't in the Chrome Web Store yet, so Chrome installs it as an unpacked extension.")}</p>
        </section>
      </div>
    </Panel>
  );
}
