import { useEffect, useRef } from "react";

type noop = (...args: any[]) => any;

/**
 * usePersistFn instead of useCallback to reduce cognitive load
 *
 * The ref is updated in an effect rather than during the render.
 * Writing to a ref while rendering is a side effect: with React's
 * concurrent rendering a render can be thrown away, and the ref would
 * then hold a function from a render that never happened.
 */
export function usePersistFn<T extends noop>(fn: T) {
  const fnRef = useRef<T>(fn);

  useEffect(() => {
    fnRef.current = fn;
  });

  const persistFn = useRef<T>(null);
  if (!persistFn.current) {
    persistFn.current = function (this: unknown, ...args) {
      return fnRef.current!.apply(this, args);
    } as T;
  }

  return persistFn.current!;
}
