import { Producto } from "../types";
import MarqueeText from "./MarqueeText";
import { ShoppingCart, Send, Trash2, Search, Plus, X } from "lucide-react";

interface OrderItem {
  productCode: string;
  codigo: string;
  nombre: string;
  descripcion?: string;
  loteId: string;
  loteNumero: string;
  fecha: string;
  precio: number;
  cantidadAprobada: number;
}

interface BlockItem {
  id: string;
  productCode: string;
  nivel: number;
}

interface Block {
  id: string;
  items: BlockItem[];
  updatedAt: number;
}

interface OrderPanelProps {
  products: Producto[];
  orderItems: OrderItem[];
  orderSelectedProduct: string | null;
  orderSelectedLot: string | null;
  orderSelectedQuantity: number | null;
  orderProductSearch: string;
  onCloseOrderPanel: () => void;
  onClearOrder: () => void;
  onCompleteOrder: () => void;
  onShareOrderByWhatsApp: () => void;
  onUpdateOrderItemQuantity: (index: number, quantity: number) => void;
  onRemoveOrderItem: (index: number) => void;
  onUpdateOrderProductSearch: (search: string) => void;
  onSelectOrderProduct: (productCode: string | null) => void;
  onSetOrderSelectedLot: (lotId: string | null) => void;
  onSetOrderSelectedQuantity: (quantity: number | null) => void;
  onAddOrderItem: () => void;
  blocks: Block[];
  onOpenProductDetail?: (productCode: string) => void;
  availableCatalogos: any[];
  orderCatalogId: string;
  onSetOrderCatalogId: (catalogId: string) => void;
}

