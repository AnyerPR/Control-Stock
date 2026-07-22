import React, { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { collection, doc, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { Producto, Usuario, Lote, Movimiento } from "../types";
import { playSound } from "../utils/audio";
import { FileSpreadsheet, Upload, AlertCircle, CheckCircle, HelpCircle, X } from "lucide-react";

interface CargaMasivaProps {
  products: Producto[];
  currentUser: Usuario | null;
  onImportComplete: (updatedProducts: Producto[]) => void;
  showToast: (message: string) => void;
  activeCatalogId: string;
}

interface ImportSummary {
  total: number;
  imported: number;
  notFound: string[];
  duplicates: string[];
  errors: string[];
}

export default function CargaMasiva({ products, currentUser, onImportComplete, showToast, activeCatalogId }: CargaMasivaProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragging(true);
    } else if (e.type === "dragleave") {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const normalizeDate = (val: any): string => {
    if (!val) return "";
    if (typeof val === "number") {
      // Excel serial date number
      const date = new Date((val - 25569) * 86400 * 1000);
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    const cleanStr = String(val).trim();
    // Check format DD/MM/YYYY or DD-MM-YYYY
    const ddmmyyyy = cleanStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (ddmmyyyy) {
      return `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, "0")}-${ddmmyyyy[1].padStart(2, "0")}`;
    }
    // Check format YYYY/MM/DD or YYYY-MM-DD
    const yyyymmdd = cleanStr.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (yyyymmdd) {
      return `${yyyymmdd[1]}-${yyyymmdd[2].padStart(2, "0")}-${yyyymmdd[3].padStart(2, "0")}`;
    }
    const parsedDate = new Date(cleanStr);
    if (!isNaN(parsedDate.getTime())) {
      const y = parsedDate.getFullYear();
      const m = String(parsedDate.getMonth() + 1).padStart(2, "0");
      const d = String(parsedDate.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    return cleanStr;
  };

  const cleanHeader = (str: string): string => {
    return str
      .toLowerCase()
      .trim()
      .replace(/[áàäâ]/g, "a")
      .replace(/[éèëê]/g, "e")
      .replace(/[íìïî]/g, "i")
      .replace(/[óòöô]/g, "o")
      .replace(/[úùüû]/g, "u")
      .replace(/[\.\s]+/g, "");
  };

  const processFile = (file: File) => {
    setLoading(true);
    setSummary(null);
    playSound("open");

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rawRows = XLSX.utils.sheet_to_json(worksheet) as any[];

        if (rawRows.length === 0) {
          setSummary({
            total: 0,
            imported: 0,
            notFound: [],
            duplicates: [],
            errors: ["El archivo de Excel está vacío."]
          });
          setLoading(false);
          playSound("negative");
          return;
        }

        const notFound: string[] = [];
        const duplicates: string[] = [];
        const errors: string[] = [];
        let importedCount = 0;

        // Map existing products by name and code for fast lookup (filtered by activeCatalogId)
        const productsMapByName = new Map<string, Producto>();
        const productsMapByCode = new Map<string, Producto>();
        products.forEach((p) => {
          const prodCatalogId = p.catalogId || "default-cat";
          if (prodCatalogId === activeCatalogId) {
            const cleanName = p.nombre.toLowerCase().replace(/\s+/g, "");
            productsMapByName.set(cleanName, p);
            productsMapByCode.set(p.codigo.toLowerCase(), p);
          }
        });

        const productsToUpdate = new Map<string, Producto>();
        const movementLogs: Movimiento[] = [];

        for (let i = 0; i < rawRows.length; i++) {
          const row = rawRows[i];
          const rowNum = i + 2; // Rows are 1-based, plus header row is row 1, so data starts at row 2

          let supplyNameOrCode = "";
          let lotNum = "";
          let expDateRaw = "";
          let qty = 0;
          let priceVal = 0;

          // Align headers dynamically
          Object.keys(row).forEach((key) => {
            const cleanKey = cleanHeader(key);
            const val = row[key];

            if (["producto", "nombre", "medicamento", "insumo", "codigo"].includes(cleanKey)) {
              supplyNameOrCode = String(val).trim();
            } else if (["lote", "nºdelote", "numerodelote", "numlote"].includes(cleanKey)) {
              lotNum = String(val).trim();
            } else if (["vencimiento", "fechadevencimiento", "fecha", "vence", "fechavencimiento"].includes(cleanKey)) {
              expDateRaw = normalizeDate(val);
            } else if (["cantidad", "cant", "unidades"].includes(cleanKey)) {
              qty = Number(val);
            } else if (["precio", "preciounitario", "costo", "valor"].includes(cleanKey)) {
              priceVal = Number(val);
            }
          });

          if (!supplyNameOrCode) {
            errors.push(`Fila ${rowNum}: Nombre o código del suministro no especificado.`);
            continue;
          }

          // Lookup product
          const cleanLookup = supplyNameOrCode.toLowerCase().replace(/\s+/g, "");
          let product = productsMapByCode.get(cleanLookup) || productsMapByName.get(cleanLookup);

          if (!product) {
            notFound.push(`Fila ${rowNum}: "${supplyNameOrCode}" (No se encuentra en el inventario actual).`);
            continue;
          }

          if (!lotNum) {
            errors.push(`Fila ${rowNum}: "${supplyNameOrCode}" - Número de lote vacío.`);
            continue;
          }

          if (isNaN(qty) || qty <= 0) {
            errors.push(`Fila ${rowNum}: "${supplyNameOrCode}" - Cantidad inválida o menor a 1 (${qty || 0}).`);
            continue;
          }

          if (isNaN(priceVal) || priceVal < 0) {
            errors.push(`Fila ${rowNum}: "${supplyNameOrCode}" - Precio inválido (${priceVal || 0}).`);
            continue;
          }

          const expiration = new Date(expDateRaw + "T00:00:00");
          if (!expDateRaw || isNaN(expiration.getTime())) {
            errors.push(`Fila ${rowNum}: "${supplyNameOrCode}" - Fecha de vencimiento vacía o inválida (${expDateRaw || ""}).`);
            continue;
          }

          // Check if this lot already exists in the local state or database
          const activeProduct = productsToUpdate.get(product.codigo) || JSON.parse(JSON.stringify(product));
          if (activeProduct.lotes.some((l: Lote) => l.numeroLote.toLowerCase() === lotNum.toLowerCase())) {
            duplicates.push(`Fila ${rowNum}: "${supplyNameOrCode}" - El Lote "${lotNum}" ya existe para este producto.`);
            continue;
          }

          const newLot: Lote = {
            id: `lote-${product.codigo}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            numeroLote: lotNum,
            cantidad: qty,
            cantidadF: qty,
            fechaVencimiento: expDateRaw,
            precio: priceVal,
            loteFisico: "Carga Masiva",
            fechaFisica: expDateRaw
          };

          activeProduct.lotes.push(newLot);
          activeProduct.updatedAt = Date.now();
          productsToUpdate.set(product.codigo, activeProduct);

          const movement: Movimiento = {
            id: `mov-${product.codigo}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            productoCodigo: product.codigo,
            productoNombre: product.nombre,
            lote: lotNum,
            cantidad: qty,
            precio: priceVal,
            tipoMovimiento: "Entrada",
            usuario: currentUser ? `${currentUser.nombre} (${currentUser.usuario})` : "Carga Masiva",
            fecha: new Date().toISOString(),
            timestamp: Date.now(),
            catalogId: activeCatalogId
          };

          movementLogs.push(movement);
          importedCount++;
        }

        if (productsToUpdate.size > 0) {
          const batch = writeBatch(db);
          const productsCol = collection(db, "productos");
          const movementsCol = collection(db, "movimientos");

          for (const [code, updatedProd] of productsToUpdate.entries()) {
            const prodRef = doc(productsCol, code.replace(/\//g, "_"));
            batch.set(prodRef, { ...updatedProd, verificado: false });
          }

          for (const mov of movementLogs) {
            const movRef = doc(movementsCol, mov.id);
            batch.set(movRef, mov);
          }

          await batch.commit();

          // Construct final products array to notify App.tsx
          const finalProducts = products.map((p) => {
            const updated = productsToUpdate.get(p.codigo);
            return updated ? { ...updated, verificado: false } : p;
          });

          onImportComplete(finalProducts);
          showToast(`Se importaron ${importedCount} lotes de forma masiva.`);
        }

        setSummary({
          total: rawRows.length,
          imported: importedCount,
          notFound,
          duplicates,
          errors
        });
        playSound("positive");
      } catch (err) {
        console.error("Error processing Excel file:", err);
        setSummary({
          total: 0,
          imported: 0,
          notFound: [],
          duplicates: [],
          errors: [`Error fatal de lectura: ${err instanceof Error ? err.message : String(err)}`]
        });
        playSound("negative");
      } finally {
        setLoading(false);
      }
    };

    reader.readAsArrayBuffer(file);
  };

  const triggerFileBrowser = () => {
    if (loading) return;
    fileInputRef.current?.click();
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
        <h3 className="text-lg font-bold text-slate-900 mb-2">Importar Inventario desde Excel</h3>
        <p className="text-slate-500 text-sm mb-6">
          Sube un archivo de Excel (.xlsx o .xls) para registrar y crear nuevos lotes de medicamentos y suministros.
          El archivo debe incluir columnas como:{" "}
          <span className="font-semibold text-teal-800">Medicamento (o Nombre), Lote, Fecha Vencimiento, Cantidad, Precio</span>.
        </p>

        <form
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          onSubmit={(e) => e.preventDefault()}
          onClick={triggerFileBrowser}
          className={`flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-2xl transition cursor-pointer text-center ${
            isDragging ? "border-teal-500 bg-teal-50" : "border-slate-300 hover:border-teal-400 bg-slate-50 hover:bg-slate-50/50"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx, .xls"
            onChange={handleFileChange}
            className="hidden"
            disabled={loading}
          />

          {loading ? (
            <div className="space-y-3">
              <div className="w-10 h-10 border-4 border-teal-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="text-slate-800 font-semibold text-sm">Procesando y guardando datos en la nube...</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="p-3 bg-teal-100 text-teal-700 rounded-full w-12 h-12 flex items-center justify-center mx-auto shadow-sm">
                <Upload className="w-6 h-6 animate-pulse" />
              </div>
              <p className="text-slate-800 font-bold text-sm">Arrastra y suelta tu archivo Excel aquí</p>
              <p className="text-xs text-slate-400">o haz clic para explorar tu dispositivo (.xlsx, .xls)</p>
            </div>
          )}
        </form>
      </div>

      {summary && (
        <div className="anim-card-in space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-center">
              <span className="block text-2xl font-black text-slate-800">{summary.total}</span>
              <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Filas Leídas</span>
            </div>

            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 text-center">
              <span className="block text-2xl font-black text-emerald-700">{summary.imported}</span>
              <span className="text-xs text-emerald-600 font-bold uppercase tracking-wider">Importados</span>
            </div>

            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 text-center">
              <span className="block text-2xl font-black text-amber-700">{summary.notFound.length}</span>
              <span className="text-xs text-amber-600 font-bold uppercase tracking-wider">No Encontrados</span>
            </div>

            <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4 text-center">
              <span className="block text-2xl font-black text-rose-700">
                {summary.errors.length + summary.duplicates.length}
              </span>
              <span className="text-xs text-rose-600 font-bold uppercase tracking-wider">Errores / Duplicados</span>
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-600" />
              <h4 className="font-bold text-slate-900 text-sm">Resumen Detallado del Procesamiento</h4>
            </div>

            {summary.imported > 0 && (
              <div className="p-6 border-b border-slate-100 space-y-2">
                <div className="flex items-center gap-2 text-emerald-700 font-bold text-xs uppercase tracking-wider">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                  <span>Lotes importados correctamente ({summary.imported})</span>
                </div>
                <p className="text-xs text-slate-500">
                  Los lotes se han insertado exitosamente en Firestore. Se ha recalculado la cantidad física y se han generado sus respectivos registros en el historial de movimientos de entrada.
                </p>
              </div>
            )}

            {summary.notFound.length > 0 && (
              <div className="p-6 border-b border-slate-100 space-y-3">
                <div className="flex items-center gap-2 text-amber-700 font-bold text-xs uppercase tracking-wider">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                  <span>Suministros No Encontrados en Inventario ({summary.notFound.length})</span>
                </div>
                <p className="text-xs text-slate-500">
                  Los siguientes medicamentos en la planilla de Excel no coinciden con ningún código o nombre exacto registrado en el catálogo. <span className="font-semibold text-rose-700">No fueron importados</span>. Deberás registrarlos primero en la sección de suministros:
                </p>
                <div className="max-h-48 overflow-y-auto bg-amber-50/50 rounded-xl p-3 border border-amber-100 divide-y divide-amber-100/50 font-mono text-[11px] text-amber-800 space-y-1">
                  {summary.notFound.map((item, idx) => (
                    <div key={idx} className="py-1 first:pt-0 last:pb-0 flex items-start gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {summary.duplicates.length > 0 && (
              <div className="p-6 border-b border-slate-100 space-y-3">
                <div className="flex items-center gap-2 text-rose-700 font-bold text-xs uppercase tracking-wider">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
                  <span>Lotes Duplicados Omitidos ({summary.duplicates.length})</span>
                </div>
                <p className="text-xs text-slate-500">
                  Los siguientes lotes ya se encontraban registrados en la base de datos para estos medicamentos. Se ignoraron para evitar alterar el stock original de forma incorrecta:
                </p>
                <div className="max-h-48 overflow-y-auto bg-rose-50/40 rounded-xl p-3 border border-rose-100 divide-y divide-rose-100/50 font-mono text-[11px] text-rose-800 space-y-1">
                  {summary.duplicates.map((item, idx) => (
                    <div key={idx} className="py-1 first:pt-0 last:pb-0 flex items-start gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {summary.errors.length > 0 && (
              <div className="p-6 space-y-3">
                <div className="flex items-center gap-2 text-rose-700 font-bold text-xs uppercase tracking-wider">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
                  <span>Errores de Validación ({summary.errors.length})</span>
                </div>
                <p className="text-xs text-slate-500">
                  Las siguientes filas contienen datos inconsistentes o tipos inválidos (ej. cantidades menores a 1, fechas de vencimiento corruptas, etc.) y fueron omitidas:
                </p>
                <div className="max-h-48 overflow-y-auto bg-red-50/40 rounded-xl p-3 border border-red-100 divide-y divide-red-100/50 font-mono text-[11px] text-rose-900 space-y-1">
                  {summary.errors.map((item, idx) => (
                    <div key={idx} className="py-1 first:pt-0 last:pb-0 flex items-start gap-1.5">
                      <X className="w-3.5 h-3.5 mt-0.5 text-rose-600 shrink-0" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
