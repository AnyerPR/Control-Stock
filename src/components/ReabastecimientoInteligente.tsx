import React, { useState, useMemo, useRef } from "react";
import {
  Sparkles,
  Search,
  AlertTriangle,
  Package,
  ArrowRight,
  CheckSquare,
  Square,
  RotateCcw,
  Calculator,
  TrendingUp,
  SlidersHorizontal,
  Info,
  Send,
  ChevronDown
} from "lucide-react";
import { Producto, Solicitud, SolicitudItem, Movimiento, Catalogo, matchesCatalog } from "../types";

interface ReabastecimientoInteligenteProps {
  products: Producto[];
  solicitudes: Solicitud[];
  movements?: Movimiento[];
  catalogos: Catalogo[];
  activeCatalogId: string;
  userDepartment: string;
  onApplyItems: (items: Omit<SolicitudItem, "id">[], summaryNote: string) => void;
  onDirectSubmitSolicitud?: (items: Omit<SolicitudItem, "id">[], summaryNote: string) => Promise<void>;
  playSound: (type: "click" | "action" | "positive" | "negative" | "open" | "close") => void;
  showToast: (msg: string) => void;
}

type StockFilterMode = "criticos" | "agotados" | "bajos" | "todos";

interface CalculatedRow {
  product: Producto;
  existenciaActual: number;
  consumoMensualEstimado: number;
  faltanteSugerido: number;
  cantidadAPedir: number;
  status: "agotado" | "bajo" | "optimo";
  isSelected: boolean;
}

const PAGE_SIZE = 50;

