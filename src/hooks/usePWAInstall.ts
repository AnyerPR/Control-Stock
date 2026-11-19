import { useEffect, useState, useCallback } from "react";

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(() => {
    if (typeof window !== "undefined" && window.__deferredPWAInstallPrompt) {
      return window.__deferredPWAInstallPrompt as BeforeInstallPromptEvent;
    }
    return null;
  });
  const [isInstalled, setIsInstalled] = useState<boolean>(false);
  const [isIOS, setIsIOS] = useState<boolean>(false);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [isInIframe, setIsInIframe] = useState<boolean>(false);
  const [isBrave, setIsBrave] = useState<boolean>(false);
  const [isSamsung, setIsSamsung] = useState<boolean>(false);
  const [isFirefox, setIsFirefox] = useState<boolean>(false);
  const [isEdge, setIsEdge] = useState<boolean>(false);
  const [isChrome, setIsChrome] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Check if running in standalone mode (installed PWA)
    const checkStandalone = () => {
      const standaloneMatch =
        window.matchMedia("(display-mode: standalone)").matches ||
        window.matchMedia("(display-mode: window-controls-overlay)").matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      setIsInstalled(standaloneMatch);
    };

    checkStandalone();

    const mediaQuery = window.matchMedia("(display-mode: standalone)");
    const handleDisplayModeChange = () => checkStandalone();
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleDisplayModeChange);
    }

    // Detect browser and device types
    const ua = window.navigator.userAgent.toLowerCase();
    const iosDevice =
      /iphone|ipad|ipod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const mobileDevice = iosDevice || /android|webos|blackberry|iemobile|opera mini/i.test(ua);
    setIsIOS(iosDevice);
    setIsMobile(mobileDevice);

    const samsung = /samsungbrowser/i.test(ua);
    const firefox = /firefox|fxios/i.test(ua);
    const edge = /edg/i.test(ua);
    setIsSamsung(samsung);
    setIsFirefox(firefox);
    setIsEdge(edge);

    // Detect Brave Browser
    const nav = window.navigator as any;
    if (nav.brave && typeof nav.brave.isBrave === "function") {
      nav.brave.isBrave().then((b: boolean) => {
        setIsBrave(!!b);
        setIsChrome(!b && /chrome|crios/i.test(ua) && !samsung && !edge);
      }).catch(() => {
        setIsChrome(/chrome|crios/i.test(ua) && !samsung && !edge);
      });
    } else {
      setIsChrome(/chrome|crios/i.test(ua) && !samsung && !edge);
    }

    // Detect if running inside an iframe (e.g. preview container)
    try {
      setIsInIframe(window.self !== window.top);
    } catch {
      setIsInIframe(true);
    }

    // Check if global listener in index.html already caught the prompt
    if (window.__deferredPWAInstallPrompt) {
      setDeferredPrompt(window.__deferredPWAInstallPrompt as BeforeInstallPromptEvent);
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      window.__deferredPWAInstallPrompt = e;
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handlePromptReady = () => {
      if (window.__deferredPWAInstallPrompt) {
        setDeferredPrompt(window.__deferredPWAInstallPrompt as BeforeInstallPromptEvent);
      }
    };

    const handleAppInstalled = () => {
      window.__deferredPWAInstallPrompt = null;
      setDeferredPrompt(null);
      setIsInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("pwa-prompt-ready", handlePromptReady);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("pwa-prompt-ready", handlePromptReady);
      window.removeEventListener("appinstalled", handleAppInstalled);
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener("change", handleDisplayModeChange);
      }
    };
  }, []);

  const install = useCallback(async (): Promise<"accepted" | "dismissed" | "manual"> => {
    const promptEvent =
      deferredPrompt ||
      (typeof window !== "undefined" ? (window.__deferredPWAInstallPrompt as BeforeInstallPromptEvent) : null);

    if (!promptEvent) {
      return "manual";
    }

    try {
      await promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      if (outcome === "accepted") {
        window.__deferredPWAInstallPrompt = null;
        setDeferredPrompt(null);
        setIsInstalled(true);
        return "accepted";
      }
      return "dismissed";
    } catch {
      return "manual";
    }
  }, [deferredPrompt]);

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isIOS,
    isMobile,
    isInIframe,
    isBrave,
    isSamsung,
    isFirefox,
    isEdge,
    isChrome,
    install
  };
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}
