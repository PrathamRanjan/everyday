import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Lifeline } from "@/components/Lifeline";

export default function NotFound() {
  const t = new Date().toISOString().slice(0, 10);
  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="eyebrow">404</div>
      <h1 className="mt-2 text-4xl font-medium">This page isn't on the line.</h1>
      <p className="mt-3 text-ink-2">The link may be old, or the thing it pointed to was reset with the demo.</p>
      <div className="my-6 opacity-70">
        <Lifeline compact marks={[{ key: "x", label: "Not found", date: t, tone: "stop" }]} today={t} />
      </div>
      <Button asChild>
        <Link to="/">Go to the start</Link>
      </Button>
    </div>
  );
}
