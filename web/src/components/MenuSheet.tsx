import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

/** The phone menu's slide-over. Its own chunk: the dialog and scroll-lock code load after the first paint. */
export default function MenuSheet({ open, onOpenChange, trigger, title, description, children }: { open: boolean; onOpenChange: (v: boolean) => void; trigger: ReactNode; title: string; description: string; children: ReactNode }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="right" className="w-[300px] bg-paper p-0">
        <SheetHeader className="border-b border-rule">
          <SheetTitle className="font-display text-xl">{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
  );
}