export default function OrderPanel({
  products,
  orderItems,
  orderSelectedProduct,
  orderSelectedLot,
  orderSelectedQuantity,
  orderProductSearch,
  onCloseOrderPanel,
  onClearOrder,
  onCompleteOrder,
  onShareOrderByWhatsApp,
  onUpdateOrderItemQuantity,
  onRemoveOrderItem,
  onUpdateOrderProductSearch,
  onSelectOrderProduct,
  onSetOrderSelectedLot,
  onSetOrderSelectedQuantity,
  onAddOrderItem,
  blocks,
  onOpenProductDetail,
  availableCatalogos,
  orderCatalogId,
  onSetOrderCatalogId
}: OrderPanelProps) {
  const searchLower = orderProductSearch.trim().toLowerCase();
  const matchedProducts = products
    .filter(
      (p) =>
        p.catalogId === orderCatalogId &&
        (!searchLower ||
          p.nombre.toLowerCase().includes(searchLower) ||
          (p.descripcion || "").toLowerCase().includes(searchLower) ||
          p.codigo.toLowerCase().includes(searchLower))
    )
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  const targetProduct = products.find((p) => p.codigo === orderSelectedProduct);

  const getProductCoordinates = (productCode: string) => {
    return blocks
      .flatMap((b) =>
        (b.items || [])
          .filter((item) => item.productCode === productCode)
          .map((item) => `Bl. ${b.id} • N. ${item.nivel}`)
      )
      .join(", ") || "No asignado";
  };

  const getDaysToExpiration = (dateStr: string) => {
    if (!dateStr) return Infinity;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expDate = new Date(dateStr + "T00:00:00");
    return Math.ceil((expDate.getTime() - today.getTime()) / 86400000);
  };

  const getNearestExpirationDate = (prod: Producto) => {
    if (!prod.lotes || prod.lotes.length === 0) return "—";
    const sortedDates = prod.lotes
      .map((l) => l.fechaVencimiento)
      .filter(Boolean)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    return sortedDates.length === 0 ? "—" : new Date(sortedDates[0]).toLocaleDateString("es-DO");
  };

  const selectedLotObj = targetProduct?.lotes.find((l) => l.id === orderSelectedLot);

  return (
    <div className="anim-card-in mb-6 rounded-3xl bg-white border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-6 py-4 border-b border-slate-200">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-slate-400 font-bold">
            Salida de Medicamentos
          </p>
          <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <ShoppingCart className="w-6 h-6 text-teal-600" />
            Pedido Activo
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {orderItems.length > 0 && (
            <>
              <button
                onClick={onCompleteOrder}
                className="rounded-xl bg-teal-600 hover:bg-teal-700 text-white px-3 py-2 text-xs font-bold transition shadow-sm cursor-pointer"
              >
                Completar Pedido
              </button>
              <button
                onClick={onShareOrderByWhatsApp}
                className="rounded-xl border border-teal-500 bg-teal-50 text-teal-700 hover:bg-teal-100 px-3 py-2 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                WhatsApp
              </button>
              <button
                onClick={onClearOrder}
                className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 px-3 py-2 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Limpiar
              </button>
            </>
          )}
          <button
            onClick={onCloseOrderPanel}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 transition cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Selector de Catálogo */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-xs font-black uppercase text-slate-500 tracking-wider">Catálogo de Trabajo *</h3>
            <p className="text-xs text-slate-400">Seleccione el catálogo de origen para seleccionar insumos</p>
          </div>
          <select
            value={orderCatalogId}
            onChange={(e) => onSetOrderCatalogId(e.target.value)}
            className="w-full sm:max-w-xs rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-teal-400 cursor-pointer"
          >
            <option value="">-- Seleccione un catálogo --</option>
            {availableCatalogos.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.nombre}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto border border-slate-200 rounded-2xl bg-slate-50">
          <table className="min-w-[650px] w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
                <th className="px-4 py-3">Código</th>
                <th className="px-4 py-3">Nombre</th>
                <th className="px-4 py-3">Lote</th>
                <th className="px-4 py-3">Vencimiento</th>
                <th className="px-4 py-3 text-right">Cantidad Solicitada</th>
                <th className="px-4 py-3 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {orderItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400 font-medium bg-white">
                    No hay productos en el pedido. Selecciona un medicamento e introduce un lote abajo.
                  </td>
                </tr>
              ) : (
                orderItems.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/50 bg-white transition">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => onOpenProductDetail?.(item.productCode)}
                        className="text-teal-800 font-extrabold hover:underline cursor-pointer text-left focus:outline-none"
                        title="Ver detalles del insumo"
                      >
                        {item.codigo}
                      </button>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-800 max-w-[200px]">
                      <button
                        onClick={() => onOpenProductDetail?.(item.productCode)}
                        className="font-semibold text-slate-800 text-sm hover:underline cursor-pointer text-left w-full focus:outline-none"
                        title="Ver detalles del insumo"
                      >
                        <MarqueeText text={item.nombre} className="w-full" textClassName="font-semibold text-slate-800 text-sm" />
                      </button>
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-slate-600">{item.loteNumero}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {new Date(item.fecha + "T00:00:00").toLocaleDateString("es-DO")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <input
                        type="number"
                        min="1"
                        value={item.cantidadAprobada}
                        onChange={(e) => onUpdateOrderItemQuantity(idx, Number(e.target.value))}
                        className="w-20 text-right rounded-lg border border-slate-200 px-2 py-1.5 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-teal-400 bg-slate-50 font-sans"
                      />
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <button
                        onClick={() => onOpenProductDetail?.(item.productCode)}
                        className="text-xs font-bold text-teal-600 hover:text-teal-800 hover:underline cursor-pointer"
                      >
                        Ver Detalle
                      </button>
                      <span className="text-slate-300">|</span>
                      <button
                        onClick={() => onRemoveOrderItem(idx)}
                        className="text-xs font-bold text-rose-600 hover:text-rose-800 hover:underline cursor-pointer"
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
            <h3 className="text-xs font-black uppercase text-slate-500 tracking-wider">1. Buscar Medicamento</h3>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Filtrar por nombre, descripción..."
                value={orderProductSearch}
                onChange={(e) => onUpdateOrderProductSearch(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-400"
              />
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {!orderCatalogId ? (
                <div className="text-center text-xs text-amber-600 bg-amber-50/50 border border-amber-200/60 rounded-2xl p-4 py-8">
                  <span className="text-2xl block mb-2">⚠️</span>
                  <span className="font-bold uppercase tracking-wider text-[10px]">No se muestran productos</span>
                  <p className="text-slate-500 mt-1.5 font-medium">Por favor seleccione un catálogo arriba primero.</p>
                </div>
              ) : matchedProducts.length === 0 ? (
                <p className="text-center text-xs text-slate-400 py-6">No se encontraron medicamentos</p>
              ) : (
                matchedProducts.map((p) => {
                  const coords = getProductCoordinates(p.codigo);
                  const totalStock = p.lotes.reduce((sum, l) => sum + Number(l.cantidad || 0), 0);
                  const isSelected = orderSelectedProduct === p.codigo;

                  return (
                    <div
                      key={p.codigo}
                      onClick={() => onSelectOrderProduct(p.codigo)}
                      className={`w-full text-left rounded-xl border p-3 flex justify-between items-start transition cursor-pointer ${
                        isSelected
                          ? "border-teal-500 bg-white shadow-sm ring-1 ring-teal-200"
                          : "border-slate-200 bg-white hover:bg-slate-100/50"
                      }`}
                    >
                      <div className="min-w-0 pr-2 flex-1">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="block text-[9px] font-black text-teal-700">{p.codigo}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenProductDetail?.(p.codigo);
                            }}
                            className="text-[9px] text-teal-600 hover:text-teal-800 hover:underline font-bold cursor-pointer"
                          >
                            (Ver Detalle)
                          </button>
                        </div>
                        <MarqueeText text={p.nombre} className="w-full" textClassName="font-bold text-slate-800 text-xs" />
                        <p className="text-[10px] text-slate-500 line-clamp-1">{coords}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="block font-black text-xs text-slate-800">{totalStock} und</span>
                        <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Stock</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-4">
            <h3 className="text-xs font-black uppercase text-slate-500 tracking-wider">2. Seleccionar Lote & Cantidad</h3>
            {targetProduct ? (
              <div className="space-y-4">
                <div className="bg-white rounded-xl border border-slate-200 p-3">
                  <span className="block text-[9px] font-black text-teal-700">{targetProduct.codigo}</span>
                  <MarqueeText text={targetProduct.nombre} className="w-full" textClassName="font-bold text-slate-800 text-sm" />
                  {targetProduct.descripcion && (
                    <p className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-lg p-2.5 mt-2 font-medium italic">
                      Descripción: {targetProduct.descripcion}
                    </p>
                  )}
                  <p className="text-xs text-slate-500 mt-2">
                    Vencimiento más próximo: {getNearestExpirationDate(targetProduct)}
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    Selecciona Lote
                  </label>
                  <select
                    value={orderSelectedLot || ""}
                    onChange={(e) => onSetOrderSelectedLot(e.target.value || null)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-teal-400"
                  >
                    <option value="">-- Elige lote disponible --</option>
                    {targetProduct.lotes
                      .filter((l) => Math.max(Number(l.cantidad || 0), Number(l.cantidadF || 0)) > 0)
                      .map((l) => {
                        const daysTo = getDaysToExpiration(l.fechaVencimiento);
                        let prefix = "🟢";
                        let suffix = "";
                        if (daysTo < 0) {
                          prefix = "🔴 [VENCIDO]";
                          suffix = ` (HACE ${Math.abs(daysTo)} DÍAS)`;
                        } else if (daysTo <= 30) {
                          prefix = "⚠️ [POR VENCER]";
                          suffix = ` (EN ${daysTo} DÍAS)`;
                        } else if (daysTo <= 90) {
                          prefix = "🟡 [PRÓXIMO]";
                          suffix = ` (EN ${daysTo} DÍAS)`;
                        }
                        return (
                          <option key={l.id} value={l.id}>
                            {prefix} Lote: {l.numeroLote} • {new Date(l.fechaVencimiento + "T00:00:00").toLocaleDateString("es-DO")} • (Sis: {l.cantidad || 0} | Fís: {l.cantidadF || 0} und.){suffix}
                          </option>
                        );
                      })}
                  </select>
                </div>

                {selectedLotObj && (() => {
                  const maxAvailable = Math.max(Number(selectedLotObj.cantidad || 0), Number(selectedLotObj.cantidadF || 0));
                  return (
                    <div className="anim-card-in space-y-3">
                      <div className={`border p-3 rounded-xl ${(() => {
                        const dTo = getDaysToExpiration(selectedLotObj.fechaVencimiento);
                        if (dTo < 0) return "bg-rose-50 border-rose-200 shadow-sm";
                        if (dTo <= 30) return "bg-amber-50 border-amber-200 shadow-sm animate-pulse";
                        if (dTo <= 90) return "bg-yellow-50 border-yellow-200 shadow-sm";
                        return "bg-white border-slate-200";
                      })()}`}>
                        <div className="flex justify-between items-center text-xs mb-1.5 pb-1.5 border-b border-slate-100 font-semibold">
                          <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">Expiración:</span>
                          <span className={(() => {
                            const dTo = getDaysToExpiration(selectedLotObj.fechaVencimiento);
                            if (dTo < 0) return "text-rose-700 font-extrabold";
                            if (dTo <= 30) return "text-amber-700 font-extrabold";
                            if (dTo <= 90) return "text-yellow-700 font-bold";
                            return "text-emerald-700 font-bold";
                          })()}>
                            {(() => {
                              const dTo = getDaysToExpiration(selectedLotObj.fechaVencimiento);
                              if (dTo < 0) return `¡VENCIDO! (${Math.abs(dTo)}d atrás)`;
                              if (dTo <= 30) return `¡POR VENCER! (en ${dTo}d)`;
                              if (dTo <= 90) return `Vence pronto (en ${dTo}d)`;
                              return `Vigente (en ${dTo}d)`;
                            })()}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-500 font-semibold">Ubicación Física:</span>
                          <span className="font-bold text-slate-800">{selectedLotObj.loteFisico || "No especificado"}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs mt-1.5">
                          <span className="text-slate-500 font-semibold">Precio de Adquisición:</span>
                          <span className="font-bold text-slate-800">RD$ {selectedLotObj.precio.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs mt-1.5 border-t border-slate-100 pt-1.5 font-semibold text-teal-800">
                          <span>Stock Sistema:</span>
                          <span>{selectedLotObj.cantidad || 0} und.</span>
                        </div>
                        <div className="flex justify-between items-center text-xs font-semibold text-blue-800">
                          <span>Stock Físico:</span>
                          <span>{selectedLotObj.cantidadF || 0} und.</span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                          Cantidad a Despachar
                        </label>
                        <input
                          type="number"
                          min="1"
                          max={maxAvailable}
                          value={orderSelectedQuantity || ""}
                          onChange={(e) =>
                            onSetOrderSelectedQuantity(e.target.value ? Number(e.target.value) : null)
                          }
                          placeholder={`1 - ${maxAvailable} unidades`}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-teal-400"
                        />
                      </div>

                      <button
                        onClick={onAddOrderItem}
                        disabled={!orderSelectedLot || !orderSelectedQuantity || orderSelectedQuantity <= 0 || orderSelectedQuantity > maxAvailable}
                        className="w-full rounded-xl bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white py-3 text-xs font-bold transition shadow-sm disabled:cursor-not-allowed uppercase tracking-wider cursor-pointer"
                      >
                        Añadir al pedido
                      </button>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <p className="text-center text-xs text-slate-400 py-12">
                {!orderCatalogId
                  ? "Por favor, seleccione un catálogo de trabajo primero."
                  : "Por favor, selecciona un suministro a la izquierda."}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
