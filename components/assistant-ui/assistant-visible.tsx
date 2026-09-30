"use client";

// `<AssistantVisible>` — declarative wrapper around assistant-ui's
// `makeAssistantVisible` HOC. Use it to mark dashboard widgets, cards,
// and panels as readable by the assistant: when the chat surface is
// mounted in the same React tree (i.e. shares an `AssistantRuntimeProvider`),
// the wrapped element's `outerHTML` is injected into the model's system
// context every turn, so the assistant can reason about what the user
// is actually looking at.
//
// `clickable` / `editable` opt-in to assistant-ui's `click` / `edit` tools
// so the model can also drive the UI. Off by default — read-only is the
// safe baseline; we'll opt in card-by-card once the UX is settled.
//
// REQUIRES an AssistantRuntimeProvider ancestor. The HOC unconditionally
// reads from `useAui()` and registers a model-context source in `useEffect`
// — without a provider, the default proxy throws on `modelContext()`,
// which surfaces as "Something went wrong" via React's error boundary.
// Only render this where chat is actually mounted in the same tree.

import type { ReactNode } from "react";
import { makeAssistantVisible } from "@assistant-ui/react";

interface InnerProps {
  children: ReactNode;
  className?: string;
  label?: string;
}

// Inner div that `makeAssistantVisible` wraps. The HOC needs a real
// component (it forwards refs + injects data-* attributes), so we
// declare a stable functional component here rather than wrapping an
// inline arrow.
function AssistantVisibleInner({ children, className, label }: InnerProps) {
  return (
    <div className={className} data-assistant-label={label}>
      {children}
    </div>
  );
}

const ReadableInner = makeAssistantVisible(AssistantVisibleInner);

const ClickableInner = makeAssistantVisible(AssistantVisibleInner, {
  clickable: true,
});

const EditableInner = makeAssistantVisible(AssistantVisibleInner, {
  clickable: true,
  editable: true,
});

export interface AssistantVisibleProps extends InnerProps {
  /** Allow the assistant to invoke `click` on this subtree. Off by default. */
  clickable?: boolean;
  /** Allow the assistant to invoke `edit` on input/textarea inside. Implies clickable. Off by default. */
  editable?: boolean;
}

export function AssistantVisible({
  clickable = false,
  editable = false,
  ...rest
}: AssistantVisibleProps) {
  if (editable) return <EditableInner {...rest} />;
  if (clickable) return <ClickableInner {...rest} />;
  return <ReadableInner {...rest} />;
}
