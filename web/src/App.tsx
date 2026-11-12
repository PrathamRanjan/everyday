import { lazy, Suspense, useEffect } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router";
import { Toaster } from "@/components/ui/sonner";
import { t } from "@/i18n";
import { Shell } from "@/components/Shell";
import { PageSkeleton } from "@/components/kit";
import { useFlash } from "@/lib/api";
import { endTourOnRouteChange } from "@/tours/tours";
import Landing from "@/pages/Landing";

const p = <T extends Record<string, any>>(f: () => Promise<T>, k: keyof T = "default") => lazy(() => f().then((m) => ({ default: m[k] })));
const Login = p(() => import("@/pages/Login"));
const Today = p(() => import("@/pages/Today"));
const Discover = p(() => import("@/pages/Discover"));
const Capture = p(() => import("@/pages/Capture"));
const Plans = p(() => import("@/pages/Plans"));
const Plan = p(() => import("@/pages/Plan"));
const Receipts = p(() => import("@/pages/Receipts"));
const Purchases = p(() => import("@/pages/Purchases"));
const Order = p(() => import("@/pages/Order"));
const You = p(() => import("@/pages/You"));
const Guard = p(() => import("@/pages/Guard"));
const Passport = p(() => import("@/pages/Passport"));
const Safety = p(() => import("@/pages/Safety"));
const ModelCard = p(() => import("@/pages/Safety"), "ModelCard");
const Channels = p(() => import("@/pages/Channels"));
const Traces = p(() => import("@/pages/Traces"));
const Trace = p(() => import("@/pages/Traces"), "Trace");
const Merchant = p(() => import("@/pages/Merchant"));
const MerchantMoney = p(() => import("@/pages/Merchant"), "MerchantMoney");
const MerchantApprovals = p(() => import("@/pages/Merchant"), "MerchantApprovals");
const Judge = p(() => import("@/pages/Demo"), "Judge");
const Ask = p(() => import("@/pages/Ask"));
const DemoPage = p(() => import("@/pages/Demo"));
const Console = p(() => import("@/pages/Console"));
const Evidence = p(() => import("@/pages/Console"), "Evidence");
const Eval = p(() => import("@/pages/Console"), "Eval");
const Telegram = p(() => import("@/pages/Console"), "Telegram");
const Proof = p(() => import("@/pages/Public"));
const AiCalls = p(() => import("@/pages/Public"), "AiCalls");
const PayPalApis = p(() => import("@/pages/Public"), "PayPalApis");
const Roles = p(() => import("@/pages/Public"), "Roles");
const Accessibility = p(() => import("@/pages/Public"), "Accessibility");
const Agents = p(() => import("@/pages/Public"), "Agents");
const NotFound = p(() => import("@/pages/NotFound"));

export function App() {
  const loc = useLocation();
  const nav = useNavigate();
  useFlash();
  useEffect(() => {
    window.scrollTo({ top: 0 });
    // A3.3: no tour starts by itself; an old "?tour=" link just opens the page.
    const q = new URLSearchParams(loc.search);
    if (q.get("tour")) {
      q.delete("tour");
      nav({ pathname: loc.pathname, search: q.toString() ? `?${q}` : "" }, { replace: true });
    }
    endTourOnRouteChange(loc.pathname);
  }, [loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Shell>
        <Suspense fallback={<PageSkeleton />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/today" element={<Today />} />
            <Route path="/discover" element={<Discover />} />
            <Route path="/captures/:id" element={<Capture />} />
            <Route path="/plans" element={<Plans />} />
            <Route path="/plans/:id" element={<Plan />} />
            <Route path="/purchases" element={<Purchases />} />
            <Route path="/receipts" element={<Receipts />} />
            <Route path="/orders/:id" element={<Order />} />
            <Route path="/you" element={<You />} />
            <Route path="/things" element={<You />} />
            <Route path="/guard" element={<Guard />} />
            <Route path="/passport" element={<Passport />} />
            <Route path="/safety" element={<Safety />} />
            <Route path="/safety/model-card" element={<ModelCard />} />
            <Route path="/channels" element={<Channels />} />
            <Route path="/traces" element={<Traces />} />
            <Route path="/trace/:id" element={<Trace />} />
            <Route path="/merchant" element={<Merchant />} />
            <Route path="/merchant/money" element={<MerchantMoney />} />
            <Route path="/merchant/approvals" element={<MerchantApprovals />} />
            <Route path="/judge" element={<Judge />} />
            <Route path="/ask" element={<Ask />} />
            <Route path="/proof" element={<Proof />} />
            <Route path="/ai" element={<AiCalls />} />
            <Route path="/paypal" element={<PayPalApis />} />
            <Route path="/who-can-move-money" element={<Roles />} />
            <Route path="/accessibility" element={<Accessibility />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/demo" element={<DemoPage />} />
            <Route path="/console" element={<Console />} />
            <Route path="/console/evidence" element={<Evidence />} />
            <Route path="/console/eval" element={<Eval />} />
            <Route path="/telegram" element={<Telegram />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </Shell>
      <Toaster containerAriaLabel={t("Notifications")} />
    </>
  );
}
