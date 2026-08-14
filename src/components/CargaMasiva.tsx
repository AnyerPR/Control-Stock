import React, { useRef, useState, useMemo } from "react";
import * as XLSX from "xlsx";
import { Producto, Usuario, Lote, Movimiento, CargaMasivaRecord } from "../types";
import { playSound } from "../utils/audio";
import {
  normalizeSupplyName,
  normalizeCompactName,
  getInitialPrefix,
  generateNextCodeConsecutive,
  analyzeItemMatch,
  MatchAnalysisResult
} from "../utils/productMatching";
import {
  FileSpreadsheet,
  Upload,
  AlertCircle,
  CheckCircle,
  X,
  RotateCcw,
  History,
  Search,
  CheckCircle2,
  PlusCircle,
  Layers,
  ArrowRight,
  Sparkles,
  Check,
  AlertTriangle,
  Edit3,
  Undo2,
  Package,
  Boxes
} from "lucide-react";

interface CargaMasivaProps {
  products: Producto[];
  currentUser: Usuario | null;
  onImportComplete: (updatedProducts: Producto[]) => void;
  showToast: (message: string) => void;
  activeCatalogId: string;
  performImport?: (items: any[], fileName?: string, progressCb?: (done: number, total: number) => void) => Promise<any>;
  cargasMasivasList?: CargaMasivaRecord[];
  onRevertirCarga?: (cargaId: string) => Promise<boolean>;
}

interface ImportSummary {
  total: number;
  imported: number;
  notFound: string[];
  duplicates: string[];
  errors: string[];
  lastCargaRecordId?: string;
}

export interface PreviewItem {
  row: number;
  codigoOriginal?: string;
  nombre: string;
  descripcion: string;
  lote?: string;
  fechaVto: string;
  cantidad: number;
  precio: number;
  analysis: MatchAnalysisResult;
}

