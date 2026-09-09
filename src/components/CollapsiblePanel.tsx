import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

type CollapsiblePanelProps = {
  title: string;
  description?: string;
  meta?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  contentClassName?: string;
};

export function CollapsiblePanel({
  title,
  description,
  meta,
  children,
  defaultOpen = false,
  className = "",
  contentClassName = "",
}: CollapsiblePanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <section className={`panel overflow-hidden ${className}`}>
      <button
        type="button"
        className="flex min-h-14 w-full items-center justify-between gap-4 px-4 py-3 text-left sm:px-5"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-foreground">{title}</span>
          {description && (
            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
              {description}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {meta && <span className="text-xs text-muted-foreground">{meta}</span>}
          <ChevronDown
            className={`size-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
        </span>
      </button>
      <div
        id={contentId}
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className={`border-t border-border px-4 py-4 sm:px-5 ${contentClassName}`}>
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}
