import * as React from "react"

const MOBILE_BREAKPOINT = 768
const LG_BREAKPOINT_PX = 1024

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}

/** Shodné s Tailwind `lg:` — mobilní dashboard a kompaktní kalendář jen pod 1024px. */
export function useIsBelowLg(): boolean {
  const query = `(max-width: ${LG_BREAKPOINT_PX - 1}px)`
  return React.useSyncExternalStore(
    (onStoreChange) => {
      const mql = window.matchMedia(query)
      mql.addEventListener("change", onStoreChange)
      return () => mql.removeEventListener("change", onStoreChange)
    },
    () => window.matchMedia(query).matches,
    () => false
  )
}
