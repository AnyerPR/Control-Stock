import React, { memo } from "react";
import {
  LayoutDashboard,
  Package,
  Receipt,
  FileSpreadsheet,
  ClipboardList,
  History,
  Users,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Volume2,
  VolumeX,
  Building2,
  Layers,
  ShoppingCart,
  ShieldCheck
} from "lucide-react";
import { Usuario } from "../types";
import { APP_ICON_PATH, PWAInstallButton } from "./PWAInstallButton";

export interface NavigationItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | number;
  badgeColor?: string;
  sublabel?: string;
}

interface SidebarProps {
  activeTab: string;
  onSelectTab: (tabId: string) => void;
  currentUser: Usuario;
  enabledModules: string[];
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isMobileOpen: boolean;
  onOpenMobile?: () => void;
  onCloseMobile: () => void;
  orderCount?: number;
  onOpenOrder?: () => void;
  showOrder?: boolean;
  showBlocks?: boolean;
  onToggleBlocks?: () => void;
  onLogout: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
  farmaciaNombre?: string;
  farmaciaSubtitulo?: string;
  activeCatalogName?: string;
}

function Sidebar({
  activeTab,
  onSelectTab,
  currentUser,
  enabledModules,
  isCollapsed,
  onToggleCollapse,
  isMobileOpen,
  onOpenMobile,
  onCloseMobile,
  orderCount = 0,
  onOpenOrder,
  showOrder = false,
  showBlocks = false,
  onToggleBlocks,
  onLogout,
  isMuted,
  onToggleMute,
  farmaciaNombre = "Control de Stock",
  farmaciaSubtitulo = "Suministros Hospitalarios",
  activeCatalogName
}: SidebarProps) {
  // Construir elementos de navegación según permisos activos
  const navItems: NavigationItem[] = [
    {
      id: "dashboard",
      label: "Dashboard",
      icon: LayoutDashboard,
      sublabel: "Resumen y Métricas"
    }
  ];

  if (enabledModules.includes("inventory")) {
    navItems.push({
      id: "inventory",
      label: "Suministros",
      icon: Package,
      sublabel: "Control de Stock"
    });
  }

  if (enabledModules.includes("venta")) {
    navItems.push({
      id: "venta",
      label: "Ventas",
      icon: Receipt,
      sublabel: "Facturación y Despacho"
    });
  }

  if (enabledModules.includes("dgii")) {
    navItems.push({
      id: "dgii",
      label: "Cumplimiento DGII",
      icon: ShieldCheck,
      sublabel: "e-CF, NCF, 606, 607 y 608",
      badge: "Ley 32-23",
      badgeColor: "bg-emerald-500/20 text-emerald-200 border-emerald-400/30"
    });
  }

  if (enabledModules.includes("carga_masiva")) {
    navItems.push({
      id: "carga_masiva",
      label: "Carga Masiva",
      icon: FileSpreadsheet,
      sublabel: "Importar Excel"
    });
  }

  if (enabledModules.includes("solicitudes")) {
    navItems.push({
      id: "solicitudes",
      label: currentUser.rol === "Administrador" ? "Órdenes" : "Solicitudes",
      icon: ClipboardList,
      sublabel: "Reabastecimiento y Pedidos",
      badge: "Inteligente",
      badgeColor: "bg-teal-500/20 text-teal-200 border-teal-400/30"
    });
  }

  if (enabledModules.includes("historial")) {
    navItems.push({
      id: "historial",
      label: "Historial Movs",
      icon: History,
      sublabel: "Kardex y Auditoría"
    });
  }

  if (enabledModules.includes("usuarios")) {
    navItems.push({
      id: "usuarios",
      label: "Personal",
      icon: Users,
      sublabel: "Usuarios y Permisos"
    });
  }

  if (enabledModules.includes("configuracion")) {
    navItems.push({
      id: "configuracion",
      label: "Configuración",
      icon: Settings,
      sublabel: "Ajustes y Catálogos"
    });
  }

  const handleTabClick = (tabId: string) => {
    if (isMobileOpen) {
      onCloseMobile();
    }
    onSelectTab(tabId);
  };

  const handleHideSidebar = () => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      onCloseMobile();
    } else {
      onToggleCollapse();
    }
  };

  const handleShowSidebar = () => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      if (onOpenMobile) {
        onOpenMobile();
      } else {
        onToggleCollapse();
      }
    } else {
      onToggleCollapse();
    }
  };

  return (
    <>
      {/* Botón flotante único ">" fijo en pantalla cuando el panel lateral está oculto */}
      <button
        type="button"
        onClick={handleShowSidebar}
        aria-label="Mostrar menú lateral"
        title="Mostrar menú lateral"
        className={`fixed left-0 top-1/2 -translate-y-1/2 z-50 flex items-center justify-center w-8 h-14 sm:w-9 sm:h-16 rounded-r-2xl bg-slate-900/95 hover:bg-teal-700 active:scale-95 text-teal-300 hover:text-white shadow-xl border border-l-0 border-teal-500/40 cursor-pointer transition-all duration-200 touch-manipulation ${
          isMobileOpen
            ? "opacity-0 pointer-events-none -translate-x-full"
            : isCollapsed
            ? "opacity-100 translate-x-0"
            : "lg:opacity-0 lg:pointer-events-none lg:-translate-x-full opacity-100 translate-x-0"
        }`}
      >
        <ChevronRight className="w-5 h-5 stroke-[2.75]" />
      </button>

      {/* Fondo oscuro en móvil/tablet cuando el menú está abierto */}
      {isMobileOpen && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-[2px] z-40 lg:hidden transition-opacity duration-200"
          aria-hidden="true"
        />
      )}

      {/* Panel Lateral Fijo en Pantalla (siempre visible al hacer scroll hacia abajo) */}
      <aside
        className={`fixed top-0 left-0 bottom-0 h-dvh w-64 max-w-[82vw] z-50 flex flex-col bg-slate-900 text-slate-100 select-none shadow-2xl border-r border-slate-800 transform-gpu will-change-transform transition-transform duration-200 ease-out ${
          isMobileOpen
            ? "translate-x-0"
            : isCollapsed
            ? "-translate-x-full pointer-events-none"
            : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {/* Encabezado del Panel Lateral con botón "<" para ocultar */}
        <div className="px-4 py-4 border-b border-slate-800/80 flex items-center justify-between gap-2.5 shrink-0 bg-slate-950/40">
          <div
            onClick={() => handleTabClick("dashboard")}
            className="flex items-center gap-3 cursor-pointer min-w-0 group"
          >
            <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-teal-500 to-emerald-600 p-1.5 shadow-md shadow-teal-900/30 flex items-center justify-center shrink-0 border border-teal-300/30">
              <img
                src={APP_ICON_PATH}
                alt="Logo"
                className="w-full h-full object-contain"
              />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-extrabold text-white tracking-tight truncate leading-tight group-hover:text-teal-300 transition-colors">
                {farmaciaNombre}
              </h2>
              <p className="text-[10px] font-semibold text-slate-400 truncate mt-0.5">
                {farmaciaSubtitulo}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleHideSidebar}
            className="p-2 text-slate-300 hover:text-white hover:bg-slate-800 active:scale-95 rounded-xl transition cursor-pointer border border-slate-700/80 shrink-0 touch-manipulation"
            title="Ocultar menú lateral"
            aria-label="Ocultar menú lateral"
          >
            <ChevronLeft className="w-4 h-4 text-teal-400 stroke-[2.5]" />
          </button>
        </div>

        {/* Catálogo Activo */}
        {activeCatalogName && (
          <div className="mx-3 mt-3 px-3 py-2 rounded-xl bg-teal-950/50 border border-teal-800/40 text-[11px] text-teal-200 flex items-center gap-2 shrink-0">
            <Building2 className="w-3.5 h-3.5 text-teal-400 shrink-0" />
            <div className="min-w-0">
              <span className="block text-[9px] uppercase tracking-wider text-teal-400/80 font-bold">
                Catálogo Activo:
              </span>
              <span className="font-bold text-white truncate block">
                {activeCatalogName}
              </span>
            </div>
          </div>
        )}

        {/* Lista de Módulos con scroll independiente */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-3 space-y-1.5">
          <div className="px-2 pb-1 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
            Módulos del Sistema
          </div>

          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id && !showBlocks && !showOrder;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleTabClick(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl font-bold text-xs transition-colors duration-100 cursor-pointer text-left relative group touch-manipulation ${
                  isActive
                    ? "bg-teal-600 text-white shadow-md shadow-teal-950/30 font-extrabold"
                    : "text-slate-300 hover:bg-slate-800/75 hover:text-white active:bg-slate-800"
                }`}
              >
                <div
                  className={`p-1.5 rounded-xl transition-colors ${
                    isActive
                      ? "bg-white/20 text-white"
                      : "bg-slate-800/70 text-slate-400 group-hover:text-teal-300"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="truncate">{item.label}</span>
                    {item.badge && (
                      <span
                        className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${
                          item.badgeColor || "bg-teal-900/50 text-teal-300 border-teal-700/50"
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </div>
                  {item.sublabel && (
                    <span
                      className={`block text-[10px] font-normal truncate mt-0.5 ${
                        isActive ? "text-teal-100/90" : "text-slate-400"
                      }`}
                    >
                      {item.sublabel}
                    </span>
                  )}
                </div>

                {isActive && (
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-white rounded-l-full" />
                )}
              </button>
            );
          })}

          {/* Herramientas de Suministros (Bloques y Pedido) */}
          {enabledModules.includes("inventory") && (onToggleBlocks || onOpenOrder) && (
            <div className="pt-2 mt-2 border-t border-slate-800/80 space-y-1.5">
              <div className="px-2 pb-0.5 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                Herramientas Almacén
              </div>

              {onToggleBlocks && (
                <button
                  type="button"
                  onClick={() => {
                    if (isMobileOpen) onCloseMobile();
                    onToggleBlocks();
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-2xl font-bold text-xs transition-colors cursor-pointer relative group touch-manipulation ${
                    showBlocks && activeTab === "inventory"
                      ? "bg-teal-700/80 text-white border border-teal-400/40 shadow-sm"
                      : "text-slate-300 hover:bg-slate-800/70 hover:text-white"
                  }`}
                >
                  <div className="p-1.5 rounded-xl bg-slate-800/70 text-teal-300">
                    <Layers className="w-4 h-4 shrink-0" />
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <span className="font-extrabold truncate block">Bloques</span>
                    <span className="block text-[10px] text-slate-400 truncate font-normal">
                      Módulos de ubicación
                    </span>
                  </div>
                </button>
              )}

              {onOpenOrder && (
                <button
                  type="button"
                  onClick={() => {
                    if (isMobileOpen) onCloseMobile();
                    onOpenOrder();
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-2xl font-bold text-xs transition-colors cursor-pointer relative group touch-manipulation ${
                    showOrder && activeTab === "inventory"
                      ? "bg-amber-500 text-slate-950 font-extrabold shadow-sm"
                      : orderCount > 0
                      ? "bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30"
                      : "text-slate-300 hover:bg-slate-800/70 hover:text-white"
                  }`}
                >
                  <div
                    className={`p-1.5 rounded-xl ${
                      showOrder && activeTab === "inventory"
                        ? "bg-slate-950/20 text-slate-950"
                        : orderCount > 0
                        ? "bg-amber-500/20 text-amber-200"
                        : "bg-slate-800/70 text-amber-300"
                    }`}
                  >
                    <ShoppingCart className="w-4 h-4 shrink-0" />
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-center justify-between">
                      <span className="font-extrabold truncate">Pedido</span>
                      {orderCount > 0 && (
                        <span className="bg-amber-400 text-slate-950 font-black text-[10px] px-2 py-0.5 rounded-full">
                          {orderCount}
                        </span>
                      )}
                    </div>
                    <span
                      className={`block text-[10px] truncate font-normal ${
                        showOrder && activeTab === "inventory" ? "text-slate-900" : "text-slate-400"
                      }`}
                    >
                      {orderCount > 0 ? "Productos en preparación" : "Orden de pedido"}
                    </span>
                  </div>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Pie del Panel Lateral: Usuario, Sonido y Cerrar Sesión */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/60 shrink-0 space-y-2.5">
          {/* Botón directo de instalación en el menú lateral */}
          <PWAInstallButton variant="sidebar" />

          <div className="flex items-center gap-2.5 p-2 rounded-2xl bg-slate-800/40 border border-slate-800">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-teal-600 to-emerald-500 flex items-center justify-center font-black text-white text-xs shrink-0">
              {currentUser.nombre.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-extrabold text-white truncate leading-tight">
                {currentUser.nombre}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[9px] font-bold uppercase tracking-wider text-teal-400 bg-teal-950/80 px-1.5 py-0.2 rounded-md border border-teal-800/50">
                  {currentUser.rol}
                </span>
                <span className="text-[10px] text-slate-400 truncate">
                  {currentUser.departamento}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-1.5">
            <button
              type="button"
              onClick={onToggleMute}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition cursor-pointer border border-transparent hover:border-slate-700 text-xs flex items-center justify-center shrink-0 touch-manipulation"
              title={isMuted ? "Activar Sonidos" : "Silenciar"}
              aria-label={isMuted ? "Activar Sonidos" : "Silenciar"}
            >
              {isMuted ? (
                <VolumeX className="w-4 h-4 text-rose-400" />
              ) : (
                <Volume2 className="w-4 h-4 text-emerald-400" />
              )}
            </button>

            <button
              type="button"
              onClick={onLogout}
              className="flex-1 flex items-center justify-center gap-2 p-2 text-rose-300 hover:text-white hover:bg-rose-600/90 rounded-xl transition cursor-pointer text-xs font-bold border border-rose-500/20 hover:border-transparent touch-manipulation"
              title="Cerrar Sesión"
            >
              <LogOut className="w-4 h-4" />
              <span>Cerrar Sesión</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

export default memo(Sidebar);
