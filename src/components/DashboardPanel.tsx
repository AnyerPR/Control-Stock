import React, { useState, useEffect, useMemo } from "react";
import { query, orderBy, limit, getDocs, getDoc } from "firebase/firestore";
import { tenantCollection, tenantDoc } from "../firebase";
import {
  Producto,
  Usuario,
  Catalogo,
  Solicitud,
  Movimiento,
  FacturaVenta,
  getEnabledModules,
  getUserAvailableCatalogos,
  isCatalogAllowedForUser,
  matchesCatalog
} from "../types";
import { playSound } from "../utils/audio";
import { isLotExpiredWithStock } from "../utils/inventoryStatus";
import {
  LayoutDashboard,
  Package,
  ClipboardList,
  History,
  Receipt,
  Users,
  Settings,
  FileSpreadsheet,
  TriangleAlert,
  Clock,
  CheckCircle2,
  TrendingDown,
  AlertCircle,
  Layers,
  Search,
  ArrowRight,
  RefreshCw,
  DollarSign,
  Activity,
  BarChart3,
  PieChart,
  ShieldCheck,
  Sparkles,
  Building2
} from "lucide-react";

interface DashboardPanelProps {
  currentUser: Usuario;
  products: Producto[];
  catalogos: Catalogo[];
  activeCatalogId: string;
  activePeriod: string;
  onSelectCatalog: (catalogId: string) => void;
  onNavigateTab: (tabId: string) => void;
  onNavigateInventoryFilter: (filterKey: string, catalogId?: string) => void;
  onOpenProductDetail: (productCode: string) => void;
}