export default function CargaMasiva({
  products,
  currentUser,
  onImportComplete,
  showToast,
  activeCatalogId,
  performImport,
  cargasMasivasList = [],
  onRevertirCarga
}: CargaMasivaProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string>("");
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<PreviewItem[] | null>(null);
  const [previewErrors, setPreviewErrors] = useState<string[]>([]);
  const [ignoredCount, setIgnoredCount] = useState<number>(0);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // Filter & Search states inside preview
  const [previewFilter, setPreviewFilter] = useState<"todos" | "coincidencias" | "manuales" | "nuevos" | "agrupados">("todos");
  const [previewSearch, setPreviewSearch] = useState<string>("");

  // Modal State for Manual Code Assignment / Override
  const [editingItemRow, setEditingItemRow] = useState<number | null>(null);
  const [assignSearchQuery, setAssignSearchQuery] = useState<string>("");
  const [applyToAllSameName, setApplyToAllSameName] = useState<boolean>(true);

  const activeCatalogProducts = useMemo(() => {
    return products.filter((p) => (p.catalogId || "default-cat") === activeCatalogId);
  }, [products, activeCatalogId]);

  const editingItem = useMemo(() => {
    if (editingItemRow === null || !preview) return null;
    return preview.find((item) => item.row === editingItemRow) || null;
  }, [editingItemRow, preview]);

  // Same name count in the Excel file
  const sameNameCount = useMemo(() => {
    if (!editingItem || !preview) return 1;
    const clean = normalizeSupplyName(editingItem.nombre);
    return preview.filter((p) => normalizeSupplyName(p.nombre) === clean).length;
  }, [editingItem, preview]);

  // Catalog products filtered by search inside modal
  const filteredCatalogForAssign = useMemo(() => {
    if (!assignSearchQuery.trim()) {
      return activeCatalogProducts.slice(0, 30);
    }
    const q = normalizeSupplyName(assignSearchQuery);
    const qRaw = assignSearchQuery.toLowerCase().trim();
    return activeCatalogProducts.filter((p) => {
      const nameMatch = normalizeSupplyName(p.nombre).includes(q);
      const codeMatch = p.codigo.toLowerCase().includes(qRaw);
      const descMatch = normalizeSupplyName(p.descripcion).includes(q);
      return nameMatch || codeMatch || descMatch;
    }).slice(0, 40);
  }, [activeCatalogProducts, assignSearchQuery]);

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
      const date = new Date((val - 25569) * 86400 * 1000);
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    const cleanStr = String(val).trim();
    const ddmmyyyy = cleanStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (ddmmyyyy) {
      return `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, "0")}-${ddmmyyyy[1].padStart(2, "0")}`;
    }
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
    setSelectedFileName(file.name);
    setLoading(true);
    setSummary(null);
    setPreviewFilter("todos");
    setPreviewSearch("");
    setEditingItemRow(null);
    playSound("open");

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false });
        if (!rows || rows.length === 0) {
          setSummary({ total: 0, imported: 0, notFound: [], duplicates: [], errors: ["El archivo Excel está vacío."] });
          setLoading(false);
          playSound("negative");
          return;
        }

        // Detect header row
        let headerRowIndex = 9;
        if (rows.length < 10) {
          headerRowIndex = 0;
        }

        for (let r = 0; r < Math.min(rows.length, 15); r++) {
          const rRow = rows[r] as any[];
          if (!rRow) continue;
          const joined = rRow.map((c) => cleanHeader(String(c || ""))).join(" ");
          if (
            (joined.includes("suministro") ||
              joined.includes("producto") ||
              joined.includes("nombre") ||
              joined.includes("medicamento") ||
              joined.includes("insumo")) &&
            (joined.includes("cantidad") || joined.includes("cant"))
          ) {
            headerRowIndex = r;
            break;
          }
        }

        const headerRow = rows[headerRowIndex] as any[];
        if (!headerRow || headerRow.length === 0) {
          setSummary({ total: 0, imported: 0, notFound: [], duplicates: [], errors: ["No se encontraron los encabezados en la planilla Excel."] });
          setLoading(false);
          playSound("negative");
          return;
        }

        const headerMap = new Map<string, number>();
        headerRow.forEach((h, idx) => {
          if (!h && h !== 0) return;
          const key = cleanHeader(String(h));
          headerMap.set(key, idx);
        });

        const rawExtractedItems: any[] = [];
        const errors: string[] = [];
        const ignored = { empty: 0 };

        for (let r = headerRowIndex + 1; r < rows.length; r++) {
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
            for (const [k, idx] of headerMap.entries()) {
              for (const n of names) {
                if (k.includes(cleanHeader(n))) return raw[idx];
              }
            }
            return undefined;
          };

          const suministro = getCell(["Suministro", "Producto", "Nombre", "Medicamento", "Insumo"]);
          const uEmision = getCell([
            "U. de Emision",
            "U. de Emisión",
            "UdeEmision",
            "Descripcion",
            "Descripción",
            "Presentación",
            "Presentacion"
          ]);
          const cantidadRaw = getCell(["Cantidad", "Cant", "Unidades"]);
          const costoRaw = getCell(["Costo Unit.", "Costo Unit", "Costo", "Precio", "Precio Unit.", "PrecioUnit", "Valor"]);
          const codigoRaw = getCell(["Código", "Codigo", "Cod", "SKU", "Clave", "Referencia", "Ref", "ID", "Code"]);
          const loteRaw = getCell(["Nº de Lote", "NºdeLote", "Numero de Lote", "Nro de Lote", "Lote", "NumLote"]);
          const fechaVtoRaw = getCell(["Fecha Vto", "FechaVto", "Fecha Vencimiento", "FechaVencimiento", "Vto", "Vencimiento"]);

          const rowNum = r + 1;
          if (!suministro || String(suministro).trim() === "") {
            errors.push(`Fila ${rowNum}: Nombre/Suministro obligatorio vacío.`);
            continue;
          }

          const cantidad = Number(String(cantidadRaw || "1").replace(/\s+/g, "").replace(/,/g, ""));
          const precio = Number(String(costoRaw || "0").replace(/\s+/g, "").replace(/,/g, ""));

          if (isNaN(cantidad) || cantidad <= 0) {
            errors.push(`Fila ${rowNum}: Cantidad inválida ('${cantidadRaw}').`);
            continue;
          }

          if (isNaN(precio) || precio < 0) {
            errors.push(`Fila ${rowNum}: Precio inválido ('${costoRaw}').`);
            continue;
          }

          const fechaVto = fechaVtoRaw ? normalizeDate(fechaVtoRaw) : "";

          rawExtractedItems.push({
            row: rowNum,
            codigoOriginal: codigoRaw ? String(codigoRaw).trim() : undefined,
            nombre: String(suministro).trim(),
            descripcion: uEmision ? String(uEmision).trim() : "",
            lote: loteRaw ? String(loteRaw).trim() : undefined,
            fechaVto,
            cantidad,
            precio
          });
        }

        // =========================================================================
        // Simular análisis de coincidencia y asignación de códigos en tiempo real
        // =========================================================================
        const catalogProducts = products.filter((p) => (p.catalogId || "default-cat") === activeCatalogId);
        const simulatedWorkingProducts = JSON.parse(JSON.stringify(catalogProducts)) as Producto[];

        const previewItems: PreviewItem[] = rawExtractedItems.map((item) => {
          const analysis = analyzeItemMatch(
            item.nombre,
            item.descripcion,
            catalogProducts,
            simulatedWorkingProducts,
            activeCatalogId
          );

          if (analysis.matchType === "new_product") {
            const dummyNewProd: Producto = {
              codigo: analysis.projectedCode,
              nombre: item.nombre,
              descripcion: item.descripcion,
              lotes: [],
              updatedAt: Date.now(),
              catalogId: activeCatalogId
            };
            simulatedWorkingProducts.push(dummyNewProd);
          }

          return {
            ...item,
            analysis
          };
        });

        setPreview(previewItems);
        setPreviewErrors(errors);
        setIgnoredCount(ignored.empty || 0);
        setLoading(false);
        playSound(errors.length > 0 ? "negative" : "positive");
      } catch (err) {
        console.error("Error processing Excel file:", err);
        setSummary({
          total: 0,
          imported: 0,
          notFound: [],
          duplicates: [],
          errors: [`Error al procesar archivo: ${err instanceof Error ? err.message : String(err)}`]
        });
        setLoading(false);
        playSound("negative");
      }
    };

    reader.readAsArrayBuffer(file);
  };

  // Demo / Sample simulation for instant testing
  const handleLoadDemoFile = () => {
    setSelectedFileName("Ejemplo_Inventario_Hospitalario.xlsx");
    setLoading(true);
    setSummary(null);
    setPreviewFilter("todos");
    setPreviewSearch("");
    setEditingItemRow(null);
    playSound("open");

    setTimeout(() => {
      const catalogProducts = products.filter((p) => (p.catalogId || "default-cat") === activeCatalogId);
      const simulatedWorkingProducts = JSON.parse(JSON.stringify(catalogProducts)) as Producto[];

      // Pick first 2 product names from catalog if available to demonstrate exact matching
      const existingName1 = catalogProducts[0]?.nombre || "Paracetamol 500mg Comprimidos";
      const existingName2 = catalogProducts[1]?.nombre || "Ibuprofeno 400mg Tabletas";

      const sampleItems = [
        {
          row: 1,
          codigoOriginal: "REF-001",
          nombre: existingName1,
          descripcion: "Caja x 100 comprimidos",
          lote: "LOT-2026-A1",
          fechaVto: "2027-11-30",
          cantidad: 150,
          precio: 2.50
        },
        {
          row: 2,
          codigoOriginal: "REF-002",
          nombre: existingName2,
          descripcion: "Blíster x 10 tabletas",
          lote: "LOT-IBU-99",
          fechaVto: "2028-04-15",
          cantidad: 80,
          precio: 4.20
        },
        {
          row: 3,
          codigoOriginal: "REF-001-B",
          nombre: existingName1,
          descripcion: "Caja x 100 comprimidos (Lote Adicional)",
          lote: "LOT-2026-B2",
          fechaVto: "2027-12-31",
          cantidad: 100,
          precio: 2.50
        },
        {
          row: 4,
          codigoOriginal: "AMX-500",
          nombre: "Amoxicilina + Ácido Clavulánico 500/125mg",
          descripcion: "Frasco Suspensión 60ml",
          lote: "LOT-AMX-2026",
          fechaVto: "2026-10-20",
          cantidad: 45,
          precio: 8.75
        },
        {
          row: 5,
          codigoOriginal: "GAS-1010",
          nombre: "Gasa Quirúrgica Estéril 10x10 cm",
          descripcion: "Sobre x 5 unidades estériles",
          lote: "LOT-GAS-884",
          fechaVto: "2029-01-01",
          cantidad: 300,
          precio: 1.10
        }
      ];

      const previewItems: PreviewItem[] = sampleItems.map((item) => {
        const analysis = analyzeItemMatch(
          item.nombre,
          item.descripcion,
          catalogProducts,
          simulatedWorkingProducts,
          activeCatalogId
        );

        if (analysis.matchType === "new_product") {
          const dummyNewProd: Producto = {
            codigo: analysis.projectedCode,
            nombre: item.nombre,
            descripcion: item.descripcion,
            lotes: [],
            updatedAt: Date.now(),
            catalogId: activeCatalogId
          };
          simulatedWorkingProducts.push(dummyNewProd);
        }

        return {
          ...item,
          analysis
        };
      });

      setPreview(previewItems);
      setPreviewErrors([]);
      setIgnoredCount(0);
      setLoading(false);
      playSound("positive");
      showToast("Ejemplo de planilla cargado. Revisa las columnas de coincidencia y asignación.");
    }, 400);
  };
  const handleAssignToExistingProduct = (targetProd: Producto) => {
    if (!editingItem || !preview) return;

    const targetRow = editingItem.row;
    const cleanTargetName = normalizeSupplyName(editingItem.nombre);

    setPreview((prev) => {
      if (!prev) return prev;
      return prev.map((it) => {
        const matchesRow = it.row === targetRow;
        const matchesSameName = applyToAllSameName && normalizeSupplyName(it.nombre) === cleanTargetName;

        if (matchesRow || matchesSameName) {
          const newAnalysis: MatchAnalysisResult = {
            matchType: "manual_assigned",
            matchedProduct: targetProd,
            matchedCatalogName: targetProd.nombre,
            matchedCatalogCode: targetProd.codigo,
            projectedCode: targetProd.codigo,
            prefix: getInitialPrefix(targetProd.nombre),
            confidence: "manual",
            isManualOverride: true,
            reason: `Asignado manualmente al producto "${targetProd.nombre}" (${targetProd.codigo}).`
          };

          return {
            ...it,
            analysis: newAnalysis
          };
        }
        return it;
      });
    });

    setEditingItemRow(null);
    setAssignSearchQuery("");
    showToast(`Asignado a: [${targetProd.codigo}] ${targetProd.nombre}`);
    playSound("click");
  };

  const handleAssignAsNewProduct = () => {
    if (!editingItem || !preview) return;

    const targetRow = editingItem.row;
    const cleanTargetName = normalizeSupplyName(editingItem.nombre);
    const prefix = getInitialPrefix(editingItem.nombre);
    const projectedCode = generateNextCodeConsecutive(activeCatalogId, prefix, activeCatalogProducts);

    setPreview((prev) => {
      if (!prev) return prev;
      return prev.map((it) => {
        const matchesRow = it.row === targetRow;
        const matchesSameName = applyToAllSameName && normalizeSupplyName(it.nombre) === cleanTargetName;

        if (matchesRow || matchesSameName) {
          const newAnalysis: MatchAnalysisResult = {
            matchType: "new_product",
            matchedProduct: null,
            projectedCode,
            prefix,
            confidence: "manual",
            isManualOverride: true,
            reason: `Forzado manualmente como Nuevo Producto con código ${projectedCode}.`
          };

          return {
            ...it,
            analysis: newAnalysis
          };
        }
        return it;
      });
    });

    setEditingItemRow(null);
    setAssignSearchQuery("");
    showToast(`Configurado como Nuevo Producto (${projectedCode})`);
    playSound("click");
  };

  const handleResetToAuto = () => {
    if (!editingItem || !preview) return;

    const targetRow = editingItem.row;
    const cleanTargetName = normalizeSupplyName(editingItem.nombre);

    setPreview((prev) => {
      if (!prev) return prev;
      return prev.map((it) => {
        const matchesRow = it.row === targetRow;
        const matchesSameName = applyToAllSameName && normalizeSupplyName(it.nombre) === cleanTargetName;

        if (matchesRow || matchesSameName) {
          const freshAnalysis = analyzeItemMatch(
            it.nombre,
            it.descripcion,
            activeCatalogProducts,
            activeCatalogProducts,
            activeCatalogId
          );

          return {
            ...it,
            analysis: freshAnalysis
          };
        }
        return it;
      });
    });

    setEditingItemRow(null);
    setAssignSearchQuery("");
    showToast("Restablecido a análisis automático.");
    playSound("click");
  };

  const handleConfirmImport = async () => {
    if (!preview || preview.length === 0) {
      showToast("No hay filas válidas para importar.");
      return;
    }

    if (!performImport) {
      showToast("Función de importación no disponible.");
      return;
    }

    setImporting(true);
    setProgress({ done: 0, total: preview.length });

    try {
      const itemsToImport = preview.map((p) => ({
        row: p.row,
        codigoOriginal: p.codigoOriginal,
        nombre: p.nombre,
        descripcion: p.descripcion,
        lote: p.lote,
        fechaVto: p.fechaVto,
        cantidad: p.cantidad,
        precio: p.precio,
        targetProductCode: p.analysis.matchedProduct?.codigo || p.analysis.projectedCode,
        isManualOverride: p.analysis.isManualOverride,
        matchType: p.analysis.matchType
      }));

      const result = await performImport(itemsToImport, selectedFileName, (done, total) =>
        setProgress({ done, total })
      );

      setSummary({
        total: preview.length + ignoredCount,
        imported: result.imported || 0,
        notFound: result.notFound || [],
        duplicates: result.duplicates || [],
        errors: result.errors || [],
        lastCargaRecordId: result.cargaRecordId
      });

      if (result.imported && result.imported > 0) {
        showToast(`Se importaron ${result.imported} registros correctamente.`);
        playSound("positive");
      } else {
        playSound("negative");
      }

      if (result.finalProducts) onImportComplete(result.finalProducts);
    } catch (err) {
      console.error("Import error:", err);
      showToast("Error durante la importación masiva.");
      playSound("negative");
      setSummary({
        total: preview.length + ignoredCount,
        imported: 0,
        notFound: [],
        duplicates: [],
        errors: [err instanceof Error ? err.message : String(err)]
      });
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
    setSelectedFileName("");
    setEditingItemRow(null);
  };

  const triggerFileBrowser = () => {
    if (loading || importing) return;
    fileInputRef.current?.click();
  };

  const handleRevertir = async (cargaId: string) => {
    if (!onRevertirCarga) return;
    setRevertingId(cargaId);
    try {
      const success = await onRevertirCarga(cargaId);
      if (success && summary && summary.lastCargaRecordId === cargaId) {
        setSummary(null);
      }
    } finally {
      setRevertingId(null);
    }
  };

  const catalogCargas = cargasMasivasList.filter(
    (c) => (c.activeCatalogId || "default-cat") === activeCatalogId
  );

  // Match statistics for the preview
  const previewStats = useMemo(() => {
    if (!preview) return { total: 0, coincidencias: 0, manuales: 0, nuevos: 0, agrupados: 0 };
    const coincidencias = preview.filter((p) => p.analysis.matchType === "existing_catalog").length;
    const manuales = preview.filter((p) => p.analysis.matchType === "manual_assigned" || p.analysis.isManualOverride).length;
    const agrupados = preview.filter((p) => p.analysis.matchType === "same_file_batch").length;
    const nuevos = preview.filter((p) => p.analysis.matchType === "new_product" && !p.analysis.isManualOverride).length;
    return {
      total: preview.length,
      coincidencias,
      manuales,
      agrupados,
      nuevos
    };
  }, [preview]);

  // Filtered preview items
  const filteredPreview = useMemo(() => {
    if (!preview) return [];
    return preview.filter((item) => {
      // 1. Tab Filter
      if (previewFilter === "coincidencias" && item.analysis.matchType !== "existing_catalog") {
        return false;
      }
      if (previewFilter === "manuales" && item.analysis.matchType !== "manual_assigned" && !item.analysis.isManualOverride) {
        return false;
      }
      if (previewFilter === "nuevos" && (item.analysis.matchType !== "new_product" || item.analysis.isManualOverride)) {
        return false;
      }
      if (previewFilter === "agrupados" && item.analysis.matchType !== "same_file_batch") {
        return false;
      }

      // 2. Search Query
      if (previewSearch.trim()) {
        const query = normalizeSupplyName(previewSearch);
        const nameClean = normalizeSupplyName(item.nombre);
        const descClean = normalizeSupplyName(item.descripcion);
        const codeClean = (item.analysis.projectedCode || "").toLowerCase();
        const matchedNameClean = normalizeSupplyName(item.analysis.matchedCatalogName);
        const matchedCodeClean = (item.analysis.matchedCatalogCode || "").toLowerCase();
        const loteClean = (item.lote || "").toLowerCase();

        return (
          nameClean.includes(query) ||
          descClean.includes(query) ||
          codeClean.includes(query) ||
          matchedNameClean.includes(query) ||
          matchedCodeClean.includes(query) ||
          loteClean.includes(query)
        );
      }

      return true;
    });
  }, [preview, previewFilter, previewSearch]);

  return (
    <div className="space-y-6">
      {/* Informational Guidance Banner */}
      <div className="bg-emerald-50/80 border border-emerald-200/90 rounded-3xl p-5 shadow-xs flex items-start gap-3.5">
        <div className="p-2.5 bg-emerald-100 text-emerald-800 rounded-2xl shrink-0 mt-0.5 shadow-xs">
          <CheckCircle className="w-5 h-5" />
        </div>
        <div className="space-y-1.5 text-xs text-emerald-950">
          <h4 className="font-extrabold text-emerald-900 text-sm flex items-center gap-2">
            <span>Carga Masiva con Auditoría y Asignación Manual de Códigos</span>
            <span className="bg-emerald-200/80 text-emerald-900 text-[10px] px-2 py-0.5 rounded-full font-bold">
              Control Total Previo
            </span>
          </h4>
          <p className="leading-relaxed text-slate-700">
            <strong>1. Vista Previa antes de guardar:</strong> Al subir tu Excel, el sistema te muestra la lista de medicamentos encontrados y con qué producto del catálogo coincide cada uno.
          </p>
          <p className="leading-relaxed text-slate-700">
            <strong>2. Elección manual de código:</strong> Si el sistema no encuentra coincidencia automática pero tú sabes que el medicamento existe, puedes hacer clic en <strong>"Asignar / Cambiar Código"</strong> para vincularlo manualmente al código existente que desees.
          </p>
          <p className="leading-relaxed text-slate-700">
            <strong>3. Conservación de códigos:</strong> Los productos coincidentes o asignados conservan su código actual y agregan su nuevo lote; los productos nuevos generan su código correlativo consecutivo (ej: <strong>P001, P002...</strong>).
          </p>
        </div>
      </div>

      {/* Upload Box */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Importar Inventario desde Excel</h3>
            <p className="text-slate-500 text-sm">
              Sube tu planilla (.xlsx o .xls) para auditar, elegir destinos y cargar suministros con sus lotes.
            </p>
          </div>
          {preview && (
            <button
              type="button"
              onClick={handleCancelPreview}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-xl transition cursor-pointer self-start"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Cargar Otro Archivo</span>
            </button>
          )}
        </div>

        {/* Drag & Drop Area */}
        {!preview && (
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
              <div className="space-y-3 py-4">
                <div className="w-10 h-10 border-4 border-teal-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
                <p className="text-slate-800 font-bold text-sm">Analizando medicamentos y buscando coincidencias...</p>
                <p className="text-xs text-slate-400">Verificando nombres en tu catálogo y calculando códigos...</p>
              </div>
            ) : (
              <div className="space-y-3 py-4">
                <div className="p-3.5 bg-teal-100 text-teal-700 rounded-full w-14 h-14 flex items-center justify-center mx-auto shadow-sm">
                  <Upload className="w-7 h-7" />
                </div>
                <div>
                  <p className="text-slate-800 font-bold text-base">Arrastra y suelta tu archivo Excel aquí</p>
                  <p className="text-xs text-slate-500 mt-1">o haz clic para buscar en tu computadora (.xlsx, .xls)</p>
                </div>
                <div className="inline-flex items-center gap-2 bg-slate-200/60 px-3 py-1 rounded-lg text-[11px] font-medium text-slate-600">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-teal-700" />
                  <span>Plantilla: Suministro (Nombre), Descripción, Lote, Fecha Vto, Cantidad, Precio</span>
                </div>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleLoadDemoFile();
                    }}
                    className="inline-flex items-center gap-1.5 text-xs font-black text-teal-800 bg-teal-100/90 hover:bg-teal-200 border border-teal-300 px-4 py-2 rounded-xl transition cursor-pointer shadow-xs active:scale-95"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-teal-700" />
                    <span>Cargar Ejemplo de Demostración con Auditoría y Coincidencias</span>
                  </button>
                </div>
              </div>
            )}
          </form>
        )}

        {/* ========================================================================= */}
        {/* PRE-IMPORT VERIFICATION AUDIT PANEL (User's Requested Feature)             */}
        {/* ========================================================================= */}
        {preview && (
          <div className="space-y-6 pt-2">
            {/* Header with filename and file status */}
            <div className="bg-slate-900 text-white rounded-2xl p-5 shadow-sm space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-teal-500/20 border border-teal-500/40 rounded-xl text-teal-300">
                    <FileSpreadsheet className="w-6 h-6" />
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-mono tracking-widest text-teal-400 font-black">
                      Auditoría Previa y Asignación de Códigos
                    </span>
                    <h4 className="font-extrabold text-base text-white tracking-tight flex items-center gap-2">
                      <span>{selectedFileName}</span>
                    </h4>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-center">
                  <button
                    type="button"
                    onClick={handleCancelPreview}
                    disabled={importing}
                    className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition cursor-pointer flex items-center gap-1.5"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Descartar</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmImport}
                    disabled={importing}
                    className="px-5 py-2 rounded-xl bg-teal-500 hover:bg-teal-400 active:scale-95 text-slate-950 text-xs font-black uppercase tracking-wider transition shadow-md cursor-pointer inline-flex items-center gap-2"
                  >
                    {importing ? (
                      <>
                        <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></div>
                        <span>Importando...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4 text-slate-950 stroke-[3]" />
                        <span>Confirmar e Importar ({preview.length})</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Progress bar during import */}
              {importing && progress && (
                <div className="space-y-1.5 pt-2 border-t border-slate-800">
                  <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden">
                    <div
                      className="bg-teal-400 h-2.5 rounded-full transition-all duration-200"
                      style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }}
                    ></div>
                  </div>
                  <div className="text-xs text-teal-300 flex justify-between font-mono">
                    <span>Guardando suministros y lotes...</span>
                    <span>{progress.done} de {progress.total} procesados</span>
                  </div>
                </div>
              )}
            </div>

            {/* Metric KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <div
                onClick={() => setPreviewFilter("todos")}
                className={`border rounded-2xl p-3.5 flex items-center justify-between cursor-pointer transition ${
                  previewFilter === "todos"
                    ? "bg-slate-200/80 border-slate-400 ring-2 ring-slate-400/20"
                    : "bg-slate-50 border-slate-200 hover:bg-slate-100"
                }`}
              >
                <div>
                  <span className="block text-2xl font-black text-slate-900">{previewStats.total}</span>
                  <span className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">Total Leídos</span>
                </div>
                <div className="p-2 bg-slate-200 text-slate-700 rounded-xl">
                  <FileSpreadsheet className="w-4 h-4" />
                </div>
              </div>

              <div
                onClick={() => setPreviewFilter("coincidencias")}
                className={`border rounded-2xl p-3.5 flex items-center justify-between cursor-pointer transition ${
                  previewFilter === "coincidencias"
                    ? "bg-emerald-100/70 border-emerald-400 shadow-xs ring-2 ring-emerald-400/20"
                    : "bg-emerald-50/70 border-emerald-200 hover:bg-emerald-100/50"
                }`}
              >
                <div>
                  <span className="block text-2xl font-black text-emerald-800">{previewStats.coincidencias}</span>
                  <span className="text-[11px] text-emerald-700 font-bold uppercase tracking-wider">Coincidencias</span>
                  <span className="block text-[10px] text-emerald-600 font-medium">Automáticas</span>
                </div>
                <div className="p-2 bg-emerald-200 text-emerald-800 rounded-xl">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
              </div>

              <div
                onClick={() => setPreviewFilter("manuales")}
                className={`border rounded-2xl p-3.5 flex items-center justify-between cursor-pointer transition ${
                  previewFilter === "manuales"
                    ? "bg-indigo-100/70 border-indigo-400 shadow-xs ring-2 ring-indigo-400/20"
                    : "bg-indigo-50/70 border-indigo-200 hover:bg-indigo-100/50"
                }`}
              >
                <div>
                  <span className="block text-2xl font-black text-indigo-800">{previewStats.manuales}</span>
                  <span className="text-[11px] text-indigo-700 font-bold uppercase tracking-wider">Asignados Manual</span>
                  <span className="block text-[10px] text-indigo-600 font-medium">Elegidos por ti</span>
                </div>
                <div className="p-2 bg-indigo-200 text-indigo-800 rounded-xl">
                  <Edit3 className="w-4 h-4" />
                </div>
              </div>

              <div
                onClick={() => setPreviewFilter("nuevos")}
                className={`border rounded-2xl p-3.5 flex items-center justify-between cursor-pointer transition ${
                  previewFilter === "nuevos"
                    ? "bg-sky-100/70 border-sky-400 shadow-xs ring-2 ring-sky-400/20"
                    : "bg-sky-50/70 border-sky-200 hover:bg-sky-100/50"
                }`}
              >
                <div>
                  <span className="block text-2xl font-black text-sky-800">{previewStats.nuevos}</span>
                  <span className="text-[11px] text-sky-700 font-bold uppercase tracking-wider">Nuevos Productos</span>
                  <span className="block text-[10px] text-sky-600 font-medium">Nuevo código</span>
                </div>
                <div className="p-2 bg-sky-200 text-sky-800 rounded-xl">
                  <PlusCircle className="w-4 h-4" />
                </div>
              </div>

              <div
                onClick={() => setPreviewFilter("agrupados")}
                className={`border rounded-2xl p-3.5 flex items-center justify-between cursor-pointer transition ${
                  previewFilter === "agrupados"
                    ? "bg-purple-100/70 border-purple-400 shadow-xs ring-2 ring-purple-400/20"
                    : "bg-purple-50/70 border-purple-200 hover:bg-purple-100/50"
                }`}
              >
                <div>
                  <span className="block text-2xl font-black text-purple-800">{previewStats.agrupados}</span>
                  <span className="text-[11px] text-purple-700 font-bold uppercase tracking-wider">Mismo Archivo</span>
                  <span className="block text-[10px] text-purple-600 font-medium">Repetidos</span>
                </div>
                <div className="p-2 bg-purple-200 text-purple-800 rounded-xl">
                  <Layers className="w-4 h-4" />
                </div>
              </div>
            </div>

            {/* Filter Tabs & Search Bar */}
            <div className="bg-slate-50 rounded-2xl p-3 border border-slate-200 flex flex-col md:flex-row items-center justify-between gap-3">
              {/* Filter Pills */}
              <div className="flex items-center gap-1.5 flex-wrap w-full md:w-auto">
                <button
                  type="button"
                  onClick={() => setPreviewFilter("todos")}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                    previewFilter === "todos"
                      ? "bg-slate-900 text-white shadow-xs"
                      : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
                  }`}
                >
                  <span>Todos</span>
                  <span className="text-[10px] opacity-80 font-mono">({previewStats.total})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPreviewFilter("coincidencias")}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                    previewFilter === "coincidencias"
                      ? "bg-emerald-700 text-white shadow-xs"
                      : "bg-white text-emerald-800 hover:bg-emerald-50 border border-emerald-200"
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Coincidencias</span>
                  <span className="text-[10px] font-mono">({previewStats.coincidencias})</span>
                </button>

                {previewStats.manuales > 0 && (
                  <button
                    type="button"
                    onClick={() => setPreviewFilter("manuales")}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                      previewFilter === "manuales"
                        ? "bg-indigo-700 text-white shadow-xs"
                        : "bg-white text-indigo-800 hover:bg-indigo-50 border border-indigo-200"
                    }`}
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Asignados Manual ({previewStats.manuales})</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setPreviewFilter("nuevos")}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                    previewFilter === "nuevos"
                      ? "bg-sky-700 text-white shadow-xs"
                      : "bg-white text-sky-800 hover:bg-sky-50 border border-sky-200"
                  }`}
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Nuevos</span>
                  <span className="text-[10px] font-mono">({previewStats.nuevos})</span>
                </button>

                {previewStats.agrupados > 0 && (
                  <button
                    type="button"
                    onClick={() => setPreviewFilter("agrupados")}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                      previewFilter === "agrupados"
                        ? "bg-purple-700 text-white shadow-xs"
                        : "bg-white text-purple-800 hover:bg-purple-50 border border-purple-200"
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>Mismo Archivo</span>
                    <span className="text-[10px] font-mono">({previewStats.agrupados})</span>
                  </button>
                )}
              </div>

              {/* Search Bar inside preview */}
              <div className="relative w-full md:w-80">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={previewSearch}
                  onChange={(e) => setPreviewSearch(e.target.value)}
                  placeholder="Buscar por nombre, código proyectado..."
                  className="w-full pl-9 pr-8 py-1.5 text-xs rounded-xl bg-white border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
                />
                {previewSearch && (
                  <button
                    type="button"
                    onClick={() => setPreviewSearch("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Audit Comparison Table */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
              <div className="overflow-x-auto max-h-[580px]">
                <table className="w-full text-xs text-left border-collapse">
                  <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700 font-bold uppercase tracking-wider text-[11px] border-b border-slate-200 shadow-xs">
                    <tr>
                      <th className="py-3.5 px-3 text-center w-12 bg-slate-100">#</th>
                      <th className="py-3.5 px-3 min-w-[200px] bg-slate-100">Nombre (Excel)</th>
                      <th className="py-3.5 px-3 min-w-[150px] bg-slate-100">Descripción</th>
                      <th className="py-3.5 px-3 min-w-[100px] bg-slate-100">Lote</th>
                      <th className="py-3.5 px-3 min-w-[100px] bg-slate-100">Fecha Vto.</th>
                      <th className="py-3.5 px-3 text-right min-w-[80px] bg-slate-100">Cantidad</th>
                      <th className="py-3.5 px-3 text-right min-w-[90px] bg-slate-100">Precio</th>
                      <th className="py-3.5 px-3.5 min-w-[170px] bg-emerald-50 text-emerald-950 border-x border-emerald-100">
                        <div className="flex items-center gap-1.5 font-black">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                          <span>Estado de Coincidencia</span>
                        </div>
                      </th>
                      <th className="py-3.5 px-3.5 min-w-[240px] bg-slate-100/90 text-slate-900">
                        <span>Producto Vinculado (Catálogo)</span>
                      </th>
                      <th className="py-3.5 px-3 text-center min-w-[120px] bg-slate-100">
                        <span>Stock Actual Catálogo</span>
                      </th>
                      <th className="py-3.5 px-3.5 text-center min-w-[140px] bg-teal-50 text-teal-950 border-x border-teal-100">
                        <div className="flex items-center justify-center gap-1.5 font-black">
                          <Sparkles className="w-3.5 h-3.5 text-teal-700" />
                          <span>Código Final que Recibirá</span>
                        </div>
                      </th>
                      <th className="py-3.5 px-3 text-center min-w-[120px] bg-slate-100">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredPreview.length === 0 ? (
                      <tr>
                        <td colSpan={12} className="py-12 text-center text-slate-400 text-xs font-medium">
                          No se encontraron elementos con el filtro o búsqueda seleccionada.
                        </td>
                      </tr>
                    ) : (
                      filteredPreview.map((item, idx) => {
                        const isManual = item.analysis.matchType === "manual_assigned" || item.analysis.isManualOverride;
                        const isExisting = item.analysis.matchType === "existing_catalog";
                        const isSameBatch = item.analysis.matchType === "same_file_batch";
                        const isNew = item.analysis.matchType === "new_product" && !isManual;

                        const matchedProd = item.analysis.matchedProduct;
                        const matchedTotalStock = matchedProd?.lotes?.reduce(
                          (sum, l) => sum + Number(l.cantidad || 0),
                          0
                        ) || 0;
                        const matchedLotsCount = matchedProd?.lotes?.length || 0;

                        return (
                          <tr
                            key={idx}
                            className={`transition hover:bg-slate-50/90 ${
                              isManual
                                ? "bg-indigo-50/20"
                                : isExisting
                                ? "bg-emerald-50/15"
                                : isSameBatch
                                ? "bg-purple-50/15"
                                : "bg-sky-50/15"
                            }`}
                          >
                            {/* 1. # Fila */}
                            <td className="py-3 px-3 text-center font-mono font-bold text-slate-400 text-[11px]">
                              {item.row}
                            </td>

                            {/* 2. Nombre (Excel) */}
                            <td className="py-3 px-3">
                              <div className="space-y-0.5">
                                <span className="font-extrabold text-slate-900 block text-xs">
                                  {item.nombre}
                                </span>
                                {item.codigoOriginal && (
                                  <span className="inline-block text-[10px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded">
                                    Cód. Excel: {item.codigoOriginal}
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* 3. Descripción */}
                            <td className="py-3 px-3 text-xs text-slate-600">
                              {item.descripcion || <span className="text-slate-300 italic">—</span>}
                            </td>

                            {/* 4. Lote */}
                            <td className="py-3 px-3">
                              <span className="font-mono text-xs font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-md">
                                {item.lote || <span className="text-slate-400 italic">Auto</span>}
                              </span>
                            </td>

                            {/* 5. Fecha Vto. */}
                            <td className="py-3 px-3 font-mono text-xs text-slate-700">
                              {item.fechaVto ? (
                                <span className="font-semibold text-slate-800">{item.fechaVto}</span>
                              ) : (
                                <span className="text-amber-700 italic text-[11px]">Sin Vto</span>
                              )}
                            </td>

                            {/* 6. Cantidad */}
                            <td className="py-3 px-3 text-right font-mono font-black text-slate-900 text-xs">
                              {item.cantidad.toLocaleString("es-ES")} <span className="text-[10px] font-normal text-slate-500">u.</span>
                            </td>

                            {/* 7. Precio */}
                            <td className="py-3 px-3 text-right font-mono text-xs text-slate-700">
                              {item.precio > 0 ? (
                                `$${item.precio.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              ) : (
                                <span className="text-slate-400">$0.00</span>
                              )}
                            </td>

                            {/* 8. Estado de Coincidencia (Dedicated Badge Column) */}
                            <td className="py-3 px-3.5 border-x border-slate-100">
                              {isManual && (
                                <span className="inline-flex items-center gap-1.5 bg-indigo-100 text-indigo-900 text-[11px] font-extrabold px-2.5 py-1 rounded-full border border-indigo-300 shadow-2xs whitespace-nowrap">
                                  <Edit3 className="w-3.5 h-3.5 text-indigo-700 shrink-0" />
                                  <span>Asignado Manual</span>
                                </span>
                              )}
                              {isExisting && (
                                <span className="inline-flex items-center gap-1.5 bg-emerald-100 text-emerald-900 text-[11px] font-extrabold px-2.5 py-1 rounded-full border border-emerald-300 shadow-2xs whitespace-nowrap">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                                  <span>Coincidencia en Catálogo</span>
                                </span>
                              )}
                              {isSameBatch && (
                                <span className="inline-flex items-center gap-1.5 bg-purple-100 text-purple-900 text-[11px] font-extrabold px-2.5 py-1 rounded-full border border-purple-300 shadow-2xs whitespace-nowrap">
                                  <Layers className="w-3.5 h-3.5 text-purple-700 shrink-0" />
                                  <span>Mismo Archivo</span>
                                </span>
                              )}
                              {isNew && (
                                <span className="inline-flex items-center gap-1.5 bg-sky-100 text-sky-900 text-[11px] font-extrabold px-2.5 py-1 rounded-full border border-sky-300 shadow-2xs whitespace-nowrap">
                                  <PlusCircle className="w-3.5 h-3.5 text-sky-700 shrink-0" />
                                  <span>Nuevo Producto</span>
                                </span>
                              )}
                            </td>

                            {/* 9. Con qué producto coincide exactamente en catálogo */}
                            <td className="py-3 px-3.5">
                              {isManual && matchedProd && (
                                <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-2 space-y-0.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-mono font-black text-indigo-900 bg-indigo-200/80 px-1.5 py-0.5 rounded text-[10px]">
                                      {matchedProd.codigo}
                                    </span>
                                    <span className="font-bold text-indigo-950 text-xs truncate">
                                      {matchedProd.nombre}
                                    </span>
                                  </div>
                                  <span className="text-[10px] text-indigo-700 block">
                                    Asignación manual personalizada
                                  </span>
                                </div>
                              )}

                              {isExisting && matchedProd && (
                                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-2 space-y-0.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-mono font-black text-emerald-900 bg-emerald-200/80 px-1.5 py-0.5 rounded text-[10px]">
                                      {item.analysis.matchedCatalogCode}
                                    </span>
                                    <span className="font-bold text-emerald-950 text-xs truncate">
                                      {item.analysis.matchedCatalogName}
                                    </span>
                                  </div>
                                  <span className="text-[10px] text-emerald-700 block">
                                    Coincidencia automática por nombre
                                  </span>
                                </div>
                              )}

                              {isSameBatch && (
                                <div className="bg-purple-50 border border-purple-200 rounded-xl p-2 space-y-0.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-mono font-black text-purple-900 bg-purple-200/80 px-1.5 py-0.5 rounded text-[10px]">
                                      {item.analysis.projectedCode}
                                    </span>
                                    <span className="font-bold text-purple-950 text-xs truncate">
                                      {item.analysis.matchedCatalogName}
                                    </span>
                                  </div>
                                  <span className="text-[10px] text-purple-700 block">
                                    Mismo insumo repetido en la planilla
                                  </span>
                                </div>
                              )}

                              {isNew && (
                                <div className="text-slate-400 italic text-[11px] flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl p-2">
                                  <Sparkles className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                                  <span className="text-slate-600 font-medium">Ninguno (Se creará en catálogo)</span>
                                </div>
                              )}
                            </td>

                            {/* 10. Stock actual del producto en el catálogo */}
                            <td className="py-3 px-3 text-center">
                              {matchedProd ? (
                                <div className="inline-flex flex-col items-center">
                                  <span className="font-mono font-black text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-lg text-xs">
                                    {matchedTotalStock.toLocaleString("es-ES")} u.
                                  </span>
                                  <span className="text-[10px] text-slate-500 mt-0.5">
                                    {matchedLotsCount} lote(s) previo(s)
                                  </span>
                                </div>
                              ) : (
                                <div className="inline-flex flex-col items-center text-slate-400">
                                  <span className="font-mono text-xs font-semibold bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-lg">
                                    0 u.
                                  </span>
                                  <span className="text-[10px] text-sky-600 font-bold mt-0.5">
                                    Nuevo
                                  </span>
                                </div>
                              )}
                            </td>

                            {/* 11. Código final que recibirá (Dedicated Big Badge) */}
                            <td className="py-3 px-3.5 text-center border-x border-slate-100">
                              <div className="inline-flex flex-col items-center">
                                <span
                                  className={`font-mono font-black text-xs px-3 py-1 rounded-lg border shadow-2xs tracking-wide ${
                                    isManual
                                      ? "bg-indigo-700 text-white border-indigo-800"
                                      : isExisting
                                      ? "bg-emerald-700 text-white border-emerald-800"
                                      : isSameBatch
                                      ? "bg-purple-700 text-white border-purple-800"
                                      : "bg-sky-700 text-white border-sky-800"
                                  }`}
                                >
                                  {item.analysis.projectedCode}
                                </span>
                                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mt-1">
                                  {isManual ? "Manual" : isExisting ? "Reutilizado" : isSameBatch ? "Agrupado" : "Nuevo Consecutivo"}
                                </span>
                              </div>
                            </td>

                            {/* 12. Acción (Cambiar Código) */}
                            <td className="py-3 px-3 text-center">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingItemRow(item.row);
                                  setAssignSearchQuery("");
                                  setApplyToAllSameName(true);
                                  playSound("click");
                                }}
                                className="inline-flex items-center gap-1.5 text-[11px] font-extrabold px-3 py-1.5 rounded-xl border border-teal-300 bg-teal-50 hover:bg-teal-100 text-teal-900 transition cursor-pointer shadow-2xs active:scale-95 whitespace-nowrap"
                                title="Asignar o vincular manualmente a otro producto del catálogo"
                              >
                                <Edit3 className="w-3.5 h-3.5 text-teal-700" />
                                <span>Cambiar Código</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Informational Guidance Box */}
            <div className="bg-amber-50/90 border border-amber-200 rounded-2xl p-4 text-xs text-amber-900 space-y-2">
              <div className="flex items-center gap-2 font-bold text-amber-950">
                <AlertTriangle className="w-4 h-4 text-amber-700" />
                <span>¿Cómo corregir o cambiar el código asignado a un producto?</span>
              </div>
              <p className="leading-relaxed text-amber-900/90">
                • Si un medicamento aparece como <strong>'Nuevo Producto'</strong> pero tú sabes que ya existe en tu catálogo con otro nombre o código, haz clic en el botón <strong>'Cambiar Código'</strong> en esa fila. Podrás buscar el producto en tu catálogo y asignarlo directamente sin tener que editar el Excel.
              </p>
              <p className="leading-relaxed text-amber-900/90">
                • Además, al asignarlo puedes marcar la casilla para que todas las demás filas del archivo con ese mismo nombre también se vinculen automáticamente a ese producto.
              </p>
            </div>

            {/* Observations / Errors */}
            {previewErrors.length > 0 && (
              <div className="bg-red-50 p-4 rounded-2xl border border-red-200 text-xs text-red-800 space-y-1.5">
                <span className="font-bold flex items-center gap-1.5 text-red-900">
                  <AlertCircle className="w-4 h-4 text-red-700" />
                  <span>Renglones con Observaciones o Errores Omitidos ({previewErrors.length}):</span>
                </span>
                <ul className="list-disc list-inside space-y-0.5 text-[11px] max-h-32 overflow-y-auto font-mono">
                  {previewErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Bottom Action Footer */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-slate-200">
              <div className="text-xs text-slate-500 space-x-3">
                <span>Leídos: <strong>{preview.length + ignoredCount}</strong></span>
                <span>Válidos: <strong>{preview.length}</strong></span>
                <span>Vacíos ignorados: <strong>{ignoredCount}</strong></span>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleCancelPreview}
                  disabled={importing}
                  className="px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition cursor-pointer"
                >
                  Cancelar Previsualización
                </button>
                <button
                  type="button"
                  onClick={handleConfirmImport}
                  disabled={importing}
                  className="px-6 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 active:scale-95 text-white text-xs font-black uppercase tracking-wider transition shadow-md cursor-pointer inline-flex items-center gap-2"
                >
                  {importing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Procesando Importación...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4 stroke-[3]" />
                      <span>Confirmar e Importar ({preview.length} suministros)</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODAL: ASIGNAR MEDICAMENTO A CÓDIGO DEL CATÁLOGO                          */}
      {/* ========================================================================= */}
      {editingItem && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-teal-500/20 text-teal-400 rounded-xl border border-teal-500/30">
                  <Edit3 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-white">
                    Asignar Código al Medicamento
                  </h3>
                  <p className="text-xs text-slate-400">
                    Elige a qué producto de tu catálogo debe dirigirse este ítem del Excel
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingItemRow(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              {/* Excel Item Info Card */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2">
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold flex items-center justify-between">
                  <span>Ítem en el archivo Excel (Fila #{editingItem.row})</span>
                  {editingItem.analysis.isManualOverride && (
                    <span className="text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full font-bold">
                      Asignación Manual Activa
                    </span>
                  )}
                </div>
                <div className="text-sm font-extrabold text-slate-900">
                  {editingItem.nombre}
                </div>
                {editingItem.descripcion && (
                  <div className="text-xs text-slate-600">
                    {editingItem.descripcion}
                  </div>
                )}
                <div className="flex items-center gap-4 text-[11px] text-slate-500 pt-1 font-mono">
                  <span>Cant: <strong>{editingItem.cantidad}</strong></span>
                  <span>Lote: <strong>{editingItem.lote || "Auto"}</strong></span>
                  <span>Vto: <strong>{editingItem.fechaVto || "N/A"}</strong></span>
                </div>
              </div>

              {/* Apply to all same name checkbox */}
              {sameNameCount > 1 && (
                <div className="bg-indigo-50/80 border border-indigo-200 rounded-2xl p-3 flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="applyAllSame"
                    checked={applyToAllSameName}
                    onChange={(e) => setApplyToAllSameName(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 rounded-sm focus:ring-indigo-500 cursor-pointer"
                  />
                  <label htmlFor="applyAllSame" className="text-xs text-indigo-950 font-bold cursor-pointer">
                    Aplicar esta misma asignación a todas las {sameNameCount} filas con el nombre "{editingItem.nombre}" en este Excel
                  </label>
                </div>
              )}

              {/* Option 1: Pick an existing product from catalog */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-2">
                    <Package className="w-4 h-4 text-teal-600" />
                    <span>Opción 1: Vincular a un producto existente del catálogo</span>
                  </h4>
                  <span className="text-[11px] text-slate-400 font-bold">
                    {activeCatalogProducts.length} productos en catálogo
                  </span>
                </div>

                {/* Search in catalog */}
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={assignSearchQuery}
                    onChange={(e) => setAssignSearchQuery(e.target.value)}
                    placeholder="Buscar producto por nombre o código (ej: Paracetamol, P004)..."
                    className="w-full pl-9 pr-4 py-2 text-xs rounded-xl bg-slate-50 border border-slate-300 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition"
                    autoFocus
                  />
                </div>

                {/* Product List */}
                <div className="max-h-60 overflow-y-auto space-y-1.5 border border-slate-200 rounded-2xl p-2 bg-slate-50/50">
                  {filteredCatalogForAssign.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-400">
                      No se encontraron productos en el catálogo con "{assignSearchQuery}".
                    </div>
                  ) : (
                    filteredCatalogForAssign.map((p) => {
                      const totalStock = p.lotes?.reduce((sum, l) => sum + Number(l.cantidad || 0), 0) || 0;
                      const isCurrentlySelected = editingItem.analysis.matchedProduct?.codigo === p.codigo;

                      return (
                        <div
                          key={p.codigo}
                          onClick={() => handleAssignToExistingProduct(p)}
                          className={`p-2.5 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition ${
                            isCurrentlySelected
                              ? "bg-teal-50 border-teal-400 shadow-xs ring-1 ring-teal-400/30"
                              : "bg-white border-slate-200 hover:border-teal-300 hover:bg-teal-50/30"
                          }`}
                        >
                          <div className="space-y-0.5 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-black text-teal-800 bg-teal-100/80 px-2 py-0.5 rounded text-xs">
                                {p.codigo}
                              </span>
                              <span className="font-extrabold text-slate-900 text-xs truncate">
                                {p.nombre}
                              </span>
                            </div>
                            {p.descripcion && (
                              <p className="text-[11px] text-slate-500 truncate pl-0.5">
                                {p.descripcion}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            <div className="text-right text-[11px]">
                              <span className="font-bold text-slate-700 block font-mono">{totalStock} u.</span>
                              <span className="text-[10px] text-slate-400">{p.lotes?.length || 0} lotes</span>
                            </div>
                            <button
                              type="button"
                              className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition cursor-pointer flex items-center gap-1 ${
                                isCurrentlySelected
                                  ? "bg-teal-600 text-white"
                                  : "bg-slate-100 hover:bg-teal-600 hover:text-white text-slate-700"
                              }`}
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>{isCurrentlySelected ? "Seleccionado" : "Asignar"}</span>
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Divider */}
              <div className="relative flex py-2 items-center">
                <div className="grow border-t border-slate-200"></div>
                <span className="shrink mx-4 text-[10px] font-black uppercase tracking-wider text-slate-400">o también</span>
                <div className="grow border-t border-slate-200"></div>
              </div>

              {/* Option 2 & 3: Create as new or reset */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleAssignAsNewProduct}
                  className="p-3 rounded-2xl border border-sky-200 bg-sky-50 hover:bg-sky-100 text-sky-900 text-left transition cursor-pointer flex items-start gap-2.5"
                >
                  <PlusCircle className="w-4 h-4 text-sky-700 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-extrabold text-xs block">Crear como Producto Nuevo</span>
                    <span className="text-[10px] text-sky-700/80 leading-tight block mt-0.5">
                      Generar un código correlativo nuevo (ej: {getInitialPrefix(editingItem.nombre)}001...)
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={handleResetToAuto}
                  className="p-3 rounded-2xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 text-left transition cursor-pointer flex items-start gap-2.5"
                >
                  <Undo2 className="w-4 h-4 text-slate-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-extrabold text-xs block">Detección Automática</span>
                    <span className="text-[10px] text-slate-500 leading-tight block mt-0.5">
                      Restablecer el análisis por nombre original del Excel
                    </span>
                  </div>
                </button>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setEditingItemRow(null)}
                className="px-5 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold transition cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Process Summary */}
      {summary && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-center">
              <span className="block text-2xl font-black text-slate-800">{summary.total}</span>
              <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Filas Leídas</span>
            </div>

            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 text-center">
              <span className="block text-2xl font-black text-emerald-700">{summary.imported}</span>
              <span className="text-xs text-emerald-600 font-bold uppercase tracking-wider">Procesados Exitosamente</span>
            </div>

            <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4 text-center">
              <span className="block text-2xl font-black text-rose-700">{summary.errors.length}</span>
              <span className="text-xs text-rose-600 font-bold uppercase tracking-wider">Errores / Invalidados</span>
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-emerald-600" />
                <h4 className="font-bold text-slate-900 text-sm">Resumen Detallado de Importación</h4>
              </div>

              {summary.lastCargaRecordId && onRevertirCarga && (
                <button
                  type="button"
                  disabled={revertingId === summary.lastCargaRecordId}
                  onClick={() => handleRevertir(summary.lastCargaRecordId!)}
                  className="inline-flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 active:scale-95 transition px-3.5 py-1.5 rounded-xl font-bold text-xs cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Revertir Esta Carga</span>
                </button>
              )}
            </div>

            {summary.imported > 0 && (
              <div className="p-6 border-b border-slate-100 space-y-2">
                <div className="flex items-center gap-2 text-emerald-700 font-bold text-xs uppercase tracking-wider">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                  <span>Registros procesados e insertados ({summary.imported})</span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Se actualizó el catálogo conservando los productos previos. Los suministros coincidentes o asignados recibieron nuevos lotes con su respectivo código, y los nuevos suministros generaron su código correlativo consecutivo.
                </p>
              </div>
            )}

            {summary.errors.length > 0 && (
              <div className="p-6 space-y-3">
                <div className="flex items-center gap-2 text-rose-700 font-bold text-xs uppercase tracking-wider">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
                  <span>Errores de Validación ({summary.errors.length})</span>
                </div>
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

      {/* Historial y Reversión de Cargas Masivas */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-amber-100 text-amber-800 rounded-2xl shadow-xs">
              <RotateCcw className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-extrabold text-slate-900 text-base">Historial y Reversión de Cargas Masivas</h4>
              <p className="text-xs text-slate-500">
                Puedes revertir completamente cualquier carga masiva realizada sin afectar los datos previos.
              </p>
            </div>
          </div>
          <span className="text-xs font-bold text-slate-400 bg-slate-100 px-3 py-1 rounded-full">
            {catalogCargas.length} Carga(s)
          </span>
        </div>

        {catalogCargas.length === 0 ? (
          <div className="text-center py-10 bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-400 text-xs font-medium space-y-1">
            <History className="w-8 h-8 mx-auto text-slate-300" />
            <p className="font-bold text-slate-600">No hay registros de cargas masivas en este catálogo</p>
            <p className="text-[11px] text-slate-400">Las futuras importaciones desde Excel aparecerán registradas en esta sección.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {catalogCargas.map((cm) => (
              <div
                key={cm.id}
                className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition ${
                  cm.revertida
                    ? "bg-slate-50 border-slate-200 opacity-60"
                    : "bg-amber-50/40 border-amber-200/80 shadow-xs hover:border-amber-300"
                }`}
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-slate-900 text-sm truncate">
                      📄 {cm.nombreArchivo || "Carga_Masiva.xlsx"}
                    </span>
                    {cm.revertida ? (
                      <span className="text-[10px] font-black bg-slate-200 text-slate-700 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                        Revertida
                      </span>
                    ) : (
                      <span className="text-[10px] font-black bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                        Activa
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 flex flex-wrap gap-x-4 gap-y-1">
                    <span>📅 {cm.fecha}</span>
                    <span>👤 {cm.usuario}</span>
                    <span>📦 {cm.totalItems} ítems</span>
                    <span className="text-teal-700 font-semibold">✨ {cm.productosCreados?.length || 0} nuevos productos</span>
                    <span className="text-emerald-700 font-semibold">🏷️ {cm.lotesCreados?.length || 0} lotes agregados</span>
                  </div>
                  {cm.revertida && (
                    <p className="text-[11px] text-rose-700 font-semibold italic pt-0.5">
                      Revertida el {cm.fechaReversion ? new Date(cm.fechaReversion).toLocaleString("es-ES") : "recientemente"} por {cm.usuarioReversion || "Usuario"}.
                    </p>
                  )}
                </div>

                {!cm.revertida && onRevertirCarga && (
                  <button
                    type="button"
                    disabled={revertingId === cm.id}
                    onClick={() => handleRevertir(cm.id)}
                    className="inline-flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-700 active:scale-95 transition text-white px-4 py-2.5 rounded-xl font-extrabold text-xs shadow-sm cursor-pointer shrink-0 disabled:opacity-50"
                  >
                    {revertingId === cm.id ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>Revirtiendo...</span>
                      </>
                    ) : (
                      <>
                        <RotateCcw className="w-4 h-4" />
                        <span>Revertir Carga</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
