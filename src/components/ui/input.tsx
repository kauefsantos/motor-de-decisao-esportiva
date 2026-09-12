import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, inputMode, enterKeyHint, onKeyDown, ...props }, ref) => {
    const resolvedEnterKeyHint =
      enterKeyHint ?? (inputMode === "decimal" || inputMode === "numeric" ? "done" : undefined);

    return (
      <input
        type={type}
        inputMode={inputMode}
        enterKeyHint={resolvedEnterKeyHint}
        className={cn(
          "flex h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!event.defaultPrevented && event.key === "Enter" && resolvedEnterKeyHint === "done") {
            event.currentTarget.blur();
          }
        }}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
