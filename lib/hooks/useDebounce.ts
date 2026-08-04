"use client";

import { useEffect, useState } from "react";

/**
 * Returns `value`, but only adopts a new value once it has stayed unchanged
 * for `delayMs` — every intermediate value during a fast burst of updates
 * (e.g. dragging a range slider, which fires onChange on every pixel of
 * movement) is dropped. Callers keep their own raw, instant state for
 * anything that must track the input 1:1 (the slider thumb itself, its
 * numeric label, form submission) and read this debounced value only for
 * expensive downstream work (recomputing a Clipper outline, re-rendering a
 * large SVG preview) that shouldn't re-run on every single tick.
 */
export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timeout);
  }, [value, delayMs]);

  return debounced;
}
