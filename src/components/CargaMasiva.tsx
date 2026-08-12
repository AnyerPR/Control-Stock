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
  performImport?: (items: any[], progressCb?: (done: number, total: number) => void) => Promise<any>;
}

interface ImportSummary {
  total: number;
  imported: number;
  notFound: string[];
  duplicates: string[];
  errors: string[];
}

export default function CargaMasiva({ products, currentUser, onImportComplete, showToast, activeCatalogId, performImport }: CargaMasivaProps) {
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

        // Read sheet as rows to allow ignoring first 9 rows and using row 10 as headers
        const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false });
        if (!rows || rows.length < 10) {
          setSummary({ total: 0, imported: 0, notFound: [], duplicates: [], errors: ["La planilla no contiene la fila de encabezados en la fila 10."] });
          setLoading(false);
          playSound("negative");
          return;
        }

        const headerRow = rows[9] as any[]; // 0-based index -> row 10
        if (!headerRow || headerRow.length === 0) {
          setSummary({ total: 0, imported: 0, notFound: [], duplicates: [], errors: ["Encabezado (fila 10) vacío o no válido."] });
          setLoading(false);
          playSound("negative");
          return;
        }

        // Build header map: normalized header -> column index
        const headerMap = new Map<string, number>();
        headerRow.forEach((h, idx) => {
          if (!h && h !== 0) return;
          const key = cleanHeader(String(h));
          headerMap.set(key, idx);
        });

        // Required headers detection
        const requiredCandidates = ["suministro", "cantidad", "costounit", "costo", "cantidad"]; // variations
        const hasSuministro = [...headerMap.keys()].some((k) => k.includes("suministro") || k.includes("producto") || k.includes("nombre") || k.includes("medicamento") || k.includes("insumo"));
        const hasCantidad = [...headerMap.keys()].some((k) => k.includes("cantidad") || k.includes("cant"));
        const hasCosto = [...headerMap.keys()].some((k) => k.includes("costounit") || k.includes("costo") || k.includes("precio") || k.includes("preciounitario") || k.includes("valor"));

        if (!hasSuministro || !hasCantidad || !hasCosto) {
          setSummary({ total: 0, imported: 0, notFound: [], duplicates: [], errors: ["Encabezados obligatorios faltantes (Suministro, Cantidad, Costo Unit.)."] });
          setLoading(false);
          playSound("negative");
          return;
        }

        // Parse rows starting at row index 10 (0-based)
        const previewItems: any[] = [];
        const errors: string[] = [];
        const ignored = { empty: 0 };

        for (let r = 10; r < rows.length; r++) {
          const raw = rows[r] as any[];
          if (!raw || raw.length === 0 || raw.every((c) => c === null || c === undefined || String(c).trim() === "")) {
            ignored.empty++;
            continue;
          }

          const getCell = (names: string[]) => {
            for (const n of names) {
              const key = cleanHeader(n);
              if (headerMap.has(key)) return raw[headerMap.get(key)!];
            }
            // fallback: try keys in headerMap that include the names
            for (const [k, idx] of headerMap.entries()) {
              for (const n of names) {
                if (k.includes(cleanHeader(n))) return raw[idx];
              }
            }
            return undefined;
          };

          const suministro = getCell(["Suministro", "Producto", "Nombre", "Medicamento", "Insumo"]);
          const uEmision = getCell(["U. de Emision", "U. de Emisión", "UdeEmision", "U. de Emision"]);
          const cantidadRaw = getCell(["Cantidad", "Cant", "Unidades"]);
          const costoRaw = getCell(["Costo Unit.", "Costo Unit", "Costo", "Precio", "Precio Unit.", "PrecioUnit"]);
          const codigoRaw = getCell(["Código", "Codigo", "Cod"]);
          const loteRaw = getCell(["Nº de Lote", "NºdeLote", "Numero de Lote", "Nro de Lote", "Lote", "NumLote"]);
          const fechaVtoRaw = getCell(["Fecha Vto", "FechaVto", "Fecha Vencimiento", "FechaVencimiento", "Vto", "Vencimiento"]);

          const rowNum = r + 1;
          if (!suministro || String(suministro).trim() === "") {
            errors.push(`Fila ${rowNum}: Suministro obligatorio vacío.`);
            continue;
          }

          const cantidad = Number(String(cantidadRaw || "").replace(/\s+/g, "").replace(/,/g, ""));
          const precio = Number(String(costoRaw || "").replace(/\s+/g, "").replace(/,/g, ""));

          if (isNaN(cantidad) || cantidad <= 0) {
            errors.push(`Fila ${rowNum}: Cantidad inválida ('${cantidadRaw}').`);
            continue;
          }

          if (isNaN(precio) || precio < 0) {
            errors.push(`Fila ${rowNum}: Precio inválido ('${costoRaw}').`);
            continue;
          }

          // Normalize date if present
          const fechaVto = fechaVtoRaw ? normalizeDate(fechaVtoRaw) : "";

          previewItems.push({
            row: rowNum,
            codigo: codigoRaw ? String(codigoRaw).trim() : undefined,
            nombre: String(suministro).trim(),
            descripcion: uEmision ? String(uEmision).trim() : "",
            lote: loteRaw ? String(loteRaw).trim() : undefined,
            fechaVto,
            cantidad,
            precio
          });
        }

        setPreview(previewItems);
        setPreviewErrors(errors);
        setIgnoredCount(ignored.empty || 0);
        setLoading(false);
        playSound(errors.length > 0 ? "negative" : "positive");
      } catch (err) {
        console.error("Error processing Excel file:", err);
        setSummary({ total: 0, imported: 0, notFound: [], duplicates: [], errors: [`Error fatal de lectura: ${err instanceof Error ? err.message : String(err)}`] });
        setLoading(false);
        playSound("negative");
      }
    };

    reader.readAsArrayBuffer(file);
  };

  // New preview states
  const [preview, setPreview] = useState<any[] | null>(null);
  const [previewErrors, setPreviewErrors] = useState<string[]>([]);
  const [ignoredCount, setIgnoredCount] = useState<number>(0);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const handleConfirmImport = async () => {
    if (!preview || preview.length === 0) {
      showToast("No hay filas válidas para importar.");
      return;
    }

    if (!performImport && !performImportLocal) {
      showToast("Función de importación no disponible.");
      return;
    }

    setImporting(true);
    setProgress({ done: 0, total: preview.length });

    try {
      const importFn = performImport || performImportLocal;
      const result = await importFn(preview, (done, total) => setProgress({ done, total }));
      // result expected: { imported, errors, notFound }
      setSummary({ total: preview.length + ignoredCount, imported: result.imported || 0, notFound: result.notFound || [], duplicates: result.duplicates || [], errors: result.errors || [] });
      if (result.imported && result.imported > 0) {
        showToast(`Se importaron ${result.imported} productos/lotes.`);
        playSound("positive");
      } else {
        playSound("negative");
      }
      // Notify parent app with updated products if provided
      if (result.finalProducts) onImportComplete(result.finalProducts);
    } catch (err) {
      console.error("Import error:", err);
      showToast("Error durante la importación masiva.");
      playSound("negative");
      setSummary({ total: preview.length + ignoredCount, imported: 0, notFound: [], duplicates: [], errors: [(err instanceof Error ? err.message : String(err))] });
    } finally {
      setImporting(false);
      setProgress(null);
      setPreview(null);
    }
  };

  const handleCancelPreview = () => {
    setPreview(null);
    setPreviewErrors([]);
    setIgnoredCount(0);
  };

  // Local fallback import using existing batch logic (used if App doesn't pass performImport)
  const performImportLocal = async (items: any[], progressCb?: (done: number, total: number) => void) => {
    const notFound: string[] = [];
    const duplicates: string[] = [];
    const errors: string[] = [];
    let imported = 0;

    // Build maps
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

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const codeCandidate = it.codigo ? String(it.codigo).trim().toLowerCase() : undefined;
      const nameCandidate = String(it.nombre).trim();
      const lookupKey = codeCandidate || nameCandidate.toLowerCase().replace(/\s+/g, "");

      let product = codeCandidate ? productsMapByCode.get(codeCandidate) : undefined;
      if (!product) product = productsMapByName.get(lookupKey);

      // If not found, create minimal product record (generate code)
      if (!product) {
        // Generate code naive: prefix 'P' + timestamp
        const genCode = `P${Date.now()}${Math.random().toString(36).slice(2,5)}`;
        const newProd: Producto = {
          codigo: genCode,
          nombre: nameCandidate,
          descripcion: it.descripcion || "",
          lotes: [],
          updatedAt: Date.now(),
          catalogId: activeCatalogId
        };
        productsToUpdate.set(newProd.codigo, newProd);
        product = newProd;
      }

      // Group occurrences: we'll create a single lote per occurrence (or we could aggregate external duplicates)
      const loteId = `lote-${product.codigo}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const loteNum = `CM-${Date.now()}`;
      const newLot: Lote = {
        id: loteId,
        numeroLote: loteNum,
        cantidad: Number(it.cantidad || 0),
        cantidadF: Number(it.cantidad || 0),
        fechaVencimiento: "",
        precio: Number(it.precio || 0),
        loteFisico: "Carga Masiva",
        fechaFisica: ""
      };

      const existing = productsToUpdate.get(product.codigo) || JSON.parse(JSON.stringify(product));
      existing.lotes = existing.lotes || [];
      existing.lotes.push(newLot);
      existing.updatedAt = Date.now();
      productsToUpdate.set(existing.codigo, existing);

      movementLogs.push({
        id: `mov-${existing.codigo}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        productoCodigo: existing.codigo,
        productoNombre: existing.nombre,
        lote: loteNum,
        cantidad: newLot.cantidad,
        precio: newLot.precio,
        tipoMovimiento: "Entrada",
        usuario: currentUser ? `${currentUser.nombre} (${currentUser.usuario})` : "Carga Masiva",
        fecha: new Date().toISOString(),
        timestamp: Date.now(),
        catalogId: activeCatalogId
      });

      imported++;
      if (progressCb) progressCb(i + 1, items.length);
    }

    // Commit to Firestore
    if (productsToUpdate.size > 0) {
      const batch = writeBatch(db);
      const productsCol = collection(db, "productos");
      const movementsCol = collection(db, "movimientos");

      for (const [code, updatedProd] of productsToUpdate.entries()) {
        batch.set(doc(productsCol, code.replace(/\//g, "_")), { ...updatedProd, verificado: false });
      }

      for (const mov of movementLogs) {
        batch.set(doc(movementsCol, mov.id), mov);
      }

      await batch.commit();
    }

    // Build finalProducts to return if needed
    const finalProducts = products.map((p) => {
      const updated = productsToUpdate.get(p.codigo);
      return updated ? { ...updated, verificado: false } : p;
    });

    return { imported, notFound, duplicates, errors, finalProducts };
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

        {preview && (
          <div className="mt-6 bg-white rounded-2xl border border-slate-200 p-4">
            <h4 className="font-bold text-sm mb-3">Previsualización ({preview.length} filas válidas)</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm table-auto">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="p-2">Nombre</th>
                    <th className="p-2">Descripción</th>
                    <th className="p-2">Lote</th>
                    <th className="p-2">Fecha Vto</th>
                    <th className="p-2">Cantidad</th>
                    <th className="p-2">Precio</th>
                    <th className="p-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, idx) => (
                    <tr key={idx} className="border-t border-slate-100">
                      <td className="p-2 align-top">{row.nombre}</td>
                      <td className="p-2 align-top">{row.descripcion}</td>
                      <td className="p-2 align-top font-mono">{row.lote || "-"}</td>
                      <td className="p-2 align-top font-mono">{row.fechaVto || "-"}</td>
                      <td className="p-2 align-top font-mono">{row.cantidad}</td>
                      <td className="p-2 align-top font-mono">{row.precio}</td>
                      <td className="p-2 align-top text-sm text-emerald-700 font-bold">Válido</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center justify-between gap-4">
              <div className="text-xs text-slate-600">
                <div>Total filas leídas: {preview.length + ignoredCount}</div>
                <div>Válidos: {preview.length}</div>
                <div>Errores: {previewErrors.length}</div>
                <div>Filas vacías ignoradas: {ignoredCount}</div>
              </div>

              <div className="flex items-center gap-2">
                <button onClick={handleCancelPreview} disabled={importing} className="px-3 py-2 rounded-xl bg-rose-50 text-rose-700 text-xs font-bold">Cancelar</button>
                <button onClick={handleConfirmImport} disabled={importing} className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold">Confirmar importación</button>
              </div>
            </div>

            {importing && progress && (
              <div className="mt-3">
                <div className="w-full bg-slate-100 rounded-full h-2">
                  <div className="bg-emerald-600 h-2 rounded-full" style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }}></div>
                </div>
                <div className="text-xs text-slate-500 mt-1">Procesando {progress.done} / {progress.total}</div>
              </div>
            )}
          </div>
        )}
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
