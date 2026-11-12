import React, { useState, useEffect } from "react";
import { Download, Smartphone, Monitor, Share, PlusSquare, ExternalLink, X, CheckCircle2, WifiOff, Copy, Check, ShieldAlert, Sparkles } from "lucide-react";
import { usePWAInstall, useOnlineStatus } from "../hooks/usePWAInstall";

export const APP_ICON_PATH = "./assets/aistudio/farmacia_6a281112.png";

interface PWAInstallButtonProps {
  variant?: "header" | "login" | "sidebar";
}

type BrowserTab = "brave" | "chrome" | "samsung" | "firefox" | "ios";

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = "header" }) => {
  const {
    isInstallable,
    isInstalled,
    isIOS,
    isMobile,
    isInIframe,
    isBrave,
    isSamsung,
    isFirefox,
    install
  } = usePWAInstall();

  const [showGuideModal, setShowGuideModal] = useState(false);
  const [selectedBrowserTab, setSelectedBrowserTab] = useState<BrowserTab>("chrome");
  const [copiedLink, setCopiedLink] = useState(false);

  // Auto-select detected browser tab
  useEffect(() => {
    if (isBrave) {
      setSelectedBrowserTab("brave");
    } else if (isSamsung) {
      setSelectedBrowserTab("samsung");
    } else if (isFirefox) {
      setSelectedBrowserTab("firefox");
    } else if (isIOS) {
      setSelectedBrowserTab("ios");
    } else {
      setSelectedBrowserTab("chrome");
    }
  }, [isBrave, isSamsung, isFirefox, isIOS]);

  // Do not show install button if already running as an installed standalone app
  if (isInstalled) {
    return null;
  }

  const handleInstallClick = async () => {
    if (isInstallable) {
      const result = await install();
      if (result === "manual") {
        setShowGuideModal(true);
      }
    } else {
      setShowGuideModal(true);
    }
  };

  const handleCopyAppUrl = async () => {
    try {
      const url = typeof window !== "undefined" ? window.location.href : "/";
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      alert("No se pudo copiar el enlace automáticamente.");
    }
  };

  return (
    <>
      {variant === "header" ? (
        <button
          type="button"
          onClick={handleInstallClick}
          className="inline-flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 active:scale-95 transition rounded-xl px-3 py-2 sm:px-3.5 sm:py-2.5 text-[11px] sm:text-xs font-extrabold uppercase tracking-wider shadow-sm border border-emerald-300/60 cursor-pointer shrink-0"
          title="Instalar aplicación en este dispositivo"
        >
          <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
          <span className="hidden xs:inline sm:inline">Instalar App</span>
          <span className="xs:hidden sm:hidden">App</span>
        </button>
      ) : variant === "sidebar" ? (
        <button
          type="button"
          onClick={handleInstallClick}
          className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-slate-950 font-black text-xs py-2.5 px-3 rounded-xl transition shadow-sm border border-emerald-400/40 cursor-pointer active:scale-98"
          title="Instalar aplicación en tu pantalla de inicio"
        >
          <Download className="w-4 h-4 shrink-0 text-slate-950" />
          <span>Instalar Aplicación (PWA)</span>
        </button>
      ) : (
        <div className="mt-4 bg-white/95 border border-teal-200/90 rounded-2xl p-3.5 shadow-sm flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src={APP_ICON_PATH}
              alt="Icono de la Aplicación"
              className="w-10 h-10 rounded-xl object-contain bg-slate-50 border border-slate-200 p-1 shrink-0"
            />
            <div className="min-w-0 text-left">
              <p className="text-xs font-extrabold text-slate-900 truncate">
                Instalar Aplicación Oficial
              </p>
              <p className="text-[11px] font-medium text-slate-500 truncate">
                Compatible con Brave, Chrome, Samsung, iOS y PC
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleInstallClick}
            className="inline-flex items-center gap-1.5 bg-teal-800 hover:bg-teal-700 active:scale-95 text-white font-extrabold text-xs px-3.5 py-2.5 rounded-xl shadow-xs transition cursor-pointer shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Instalar</span>
          </button>
        </div>
      )}

      {showGuideModal && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/60 backdrop-blur-xs animate-fade-in">
          <div
            className="relative w-full sm:max-w-lg bg-white text-slate-800 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 overflow-hidden anim-slide-up sm:anim-pop-in max-h-[92dvh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header del Modal */}
            <div className="px-5 py-4 bg-gradient-to-r from-teal-800 to-teal-950 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-11 h-11 rounded-2xl bg-white p-1.5 shadow-md flex items-center justify-center shrink-0">
                  <img
                    src={APP_ICON_PATH}
                    alt="Icono Farmacia"
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-black uppercase tracking-wide text-white truncate">
                    Instalar Aplicación (PWA)
                  </h3>
                  <p className="text-[11px] text-teal-100 font-medium truncate">
                    Brave, Android, iOS Safari, Chrome y Computadora
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-5 overflow-y-auto space-y-4 text-left">
              {/* Botón de acción directa si el navegador tiene el prompt listo */}
              {isInstallable && (
                <div className="bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
                  <div className="text-left">
                    <p className="text-xs font-black text-emerald-950 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>¡Tu navegador tiene lista la instalación directa!</span>
                    </p>
                    <p className="text-[11px] text-emerald-800 mt-0.5">
                      Haz clic en el botón para agregar el icono oficial a tu pantalla de inicio.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await install();
                      if (res === "accepted") {
                        setShowGuideModal(false);
                      }
                    }}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-wider px-4 py-2.5 rounded-xl shadow-sm transition active:scale-95 cursor-pointer shrink-0"
                  >
                    <Download className="w-4 h-4" />
                    <span>Instalar Ahora</span>
                  </button>
                </div>
              )}

              {/* Aviso si se encuentra dentro de un iframe/visor */}
              {isInIframe && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 space-y-2">
                  <p className="text-xs font-black text-amber-900 flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" />
                    <span>Paso previo si estás en un visor o pestaña incrustada:</span>
                  </p>
                  <p className="text-xs text-amber-800 leading-relaxed">
                    Los navegadores en Android (como Brave o Chrome) no permiten instalar aplicaciones dentro de pestañas de previsualización. Abre la aplicación en una pestaña directa de tu navegador:
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2 pt-1">
                    <a
                      href={typeof window !== "undefined" ? window.location.href : "/"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-2 flex-1 bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs py-2.5 px-4 rounded-xl transition shadow-xs"
                    >
                      <ExternalLink className="w-4 h-4" />
                      <span>Abrir en Pestaña Completa</span>
                    </a>
                    <button
                      type="button"
                      onClick={handleCopyAppUrl}
                      className="inline-flex items-center justify-center gap-2 sm:w-auto bg-white border border-amber-300 text-amber-900 hover:bg-amber-100/70 font-extrabold text-xs py-2.5 px-3.5 rounded-xl transition cursor-pointer"
                    >
                      {copiedLink ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                      <span>{copiedLink ? "¡Copiado!" : "Copiar Enlace"}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Selector de Navegador */}
              <div>
                <p className="text-xs font-black uppercase text-slate-500 tracking-wider mb-2">
                  Selecciona tu navegador para ver los pasos:
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setSelectedBrowserTab("brave")}
                    className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl text-xs font-extrabold transition cursor-pointer ${
                      selectedBrowserTab === "brave"
                        ? "bg-teal-800 text-white shadow-xs"
                        : "text-slate-700 hover:bg-slate-200/70"
                    }`}
                  >
                    <span>🦁 Brave</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedBrowserTab("chrome")}
                    className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl text-xs font-extrabold transition cursor-pointer ${
                      selectedBrowserTab === "chrome"
                        ? "bg-teal-800 text-white shadow-xs"
                        : "text-slate-700 hover:bg-slate-200/70"
                    }`}
                  >
                    <span>🌐 Chrome/Edge</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedBrowserTab("samsung")}
                    className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl text-xs font-extrabold transition cursor-pointer ${
                      selectedBrowserTab === "samsung"
                        ? "bg-teal-800 text-white shadow-xs"
                        : "text-slate-700 hover:bg-slate-200/70"
                    }`}
                  >
                    <span>🪐 Samsung</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedBrowserTab("firefox")}
                    className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl text-xs font-extrabold transition cursor-pointer ${
                      selectedBrowserTab === "firefox"
                        ? "bg-teal-800 text-white shadow-xs"
                        : "text-slate-700 hover:bg-slate-200/70"
                    }`}
                  >
                    <span>🦊 Firefox</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedBrowserTab("ios")}
                    className={`col-span-2 sm:col-span-1 flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl text-xs font-extrabold transition cursor-pointer ${
                      selectedBrowserTab === "ios"
                        ? "bg-teal-800 text-white shadow-xs"
                        : "text-slate-700 hover:bg-slate-200/70"
                    }`}
                  >
                    <span>🍏 iPhone/iPad</span>
                  </button>
                </div>
              </div>

              {/* Guía Específica por Navegador */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                {selectedBrowserTab === "brave" && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-2">
                        <span className="text-base">🦁</span>
                        <span>Cómo instalar en Navegador Brave (Android / PC)</span>
                      </h4>
                      <span className="text-[10px] bg-orange-100 text-orange-800 font-bold px-2 py-0.5 rounded-full">
                        Brave Android
                      </span>
                    </div>
                    <ol className="text-xs text-slate-700 space-y-2 list-decimal list-inside font-medium leading-relaxed">
                      <li>
                        Toca el menú de tres puntos <strong>(⋮)</strong> en la esquina inferior o superior de Brave.
                      </li>
                      <li>
                        Busca y toca <strong>&ldquo;Instalar aplicación&rdquo;</strong> o <strong>&ldquo;Agregar a la pantalla principal&rdquo;</strong>.
                      </li>
                      <li>
                        En la ventana emergente que muestra el nombre <strong>Control de Stock Hospitalario</strong>, toca <strong>Instalar</strong>.
                      </li>
                    </ol>
                    <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-xs text-orange-900 space-y-1">
                      <p className="font-extrabold flex items-center gap-1.5">
                        <ShieldAlert className="w-4 h-4 text-orange-600 shrink-0" />
                        <span>¿Brave no muestra la opción o dice que no se puede?</span>
                      </p>
                      <p className="text-[11px] leading-relaxed text-orange-800">
                        Brave incluye escudos de privacidad estrictos (Brave Shields) que a veces bloquean la detección de instalación local. Toca el <strong>icono del León de Brave</strong> al lado de la barra de direcciones, cambia el interruptor a <strong>&ldquo;Escudos: Desactivados&rdquo;</strong> para esta página y recarga. La opción de instalación se habilitará de inmediato.
                      </p>
                    </div>
                  </div>
                )}

                {selectedBrowserTab === "chrome" && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-2">
                        <Smartphone className="w-4 h-4 text-teal-700 shrink-0" />
                        <span>En Google Chrome o Microsoft Edge (Android)</span>
                      </h4>
                      <span className="text-[10px] bg-blue-100 text-blue-800 font-bold px-2 py-0.5 rounded-full">
                        Android / PC
                      </span>
                    </div>
                    <ol className="text-xs text-slate-700 space-y-2 list-decimal list-inside font-medium leading-relaxed">
                      <li>
                        Toca el menú de tres puntos <strong>(⋮)</strong> en la esquina superior derecha del navegador.
                      </li>
                      <li>
                        Selecciona <strong>&ldquo;Instalar aplicación&rdquo;</strong> o <strong>&ldquo;Agregar a la pantalla principal&rdquo;</strong>.
                      </li>
                      <li>
                        Confirma tocando <strong>Instalar</strong>. La app se guardará con su icono y abrirá en pantalla completa independiente.
                      </li>
                    </ol>
                  </div>
                )}

                {selectedBrowserTab === "samsung" && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-2">
                        <Smartphone className="w-4 h-4 text-teal-700 shrink-0" />
                        <span>En Samsung Internet (Móviles Galaxy / Android)</span>
                      </h4>
                      <span className="text-[10px] bg-purple-100 text-purple-800 font-bold px-2 py-0.5 rounded-full">
                        Samsung
                      </span>
                    </div>
                    <ol className="text-xs text-slate-700 space-y-2 list-decimal list-inside font-medium leading-relaxed">
                      <li>
                        Toca el icono de tres líneas horizontales <strong>(≡)</strong> en la esquina inferior derecha o el icono de descarga <Download className="w-3.5 h-3.5 inline mx-0.5 text-teal-700" /> en la barra de direcciones.
                      </li>
                      <li>
                        Toca <strong>&ldquo;Agregar página a&rdquo;</strong> y luego selecciona <strong>&ldquo;Pantalla de inicio&rdquo;</strong> o <strong>&ldquo;Instalar aplicación web&rdquo;</strong>.
                      </li>
                      <li>
                        Toca <strong>Instalar</strong>.
                      </li>
                    </ol>
                  </div>
                )}

                {selectedBrowserTab === "firefox" && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-2">
                        <Smartphone className="w-4 h-4 text-teal-700 shrink-0" />
                        <span>En Mozilla Firefox (Android)</span>
                      </h4>
                      <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded-full">
                        Firefox
                      </span>
                    </div>
                    <ol className="text-xs text-slate-700 space-y-2 list-decimal list-inside font-medium leading-relaxed">
                      <li>
                        Toca el menú de tres puntos <strong>(⋮)</strong> en la barra de Firefox.
                      </li>
                      <li>
                        Selecciona <strong>&ldquo;Instalar&rdquo;</strong> o <strong>&ldquo;Añadir a la pantalla de inicio&rdquo;</strong>.
                      </li>
                      <li>
                        Confirma tocando <strong>Añadir</strong>.
                      </li>
                    </ol>
                  </div>
                )}

                {selectedBrowserTab === "ios" && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-2">
                        <Smartphone className="w-4 h-4 text-teal-700 shrink-0" />
                        <span>En iPhone o iPad (Navegador Safari)</span>
                      </h4>
                      <span className="text-[10px] bg-slate-200 text-slate-800 font-bold px-2 py-0.5 rounded-full">
                        iOS Safari
                      </span>
                    </div>
                    <ol className="text-xs text-slate-700 space-y-2 list-decimal list-inside font-medium leading-relaxed">
                      <li>
                        Toca el botón <strong>Compartir</strong> <Share className="w-3.5 h-3.5 inline text-teal-700 mx-0.5" /> (cuadrado con flecha hacia arriba) en la barra inferior de Safari.
                      </li>
                      <li>
                        Desliza hacia abajo en el menú de opciones y selecciona <strong>&ldquo;Agregar a pantalla de inicio&rdquo;</strong> <PlusSquare className="w-3.5 h-3.5 inline text-teal-700 mx-0.5" />.
                      </li>
                      <li>
                        Toca <strong>Agregar</strong> en la esquina superior derecha.
                      </li>
                    </ol>
                  </div>
                )}
              </div>

              {/* Botón para copiar enlace si el usuario desea abrirlo en otro navegador */}
              <div className="flex items-center justify-between bg-slate-100 rounded-xl p-3 border border-slate-200">
                <div className="min-w-0 pr-2">
                  <span className="block text-[10px] font-black uppercase text-slate-500">¿Quieres abrirlo en otro navegador?</span>
                  <span className="block text-xs font-bold text-slate-800 truncate">Copia el enlace para pegarlo en Chrome, Brave o Edge</span>
                </div>
                <button
                  type="button"
                  onClick={handleCopyAppUrl}
                  className="inline-flex items-center gap-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer shrink-0 shadow-2xs"
                >
                  {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
                  <span>{copiedLink ? "Copiado" : "Copiar"}</span>
                </button>
              </div>

              <div className="flex items-center gap-2 text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3.5 py-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Al instalarse, funcionará como una aplicación nativa con su icono oficial y modo sin conexión.</span>
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-teal-800 hover:bg-teal-700 text-white font-extrabold text-xs uppercase tracking-wider transition cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[65] flex items-center gap-2 rounded-2xl bg-amber-600 px-3.5 py-2 text-xs font-extrabold text-white shadow-xl border border-amber-400/50">
      <WifiOff className="w-4 h-4 shrink-0 animate-pulse" />
      <span>Modo sin conexión — Usando datos en caché</span>
    </div>
  );
};
