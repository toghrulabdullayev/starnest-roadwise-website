import type { ReactNode } from "react";
import { Card } from "@/components/ui";

export function AuthShell({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <div className="flex flex-1 items-start justify-center bg-canvas-2 px-4 py-12 sm:py-16">
      <Card className="w-full max-w-md">
        <h1 className="text-3xl uppercase leading-tight sm:text-4xl">{title}</h1>
        <p className="mt-2 mb-6 text-text-muted">{lead}</p>
        {children}
      </Card>
    </div>
  );
}
