import { cn } from "@/lib/utils";

export const PANEL_HEADER_ACTION_BUTTON_CLASS =
  "rounded-[8px] border border-border bg-card px-3 py-1 text-xs font-semibold text-foreground transition hover:border-primary";

export function getPanelHeaderActionButtonClass(...classNames: Array<string | false | null | undefined>) {
  return cn(PANEL_HEADER_ACTION_BUTTON_CLASS, ...classNames);
}
