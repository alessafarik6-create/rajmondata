"use client";

import { useEffect, useState } from "react";
import {
  isHikvisionSdkReady,
  loadHikvisionSdk,
  type HikvisionSdkErrorCode,
} from "@/components/cameras/load-hikvision-sdk";

export function useHikConnectJssdk(enabled = true) {
  const [ready, setReady] = useState(false);
  const [errorCode, setErrorCode] = useState<HikvisionSdkErrorCode | null>(null);

  useEffect(() => {
    if (!enabled) {
      setReady(false);
      setErrorCode(null);
      return;
    }
    if (typeof window === "undefined") return;

    let cancelled = false;
    if (isHikvisionSdkReady()) {
      setReady(true);
      setErrorCode(null);
      return;
    }

    void loadHikvisionSdk().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setReady(true);
        setErrorCode(null);
      } else {
        setReady(false);
        setErrorCode(result.code);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { ready, errorCode };
}
