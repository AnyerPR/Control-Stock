import { useState, useEffect, useMemo } from "react";
import { query, orderBy, limit, getDocs } from "firebase/firestore";
import { tenantCollection } from "../firebase";
import { Movimiento, Usuario, Catalogo, isCatalogAllowedForUser, matchesCatalog } from "../types";
import { playSound } from "../utils/audio";
import { exportInvoiceToPDF, exportInvoiceToWord } from "../utils/exportUtils";
import {
  Calendar,
  Search,
  History,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  User,
  FileText,
  List,
  ChevronDown,
  ChevronUp,
  FileDown,
  Building2,
  Package
} from "lucide-react";
import MarqueeText from "./MarqueeText";

interface HistorialMovimientosProps {
  activeCatalogId: string;
  currentUser: Usuario | null;
  catalogos?: Catalogo[];
}

interface FacturaGroup {
  numeroFactura: string;
  fechaEntrada: string;
  proveedor: string;
  usuario: string;
  timestamp: number;
  items: Movimiento[];
  totalUnidades: number;
  totalMonto: number;
}

export default function HistorialMovimientos({ activeCatalogId, currentUser, catalogos = [] }: HistorialMovimientosProps) {
  const [allMovements, setAllMovements] = useState<Movimiento[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"facturas" | "detalle">("facturas");
  const [filterType, setFilterType] = useState<string>("todos");
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedInvoices, setExpandedInvoices] = useState<Record<string, boolean>>({});
  const pageSize = 10;

  const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";

  const fetchMovements = async () => {
    setLoading(true);
    if (isLocalFileMode) {
      const stored = localStorage.getItem("offline_movimientos");
      let list: Movimiento[] = [];
      if (stored) {
        try {
          list = JSON.parse(stored);
        } catch (e) {
          console.error(e);
        }
      }
      setAllMovements(list);
      setLoading(false);
      return;
    }

    try {
      const colRef = tenantCollection("movimientos");
      const q = query(colRef, orderBy("timestamp", "desc"), limit(2000));
      const snapshot = await getDocs(q);
      const list: Movimiento[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() } as Movimiento);
      });
      setAllMovements(list);
    } catch (err) {
      console.error("Error fetching movements:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMovements();

    if (isLocalFileMode) {
      window.addEventListener("offline_movimientos_update", fetchMovements);
      return () => {
        window.removeEventListener("offline_movimientos_update", fetchMovements);
      };
    }
  }, [isLocalFileMode, currentUser?.farmaciaId, activeCatalogId]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterType, searchTerm, viewMode, activeCatalogId]);

  const catalogAccessibleMovements = useMemo(() => {
    return allMovements.filter((mov) => {
      const movCatalogId = mov.catalogId || "default-cat";
      if (!matchesCatalog(movCatalogId, activeCatalogId, catalogos)) {
        return false;
      }

      if (currentUser) {
        const canSeeAll =
          currentUser.rol === "Administrador" ||
          currentUser.departamento === "Almacén y Suministro" ||
          currentUser.departamento === "Farmacia";
        if (!canSeeAll) {
          if (!isCatalogAllowedForUser(currentUser, movCatalogId, catalogos)) {
            return false;
          }
        }
      }
      return true;
    });
  }, [allMovements, activeCatalogId, currentUser, catalogos]);

  // Group "Entrada" movements by numeroFactura
  const groupedInvoices = useMemo(() => {
    const map = new Map<string, FacturaGroup>();

    catalogAccessibleMovements
      .filter((m) => m.tipoMovimiento === "Entrada")
      .forEach((mov) => {
        const key = (mov.numeroFactura || "").trim() || `ENTRADA-${(mov.fecha || "").slice(0, 10) || "DIRECTA"}`;
        const existing = map.get(key);
        const qty = Number(mov.cantidad || 0);
        const subtotal = qty * Number(mov.precio || 0);

        if (existing) {
          existing.items.push(mov);
          existing.totalUnidades += qty;
          existing.totalMonto += subtotal;
          if (mov.timestamp > existing.timestamp) {
            existing.timestamp = mov.timestamp;
          }
        } else {
          map.set(key, {
            numeroFactura: (mov.numeroFactura || "").trim() || key,
            fechaEntrada: mov.fechaEntrada || (mov.fecha ? mov.fecha.slice(0, 10) : ""),
            proveedor: mov.proveedor || "Entrada de Inventario",
            usuario: mov.usuario || "Sistema",
            timestamp: mov.timestamp || Date.now(),
            items: [mov],
            totalUnidades: qty,
            totalMonto: subtotal
          });
        }
      });

    return Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp);
  }, [catalogAccessibleMovements]);

  const filteredInvoices = useMemo(() => {
    if (!searchTerm.trim()) return groupedInvoices;
    const search = searchTerm.toLowerCase().trim();
    return groupedInvoices.filter((inv) => {
      if (inv.numeroFactura.toLowerCase().includes(search)) return true;
      if ((inv.proveedor || "").toLowerCase().includes(search)) return true;
      if ((inv.usuario || "").toLowerCase().includes(search)) return true;
      return inv.items.some(
        (it) =>
          it.productoCodigo.toLowerCase().includes(search) ||
          it.productoNombre.toLowerCase().includes(search) ||
          it.lote.toLowerCase().includes(search)
      );
    });
  }, [groupedInvoices, searchTerm]);

  const filteredMovements = useMemo(() => {
    return catalogAccessibleMovements.filter((mov) => {
      if (filterType !== "todos" && mov.tipoMovimiento !== filterType) {
        return false;
      }
      if (!searchTerm.trim()) return true;
      const search = searchTerm.toLowerCase().trim();
      return (
        (mov.numeroFactura || "").toLowerCase().includes(search) ||
        (mov.proveedor || "").toLowerCase().includes(search) ||
        mov.productoCodigo.toLowerCase().includes(search) ||
        mov.productoNombre.toLowerCase().includes(search) ||
        mov.lote.toLowerCase().includes(search) ||
        mov.usuario.toLowerCase().includes(search)
      );
    });
  }, [catalogAccessibleMovements, filterType, searchTerm]);

  const displayedMovements = filteredMovements.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const displayedInvoices = filteredInvoices.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const handleNextPage = () => {
    const totalCount = viewMode === "facturas" ? filteredInvoices.length : filteredMovements.length;
    if (currentPage * pageSize >= totalCount) return;
    playSound("click");
    setCurrentPage((prev) => prev + 1);
  };

  const handlePrevPage = () => {
    if (currentPage === 1) return;
    playSound("click");
    setCurrentPage((prev) => prev - 1);
  };

  const handleRefresh = () => {
    playSound("action");
    fetchMovements();
    setCurrentPage(1);
  };

  const toggleInvoiceExpand = (numeroFactura: string) => {
    playSound("click");
    setExpandedInvoices((prev) => ({
      ...prev,
      [numeroFactura]: !prev[numeroFactura]
    }));
  };

  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return "—";
    const date = new Date(dateStr);
    return isNaN(date.getTime())
      ? dateStr
      : date.toLocaleString("es-DO", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        });
  };

  const formatShortDate = (dateStr: string) => {
    if (!dateStr) return "—";
    const parts = dateStr.slice(0, 10).split("-");
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
  };

  const getMovementBadgeClass = (type: string) => {
    switch (type) {
      case "Entrada":
        return "bg-emerald-500 text-white";
      case "Salida":
        return "bg-rose-500 text-white";
      case "Ajuste":
        return "bg-amber-500 text-slate-900";
      default:
        return "bg-slate-500 text-white";
    }
  };

  return (
    <div className="space-y-6">
      {/* Cabecera estilo Imagen 2 */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200/90 shadow-xs space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg sm:text-xl font-extrabold text-slate-900 flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700 shrink-0">
                <History className="w-5 h-5" />
              </div>
              <span>Historial de Movimientos y Facturas de Entrada</span>
            </h3>
            <p className="text-slate-500 text-xs sm:text-sm mt-1 font-medium">
              Consulta las entradas agrupadas por número de factura o el registro detallado de salidas y ajustes
            </p>
          </div>
          <button
            onClick={handleRefresh}
            className="p-2.5 border border-slate-300 hover:border-teal-500 bg-white hover:bg-teal-50 rounded-2xl transition text-slate-600 hover:text-teal-700 active:scale-95 flex items-center justify-center shadow-2xs cursor-pointer shrink-0"
            title="Actualizar historial"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Selector de Pestañas Segmentado (Imagen 2) */}
        <div className="space-y-3">
          <div className="inline-flex flex-wrap items-center gap-1.5 bg-slate-100 p-1.5 rounded-2xl border border-slate-200/90">
            <button
              type="button"
              onClick={() => {
                setViewMode("facturas");
                playSound("click");
              }}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold transition cursor-pointer ${
                viewMode === "facturas"
                  ? "bg-white text-teal-900 shadow-xs border border-slate-200/80"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <FileText className={`w-4 h-4 ${viewMode === "facturas" ? "text-teal-600" : "text-slate-400"}`} />
              <span>Entradas Agrupadas por Factura</span>
              <span
                className={`px-2 py-0.5 rounded-full text-[11px] font-black tabular-nums ${
                  viewMode === "facturas"
                    ? "bg-teal-100 text-teal-800"
                    : "bg-slate-200 text-slate-600"
                }`}
              >
                {groupedInvoices.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setViewMode("detalle");
                playSound("click");
              }}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold transition cursor-pointer ${
                viewMode === "detalle"
                  ? "bg-white text-teal-900 shadow-xs border border-slate-200/80"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <List className={`w-4 h-4 ${viewMode === "detalle" ? "text-teal-600" : "text-slate-400"}`} />
              <span>Todos los Movimientos (Detalle)</span>
              <span
                className={`px-2 py-0.5 rounded-full text-[11px] font-black tabular-nums ${
                  viewMode === "detalle"
                    ? "bg-teal-100 text-teal-800"
                    : "bg-slate-200 text-slate-600"
                }`}
              >
                {catalogAccessibleMovements.length}
              </span>
            </button>
          </div>

          <p className="text-xs font-bold text-slate-500">
            {viewMode === "facturas"
              ? "Visualizando compras y entradas agrupadas por comprobante"
              : "Visualizando el registro detallado de entradas, salidas y ajustes"}
          </p>
        </div>

        {/* Barra de Búsqueda (Imagen 2) */}
        <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4.5 h-4.5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por número de factura (ej. F100094), producto, lote o responsable..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-50/90 hover:bg-white focus:bg-white border border-slate-300 rounded-2xl pl-11 pr-4 py-3 text-sm outline-none focus:ring-2 focus:ring-teal-500/30 text-slate-900 placeholder:text-slate-400 font-semibold transition"
            />
          </div>

          {viewMode === "detalle" && (
            <div className="sm:w-60">
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="w-full h-full bg-white border border-slate-300 rounded-2xl px-4 py-3 text-xs outline-none focus:ring-2 focus:ring-teal-500/30 font-extrabold text-slate-800 cursor-pointer"
              >
                <option value="todos">Todos los movimientos</option>
                <option value="Entrada">Solo Entradas</option>
                <option value="Salida">Solo Salidas</option>
                <option value="Ajuste">Solo Ajustes</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Contenido según Pestaña */}
      {viewMode === "facturas" ? (
        <div className="space-y-4">
          {loading ? (
            <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center shadow-xs">
              <div className="w-8 h-8 border-4 border-teal-600 border-t-transparent rounded-full animate-spin mx-auto mb-2.5"></div>
              <span className="text-xs text-slate-600 font-bold">Cargando facturas de entrada...</span>
            </div>
          ) : filteredInvoices.length === 0 ? (
            <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center text-slate-400 shadow-xs">
              <FileText className="w-10 h-10 mx-auto mb-2.5 text-slate-300" />
              <p className="text-sm font-extrabold text-slate-700">No hay facturas de entrada registradas</p>
              <p className="text-xs text-slate-500 mt-1">
                Las entradas registradas con número de factura aparecerán agrupadas aquí.
              </p>
            </div>
          ) : (
            displayedInvoices.map((inv) => {
              const isExpanded = !!expandedInvoices[inv.numeroFactura];
              return (
                <div
                  key={inv.numeroFactura}
                  className="bg-white rounded-3xl border border-slate-200/90 shadow-xs overflow-hidden transition hover:border-slate-300"
                >
                  <div
                    onClick={() => toggleInvoiceExpand(inv.numeroFactura)}
                    className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer hover:bg-slate-50/70 transition"
                  >
                    <div className="flex items-start gap-3.5">
                      <div className="w-11 h-11 rounded-2xl bg-teal-50 border border-teal-200/80 flex items-center justify-center text-teal-700 shrink-0">
                        <FileText className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-black text-slate-900 font-mono">
                            Factura: {inv.numeroFactura}
                          </span>
                          <span className="text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 tabular-nums">
                            {inv.items.length} {inv.items.length === 1 ? "Producto" : "Productos"}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 mt-1.5 font-medium">
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5 text-slate-400" />
                            Fecha: <strong className="text-slate-700 tabular-nums">{formatShortDate(inv.fechaEntrada)}</strong>
                          </span>
                          {inv.proveedor && (
                            <span className="inline-flex items-center gap-1">
                              <Building2 className="w-3.5 h-3.5 text-slate-400" />
                              Proveedor: <strong className="text-slate-700">{inv.proveedor}</strong>
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1">
                            <User className="w-3.5 h-3.5 text-slate-400" />
                            <strong className="text-slate-700">{inv.usuario}</strong>
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-100">
                      <div className="text-left sm:text-right mr-2">
                        <span className="block text-[10px] font-extrabold uppercase text-slate-500 tracking-wider tabular-nums">
                          Total Entrada ({inv.totalUnidades} uds)
                        </span>
                        <span className="text-sm font-black text-teal-800 tabular-nums">
                          RD$ {inv.totalMonto.toFixed(2)}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          exportInvoiceToPDF(inv.numeroFactura, formatShortDate(inv.fechaEntrada), inv.proveedor, inv.items);
                          playSound("action");
                        }}
                        className="px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 text-xs font-extrabold flex items-center gap-1.5 transition cursor-pointer"
                        title="Descargar Factura en PDF"
                      >
                        <FileDown className="w-3.5 h-3.5" />
                        <span>PDF</span>
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          exportInvoiceToWord(inv.numeroFactura, formatShortDate(inv.fechaEntrada), inv.proveedor, inv.items);
                          playSound("action");
                        }}
                        className="px-3.5 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 text-xs font-extrabold flex items-center gap-1.5 transition cursor-pointer"
                        title="Descargar Factura en Word"
                      >
                        <FileDown className="w-3.5 h-3.5" />
                        <span>Word</span>
                      </button>

                      <div className="p-1.5 text-slate-400">
                        {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-slate-200/80 bg-slate-50/60 overflow-x-auto">
                      <table className="min-w-[700px] w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-100 border-b border-slate-200 text-[10px] font-extrabold text-slate-600 uppercase tracking-wider">
                            <th className="px-5 py-3">Código</th>
                            <th className="px-5 py-3">Medicamento / Insumo</th>
                            <th className="px-5 py-3">Lote</th>
                            <th className="px-5 py-3 text-right">Cantidad</th>
                            <th className="px-5 py-3 text-right">Costo Unit.</th>
                            <th className="px-5 py-3 text-right">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200/60 text-xs bg-white">
                          {inv.items.map((item) => {
                            const sub = Number(item.cantidad || 0) * Number(item.precio || 0);
                            return (
                              <tr key={item.id} className="hover:bg-slate-50/90 transition">
                                <td className="px-5 py-3 font-mono font-extrabold text-teal-800">{item.productoCodigo}</td>
                                <td className="px-5 py-3">
                                  <p className="font-bold text-slate-900">{item.productoNombre}</p>
                                  {item.descripcion && <p className="text-[11px] text-slate-500">{item.descripcion}</p>}
                                </td>
                                <td className="px-5 py-3 font-mono font-bold text-slate-800">
                                  {item.lote}
                                  {item.loteFisico && (
                                    <span className="block text-[10px] text-amber-700 font-sans">
                                      Ubic: {item.loteFisico}
                                    </span>
                                  )}
                                </td>
                                <td className="px-5 py-3 text-right font-black text-emerald-700 tabular-nums">+{item.cantidad}</td>
                                <td className="px-5 py-3 text-right font-semibold text-slate-700 tabular-nums">
                                  RD$ {Number(item.precio || 0).toFixed(2)}
                                </td>
                                <td className="px-5 py-3 text-right font-black text-slate-900 tabular-nums">
                                  RD$ {sub.toFixed(2)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })
          )}

          {filteredInvoices.length > pageSize && (
            <div className="px-6 py-4 bg-white rounded-2xl border border-slate-200 flex items-center justify-between">
              <span className="text-xs text-slate-600 font-bold tabular-nums">
                Mostrando {displayedInvoices.length} de {filteredInvoices.length} facturas • Página {currentPage}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePrevPage}
                  disabled={currentPage === 1}
                  className="p-2 border border-slate-300 rounded-xl bg-white hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={handleNextPage}
                  disabled={currentPage * pageSize >= filteredInvoices.length}
                  className="p-2 border border-slate-300 rounded-xl bg-white hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-slate-200/90 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-[850px] w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-100/90 border-b border-slate-200 text-[11px] font-extrabold text-slate-600 uppercase tracking-wider">
                  <th className="px-6 py-4">Tipo</th>
                  <th className="px-6 py-4">Factura / Comp.</th>
                  <th className="px-6 py-4">Suministro</th>
                  <th className="px-6 py-4">Lote</th>
                  <th className="px-6 py-4 text-right">Cantidad</th>
                  <th className="px-6 py-4 text-right">Costo / Precio</th>
                  <th className="px-6 py-4">Responsable</th>
                  <th className="px-6 py-4">Fecha y Hora</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="text-center py-12">
                      <div className="w-8 h-8 border-4 border-teal-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                      <span className="text-xs text-slate-600 font-bold">Cargando registros...</span>
                    </td>
                  </tr>
                ) : filteredMovements.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-slate-400">
                      <Package className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                      <p className="text-xs font-bold text-slate-600">No se encontraron movimientos registrados</p>
                    </td>
                  </tr>
                ) : (
                  displayedMovements.map((mov) => (
                    <tr key={mov.id} className="hover:bg-slate-50/80 transition">
                      <td className="px-6 py-4">
                        <span
                          className={`inline-block px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase tracking-wider ${getMovementBadgeClass(
                            mov.tipoMovimiento
                          )}`}
                        >
                          {mov.tipoMovimiento}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-mono text-xs font-bold text-slate-700">
                        {mov.numeroFactura ? (
                          <span className="bg-teal-50 text-teal-800 border border-teal-200 px-2.5 py-0.5 rounded-lg">
                            {mov.numeroFactura}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="min-w-0">
                          <span className="block font-mono text-[10px] font-extrabold text-teal-800">{mov.productoCodigo}</span>
                          <MarqueeText
                            text={mov.productoNombre}
                            className="w-full"
                            textClassName="font-bold text-slate-900 text-sm"
                          />
                        </div>
                      </td>
                      <td className="px-6 py-4 font-mono font-bold text-slate-800">{mov.lote}</td>
                      <td className="px-6 py-4 text-right font-extrabold text-slate-900 tabular-nums">
                        {mov.tipoMovimiento === "Salida" ? "-" : "+"}
                        {mov.cantidad}
                      </td>
                      <td className="px-6 py-4 text-right font-semibold text-slate-700 tabular-nums">
                        {mov.precio != null && mov.precio > 0 ? `RD$ ${mov.precio.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="truncate max-w-[140px]" title={mov.usuario}>
                            {mov.usuario}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-600 font-medium whitespace-nowrap tabular-nums">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          <span>{formatDateTime(mov.fecha)}</span>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
            <span className="text-xs text-slate-600 font-bold tabular-nums">
              Mostrando {displayedMovements.length} de {filteredMovements.length} registros • Página {currentPage}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrevPage}
                disabled={currentPage === 1 || loading}
                className="p-2 border border-slate-300 rounded-xl bg-white hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition active:scale-95 text-slate-700 shrink-0 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={handleNextPage}
                disabled={currentPage * pageSize >= filteredMovements.length || loading}
                className="p-2 border border-slate-300 rounded-xl bg-white hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition active:scale-95 text-slate-700 shrink-0 cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
