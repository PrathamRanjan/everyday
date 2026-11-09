import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { usePrefs } from "@/lib/prefs";

/** Toasts follow the app's own theme setting (no next-themes). */
const Toaster = (props: ToasterProps) => {
  const { prefs } = usePrefs();
  return (
    <Sonner
      theme={prefs.theme}
      className="toaster group"
      position="top-center"
      icons={{
        success: <CircleCheckIcon className="size-4 text-done" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4 text-wait" />,
        error: <OctagonXIcon className="size-4 text-stop" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={{ "--normal-bg": "var(--card)", "--normal-text": "var(--ink)", "--normal-border": "var(--rule-2)", "--border-radius": "var(--radius)" } as React.CSSProperties}
      {...props}
    />
  );
};
export { Toaster };