export default function DashboardPanel({
  currentUser,
  products,
  catalogos,
  activeCatalogId,
  activePeriod,
  onSelectCatalog,
  onNavigateTab,
  onNavigateInventoryFilter,
  onOpenProductDetail
}: DashboardPanelProps) {
  const enabledModules = useMemo(() => getEnabledModules(currentUser), [currentUser]);
  const availableCatalogos = useMemo(
    () => getUserAvailableCatalogos(currentUser, catalogos),
    [currentUser, catalogos]
  );

  const hasInventoryAccess = enabledModules.includes("inventory");
  const hasSolicitudesAccess = enabledModules.includes("solicitudes");
  const hasHistorialAccess = enabledModules.includes("historial");
  const hasVentaAccess = enabledModules.includes("venta");
  const hasCargaMasivaAccess = enabledModules.includes("carga_masiva");
  const hasUsuariosAccess = enabledModules.includes("usuarios");
  const hasConfigAccess = enabledModules.includes("configuracion");

  // Interactive filter inside Dashboard: "todos" (all authorized catalogs) or a specific catalog ID
  const [dashCatalogFilter, setDashCatalogFilter] = useState<string>("todos");
  const [dashAlertFilter, setDashAlertFilter] = useState<
    "criticos" | "vencido" | "proximo" | "bajo" | "fisico" | "sinStock"
  >("criticos");
  const [dashSearch, setDashSearch] = useState<string>("");
  const [periodScope, setPeriodScope] = useState<"actual" | "todos">("actual");

  // Lightweight on-demand data for Solicitudes, Movimientos, and Ventas (loaded only if user has permissions)
  const [solicitudesList, setSolicitudesList] = useState<Solicitud[]>([]);
  const [movimientosList, setMovimientosList] = useState<Movimiento[]>([]);
  const [facturasVentaList, setFacturasVentaList] = useState<FacturaVenta[]>([]);
  const [loadingExtra, setLoadingExtra] = useState<boolean>(false);

  // Ensure dashCatalogFilter stays valid if user's availableCatalogos change
  useEffect(() => {
    if (
      dashCatalogFilter !== "todos" &&
      !availableCatalogos.some((c) => c.id === dashCatalogFilter)
    ) {
      setDashCatalogFilter("todos");
    }
  }, [availableCatalogos, dashCatalogFilter]);

  const fetchDashboardAuxiliaryData = async () => {
    const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";
    setLoadingExtra(true);

    try {
      if (isLocalFileMode) {
        if (hasSolicitudesAccess) {
          const rawSol = localStorage.getItem("offline_solicitudes");
          if (rawSol) {
            try {
              setSolicitudesList(JSON.parse(rawSol));
            } catch {}
          }
        }
        if (hasHistorialAccess || hasInventoryAccess) {
          const rawMov = localStorage.getItem("offline_movimientos");
          if (rawMov) {
            try {
              setMovimientosList(JSON.parse(rawMov));
            } catch {}
          }
        }
        if (hasVentaAccess) {
          const rawFac = localStorage.getItem("offline_facturas_venta");
          if (rawFac) {
            try {
              setFacturasVentaList(JSON.parse(rawFac));
            } catch {}
          }
        }
        setLoadingExtra(false);
        return;
      }

      const promises: Promise<void>[] = [];

      if (hasSolicitudesAccess) {
        promises.push(
          getDocs(query(tenantCollection("solicitudes"), orderBy("timestamp", "desc"), limit(250)))
            .then((snap) => {
              const list: Solicitud[] = [];
              snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<Solicitud, "id">) }));
              setSolicitudesList(list);
            })
            .catch(() => {})
        );
      }

      if (hasHistorialAccess || hasInventoryAccess) {
        promises.push(
          getDocs(query(tenantCollection("movimientos"), orderBy("timestamp", "desc"), limit(250)))
            .then((snap) => {
              const list: Movimiento[] = [];
              snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Movimiento) }));
              setMovimientosList(list);
            })
            .catch(() => {})
        );
      }

      if (hasVentaAccess) {
        promises.push(
          getDoc(tenantDoc("configuracion", "registro_ventas"))
            .then((snap) => {
              if (snap.exists()) {
                const data = snap.data();
                const list = Array.isArray(data?.facturas)
                  ? data.facturas
                  : Array.isArray(data?.items)
                  ? data.items
                  : [];
                setFacturasVentaList(list as FacturaVenta[]);
              } else {
                setFacturasVentaList([]);
              }
            })
            .catch(() => {})
        );
      }

      await Promise.all(promises);
    } finally {
      setLoadingExtra(false);
    }
  };

  useEffect(() => {
    fetchDashboardAuxiliaryData();
  }, [hasSolicitudesAccess, hasHistorialAccess, hasInventoryAccess, hasVentaAccess, currentUser.id, currentUser.farmaciaId]);

  // Allowed catalog IDs set for fast O(1) checks
  const allowedCatalogIds = useMemo(
    () => new Set(availableCatalogos.map((c) => c.id)),
    [availableCatalogos]
  );

  // Filter products to only those in authorized catalogs (and selected dashboard catalog filter)
  const scopedProducts = useMemo(() => {
    return products.filter((p) => {
      const catId = p.catalogId || "default-cat";
      if (!allowedCatalogIds.has(catId) && !isCatalogAllowedForUser(currentUser, catId, catalogos)) {
        return false;
      }
      if (dashCatalogFilter !== "todos" && !matchesCatalog(catId, dashCatalogFilter, catalogos)) {
        return false;
      }
      return true;
    });
  }, [products, allowedCatalogIds, currentUser, catalogos, dashCatalogFilter]);

  // Inventory metrics & health breakdown
  const inventoryStats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();

    let totalSkus = scopedProducts.length;
    let totalLotes = 0;
    let totalUnitsSys = 0;
    let totalUnitsPhys = 0;
    let totalValueRD = 0;
    let verifiedCount = 0;

    let expiredProductsCount = 0;
    let soonToExpireCount = 0; // <= 30 days
    let nextToExpireCount = 0; // 31 - 90 days
    let optimalProductsCount = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;
    let physicalMismatchCount = 0;

    const criticalItems: Array<{
      producto: Producto;
      totalSys: number;
      totalPhys: number;
      earliestDays: number;
      hasExpired: boolean;
      hasSoon: boolean;
      lowStock: boolean;
      noStock: boolean;
      mismatch: boolean;
      catalogName: string;
    }> = [];

    const catalogBreakdownMap = new Map<
      string,
      { id: string; nombre: string; skus: number; unitsSys: number; unitsPhys: number; valueRD: number }
    >();

    for (const cat of availableCatalogos) {
      catalogBreakdownMap.set(cat.id, {
        id: cat.id,
        nombre: cat.nombre,
        skus: 0,
        unitsSys: 0,
        unitsPhys: 0,
        valueRD: 0
      });
    }

    for (const p of scopedProducts) {
      const catId = p.catalogId || "default-cat";
      let catEntry = catalogBreakdownMap.get(catId);
      if (!catEntry) {
        const matchedCat = availableCatalogos.find((c) => matchesCatalog(catId, c.id, catalogos));
        if (matchedCat) {
          catEntry = catalogBreakdownMap.get(matchedCat.id);
        }
      }
      if (catEntry) {
        catEntry.skus += 1;
      }

      if (p.verificado) verifiedCount += 1;

      let pSys = 0;
      let pPhys = 0;
      let pValue = 0;
      let pExpired = false;
      let pSoon = false;
      let pNext = false;
      let pMismatch = false;
      let earliestDays = Infinity;

      for (const l of p.lotes || []) {
        totalLotes += 1;
        const cSys = Number(l.cantidad || 0);
        const cPhys = Number(l.cantidadF || 0);
        const price = Number(l.precio || 0);

        pSys += cSys;
        pPhys += cPhys;
        pValue += cSys * price;

        if (cSys !== cPhys) pMismatch = true;

        if (l.fechaVencimiento) {
          const expMs = new Date(l.fechaVencimiento + "T00:00:00").getTime();
          if (!isNaN(expMs)) {
            const days = Math.ceil((expMs - todayMs) / 86400000);
            if (cSys > 0 && days < earliestDays) earliestDays = days;
            if (days < 0) {
              if (isLotExpiredWithStock(l, today)) pExpired = true;
            } else if (cSys > 0 && days <= 30) pSoon = true;
            else if (cSys > 0 && days <= 90) pNext = true;
          }
        }
      }

      totalUnitsSys += pSys;
      totalUnitsPhys += pPhys;
      totalValueRD += pValue;

      if (catEntry) {
        catEntry.unitsSys += pSys;
        catEntry.unitsPhys += pPhys;
        catEntry.valueRD += pValue;
      }

      const isOut = pSys === 0 && pPhys === 0;
      const isLow = pSys > 0 && pSys < 20;

      if (pExpired) expiredProductsCount += 1;
      else if (pSoon) soonToExpireCount += 1;
      else if (pNext) nextToExpireCount += 1;
      else if (!isOut && !isLow) optimalProductsCount += 1;

      if (isOut) outOfStockCount += 1;
      if (isLow) lowStockCount += 1;
      if (pMismatch) physicalMismatchCount += 1;

      if (pExpired || pSoon || isLow || isOut || pMismatch) {
        criticalItems.push({
          producto: p,
          totalSys: pSys,
          totalPhys: pPhys,
          earliestDays,
          hasExpired: pExpired,
          hasSoon: pSoon,
          lowStock: isLow,
          noStock: isOut,
          mismatch: pMismatch,
          catalogName: catEntry?.nombre || "General"
        });
      }
    }

    criticalItems.sort((a, b) => {
      if (a.hasExpired !== b.hasExpired) return a.hasExpired ? -1 : 1;
      if (a.hasSoon !== b.hasSoon) return a.hasSoon ? -1 : 1;
      if (a.earliestDays !== b.earliestDays) return a.earliestDays - b.earliestDays;
      return a.totalSys - b.totalSys;
    });

    const verificationPct = totalSkus > 0 ? Math.round((verifiedCount / totalSkus) * 100) : 0;
    const accuracyPct =
      totalSkus > 0 ? Math.round(((totalSkus - physicalMismatchCount) / totalSkus) * 100) : 100;

    return {
      totalSkus,
      totalLotes,
      totalUnitsSys,
      totalUnitsPhys,
      totalValueRD,
      verifiedCount,
      verificationPct,
      accuracyPct,
      expiredProductsCount,
      soonToExpireCount,
      nextToExpireCount,
      optimalProductsCount,
      lowStockCount,
      outOfStockCount,
      physicalMismatchCount,
      criticalItems,
      catalogBreakdown: Array.from(catalogBreakdownMap.values())
    };
  }, [scopedProducts, availableCatalogos]);

  // Filtered critical items for the interactive table
  const filteredCriticalItems = useMemo(() => {
    const q = dashSearch.trim().toLowerCase();
    return inventoryStats.criticalItems
      .filter((item) => {
        if (dashAlertFilter === "vencido" && !item.hasExpired) return false;
        if (dashAlertFilter === "proximo" && !item.hasSoon) return false;
        if (dashAlertFilter === "bajo" && !item.lowStock) return false;
        if (dashAlertFilter === "fisico" && !item.mismatch) return false;
        if (dashAlertFilter === "sinStock" && !item.noStock) return false;

        if (q) {
          return (
            item.producto.nombre.toLowerCase().includes(q) ||
            item.producto.codigo.toLowerCase().includes(q) ||
            (item.producto.descripcion || "").toLowerCase().includes(q)
          );
        }
        return true;
      })
      .slice(0, 12);
  }, [inventoryStats.criticalItems, dashAlertFilter, dashSearch]);

  // Solicitudes stats (filtered according to user permissions & department)
  const solicitudesStats = useMemo(() => {
    const canSeeAll =
      currentUser.rol === "Administrador" ||
      currentUser.departamento === "Almacén y Suministro" ||
      currentUser.departamento === "Farmacia";

    const accessible = solicitudesList.filter((sol) => {
      const solCatId = sol.catalogId || "default-cat";
      if (!canSeeAll && !allowedCatalogIds.has(solCatId) && !isCatalogAllowedForUser(currentUser, solCatId, catalogos)) {
        return false;
      }
      if (dashCatalogFilter !== "todos" && !matchesCatalog(solCatId, dashCatalogFilter, catalogos)) {
        return false;
      }
      if (periodScope === "actual" && sol.periodo && sol.periodo !== activePeriod) {
        return false;
      }
      if (!canSeeAll) {
        const isOwnCreator =
          sol.usuarioCreador.toLowerCase().includes(currentUser.usuario.toLowerCase()) ||
          sol.usuarioCreador.toLowerCase().includes(currentUser.nombre.toLowerCase());
        const isOwnDept = sol.departamento === currentUser.departamento;
        const isAllowedDeptCatalog =
          (currentUser.departamento === "Laboratorio" && matchesCatalog(solCatId, "laboratorio", catalogos)) ||
          (currentUser.departamento === "Odontología" && matchesCatalog(solCatId, "odontologia", catalogos));
        if (!isOwnCreator && !isOwnDept && !isAllowedDeptCatalog) return false;
      }
      return true;
    });

    let pendientes = 0;
    let enProceso = 0;
    let entregadas = 0;
    let rechazadas = 0;
    let altaPrioridad = 0;

    const deptCounts = new Map<string, number>();

    for (const s of accessible) {
      if (s.estado === "Pendiente") pendientes += 1;
      else if (s.estado === "Entregada" || s.estado === "Completada") entregadas += 1;
      else if (s.estado === "Rechazada" || s.estado === "Cancelada") rechazadas += 1;
      else enProceso += 1;

      if (s.prioridad === "Alta" && s.estado !== "Entregada" && s.estado !== "Cancelada") {
        altaPrioridad += 1;
      }

      const d = s.departamento || "General";
      deptCounts.set(d, (deptCounts.get(d) || 0) + 1);
    }

    const topDepts = Array.from(deptCounts.entries())
      .map(([nombre, count]) => ({ nombre, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      total: accessible.length,
      pendientes,
      enProceso,
      entregadas,
      rechazadas,
      altaPrioridad,
      topDepts,
      recent: accessible.slice(0, 6)
    };
  }, [
    solicitudesList,
    currentUser,
    allowedCatalogIds,
    catalogos,
    dashCatalogFilter,
    periodScope,
    activePeriod
  ]);

  // Movimientos stats (filtered by authorized catalogs)
  const movimientosStats = useMemo(() => {
    const accessible = movimientosList.filter((m) => {
      const catId = m.catalogId || "default-cat";
      if (!allowedCatalogIds.has(catId) && !isCatalogAllowedForUser(currentUser, catId, catalogos)) {
        return false;
      }
      if (dashCatalogFilter !== "todos" && !matchesCatalog(catId, dashCatalogFilter, catalogos)) {
        return false;
      }
      return true;
    });

    let entradasCount = 0;
    let salidasCount = 0;
    let ajustesCount = 0;
    let entradasUnidades = 0;
    let salidasUnidades = 0;

    for (const m of accessible) {
      const qty = Number(m.cantidad || 0);
      if (m.tipoMovimiento === "Entrada") {
        entradasCount += 1;
        entradasUnidades += qty;
      } else if (m.tipoMovimiento === "Salida") {
        salidasCount += 1;
        salidasUnidades += qty;
      } else {
        ajustesCount += 1;
      }
    }

    return {
      total: accessible.length,
      entradasCount,
      salidasCount,
      ajustesCount,
      entradasUnidades,
      salidasUnidades,
      recent: accessible.slice(0, 6)
    };
  }, [movimientosList, allowedCatalogIds, currentUser, catalogos, dashCatalogFilter]);

  // Ventas stats (ONLY computed and rendered when hasVentaAccess is true)
  const ventasStats = useMemo(() => {
    if (!hasVentaAccess) {
      return { totalFacturas: 0, totalFacturado: 0, totalItbis: 0, totalUnidades: 0, porConcepto: [] };
    }
    const filtered = facturasVentaList.filter((f) => {
      const catId = f.catalogId || "default-cat";
      if (!allowedCatalogIds.has(catId) && !isCatalogAllowedForUser(currentUser, catId, catalogos)) return false;
      if (dashCatalogFilter !== "todos" && !matchesCatalog(catId, dashCatalogFilter, catalogos)) return false;
      return true;
    });

    let totalFacturado = 0;
    let totalItbis = 0;
    let totalUnidades = 0;
    const conceptoMap = new Map<string, { concepto: string; count: number; monto: number }>();

    for (const f of filtered) {
      const monto = Number(f.totalMonto || 0);
      const itbis = Number(f.itbisMonto || 0);
      const unds = Number(f.totalUnidades || 0);
      totalFacturado += monto;
      totalItbis += itbis;
      totalUnidades += unds;

      const conc = f.concepto || "Venta";
      const prev = conceptoMap.get(conc);
      if (prev) {
        prev.count += 1;
        prev.monto += monto;
      } else {
        conceptoMap.set(conc, { concepto: conc, count: 1, monto });
      }
    }

    return {
      totalFacturas: filtered.length,
      totalFacturado,
      totalItbis,
      totalUnidades,
      porConcepto: Array.from(conceptoMap.values()).sort((a, b) => b.monto - a.monto)
    };
  }, [hasVentaAccess, facturasVentaList, allowedCatalogIds, dashCatalogFilter]);

  // Authorized Quick Navigation Modules (strictly filtered by enabledModules)
  const authorizedModuleCards = useMemo(() => {
    const cards: Array<{
      id: string;
      title: string;
      subtitle: string;
      badge: string;
      icon: React.ReactNode;
      colorClass: string;
    }> = [];

    if (hasInventoryAccess) {
      cards.push({
        id: "inventory",
        title: "Suministros",
        subtitle: "Control de stock físico y sistema",
        badge: `${inventoryStats.totalSkus} ítems`,
        icon: <Package className="w-5 h-5" />,
        colorClass: "bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100/80"
      });
    }

    if (hasSolicitudesAccess) {
      cards.push({
        id: "solicitudes",
        title: currentUser.rol === "Administrador" ? "Órdenes de Servicio" : "Mis Solicitudes",
        subtitle: "Pedidos y despachos por área",
        badge: `${solicitudesStats.pendientes} pend.`,
        icon: <ClipboardList className="w-5 h-5" />,
        colorClass: "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100/80"
      });
    }

    if (hasVentaAccess) {
      cards.push({
        id: "venta",
        title: "Venta y Facturación",
        subtitle: "Emisión de facturas y recibos PDF",
        badge: `${ventasStats.totalFacturas} fact.`,
        icon: <Receipt className="w-5 h-5" />,
        colorClass: "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100/80"
      });
    }

    if (hasHistorialAccess) {
      cards.push({
        id: "historial",
        title: "Historial de Movs",
        subtitle: "Auditoría de entradas y salidas",
        badge: `${movimientosStats.total} reg.`,
        icon: <History className="w-5 h-5" />,
        colorClass: "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100/80"
      });
    }

    if (hasCargaMasivaAccess) {
      cards.push({
        id: "carga_masiva",
        title: "Carga Masiva",
        subtitle: "Importación rápida por lotes",
        badge: "Excel / CSV",
        icon: <FileSpreadsheet className="w-5 h-5" />,
        colorClass: "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100/80"
      });
    }

    if (hasUsuariosAccess) {
      cards.push({
        id: "usuarios",
        title: "Personal y Permisos",
        subtitle: "Gestión de usuarios y accesos",
        badge: "Seguridad",
        icon: <Users className="w-5 h-5" />,
        colorClass: "bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100/80"
      });
    }

    if (hasConfigAccess) {
      cards.push({
        id: "configuracion",
        title: "Configuración",
        subtitle: "Catálogos, institución y cierres",
        badge: activePeriod,
        icon: <Settings className="w-5 h-5" />,
        colorClass: "bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200/80"
      });
    }

    return cards;
  }, [
    hasInventoryAccess,
    hasSolicitudesAccess,
    hasVentaAccess,
    hasHistorialAccess,
    hasCargaMasivaAccess,
    hasUsuariosAccess,
    hasConfigAccess,
    inventoryStats.totalSkus,
    solicitudesStats.pendientes,
    ventasStats.totalFacturas,
    movimientosStats.total,
    currentUser.rol,
    activePeriod
  ]);

  return (
    <div className="space-y-6 anim-card-in">
      {/* =====================================================================
          1. CABECERA EJECUTIVA E INTERACTIVA DEL DASHBOARD
         ===================================================================== */}
      <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 shadow-xs relative overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-50 border border-teal-200 text-teal-800 text-[11px] font-extrabold uppercase tracking-wider">
              <LayoutDashboard className="w-3.5 h-3.5 text-teal-600" />
              <span>Panel de Control Interactivo • {activePeriod}</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              Hola, {currentUser.nombre}
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 font-medium flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 font-bold text-slate-700">
                <ShieldCheck className="w-4 h-4 text-teal-600" />
                Rol: {currentUser.rol}
              </span>
              <span>•</span>
              <span className="inline-flex items-center gap-1 font-bold text-slate-700">
                <Building2 className="w-4 h-4 text-teal-600" />
                Área: {currentUser.departamento || "Almacén y Suministro"}
              </span>
              <span>•</span>
              <span className="text-teal-700 font-extrabold">
                {availableCatalogos.length}{" "}
                {availableCatalogos.length === 1 ? "catálogo habilitado" : "catálogos habilitados"}
              </span>
            </p>
          </div>

          {/* Controles Interactivos de Catálogo y Actualización */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex flex-col bg-slate-50 border border-slate-200/90 rounded-2xl px-3.5 py-2 min-w-[220px]">
              <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider mb-0.5">
                Filtrar Estadísticas por Catálogo
              </label>
              <select
                value={dashCatalogFilter}
                onChange={(e) => {
                  const val = e.target.value;
                  setDashCatalogFilter(val);
                  if (val !== "todos") {
                    onSelectCatalog(val);
                  }
                  playSound("click");
                }}
                className="bg-transparent text-xs sm:text-sm font-extrabold text-slate-800 outline-none cursor-pointer"
              >
                <option value="todos">
                  📚 Todos mis catálogos ({availableCatalogos.length})
                </option>
                {availableCatalogos.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    📦 {cat.nombre}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => {
                fetchDashboardAuxiliaryData();
                playSound("click");
              }}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 active:scale-95 transition text-xs font-extrabold text-slate-700 cursor-pointer shadow-2xs"
              title="Actualizar indicadores en tiempo real"
            >
              <RefreshCw className={`w-4 h-4 text-teal-600 ${loadingExtra ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Actualizar</span>
            </button>
          </div>
        </div>

        {/* Chips de Catálogos Asignados al Usuario */}
        <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider mr-1">
            Catálogos Autorizados:
          </span>
          <button
            type="button"
            onClick={() => {
              setDashCatalogFilter("todos");
              playSound("click");
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition cursor-pointer border ${
              dashCatalogFilter === "todos"
                ? "bg-teal-800 text-white border-teal-800 shadow-2xs"
                : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
            }`}
          >
            Todos ({availableCatalogos.length})
          </button>
          {availableCatalogos.map((cat) => {
            const isSelected = dashCatalogFilter === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  setDashCatalogFilter(cat.id);
                  onSelectCatalog(cat.id);
                  playSound("click");
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition cursor-pointer border flex items-center gap-1.5 ${
                  isSelected
                    ? "bg-teal-700 text-white border-teal-700 shadow-2xs"
                    : "bg-white text-slate-700 border-slate-200 hover:border-teal-300 hover:bg-teal-50/40"
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>{cat.nombre}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* =====================================================================
          2. ACCESOS RÁPIDOS A MÓDULOS AUTORIZADOS (OCULTA NO AUTORIZADOS)
         ===================================================================== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {authorizedModuleCards.map((mod) => (
          <button
            key={mod.id}
            type="button"
            onClick={() => {
              onNavigateTab(mod.id);
              playSound("click");
            }}
            className={`card-tap text-left p-4 rounded-2xl border transition flex items-start justify-between gap-3 cursor-pointer ${mod.colorClass}`}
          >
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-black text-sm tracking-tight truncate">{mod.title}</span>
              </div>
              <p className="text-[11px] font-semibold opacity-80 line-clamp-1">{mod.subtitle}</p>
              <span className="inline-block mt-1.5 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-lg bg-white/80 border border-current/15">
                {mod.badge}
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-white/80 shadow-2xs shrink-0">
              {mod.icon}
            </div>
          </button>
        ))}
      </div>

      {/* =====================================================================
          3. SECCIÓN DE INVENTARIO (SOLO SI EL USUARIO TIENE PERMISO "inventory")
         ===================================================================== */}
      {hasInventoryAccess && (
        <>
          {/* KPIs Principales de Inventario */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* KPI 1: Total Suministros y Lotes */}
            <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-2xs flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                  Suministros Registrados
                </span>
                <div className="w-9 h-9 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700">
                  <Package className="w-4.5 h-4.5" />
                </div>
              </div>
              <div className="mt-3">
                <p className="text-2xl sm:text-3xl font-black text-slate-900 tabular-nums">
                  {inventoryStats.totalSkus.toLocaleString("es-DO")}
                </p>
                <p className="text-xs font-bold text-slate-500 mt-1 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-teal-600" />
                  <span>{inventoryStats.totalLotes.toLocaleString("es-DO")} lotes activos en total</span>
                </p>
              </div>
            </div>

            {/* KPI 2: Unidades Sistema vs Físico */}
            <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-2xs flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                  Existencias (Sistema / Físico)
                </span>
                <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700">
                  <Activity className="w-4.5 h-4.5" />
                </div>
              </div>
              <div className="mt-3">
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl sm:text-3xl font-black text-slate-900 tabular-nums">
                    {inventoryStats.totalUnitsSys.toLocaleString("es-DO")}
                  </p>
                  <span className="text-xs font-extrabold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-lg tabular-nums">
                    Fís: {inventoryStats.totalUnitsPhys.toLocaleString("es-DO")}
                  </span>
                </div>
                <p className="text-xs font-bold text-slate-500 mt-1">
                  Exactitud física:{" "}
                  <span className="text-emerald-700 font-black">{inventoryStats.accuracyPct}%</span> (
                  {inventoryStats.physicalMismatchCount} con diferencia)
                </p>
              </div>
            </div>

            {/* KPI 3: Valorización Estimada */}
            <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-2xs flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                  Valorización del Stock
                </span>
                <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700">
                  <DollarSign className="w-4.5 h-4.5" />
                </div>
              </div>
              <div className="mt-3">
                <p className="text-xl sm:text-2xl font-black text-emerald-800 tabular-nums truncate">
                  RD$ {inventoryStats.totalValueRD.toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="text-xs font-bold text-slate-500 mt-1">
                  Calculado sobre stock en sistema
                </p>
              </div>
            </div>

            {/* KPI 4: Progreso de Verificación */}
            <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-2xs flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                  Auditoría y Verificación
                </span>
                <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700">
                  <CheckCircle2 className="w-4.5 h-4.5" />
                </div>
              </div>
              <div className="mt-3 space-y-2">
                <div className="flex items-baseline justify-between">
                  <p className="text-2xl sm:text-3xl font-black text-slate-900 tabular-nums">
                    {inventoryStats.verificationPct}%
                  </p>
                  <span className="text-xs font-extrabold text-slate-500">
                    {inventoryStats.verifiedCount} / {inventoryStats.totalSkus} verif.
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200/60">
                  <div
                    className="h-full bg-emerald-600 rounded-full transition-all duration-500"
                    style={{ width: `${inventoryStats.verificationPct}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Gráficos Interactivos de Salud de Inventario y Distribución por Catálogo */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Columna Izquierda (7 cols): Semáforo / Salud del Stock con Navegación Directa */}
            <div className="lg:col-span-7 bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 shadow-2xs space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3.5">
                <div>
                  <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                    <PieChart className="w-5 h-5 text-teal-600" />
                    <span>Estado de Salud y Vencimientos del Stock</span>
                  </h3>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">
                    Haz clic en cualquier indicador para filtrar o abrir directamente esos suministros
                  </p>
                </div>
              </div>

              {/* Barra Visual Proporcional */}
              {inventoryStats.totalSkus > 0 && (
                <div className="space-y-2">
                  <div className="w-full h-4 rounded-xl overflow-hidden flex bg-slate-100 border border-slate-200/80 p-0.5 gap-0.5">
                    {inventoryStats.optimalProductsCount > 0 && (
                      <div
                        style={{
                          width: `${(inventoryStats.optimalProductsCount / inventoryStats.totalSkus) * 100}%`
                        }}
                        className="bg-emerald-500 h-full rounded-l-lg transition-all duration-500"
                        title={`Óptimos: ${inventoryStats.optimalProductsCount}`}
                      />
                    )}
                    {inventoryStats.nextToExpireCount > 0 && (
                      <div
                        style={{
                          width: `${(inventoryStats.nextToExpireCount / inventoryStats.totalSkus) * 100}%`
                        }}
                        className="bg-yellow-400 h-full transition-all duration-500"
                        title={`Próximos (31-90d): ${inventoryStats.nextToExpireCount}`}
                      />
                    )}
                    {inventoryStats.soonToExpireCount > 0 && (
                      <div
                        style={{
                          width: `${(inventoryStats.soonToExpireCount / inventoryStats.totalSkus) * 100}%`
                        }}
                        className="bg-amber-500 h-full transition-all duration-500"
                        title={`Por vencer (≤30d): ${inventoryStats.soonToExpireCount}`}
                      />
                    )}
                    {inventoryStats.expiredProductsCount > 0 && (
                      <div
                        style={{
                          width: `${(inventoryStats.expiredProductsCount / inventoryStats.totalSkus) * 100}%`
                        }}
                        className="bg-rose-600 h-full rounded-r-lg transition-all duration-500"
                        title={`Vencidos: ${inventoryStats.expiredProductsCount}`}
                      />
                    )}
                  </div>
                </div>
              )}

              {/* Tarjetas Interactivas de Alerta */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setDashAlertFilter("vencido");
                    playSound("click");
                  }}
                  onDoubleClick={() =>
                    onNavigateInventoryFilter(
                      "vencido",
                      dashCatalogFilter !== "todos" ? dashCatalogFilter : undefined
                    )
                  }
                  className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
                    dashAlertFilter === "vencido"
                      ? "bg-rose-50 border-rose-400 ring-2 ring-rose-500/20"
                      : "bg-rose-50/50 border-rose-200 hover:bg-rose-50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase text-rose-700 tracking-wider">
                      Lotes Vencidos
                    </span>
                    <TriangleAlert className="w-4 h-4 text-rose-600" />
                  </div>
                  <p className="text-2xl font-black text-rose-800 mt-1 tabular-nums">
                    {inventoryStats.expiredProductsCount}
                  </p>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigateInventoryFilter(
                        "vencido",
                        dashCatalogFilter !== "todos" ? dashCatalogFilter : undefined
                      );
                    }}
                    className="inline-flex items-center gap-1 text-[10px] font-extrabold text-rose-700 hover:underline mt-1"
                  >
                    Ver en catálogo <ArrowRight className="w-3 h-3" />
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setDashAlertFilter("proximo");
                    playSound("click");
                  }}
                  className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
                    dashAlertFilter === "proximo"
                      ? "bg-amber-50 border-amber-400 ring-2 ring-amber-500/20"
                      : "bg-amber-50/50 border-amber-200 hover:bg-amber-50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase text-amber-800 tracking-wider">
                      Por Vencer (≤30d)
                    </span>
                    <Clock className="w-4 h-4 text-amber-600" />
                  </div>
                  <p className="text-2xl font-black text-amber-900 mt-1 tabular-nums">
                    {inventoryStats.soonToExpireCount}
                  </p>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigateInventoryFilter(
                        "proximo",
                        dashCatalogFilter !== "todos" ? dashCatalogFilter : undefined
                      );
                    }}
                    className="inline-flex items-center gap-1 text-[10px] font-extrabold text-amber-800 hover:underline mt-1"
                  >
                    Ver en catálogo <ArrowRight className="w-3 h-3" />
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setDashAlertFilter("bajo");
                    playSound("click");
                  }}
                  className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
                    dashAlertFilter === "bajo"
                      ? "bg-orange-50 border-orange-400 ring-2 ring-orange-500/20"
                      : "bg-orange-50/50 border-orange-200 hover:bg-orange-50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase text-orange-800 tracking-wider">
                      Stock Bajo (&lt;20)
                    </span>
                    <TrendingDown className="w-4 h-4 text-orange-600" />
                  </div>
                  <p className="text-2xl font-black text-orange-900 mt-1 tabular-nums">
                    {inventoryStats.lowStockCount}
                  </p>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigateInventoryFilter(
                        "bajo",
                        dashCatalogFilter !== "todos" ? dashCatalogFilter : undefined
                      );
                    }}
                    className="inline-flex items-center gap-1 text-[10px] font-extrabold text-orange-800 hover:underline mt-1"
                  >
                    Ver en catálogo <ArrowRight className="w-3 h-3" />
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setDashAlertFilter("fisico");
                    playSound("click");
                  }}
                  className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
                    dashAlertFilter === "fisico"
                      ? "bg-indigo-50 border-indigo-400 ring-2 ring-indigo-500/20"
                      : "bg-indigo-50/50 border-indigo-200 hover:bg-indigo-50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase text-indigo-800 tracking-wider">
                      Diferencia Física
                    </span>
                    <AlertCircle className="w-4 h-4 text-indigo-600" />
                  </div>
                  <p className="text-2xl font-black text-indigo-900 mt-1 tabular-nums">
                    {inventoryStats.physicalMismatchCount}
                  </p>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigateInventoryFilter(
                        "fisico",
                        dashCatalogFilter !== "todos" ? dashCatalogFilter : undefined
                      );
                    }}
                    className="inline-flex items-center gap-1 text-[10px] font-extrabold text-indigo-800 hover:underline mt-1"
                  >
                    Ver en catálogo <ArrowRight className="w-3 h-3" />
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setDashAlertFilter("sinStock");
                    playSound("click");
                  }}
                  className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
                    dashAlertFilter === "sinStock"
                      ? "bg-slate-200 border-slate-400 ring-2 ring-slate-400/20"
                      : "bg-slate-50 border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase text-slate-700 tracking-wider">
                      Agotados (0 und)
                    </span>
                    <Package className="w-4 h-4 text-slate-500" />
                  </div>
                  <p className="text-2xl font-black text-slate-900 mt-1 tabular-nums">
                    {inventoryStats.outOfStockCount}
                  </p>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigateInventoryFilter(
                        "sinStock",
                        dashCatalogFilter !== "todos" ? dashCatalogFilter : undefined
                      );
                    }}
                    className="inline-flex items-center gap-1 text-[10px] font-extrabold text-slate-700 hover:underline mt-1"
                  >
                    Ver en catálogo <ArrowRight className="w-3 h-3" />
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    onNavigateInventoryFilter(
                      "todos",
                      dashCatalogFilter !== "todos" ? dashCatalogFilter : undefined
                    )
                  }
                  className="p-3.5 rounded-2xl border border-emerald-200 bg-emerald-50/50 hover:bg-emerald-50 text-left transition cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase text-emerald-800 tracking-wider">
                      Stock Óptimo
                    </span>
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  </div>
                  <p className="text-2xl font-black text-emerald-900 mt-1 tabular-nums">
                    {inventoryStats.optimalProductsCount}
                  </p>
                  <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-emerald-800 mt-1">
                    Abrir inventario <ArrowRight className="w-3 h-3" />
                  </span>
                </button>
              </div>
            </div>

            {/* Columna Derecha (5 cols): Distribución por Catálogo Autorizado */}
            <div className="lg:col-span-5 bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 shadow-2xs flex flex-col justify-between space-y-4">
              <div>
                <div className="border-b border-slate-100 pb-3.5">
                  <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-teal-600" />
                    <span>Distribución por Catálogo</span>
                  </h3>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">
                    Comparativa de insumos y existencias en tus catálogos
                  </p>
                </div>

                <div className="mt-4 space-y-3.5">
                  {inventoryStats.catalogBreakdown.map((cat) => {
                    const maxSkus = Math.max(
                      1,
                      ...inventoryStats.catalogBreakdown.map((c) => c.skus)
                    );
                    const pct = Math.round((cat.skus / maxSkus) * 100);
                    return (
                      <div
                        key={cat.id}
                        onClick={() => {
                          setDashCatalogFilter(cat.id === dashCatalogFilter ? "todos" : cat.id);
                          onSelectCatalog(cat.id);
                          playSound("click");
                        }}
                        className={`p-3.5 rounded-2xl border transition cursor-pointer ${
                          dashCatalogFilter === cat.id
                            ? "bg-teal-50/70 border-teal-400"
                            : "bg-slate-50/70 border-slate-200/80 hover:border-teal-300"
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs font-extrabold text-slate-800 mb-1.5">
                          <span className="truncate">{cat.nombre}</span>
                          <span className="text-teal-800 bg-white px-2 py-0.5 rounded-lg border border-slate-200 tabular-nums">
                            {cat.skus} insumos • {cat.unitsSys.toLocaleString("es-DO")} und.
                          </span>
                        </div>
                        <div className="w-full h-2 bg-slate-200/80 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-teal-600 rounded-full transition-all duration-500"
                            style={{ width: `${Math.max(6, pct)}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between mt-1.5 text-[10px] font-bold text-slate-500">
                          <span>Físico: {cat.unitsPhys.toLocaleString("es-DO")} und.</span>
                          <span>
                            RD${" "}
                            {cat.valueRD.toLocaleString("es-DO", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2
                            })}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-between items-center text-xs">
                <span className="font-bold text-slate-500">
                  Movimientos registrados: <strong className="text-slate-800">{movimientosStats.total}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => onNavigateTab("inventory")}
                  className="font-extrabold text-teal-700 hover:text-teal-800 inline-flex items-center gap-1 cursor-pointer"
                >
                  Ir a Suministros <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Tabla Interactiva de Suministros Críticos / Prioritarios */}
          <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 shadow-2xs space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-amber-500" />
                  <span>Atención Prioritaria de Inventario</span>
                </h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  Insumos con alertas de vencimiento, bajo stock o diferencias de conteo físico
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={dashSearch}
                    onChange={(e) => setDashSearch(e.target.value)}
                    placeholder="Buscar código o insumo..."
                    className="bg-slate-50 border border-slate-200 rounded-xl pl-8.5 pr-3 py-1.5 text-xs font-bold text-slate-800 outline-none focus:bg-white focus:border-teal-500"
                  />
                </div>
                {(["criticos", "vencido", "proximo", "bajo", "fisico", "sinStock"] as const).map(
                  (key) => {
                    const labels: Record<string, string> = {
                      criticos: "Todas las Alertas",
                      vencido: "Vencidos",
                      proximo: "≤30 días",
                      bajo: "Stock Bajo",
                      fisico: "Dif. Física",
                      sinStock: "Sin Stock"
                    };
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setDashAlertFilter(key);
                          playSound("click");
                        }}
                        className={`px-3 py-1.5 rounded-xl text-[11px] font-extrabold transition cursor-pointer border ${
                          dashAlertFilter === key
                            ? "bg-teal-800 text-white border-teal-800"
                            : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                        }`}
                      >
                        {labels[key]}
                      </button>
                    );
                  }
                )}
              </div>
            </div>

            {filteredCriticalItems.length === 0 ? (
              <div className="py-10 text-center text-slate-400">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
                <p className="text-sm font-bold text-slate-600">
                  No hay suministros críticos bajo este filtro
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  El inventario seleccionado se encuentra en estado óptimo.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-200/80 rounded-2xl">
                <table className="w-full text-left border-collapse min-w-[640px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase text-slate-500 tracking-wider">
                      <th className="py-3 px-4">Código / Suministro</th>
                      <th className="py-3 px-4">Catálogo</th>
                      <th className="py-3 px-4 text-center">Stock Sistema</th>
                      <th className="py-3 px-4 text-center">Stock Físico</th>
                      <th className="py-3 px-4">Estado / Alerta</th>
                      <th className="py-3 px-4 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs bg-white">
                    {filteredCriticalItems.map((it) => (
                      <tr
                        key={it.producto.codigo}
                        onClick={() => onOpenProductDetail(it.producto.codigo)}
                        className="hover:bg-slate-50/90 transition cursor-pointer"
                      >
                        <td className="py-3 px-4">
                          <span className="font-mono text-[10px] font-extrabold text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200 mr-2">
                            {it.producto.codigo}
                          </span>
                          <span className="font-extrabold text-slate-800">{it.producto.nombre}</span>
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-600">{it.catalogName}</td>
                        <td className="py-3 px-4 text-center font-black text-slate-900 tabular-nums">
                          {it.totalSys}
                        </td>
                        <td className="py-3 px-4 text-center font-black text-amber-800 tabular-nums">
                          {it.totalPhys}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap gap-1">
                            {it.hasExpired && (
                              <span className="px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 font-extrabold text-[10px]">
                                Vencido
                              </span>
                            )}
                            {it.hasSoon && (
                              <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 font-extrabold text-[10px]">
                                Vence en {it.earliestDays}d
                              </span>
                            )}
                            {it.noStock && (
                              <span className="px-2 py-0.5 rounded-md bg-slate-200 text-slate-800 font-extrabold text-[10px]">
                                Sin Stock
                              </span>
                            )}
                            {it.lowStock && !it.noStock && (
                              <span className="px-2 py-0.5 rounded-md bg-orange-100 text-orange-800 font-extrabold text-[10px]">
                                Stock Bajo
                              </span>
                            )}
                            {it.mismatch && (
                              <span className="px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 font-extrabold text-[10px]">
                                Dif. Física
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenProductDetail(it.producto.codigo);
                            }}
                            className="px-3 py-1 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 font-extrabold text-[11px] transition cursor-pointer"
                          >
                            Inspeccionar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* =====================================================================
          4. SECCIÓN DE SOLICITUDES / ÓRDENES (SI TIENE PERMISO "solicitudes")
         ===================================================================== */}
      {hasSolicitudesAccess && (
        <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 shadow-2xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                <ClipboardList className="w-5 h-5 text-teal-600" />
                <span>
                  {currentUser.rol === "Administrador"
                    ? "Estadísticas de Órdenes y Solicitudes Departamentales"
                    : `Resumen de Solicitudes • ${currentUser.departamento || "Mi Área"}`}
                </span>
              </h3>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                Monitoreo de estados, prioridades y despachos en tus catálogos habilitados
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPeriodScope("actual")}
                className={`px-3 py-1.5 rounded-xl text-xs font-extrabold border transition cursor-pointer ${
                  periodScope === "actual"
                    ? "bg-teal-800 text-white border-teal-800"
                    : "bg-slate-50 text-slate-600 border-slate-200"
                }`}
              >
                Período: {activePeriod}
              </button>
              <button
                type="button"
                onClick={() => setPeriodScope("todos")}
                className={`px-3 py-1.5 rounded-xl text-xs font-extrabold border transition cursor-pointer ${
                  periodScope === "todos"
                    ? "bg-teal-800 text-white border-teal-800"
                    : "bg-slate-50 text-slate-600 border-slate-200"
                }`}
              >
                Todo el Historial
              </button>
              <button
                type="button"
                onClick={() => onNavigateTab("solicitudes")}
                className="px-3.5 py-1.5 rounded-xl text-xs font-extrabold bg-teal-600 hover:bg-teal-700 text-white transition cursor-pointer flex items-center gap-1"
              >
                <span>Abrir Solicitudes</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80">
              <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                Total Solicitudes
              </span>
              <p className="text-2xl font-black text-slate-900 mt-1 tabular-nums">
                {solicitudesStats.total}
              </p>
              {solicitudesStats.altaPrioridad > 0 && (
                <span className="inline-block mt-1 text-[10px] font-extrabold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md">
                  {solicitudesStats.altaPrioridad} prioridad alta
                </span>
              )}
            </div>

            <div className="p-4 rounded-2xl bg-amber-50/60 border border-amber-200">
              <span className="text-[10px] font-black uppercase text-amber-800 tracking-wider">
                Pendientes
              </span>
              <p className="text-2xl font-black text-amber-900 mt-1 tabular-nums">
                {solicitudesStats.pendientes}
              </p>
              <span className="text-[11px] font-bold text-amber-700">En espera de atención</span>
            </div>

            <div className="p-4 rounded-2xl bg-blue-50/60 border border-blue-200">
              <span className="text-[10px] font-black uppercase text-blue-800 tracking-wider">
                En Proceso / Aprobadas
              </span>
              <p className="text-2xl font-black text-blue-900 mt-1 tabular-nums">
                {solicitudesStats.enProceso}
              </p>
              <span className="text-[11px] font-bold text-blue-700">En preparación de despacho</span>
            </div>

            <div className="p-4 rounded-2xl bg-emerald-50/60 border border-emerald-200">
              <span className="text-[10px] font-black uppercase text-emerald-800 tracking-wider">
                Entregadas
              </span>
              <p className="text-2xl font-black text-emerald-900 mt-1 tabular-nums">
                {solicitudesStats.entregadas}
              </p>
              <span className="text-[11px] font-bold text-emerald-700">Completadas con éxito</span>
            </div>
          </div>

          {/* Si el usuario NO tiene inventario (ej. Operador como Rossy), mostrar también disponibilidad de sus catálogos asignados */}
          {!hasInventoryAccess && (
            <div className="pt-2 border-t border-slate-100">
              <h4 className="text-xs font-black uppercase text-slate-500 tracking-wider mb-3">
                Disponibilidad de Productos en Tus Catálogos Habilitados ({availableCatalogos.length})
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {inventoryStats.catalogBreakdown.map((cat) => (
                  <div
                    key={cat.id}
                    onClick={() => {
                      onSelectCatalog(cat.id);
                      onNavigateTab("solicitudes");
                      playSound("click");
                    }}
                    className="p-4 rounded-2xl border border-slate-200 bg-slate-50/70 hover:border-teal-400 hover:bg-teal-50/30 transition cursor-pointer flex items-center justify-between gap-3"
                  >
                    <div>
                      <p className="text-xs font-black text-slate-900">{cat.nombre}</p>
                      <p className="text-[11px] font-semibold text-slate-500 mt-0.5">
                        {cat.skus} productos registrados • {cat.unitsSys.toLocaleString("es-DO")} und. disponibles
                      </p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-teal-600 shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          5. SECCIÓN DE VENTAS (ESTRÍCTAMENTE SOLO SI TIENE PERMISO "venta")
         ===================================================================== */}
      {hasVentaAccess && (
        <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 shadow-2xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                <Receipt className="w-5 h-5 text-emerald-600" />
                <span>Resumen de Facturación y Operaciones de Venta</span>
              </h3>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                Facturas emitidas, recaudación de ITBIS (18%) y distribución por concepto
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab("venta")}
              className="px-4 py-2 rounded-xl text-xs font-extrabold bg-emerald-700 hover:bg-emerald-800 text-white transition cursor-pointer inline-flex items-center gap-1.5 self-start sm:self-auto"
            >
              <span>Ir al Módulo de Venta</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-2xl bg-emerald-50/60 border border-emerald-200">
              <span className="text-[10px] font-black uppercase text-emerald-800 tracking-wider">
                Total Facturado
              </span>
              <p className="text-xl sm:text-2xl font-black text-emerald-900 mt-1 tabular-nums">
                RD${" "}
                {ventasStats.totalFacturado.toLocaleString("es-DO", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2
                })}
              </p>
              <span className="text-[11px] font-bold text-emerald-700">
                ITBIS (18%): RD${" "}
                {ventasStats.totalItbis.toLocaleString("es-DO", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2
                })}
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">
                Facturas Emitidas
              </span>
              <p className="text-2xl font-black text-slate-900 mt-1 tabular-nums">
                {ventasStats.totalFacturas}
              </p>
              <span className="text-[11px] font-bold text-slate-500">
                {ventasStats.totalUnidades.toLocaleString("es-DO")} unidades despachadas
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">
                Conceptos Principales
              </span>
              <div className="mt-1.5 space-y-1">
                {ventasStats.porConcepto.length === 0 ? (
                  <p className="text-xs text-slate-400 font-semibold">Sin facturas registradas</p>
                ) : (
                  ventasStats.porConcepto.slice(0, 3).map((c) => (
                    <div key={c.concepto} className="flex justify-between text-xs font-bold">
                      <span className="text-slate-700">{c.concepto}:</span>
                      <span className="text-emerald-800">{c.count} op.</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
