import { Link } from "react-router";
import { ChevronRight, ShoppingBag } from "lucide-react";
import { Amount, Empty, GoLink, Loaded, PageHead, Panel, State } from "@/components/kit";
import { useApi } from "@/lib/api";
import { day, when } from "@/lib/format";

interface PurchasesData {
  orders: { id: string; number: string; status: string; total_cents: number; gross_cents: number | null; refunded_cents: number; repaired: boolean; created_at: string; capture_id: string | null; paypal_order_id: string | null; lines: { title: string; status: string; eta: string | null }[] }[];
}

export default function Purchases() {
  const st = useApi<PurchasesData>("/api/ui/purchases");
  return (
    <Loaded state={st}>
      {(d) => {
        const paid = d.orders.filter((o) => o.capture_id);
        const due = d.orders.filter((o) => o.status === "created");
        return (
          <div className="ev-rise">
            <PageHead eyebrow="Bought" title="What you bought" lede={paid.length ? `${paid.length} paid, each read back from PayPal.` : "Nothing paid yet."} needs={due.length ? `${due.length} not paid yet` : undefined} />
            <Panel tight>
              <div data-tour="purchases">
                {d.orders.length ? (
                  <ul className="divide-y divide-rule">
                    {d.orders.map((o) => (
                      <li key={o.id}>
                        <Link to={`/orders/${o.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-sunk/60 sm:px-5">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{o.lines.map((l) => l.title).join(", ") || o.number}</span>
                            <span className="num mt-0.5 flex flex-wrap gap-x-2 text-xs text-ink-2">
                              <span className="id">{o.number}</span>
                              <span>{when(o.created_at)}</span>
                              {o.lines.find((l) => l.eta && l.status !== "delivered") && <span>arrives {day(o.lines.find((l) => l.eta)!.eta)}</span>}
                              {o.repaired && <span className="text-done">recovered from PayPal</span>}
                            </span>
                          </span>
                          <span className="flex flex-col items-end gap-1">
                            <Amount cents={o.gross_cents ?? o.total_cents} strong />
                            {o.refunded_cents ? (
                              <span className="num text-xs text-done">
                                −<Amount cents={o.refunded_cents} /> back
                              </span>
                            ) : null}
                          </span>
                          <State s={o.status} className="hidden sm:inline-flex" />
                          <ChevronRight className="size-4 shrink-0 text-ink-3" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="p-4 sm:p-5">
                    <Empty icon={<ShoppingBag className="size-6" />} title="No purchases yet." action={<GoLink to="/plans">Open a plan</GoLink>}>
                      When you approve a plan on PayPal, the order appears here with its dates.
                    </Empty>
                  </div>
                )}
              </div>
            </Panel>
          </div>
        );
      }}
    </Loaded>
  );
}
