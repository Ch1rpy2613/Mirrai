import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  /**
   * The first answer is the right one.
   *
   * It used to be `false` until the effect ran, so on a phone the
   * interface showed the desktop layout for a frame and then changed
   * itself — a flash of the wrong thing on every mount.
   */
  const [isMobile, setIsMobile] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < MOBILE_BREAKPOINT;
  });

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
