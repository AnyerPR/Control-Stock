import { Producto } from "../types";
import MarqueeText from "./MarqueeText";
import { Layers, ArrowLeft, Plus, X, Trash2, MapPin } from "lucide-react";

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

interface BlockPanelProps {
  products: Producto[];
  blocks: Block[];
  selectedBlock: string | null;
  blockLevelFilter: string;
  blockAddMode: "selectProduct" | "selectLevel" | null;
  blockAddProduct: string | null;
  blockProductSearch: string;
  onSelectBlock: (blockId: string | null) => void;
  onSetBlockLevelFilter: (level: string) => void;
  onAddSupplyToBlock: () => void;
  onUpdateBlockProductSearch: (search: string) => void;
  onStartBlockAddProduct: (productCode: string) => void;
  onCancelBlockAdd: () => void;
  onBackToBlockProductSelection: () => void;
  onConfirmBlockLevelAssignment: (level: number) => void;
  onRemoveSupplyFromBlock: (itemId: string) => void;
  onOpenProductDetail: (productCode: string) => void;
}

export default function BlockPanel({
  products,
  blocks,
  selectedBlock,
  blockLevelFilter,
  blockAddMode,
  blockAddProduct,
  blockProductSearch,
  onSelectBlock,
  onSetBlockLevelFilter,
  onAddSupplyToBlock,
  onUpdateBlockProductSearch,
  onStartBlockAddProduct,
  onCancelBlockAdd,
  onBackToBlockProductSelection,
  onConfirmBlockLevelAssignment,
  onRemoveSupplyFromBlock,
  onOpenProductDetail
}: BlockPanelProps) {
  if (!selectedBlock) return null;

  const currentBlock = blocks.find((b) => b.id === selectedBlock) || { id: selectedBlock, items: [] };
  const levels = ["todos", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
  const filteredItems = (currentBlock.items || []).filter(
    (item) => blockLevelFilter === "todos" || item.nivel === Number(blockLevelFilter)
  );

  const searchLower = blockProductSearch.trim().toLowerCase();
  const matchedProducts = products
    .filter(
      (p) =>
        !searchLower ||
        p.nombre.toLowerCase().includes(searchLower) ||
        (p.descripcion || "").toLowerCase().includes(searchLower) ||
        p.codigo.toLowerCase().includes(searchLower)
    )
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  const targetProduct = products.find((p) => p.codigo === blockAddProduct);

  return (
    <div className="anim-card-in mb-6 rounded-3xl bg-white border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-slate-200">
        <div>
          <p className="text-xs decoration-dashed uppercase tracking-[0.24em] text-slate-400 font-bold">
            Bloque Seleccionado
          </p>
          <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <Layers className="w-6 h-6 text-teal-600" />
            Bloque {currentBlock.id}
          </h2>
        </div>
        <button
          onClick={() => onSelectBlock(null)}
          className="rounded-2xl border border-slate-200 p-2.5 text-slate-500 hover:bg-slate-50 active:scale-90 transition"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <button
            onClick={onAddSupplyToBlock}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 hover:bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition active:scale-95"
          >
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-teal-600 text-white text-md font-bold">
              +
            </span>
            <span>Asignar medicamentos</span>
          </button>

          <div className="flex flex-wrap gap-1.5">
            {levels.map((lvl) => {
              const isActive = blockLevelFilter === lvl;
              const text = lvl === "todos" ? "Todos" : `Nivel ${lvl}`;
              return (
                <button
                  key={lvl}
                  onClick={() => onSetBlockLevelFilter(lvl)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition active:scale-90 ${
                    isActive ? "bg-teal-600 text-white shadow-sm" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {text}
                </button>
              );
            })}
          </div>
        </div>

        {blockAddMode === "selectProduct" && (
          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-800">
                Seleccionar Medicamento para Bloque {currentBlock.id}
              </h4>
              <button onClick={onCancelBlockAdd} className="text-xs font-bold text-rose-600 hover:text-rose-800">
                Cancelar
              </button>
            </div>

            <div className="relative">
              <Plus className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar medicamento para agregar..."
                value={blockProductSearch}
                onChange={(e) => onUpdateBlockProductSearch(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-400"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto">
              {matchedProducts.length === 0 ? (
                <p className="col-span-full text-center text-xs text-slate-400 py-6">No se encontraron medicamentos</p>
              ) : (
                matchedProducts.map((p) => (
                  <button
                    key={p.codigo}
                    onClick={() => onStartBlockAddProduct(p.codigo)}
                    className="text-left rounded-xl border border-slate-200 bg-white p-3 hover:border-teal-400 hover:bg-teal-50/30 transition flex justify-between items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="block text-[10px] font-black text-teal-700">{p.codigo}</span>
                      <MarqueeText text={p.nombre} className="w-full" textClassName="font-semibold text-slate-800 text-sm" />
                    </div>
                    <Plus className="w-4 h-4 text-teal-600 shrink-0 ml-2" />
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {blockAddMode === "selectLevel" && targetProduct && (
          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <button
                onClick={onBackToBlockProductSelection}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Volver</span>
              </button>
              <button onClick={onCancelBlockAdd} className="text-xs font-bold text-rose-600 hover:text-rose-800">
                Cancelar
              </button>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-3 flex justify-between items-center">
              <div className="min-w-0 flex-1">
                <span className="block text-[10px] font-black text-teal-700">{targetProduct.codigo}</span>
                <MarqueeText text={targetProduct.nombre} className="w-full" textClassName="font-semibold text-slate-800 text-sm" />
              </div>
            </div>

            <p className="text-xs font-bold text-slate-500 uppercase">
              ¿En qué nivel del Bloque {currentBlock.id} desea posicionarlo?
            </p>
            <div className="grid grid-cols-5 gap-2">
              {Array.from({ length: 10 }, (_, idx) => idx + 1).map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => onConfirmBlockLevelAssignment(lvl)}
                  className="rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-bold text-slate-800 hover:bg-teal-600 hover:text-white hover:border-teal-500 shadow-sm transition active:scale-95"
                >
                  N. {lvl}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          {filteredItems.length === 0 ? (
            <div className="col-span-full rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-slate-400">
              <Layers className="w-8 h-8 mx-auto mb-2 text-slate-300 animate-pulse" />
              <p className="text-xs font-semibold mb-1">Este bloque está vacío o no hay elementos en este nivel</p>
              <p className="text-[11px] text-slate-400">Asigna medicamentos a los niveles correspondientes.</p>
            </div>
          ) : (
            filteredItems.map((item) => {
              const product = products.find((p) => p.codigo === item.productCode) || {
                nombre: "Medicamento no encontrado",
                codigo: item.productCode,
                descripcion: "No disponible"
              };
              return (
                <div
                  key={item.id}
                  className="anim-card-in card-tap flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex-1 cursor-pointer min-w-0" onClick={() => onOpenProductDetail(item.productCode)}>
                    <span className="block text-[10px] font-black text-teal-700">{item.productCode}</span>
                    <MarqueeText text={product.nombre} className="w-full" textClassName="font-semibold text-slate-800 text-sm" />
                    <p className="text-xs text-slate-500 truncate">{product.descripcion}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-black uppercase tracking-[0.14em] text-teal-800 bg-teal-50 border border-teal-100 px-2 py-1 rounded-full whitespace-nowrap shrink-0">
                      Nivel {item.nivel}
                    </span>
                    <button
                      onClick={() => onRemoveSupplyFromBlock(item.id)}
                      className="text-slate-300 hover:text-rose-600 active:scale-90 transition shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
