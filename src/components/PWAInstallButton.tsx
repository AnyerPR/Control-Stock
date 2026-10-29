import React, { useState } from "react";
import { Download, Smartphone, Monitor, Share, PlusSquare, ExternalLink, X, CheckCircle2, WifiOff } from "lucide-react";
import { usePWAInstall, useOnlineStatus } from "../hooks/usePWAInstall";

export const APP_ICON_PATH = "./assets/aistudio/farmacia_6a281112.png";

interface PWAInstallButtonProps {
  variant?: "header" | "login";
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = "header" }) => {
  const { isInstallable, isInstalled, isIOS, isMobile, isInIframe, install } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);

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
                Acceso directo en tu teléfono o computadora
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
            className="relative w-full sm:max-w-md bg-white text-slate-800 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 overflow-hidden anim-slide-up sm:anim-pop-in max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 bg-gradient-to-r from-teal-800 to-teal-900 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-white p-1.5 shadow-md flex items-center justify-center shrink-0">
                  <img
                    src={APP_ICON_PATH}
                    alt="Icono Farmacia"
                    className="w-full h-full object-contain"
                  />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold uppercase tracking-wide text-white">
                    Instalar como Aplicación
                  </h3>
                  <p className="text-[11px] text-teal-100 font-semibold">
                    Control de Stock • Móvil y Computadora
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

            <div className="p-5 overflow-y-auto space-y-4 text-left">
              {isInIframe && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 space-y-2">
                  <p className="text-xs font-extrabold text-amber-900">
                    Paso previo recomendado:
                  </p>
                  <p className="text-xs text-amber-800 leading-relaxed">
                    Para que el navegador habilite el botón directo de instalación en tu dispositivo, abre primero la aplicación en una pestaña completa:
                  </p>
                  <a
                    href={typeof window !== "undefined" ? window.location.href : "/"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 w-full bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs py-2.5 px-4 rounded-xl transition shadow-xs"
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span>Abrir en Pestaña Completa para Instalar</span>
                  </a>
                </div>
              )}

              {/* Instrucciones para iOS (iPhone / iPad) */}
              <div className={`rounded-2xl border p-4 space-y-2.5 ${isIOS ? "bg-teal-50/70 border-teal-300" : "bg-slate-50 border-slate-200"}`}>
                <div className="flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-teal-700 shrink-0" />
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-900">
                    En iPhone o iPad (Safari)
                  </h4>
                </div>
                <ol className="text-xs text-slate-700 space-y-1.5 list-decimal list-inside font-medium">
                  <li>
                    Toca el botón <strong>Compartir</strong>{" "}
                    <Share className="w-3.5 h-3.5 inline text-teal-700 mx-0.5" /> en la barra de Safari.
                  </li>
                  <li>
                    Desliza hacia abajo y selecciona{" "}
                    <strong>&ldquo;Agregar a pantalla de inicio&rdquo;</strong>{" "}
                    <PlusSquare className="w-3.5 h-3.5 inline text-teal-700 mx-0.5" />.
                  </li>
                  <li>
                    Toca <strong>Agregar</strong> en la esquina superior derecha.
                  </li>
                </ol>
              </div>

              {/* Instrucciones para Android */}
              <div className={`rounded-2xl border p-4 space-y-2.5 ${isMobile && !isIOS ? "bg-teal-50/70 border-teal-300" : "bg-slate-50 border-slate-200"}`}>
                <div className="flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-teal-700 shrink-0" />
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-900">
                    En Teléfonos Android (Chrome / Edge)
                  </h4>
                </div>
                <ol className="text-xs text-slate-700 space-y-1.5 list-decimal list-inside font-medium">
                  <li>
                    Toca el menú de tres puntos <strong>(⋮)</strong> en la esquina superior derecha del navegador.
                  </li>
                  <li>
                    Selecciona <strong>&ldquo;Instalar aplicación&rdquo;</strong> o <strong>&ldquo;Agregar a la pantalla principal&rdquo;</strong>.
                  </li>
                  <li>
                    Confirma tocando <strong>Instalar</strong>.
                  </li>
                </ol>
              </div>

              {/* Instrucciones para Computadora */}
              <div className={`rounded-2xl border p-4 space-y-2.5 ${!isMobile ? "bg-teal-50/70 border-teal-300" : "bg-slate-50 border-slate-200"}`}>
                <div className="flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-teal-700 shrink-0" />
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-900">
                    En Computadora (Chrome / Edge)
                  </h4>
                </div>
                <ol className="text-xs text-slate-700 space-y-1.5 list-decimal list-inside font-medium">
                  <li>
                    Haz clic en el icono de instalación <Download className="w-3.5 h-3.5 inline text-teal-700 mx-0.5" /> situado en el lado derecho de la barra de direcciones.
                  </li>
                  <li>
                    Haz clic en <strong>Instalar</strong> para crear el acceso directo en tu escritorio.
                  </li>
                </ol>
              </div>

              <div className="flex items-center gap-2 text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3.5 py-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Se instalará con el icono oficial de la farmacia en pantalla completa.</span>
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-teal-800 hover:bg-teal-700 text-white font-extrabold text-xs uppercase tracking-wider transition cursor-pointer"
              >
                Entendido
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
