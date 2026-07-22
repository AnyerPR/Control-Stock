import { useState, useEffect } from "react";
import { collection, query, orderBy, limit, getDocs, startAfter, getCountFromServer, where } from "firebase/firestore";
import { db } from "../firebase";
import { Movimiento, Usuario } from "../types";
import { playSound } from "../utils/audio";
import { Calendar, Search, History, RefreshCw, ChevronLeft, ChevronRight, User } from "lucide-react";
import MarqueeText from "./MarqueeText";

interface HistorialMovimientosProps {
  activeCatalogId: string;
  currentUser: Usuario | null;
}

export default function HistorialMovimientos({ activeCatalogId, currentUser }: HistorialMovimientosProps) {
  const [allMovements, setAllMovements] = useState<Movimiento[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>("todos");
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";

  const fetchMovements = async () => {
    setLoading(true);
    if (isLocalFileMode) {
      let stored = localStorage.getItem("offline_movimientos");
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
      const colRef = collection(db, "movimientos");
      // Use simple query with ordering on a single field to avoid needing composite indexes.
      // Limit to 2000 items as a safe guard.
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
  }, [isLocalFileMode]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterType, searchTerm]);

  const handleNextPage = () => {
    const totalCount = filteredMovements.length;
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

  const filteredMovements = allMovements.filter((mov) => {
    // 0. Filter by catalog ID
    const movCatalogId = mov.catalogId || "default-cat";
    if (movCatalogId !== activeCatalogId) {
      return false;
    }

    // 0b. Strict access control by department / catalog permissions
    if (currentUser) {
      const canSeeAll = currentUser.rol === "Administrador" || currentUser.departamento === "Almacén y Suministro" || currentUser.departamento === "Farmacia";
      if (!canSeeAll) {
        if (currentUser.departamento === "Laboratorio" && movCatalogId !== "laboratorio") {
          return false;
        }
        if (currentUser.departamento === "Odontología" && movCatalogId !== "odontologia") {
          return false;
        }
        const userCats = currentUser.catalogos || [];
        if (userCats.length > 0 && !userCats.includes(movCatalogId)) {
          return false;
        }
      }
    }

    // 1. Filter by movement type
    if (filterType !== "todos" && mov.tipoMovimiento !== filterType) {
      return false;
    }
    // 2. Filter by search query
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      mov.productoCodigo.toLowerCase().includes(search) ||
      mov.productoNombre.toLowerCase().includes(search) ||
      mov.lote.toLowerCase().includes(search) ||
      mov.usuario.toLowerCase().includes(search)
    );
  });

  const displayedMovements = filteredMovements.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return "—";
    const date = new Date(dateStr);
    return isNaN(date.getTime())
      ? "—"
      : date.toLocaleString("es-DO", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        });
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
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <History className="w-5 h-5 text-teal-600" />
              Historial de Movimientos de Stock
            </h3>
            <p className="text-slate-500 text-xs mt-1">
              Sigue el rastro de entradas, salidas y ajustes del inventario físico
            </p>
          </div>
          <div>
            <button
              onClick={handleRefresh}
              className="p-2.5 border border-slate-200 hover:border-teal-400 bg-slate-50 hover:bg-slate-100 rounded-xl transition text-slate-600 hover:text-teal-600 active:scale-95 flex items-center justify-center shadow-sm"
              title="Actualizar historial"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative col-span-2">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por código, nombre o lote..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-400"
            />
          </div>
          <div>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-400 font-semibold text-slate-700"
            >
              <option value="todos">Todos los movimientos</option>
              <option value="Entrada">Entradas</option>
              <option value="Salida">Salidas</option>
              <option value="Ajuste">Ajustes</option>
            </select>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[800px] w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <th className="px-6 py-4">Tipo</th>
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
                  <td colSpan={7} className="text-center py-12">
                    <div className="w-8 h-8 border-4 border-teal-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                    <span className="text-xs text-slate-500 font-medium">Cargando registros...</span>
                  </td>
                </tr>
              ) : filteredMovements.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-slate-400">
                    <History className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    <p className="text-xs font-semibold">No se encontraron movimientos registrados</p>
                  </td>
                </tr>
              ) : (
                displayedMovements.map((mov) => (
                  <tr key={mov.id} className="hover:bg-slate-50/50 transition">
                    <td className="px-6 py-4">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${getMovementBadgeClass(mov.tipoMovimiento)}`}>
                        {mov.tipoMovimiento}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="min-w-0">
                        <span className="block text-[10px] font-black text-teal-700">{mov.productoCodigo}</span>
                        <MarqueeText text={mov.productoNombre} className="w-full" textClassName="font-semibold text-slate-800 text-sm" />
                      </div>
                    </td>
                    <td className="px-6 py-4 font-mono font-bold text-slate-700">{mov.lote}</td>
                    <td className="px-6 py-4 text-right font-bold text-slate-800">
                      {mov.tipoMovimiento === "Salida" ? "-" : "+"}
                      {mov.cantidad}
                    </td>
                    <td className="px-6 py-4 text-right font-semibold text-slate-500">
                      {mov.precio != null && mov.precio > 0 ? `RD$ ${mov.precio.toFixed(2)}` : "—"}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate max-w-[140px]" title={mov.usuario}>
                          {mov.usuario}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-500 whitespace-nowrap">
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
          <span className="text-xs text-slate-500 font-semibold">
            Mostrando {displayedMovements.length} de {filteredMovements.length} registros • Página {currentPage}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrevPage}
              disabled={currentPage === 1 || loading}
              className="p-2 border border-slate-200 rounded-xl bg-white hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition active:scale-95 text-slate-600 shrink-0"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={handleNextPage}
              disabled={currentPage * pageSize >= filteredMovements.length || loading}
              className="p-2 border border-slate-200 rounded-xl bg-white hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition active:scale-95 text-slate-600 shrink-0"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
