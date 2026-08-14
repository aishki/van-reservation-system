"use client";

import { useEffect, useState } from "react";

/**
 * The value as it stood `delayMs` ago — updates settle only once the input
 * stops changing for that long. Used to hold network lookups until the user
 * pauses typing.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
