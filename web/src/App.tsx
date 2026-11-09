import { lazy, Suspense, useEffect } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Shell } from "@/components/Shell";
import { PageSkeleton } from "@/components/kit";
import { useFlash } from "@/lib/api";
import { registerTourNav, resumeTour, startTour } from "@/tours/tours";
import Landing from "@/pages/Landing";

const p = <T extends Record<string, any>>(f: () => Promise<T>, k: keyof T = "default") => lazy(() => f().then((m) => ({ default: m[k] })));
const Login = p(() => import("@/pages/Login"));
const Today = p(() => import("@/pages/Today"));
const Discover = p(() => import("@/pages/Discover"));
const Capture = p(() => import("@/pages/Capture"));
const Plans = p(() => import("@/pages/Plans"));
const Plan = p(() => import("@/pages/Plan"));
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
const DemoPage = p(() => import("@/pages/Demo"));
const Console = p(() => import("@/pages/Console"));
const Evidence = p(() => import("@/pages/Console"), "Evidence");
const Eval = p(() => import("@/pages/Console"), "Eval");
const Telegram = p(() => import("@/pages/Console"), "Telegram");
const NotFound = p(() => import("@/pages/NotFound"));

export function App() {
  const loc = useLocation();
  const nav = useNavigate();
  useFlash();
  useEffect(() => registerTourNav((to) => nav(to)), [nav]);
  useEffect(() => {
    window.scrollTo({ top: 0 });
    const q = new URLSearchParams(loc.search);
    if (q.get("tour")) {
      const k = q.get("tour") === "merchant" ? "merchant" : q.get("tour") === "shopper" ? "shopper" : "judge";
      q.delete("tour");
      nav({ pathname: loc.pathname, search: q.toString() ? `?${q}` : "" }, { replace: true });
      void startTour(k);
      return;
    }
    resumeTour(loc.pathname);
  }, [loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <TooltipProvider delayDuration={200}>
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
            <Route path="/demo" element={<DemoPage />} />
            <Route path="/console" element={<Console />} />
            <Route path="/console/evidence" element={<Evidence />} />
            <Route path="/console/eval" element={<Eval />} />
            <Route path="/telegram" element={<Telegram />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </Shell>
      <Toaster />
    </TooltipProvider>
  );
}