export default function ReabastecimientoInteligente({
  products,
  solicitudes,
  movements = [],
  catalogos,
  activeCatalogId,
  userDepartment,
  onApplyItems,
  onDirectSubmitSolicitud,
  playSound,
  showToast
}: ReabastecimientoInteligenteProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("todas");
  const [stockFilter, setStockFilter] = useState<StockFilterMode>("criticos");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [isSubmittingDirect, setIsSubmittingDirect] = useState(false);
  const submitLockRef = useRef(false);

  // Overrides locales del usuario para Consumo Mensual Estimado y Cantidad a Pedir
  const [customMonthlyConsumption, setCustomMonthlyConsumption] = useState<Record<string, number>>({});
  const [customOrderQty, setCustomOrderQty] = useState<Record<string, number>>({});
  const [selectedCodes, setSelectedCodes] = useState<Record<string, boolean>>({});
  const [hasInitializedSelection, setHasInitializedSelection] = useState(false);

  // Filtrar productos del catálogo activo
  const catalogProducts = useMemo(() => {
    return products.filter((p) => matchesCatalog(p.catalogId, activeCatalogId, catalogos));
  }, [products, activeCatalogId, catalogos]);

  // Calcular consumo histórico mensual (últimos 30 días) por código de producto
  const historicalConsumptionMap = useMemo(() => {
    const map: Record<string, number> = {};
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    for (const sol of solicitudes) {
      if ((sol.estado === "Entregada" || sol.estado === "Aprobada") && sol.timestamp >= thirtyDaysAgo) {
        for (const item of sol.items || []) {
          if (item.productoCodigo) {
            const qty = item.cantidadAprobada ?? item.cantidadSolicitada ?? 0;
            map[item.productoCodigo] = (map[item.productoCodigo] || 0) + qty;
          }
        }
      }
    }

    for (const mov of movements) {
      if (mov.tipoMovimiento === "Salida" && mov.productoCodigo) {
        map[mov.productoCodigo] = (map[mov.productoCodigo] || 0) + (mov.cantidad || 0);
      }
    }

    return map;
  }, [solicitudes, movements]);

  // Categorías únicas disponibles en el catálogo
  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    catalogProducts.forEach((p) => {
      if (p.categoria && p.categoria.trim()) {
        cats.add(p.categoria.trim());
      }
    });
    return Array.from(cats).sort((a, b) => a.localeCompare(b));
  }, [catalogProducts]);

  // Construir filas con la fórmula: Faltante Sugerido = Max(0, Consumo Mensual Estimado - Existencia Actual)
  const calculatedRows: CalculatedRow[] = useMemo(() => {
    return catalogProducts.map((p) => {
      const existenciaFromLotes = (p.lotes || []).reduce(
        (acc, l) => acc + Math.max(0, Number(l.cantidad || 0)),
        0
      );
      const existenciaActual = Math.max(0, existenciaFromLotes);
      const minStockBase = Math.max(0, Number(p.consumoMensualEstimado || 0));
      const historical = historicalConsumptionMap[p.codigo] || 0;

      const defaultMonthlyEstimate =
        minStockBase > 0
          ? minStockBase
          : historical > 0
          ? historical
          : existenciaActual === 0
          ? 50
          : Math.max(20, Math.ceil(existenciaActual * 1.25));

      const consumoMensualEstimado =
        customMonthlyConsumption[p.codigo] !== undefined
          ? Math.max(0, customMonthlyConsumption[p.codigo])
          : defaultMonthlyEstimate;

      // FÓRMULA AUTOMÁTICA: Faltante = Consumo Mensual Estimado - Existencia Actual
      const faltanteSugerido = Math.max(0, consumoMensualEstimado - existenciaActual);

      const cantidadAPedir =
        customOrderQty[p.codigo] !== undefined
          ? Math.max(0, customOrderQty[p.codigo])
          : faltanteSugerido;

      let status: "agotado" | "bajo" | "optimo" = "optimo";
      if (existenciaActual === 0) {
        status = "agotado";
      } else if (faltanteSugerido > 0 || (minStockBase > 0 && existenciaActual <= minStockBase)) {
        status = "bajo";
      }

      const isSelected =
        selectedCodes[p.codigo] !== undefined
          ? selectedCodes[p.codigo]
          : !hasInitializedSelection && (status === "agotado" || status === "bajo") && cantidadAPedir > 0;

      return {
        product: p,
        existenciaActual,
        consumoMensualEstimado,
        faltanteSugerido,
        cantidadAPedir,
        status,
        isSelected
      };
    });
  }, [
    catalogProducts,
    historicalConsumptionMap,
    customMonthlyConsumption,
    customOrderQty,
    selectedCodes,
    hasInitializedSelection
  ]);

  // Filtrar y ordenar filas
  const filteredRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();

    return calculatedRows
      .filter((row) => {
        if (stockFilter === "criticos" && row.status === "optimo" && row.faltanteSugerido === 0) {
          return false;
        }
        if (stockFilter === "agotados" && row.status !== "agotado") {
          return false;
        }
        if (stockFilter === "bajos" && row.status !== "bajo") {
          return false;
        }
        if (categoryFilter !== "todas" && (row.product.categoria || "General") !== categoryFilter) {
          return false;
        }
        if (q) {
          const matchCode = (row.product.codigo || "").toLowerCase().includes(q);
          const matchName = (row.product.nombre || "").toLowerCase().includes(q);
          const matchCat = (row.product.categoria || "").toLowerCase().includes(q);
          if (!matchCode && !matchName && !matchCat) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const rank = { agotado: 0, bajo: 1, optimo: 2 };
        if (rank[a.status] !== rank[b.status]) {
          return rank[a.status] - rank[b.status];
        }
        return b.faltanteSugerido - a.faltanteSugerido;
      });
  }, [calculatedRows, stockFilter, categoryFilter, searchTerm]);

  const paginatedRows = useMemo(() => {
    return filteredRows.slice(0, visibleCount);
  }, [filteredRows, visibleCount]);

  // Estadísticas rápidas
  const stats = useMemo(() => {
    let agotados = 0;
    let bajos = 0;
    let seleccionados = 0;
    let totalUnidadesAPedir = 0;

    for (const row of calculatedRows) {
      if (row.status === "agotado") agotados++;
      if (row.status === "bajo") bajos++;
      if (row.isSelected && row.cantidadAPedir > 0) {
        seleccionados++;
        totalUnidadesAPedir += row.cantidadAPedir;
      }
    }

    return { agotados, bajos, seleccionados, totalUnidadesAPedir };
  }, [calculatedRows]);

  const handleConsumptionChange = (codigo: string, valueStr: string, existenciaActual: number) => {
    const num = Math.max(0, parseInt(valueStr, 10) || 0);
    setCustomMonthlyConsumption((prev) => ({ ...prev, [codigo]: num }));
    const nuevoFaltante = Math.max(0, num - existenciaActual);
    setCustomOrderQty((prev) => ({ ...prev, [codigo]: nuevoFaltante }));
    if (nuevoFaltante > 0) {
      setSelectedCodes((prev) => ({ ...prev, [codigo]: true }));
    }
  };

  const handleOrderQtyChange = (codigo: string, valueStr: string) => {
    const num = Math.max(0, parseInt(valueStr, 10) || 0);
    setCustomOrderQty((prev) => ({ ...prev, [codigo]: num }));
    setSelectedCodes((prev) => ({ ...prev, [codigo]: num > 0 }));
    setHasInitializedSelection(true);
  };

  const handleToggleSelectRow = (codigo: string, currentSelected: boolean, currentOrderQty: number, faltante: number) => {
    playSound("click");
    setHasInitializedSelection(true);
    const nextSelected = !currentSelected;
    setSelectedCodes((prev) => ({ ...prev, [codigo]: nextSelected }));
    if (nextSelected && currentOrderQty === 0 && faltante > 0) {
      setCustomOrderQty((prev) => ({ ...prev, [codigo]: faltante }));
    }
  };

  const handleSelectAllFiltered = () => {
    playSound("click");
    setHasInitializedSelection(true);
    const allSelected =
      filteredRows.length > 0 && filteredRows.every((r) => r.isSelected && r.cantidadAPedir > 0);
    const nextMap = { ...selectedCodes };
    const nextQtyMap = { ...customOrderQty };

    filteredRows.forEach((row) => {
      if (allSelected) {
        nextMap[row.product.codigo] = false;
      } else {
        nextMap[row.product.codigo] = true;
        if (row.cantidadAPedir <= 0) {
          nextQtyMap[row.product.codigo] = row.faltanteSugerido > 0 ? row.faltanteSugerido : 10;
        }
      }
    });

    setSelectedCodes(nextMap);
    setCustomOrderQty(nextQtyMap);
  };

  const handleResetSuggestions = () => {
    playSound("click");
    setCustomMonthlyConsumption({});
    setCustomOrderQty({});
    setSelectedCodes({});
    setHasInitializedSelection(false);
    showToast("Valores restablecidos al cálculo sugerido automático");
  };

  const buildSelectedSolicitudPayload = () => {
    const chosenRows = calculatedRows.filter((r) => r.isSelected && r.cantidadAPedir > 0);
    if (chosenRows.length === 0) return null;

    // Deduplicación estricta por código de producto
    const uniqueByCode = new Map<string, CalculatedRow>();
    for (const r of chosenRows) {
      if (!uniqueByCode.has(r.product.codigo)) {
        uniqueByCode.set(r.product.codigo, r);
      }
    }

    const itemsToRequest: Omit<SolicitudItem, "id">[] = Array.from(uniqueByCode.values()).map((r) => ({
      productoCodigo: r.product.codigo,
      productoNombre: r.product.nombre,
      categoria: r.product.categoria || "General",
      stockActualAlMomento: r.existenciaActual,
      cantidadSolicitada: r.cantidadAPedir,
      cantidadEntregada: r.cantidadAPedir,
      justificacion: `Reabastecimiento Inteligente: Consumo mensual est. ${r.consumoMensualEstimado}, Existencia ${r.existenciaActual}, Faltante sugerido ${r.faltanteSugerido}`
    }));

    const catalogName = catalogos.find((c) => c.id === activeCatalogId)?.nombre || "Catálogo Activo";
    const summaryNote = `Pedido generado mediante Reabastecimiento Inteligente (${catalogName} - ${userDepartment}). Incluye ${itemsToRequest.length} insumo(s) con cálculo de cobertura mensual.`;

    return { itemsToRequest, summaryNote };
  };

  const handleGenerateOrder = () => {
    const payload = buildSelectedSolicitudPayload();
    if (!payload) {
      playSound("negative");
      showToast("Selecciona al menos un insumo con cantidad a pedir mayor a 0");
      return;
    }

    playSound("positive");
    onApplyItems(payload.itemsToRequest, payload.summaryNote);
  };

  const handleDirectOrderSubmit = async () => {
    if (!onDirectSubmitSolicitud) {
      handleGenerateOrder();
      return;
    }
    if (submitLockRef.current || isSubmittingDirect) return;

    const payload = buildSelectedSolicitudPayload();
    if (!payload) {
      playSound("negative");
      showToast("Selecciona al menos un insumo con cantidad a pedir mayor a 0");
      return;
    }

    submitLockRef.current = true;
    setIsSubmittingDirect(true);
    try {
      await onDirectSubmitSolicitud(payload.itemsToRequest, payload.summaryNote);
    } finally {
      submitLockRef.current = false;
      setIsSubmittingDirect(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Banner superior explicativo y KPIs */}
      <div className="bg-gradient-to-r from-teal-900 via-teal-800 to-emerald-900 rounded-2xl p-5 text-white shadow-lg border border-teal-700/50">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-500/20 border border-teal-400/30 text-teal-200 text-xs font-extrabold uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span>Cálculo Automático de Cobertura Mensual</span>
            </div>
            <h3 className="text-xl sm:text-2xl font-extrabold tracking-tight">
              Reabastecimiento Inteligente de Insumos y Medicamentos
            </h3>
            <p className="text-xs sm:text-sm text-teal-100/90 max-w-3xl leading-relaxed">
              Fórmula activa:{" "}
              <span className="font-mono font-bold bg-black/25 px-2 py-0.5 rounded-md text-amber-200 border border-white/10">
                Faltante Sugerido = Consumo Mensual Estimado − Existencia Actual
              </span>
              . Desliza horizontalmente la tabla: la columna del medicamento permanece fija a la izquierda para facilitar la lectura.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 shrink-0">
            <div className="bg-black/25 backdrop-blur-xs border border-white/10 rounded-xl p-3 text-center">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-rose-300">
                Agotados (Stock 0)
              </span>
              <span className="text-xl font-black text-white">{stats.agotados}</span>
            </div>
            <div className="bg-black/25 backdrop-blur-xs border border-white/10 rounded-xl p-3 text-center">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-amber-300">
                Stock Bajo
              </span>
              <span className="text-xl font-black text-white">{stats.bajos}</span>
            </div>
            <div className="bg-black/25 backdrop-blur-xs border border-white/10 rounded-xl p-3 text-center">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-teal-300">
                Ítems a Pedir
              </span>
              <span className="text-xl font-black text-emerald-300">{stats.seleccionados}</span>
            </div>
            <div className="bg-black/25 backdrop-blur-xs border border-white/10 rounded-xl p-3 text-center">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-teal-200">
                Unidades Totales
              </span>
              <span className="text-xl font-black text-white">{stats.totalUnidadesAPedir}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Barra de controles y filtros */}
      <div className="bg-white rounded-2xl p-4 shadow-xs border border-slate-200 space-y-3">
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
          {/* Buscador */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setVisibleCount(PAGE_SIZE);
              }}
              placeholder="Buscar por código, nombre del medicamento o categoría..."
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-semibold text-slate-800 focus:bg-white focus:ring-2 focus:ring-teal-500/30 focus:border-teal-600 outline-none transition"
            />
          </div>

          {/* Filtro por Categoría */}
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-slate-500 shrink-0 hidden sm:block" />
            <select
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setVisibleCount(PAGE_SIZE);
              }}
              className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-teal-500/30 cursor-pointer"
            >
              <option value="todas">Todas las Categorías ({availableCategories.length})</option>
              {availableCategories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={handleResetSuggestions}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition cursor-pointer"
              title="Restablecer cálculos sugeridos"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Restablecer</span>
            </button>
          </div>
        </div>

        {/* Pestañas de nivel de stock y acciones rápidas */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setStockFilter("criticos");
                setVisibleCount(PAGE_SIZE);
                playSound("click");
              }}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-extrabold transition cursor-pointer flex items-center gap-1.5 ${
                stockFilter === "criticos"
                  ? "bg-teal-700 text-white shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Críticos y Faltantes ({stats.agotados + stats.bajos})</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setStockFilter("agotados");
                setVisibleCount(PAGE_SIZE);
                playSound("click");
              }}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-extrabold transition cursor-pointer ${
                stockFilter === "agotados"
                  ? "bg-rose-600 text-white shadow-xs"
                  : "bg-rose-50 text-rose-700 hover:bg-rose-100"
              }`}
            >
              Agotados ({stats.agotados})
            </button>

            <button
              type="button"
              onClick={() => {
                setStockFilter("bajos");
                setVisibleCount(PAGE_SIZE);
                playSound("click");
              }}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-extrabold transition cursor-pointer ${
                stockFilter === "bajos"
                  ? "bg-amber-600 text-white shadow-xs"
                  : "bg-amber-50 text-amber-800 hover:bg-amber-100"
              }`}
            >
              Stock Bajo ({stats.bajos})
            </button>

            <button
              type="button"
              onClick={() => {
                setStockFilter("todos");
                setVisibleCount(PAGE_SIZE);
                playSound("click");
              }}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-extrabold transition cursor-pointer ${
                stockFilter === "todos"
                  ? "bg-slate-800 text-white shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              Todo el Catálogo ({calculatedRows.length})
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleSelectAllFiltered}
              className="px-3 py-1.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-xs font-bold text-slate-700 flex items-center gap-1.5 cursor-pointer transition"
            >
              <CheckSquare className="w-3.5 h-3.5 text-teal-600" />
              <span>Seleccionar / Desmarcar visibles</span>
            </button>

            {onDirectSubmitSolicitud && (
              <button
                type="button"
                disabled={isSubmittingDirect || stats.seleccionados === 0}
                onClick={handleDirectOrderSubmit}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-extrabold flex items-center gap-2 shadow-sm transition cursor-pointer active:scale-95"
              >
                <Send className="w-3.5 h-3.5" />
                <span>
                  {isSubmittingDirect
                    ? "Registrando..."
                    : `Enviar Solicitud Directa (${stats.seleccionados})`}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={handleGenerateOrder}
              className="px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-600 text-white text-xs font-extrabold flex items-center gap-2 shadow-sm transition cursor-pointer active:scale-95"
            >
              <span>Revisar en Formulario ({stats.seleccionados})</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Tabla interactiva de Reabastecimiento Inteligente con 1ra Columna Fija (Sticky) */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
        {filteredRows.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-teal-50 text-teal-600 flex items-center justify-center mx-auto">
              <Package className="w-7 h-7" />
            </div>
            <h4 className="text-base font-extrabold text-slate-800">
              No se encontraron insumos en esta vista
            </h4>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Prueba cambiando el filtro a &ldquo;Todo el Catálogo&rdquo; o ajusta el término de búsqueda para evaluar otros productos.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto relative">
            <table className="w-full text-left border-collapse min-w-[920px]">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 text-[11px] font-extrabold uppercase tracking-wider text-slate-600">
                  {/* PRIMERA COLUMNA FIJA (STICKY): Selección + Medicamento / Insumo */}
                  <th
                    scope="col"
                    className="sticky left-0 z-20 bg-slate-100 py-3.5 pl-3.5 pr-4 border-r border-slate-200 shadow-[2px_0_6px_-2px_rgba(15,23,42,0.08)] min-w-[230px] max-w-[290px] sm:min-w-[280px] sm:max-w-[340px]"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="sr-only">Seleccionar</span>
                      <span>Medicamento / Insumo (Fijo)</span>
                    </div>
                  </th>
                  <th scope="col" className="py-3.5 px-4 whitespace-nowrap">
                    Categoría
                  </th>
                  <th scope="col" className="py-3.5 px-4 text-center whitespace-nowrap">
                    <div className="inline-flex items-center gap-1 text-slate-700">
                      <TrendingUp className="w-3.5 h-3.5 text-teal-600" />
                      <span>Consumo Mensual Est.</span>
                    </div>
                  </th>
                  <th scope="col" className="py-3.5 px-4 text-center whitespace-nowrap">
                    Existencia Actual
                  </th>
                  <th scope="col" className="py-3.5 px-4 text-center whitespace-nowrap">
                    <div className="inline-flex items-center gap-1 text-amber-800">
                      <Calculator className="w-3.5 h-3.5 text-amber-600" />
                      <span>Faltante Sugerido</span>
                    </div>
                  </th>
                  <th scope="col" className="py-3.5 px-4 text-center whitespace-nowrap">
                    Cantidad a Pedir
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70 text-xs">
                {paginatedRows.map((row) => {
                  const {
                    product,
                    existenciaActual,
                    consumoMensualEstimado,
                    faltanteSugerido,
                    cantidadAPedir,
                    status,
                    isSelected
                  } = row;

                  // Color sólido para la celda sticky para evitar transparencia al desplazar horizontalmente
                  const stickyBgClass = isSelected
                    ? "bg-teal-50 group-hover:bg-teal-100/80"
                    : status === "agotado"
                    ? "bg-rose-50 group-hover:bg-rose-100/70"
                    : "bg-white group-hover:bg-slate-50";

                  const rowBgClass = isSelected
                    ? "bg-teal-50/40 hover:bg-teal-50/70"
                    : status === "agotado"
                    ? "bg-rose-50/25 hover:bg-rose-50/50"
                    : "hover:bg-slate-50";

                  return (
                    <tr
                      key={product.codigo}
                      className={`group transition-colors ${rowBgClass}`}
                    >
                      {/* PRIMERA COLUMNA FIJA (STICKY): Checkbox + Nombre y Código del Producto */}
                      <td
                        className={`sticky left-0 z-10 py-3 pl-3.5 pr-4 border-r border-slate-200 shadow-[2px_0_6px_-2px_rgba(15,23,42,0.08)] align-middle transition-colors min-w-[230px] max-w-[290px] sm:min-w-[280px] sm:max-w-[340px] ${stickyBgClass}`}
                      >
                        <div className="flex items-start gap-2.5">
                          <button
                            type="button"
                            onClick={() =>
                              handleToggleSelectRow(
                                product.codigo,
                                isSelected,
                                cantidadAPedir,
                                faltanteSugerido
                              )
                            }
                            className="p-1 mt-0.5 rounded-lg hover:bg-slate-200/60 transition cursor-pointer shrink-0"
                            title={isSelected ? "Quitar de la solicitud" : "Incluir en la solicitud"}
                          >
                            {isSelected ? (
                              <CheckSquare className="w-5 h-5 text-teal-600" />
                            ) : (
                              <Square className="w-5 h-5 text-slate-400" />
                            )}
                          </button>

                          <div className="min-w-0 flex-1">
                            <p
                              className="font-extrabold text-slate-900 text-xs sm:text-[13px] leading-snug break-words line-clamp-2"
                              title={product.nombre}
                            >
                              {product.nombre}
                            </p>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                              <span className="font-mono text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                                {product.codigo}
                              </span>
                              <span className="text-[10px] text-slate-500 font-semibold">
                                {(product.lotes || []).length} lote(s)
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Categoría */}
                      <td className="py-3 px-4 align-middle whitespace-nowrap">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                          {product.categoria || "General"}
                        </span>
                      </td>

                      {/* Consumo Mensual Estimado (Editable para ajustar meta del mes) */}
                      <td className="py-3 px-4 text-center align-middle whitespace-nowrap">
                        <div className="inline-flex flex-col items-center">
                          <input
                            type="number"
                            min={0}
                            value={consumoMensualEstimado}
                            onChange={(e) =>
                              handleConsumptionChange(product.codigo, e.target.value, existenciaActual)
                            }
                            className="w-24 text-center font-extrabold text-slate-800 bg-white border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs focus:ring-2 focus:ring-teal-500/30 focus:border-teal-600 outline-none transition"
                            title="Consumo mensual estimado (editable)"
                          />
                          <span className="text-[10px] text-slate-400 mt-0.5">meta mensual</span>
                        </div>
                      </td>

                      {/* Existencia Actual */}
                      <td className="py-3 px-4 text-center align-middle whitespace-nowrap">
                        <div className="inline-flex flex-col items-center">
                          <span
                            className={`inline-flex items-center justify-center px-3 py-1 rounded-xl font-black text-xs border ${
                              existenciaActual === 0
                                ? "bg-rose-100 text-rose-800 border-rose-300"
                                : status === "bajo"
                                ? "bg-amber-100 text-amber-900 border-amber-300"
                                : "bg-emerald-50 text-emerald-800 border-emerald-200"
                            }`}
                          >
                            {existenciaActual}
                          </span>
                          <span className="text-[10px] font-bold mt-0.5 text-slate-400">
                            {existenciaActual === 0
                              ? "Agotado"
                              : status === "bajo"
                              ? "Stock Bajo"
                              : "Disponible"}
                          </span>
                        </div>
                      </td>

                      {/* Faltante Sugerido = Consumo Mensual Estimado - Existencia Actual */}
                      <td className="py-3 px-4 text-center align-middle whitespace-nowrap">
                        <div className="inline-flex flex-col items-center">
                          <span
                            className={`inline-flex items-center gap-1 px-3 py-1 rounded-xl font-black text-xs ${
                              faltanteSugerido > 0
                                ? "bg-amber-50 text-amber-900 border border-amber-300"
                                : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {faltanteSugerido > 0 ? `+${faltanteSugerido}` : "0"}
                          </span>
                          <span className="text-[10px] text-slate-400 mt-0.5 font-mono">
                            {consumoMensualEstimado} − {existenciaActual} = {faltanteSugerido}
                          </span>
                        </div>
                      </td>

                      {/* Cantidad a Pedir (Input Editable) */}
                      <td className="py-3 px-4 text-center align-middle whitespace-nowrap">
                        <div className="inline-flex flex-col items-center">
                          <input
                            type="number"
                            min={0}
                            value={cantidadAPedir}
                            onChange={(e) => handleOrderQtyChange(product.codigo, e.target.value)}
                            className={`w-28 text-center font-black rounded-xl px-3 py-2 text-sm outline-none transition border-2 ${
                              isSelected && cantidadAPedir > 0
                                ? "bg-teal-50/70 border-teal-600 text-teal-950 focus:ring-2 focus:ring-teal-500/30"
                                : "bg-slate-50 border-slate-300 text-slate-700 focus:border-teal-600"
                            }`}
                          />
                          {faltanteSugerido > 0 && cantidadAPedir !== faltanteSugerido && (
                            <button
                              type="button"
                              onClick={() => handleOrderQtyChange(product.codigo, String(faltanteSugerido))}
                              className="text-[10px] text-teal-700 hover:underline font-bold mt-0.5 cursor-pointer"
                            >
                              Usar sugerido ({faltanteSugerido})
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Paginación Progresiva si hay más filas */}
        {filteredRows.length > visibleCount && (
          <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600">
              Mostrando <strong className="text-slate-900">{paginatedRows.length}</strong> de{" "}
              <strong className="text-slate-900">{filteredRows.length}</strong> insumos
            </span>
            <button
              type="button"
              onClick={() => {
                playSound("click");
                setVisibleCount((prev) => prev + PAGE_SIZE);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white hover:bg-slate-100 text-teal-800 border border-slate-300 text-xs font-extrabold shadow-2xs transition cursor-pointer"
            >
              <ChevronDown className="w-4 h-4" />
              <span>Cargar más insumos ({filteredRows.length - visibleCount} restantes)</span>
            </button>
          </div>
        )}

        {/* Pie de tabla con resumen y botón de acción */}
        <div className="bg-slate-50 px-5 py-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <Info className="w-4 h-4 text-teal-600 shrink-0" />
            <span>
              Mostrando <strong>{paginatedRows.length}</strong> de <strong>{filteredRows.length}</strong> insumos. Tienes{" "}
              <strong className="text-teal-800">{stats.seleccionados} producto(s)</strong> marcados para solicitar (
              <strong>{stats.totalUnidadesAPedir} unidades</strong> en total).
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
            {onDirectSubmitSolicitud && (
              <button
                type="button"
                disabled={isSubmittingDirect || stats.seleccionados === 0}
                onClick={handleDirectOrderSubmit}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 shadow-md transition cursor-pointer active:scale-95"
              >
                <Send className="w-4 h-4" />
                <span>
                  {isSubmittingDirect
                    ? "Registrando Solicitud..."
                    : `Registrar Solicitud Ahora (${stats.seleccionados})`}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={handleGenerateOrder}
              className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-600 text-white text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 shadow-md transition cursor-pointer active:scale-95"
            >
              <span>Revisar en Formulario ({stats.seleccionados} ítems)</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
