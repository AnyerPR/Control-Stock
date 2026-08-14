import React, { useState, useEffect } from "react";
import { collection, doc, query, orderBy, onSnapshot, addDoc, updateDoc, getCountFromServer, where, getDocs, writeBatch, limit, deleteDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Usuario, Solicitud, RegistroHistorial, CambioEstado, Producto, Lote, Movimiento, SolicitudItem, Departamento } from "../types";
import { playSound } from "../utils/audio";
import { logSystemEvent } from "../utils/chatHelper";
import { FileText, ClipboardList, Plus, Search, Filter, AlertCircle, HelpCircle, Calendar, Clock, RefreshCw, Layers, LoaderCircle, User, X, PlusCircle, Trash2 } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface SolicitudesPanelProps {
  currentUser: Usuario;
  activePeriod: string; // Ej: "Julio 2026"
  showToast: (message: string) => void;
  products: Producto[];
  departamentos: Departamento[];
  activeCatalogId: string;
  catalogos: any[];
}

const DEPARTAMENTOS = [
  "Odontología",
  "Laboratorio",
  "Quirófano",
  "Urgencias",
  "Pediatría",
  "Gineco-Obstetricia",
  "Cirugía General",
  "Consulta Externa",
  "Farmacia Clínica"
];

export default function SolicitudesPanel({ currentUser, activePeriod, showToast, products, departamentos, activeCatalogId, catalogos }: SolicitudesPanelProps) {
  const dynamicDepts = departamentos.length > 0 ? departamentos.map((d) => d.nombre) : DEPARTAMENTOS;
  const isWarehouseOrAdmin = currentUser.rol === "Administrador" || currentUser.departamento === "Almacén y Suministro" || currentUser.departamento === "Farmacia";

  const getDaysToExpiration = (dateStr: string) => {
    if (!dateStr) return Infinity;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expDate = new Date(dateStr + "T00:00:00");
    return Math.ceil((expDate.getTime() - today.getTime()) / 86400000);
  };

  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [historialList, setHistorialList] = useState<RegistroHistorial[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSubTab, setActiveSubTab] = useState<"list" | "create" | "history">("list");

  // Catalog Active state for new solicitud
  const [solicitudCatalogId, setSolicitudCatalogId] = useState<string>("");

  const getAvailableCatalogos = () => {
    const activeCatalogos = (catalogos || []).filter((c) => c.activo);
    if (currentUser?.rol === "Administrador" || currentUser?.departamento === "Almacén y Suministro") {
      return activeCatalogos;
    }
    const userCats = currentUser?.catalogos || [];
    return activeCatalogos.filter((c) => userCats.includes(c.id));
  };

  const handleSetSolicitudCatalogId = (catId: string) => {
    const allowed = getAvailableCatalogos().some(c => c.id === catId);
    if (catId && !allowed) {
      showToast("No tiene permisos para acceder a este catálogo.");
      return;
    }

    if (solicitudItems.length > 0) {
      const confirmChange = window.confirm("Cambiar el catálogo eliminará los productos ya seleccionados en la solicitud actual. ¿Desea continuar?");
      if (!confirmChange) return;
      setSolicitudItems([]);
    }
    setSolicitudCatalogId(catId);
    playSound("click");
  };

  // Filters for Admin (Órdenes) or Operator (Mis Solicitudes)
  const [deptFilter, setDeptFilter] = useState("todos");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [searchTerm, setSearchTerm] = useState("");
  const [periodFilter, setPeriodFilter] = useState(activePeriod);
  const [availablePeriods, setAvailablePeriods] = useState<string[]>([activePeriod]);

  // Advanced Filters for Orders Query
  const [dateFilter, setDateFilter] = useState("");
  const [creatorFilter, setCreatorFilter] = useState("");
  const [orderNumberFilter, setOrderNumberFilter] = useState("");
  const [catalogFilterState, setCatalogFilterState] = useState("todos");

  // History Filter State
  const [histDeptFilter, setHistDeptFilter] = useState("todos");
  const [histDateFilter, setHistDateFilter] = useState("");
  const [histStatusFilter, setHistStatusFilter] = useState("todos");
  const [histUserFilter, setHistUserFilter] = useState("");

  const currentDepartment = currentUser.departamento || "Laboratorio";
  const [solicitudDept, setSolicitudDept] = useState<string>(() => currentUser.departamento || "Laboratorio");

  useEffect(() => {
    if (currentUser.departamento) {
      setSolicitudDept(currentUser.departamento);
    }
  }, [currentUser]);

  // Create Form State
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"Baja" | "Media" | "Alta">("Media");
  const [observations, setObservations] = useState("");
  const [creating, setCreating] = useState(false);

  // Custom structured products in solicitud creation
  const [solicitudItems, setSolicitudItems] = useState<Omit<SolicitudItem, "id">[]>([]);
  const [selectedProdCode, setSelectedProdCode] = useState("");
  const [qtyRequested, setQtyRequested] = useState("1");
  const [itemSearch, setItemSearch] = useState("");
  const [onlyUnverified, setOnlyUnverified] = useState(false);

  // Edit Status State
  const [selectedSolicitud, setSelectedSolicitud] = useState<Solicitud | null>(null);
  const [newStatus, setNewState] = useState<"Pendiente" | "Aprobada" | "Rechazada" | "En Proceso" | "Entregada">("Pendiente");
  const [statusObs, setStatusObs] = useState("");
  const [updating, setUpdating] = useState(false);

  // Listen to Solicitudes in real-time
  useEffect(() => {
    const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";

    if (isLocalFileMode) {
      const loadOfflineData = () => {
        // 1. Periods
        let storedSol = localStorage.getItem("offline_solicitudes");
        let solList: Solicitud[] = [];
        if (storedSol) {
          try { solList = JSON.parse(storedSol); } catch (e) {}
        }
        const periodsSet = new Set<string>();
        periodsSet.add(activePeriod);
        solList.forEach(s => {
          if (s.periodo) periodsSet.add(s.periodo);
        });
        setAvailablePeriods(Array.from(periodsSet).sort());
        setSolicitudes(solList);

        // 2. History
        let storedHist = localStorage.getItem("offline_historial");
        let histList: RegistroHistorial[] = [];
        if (storedHist) {
          try { histList = JSON.parse(storedHist); } catch (e) {}
        }
        setHistorialList(histList);
        setLoading(false);
      };

      loadOfflineData();

      window.addEventListener("offline_solicitudes_update", loadOfflineData);
      window.addEventListener("offline_historial_update", loadOfflineData);
      return () => {
        window.removeEventListener("offline_solicitudes_update", loadOfflineData);
        window.removeEventListener("offline_historial_update", loadOfflineData);
      };
    }

    setLoading(true);
    const colRef = collection(db, "solicitudes");
    
    // Listen to all solicitudes to feed available periods
    const unsubAll = onSnapshot(colRef, (snapshot) => {
      const periodsSet = new Set<string>();
      periodsSet.add(activePeriod);
      snapshot.forEach(d => {
        const data = d.data() as Solicitud;
        if (data.periodo) periodsSet.add(data.periodo);
      });
      setAvailablePeriods(Array.from(periodsSet).sort());
    });

    // Main query ordered by timestamp
    const q = query(colRef, orderBy("timestamp", "desc"));
    
    // Track known requests and their states
    let isFirstLoad = true;
    let knownRequestsMap = new Map<string, { id: string, numeroSolicitud: string, departamento: string, estado: string, usuarioCreador: string }>();

    const unsub = onSnapshot(q, (snapshot) => {
      const list: Solicitud[] = [];
      const newRequestsMap = new Map<string, { id: string, numeroSolicitud: string, departamento: string, estado: string, usuarioCreador: string }>();
      
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as Omit<Solicitud, "id">;
        const item = { id: docSnap.id, ...data } as Solicitud;
        list.push(item);
        newRequestsMap.set(item.id, {
          id: item.id,
          numeroSolicitud: item.numeroSolicitud,
          departamento: item.departamento,
          estado: item.estado,
          usuarioCreador: item.usuarioCreador
        });
      });

      setSolicitudes(list);
      setLoading(false);

      // Play sound and show toast if a request is created or its state changes
      if (!isFirstLoad && list.length > 0) {
        newRequestsMap.forEach((newVal, id) => {
          const oldVal = knownRequestsMap.get(id);
          const selfCreator = `${currentUser.nombre} (${currentUser.usuario})`;
          
          if (!oldVal) {
            // Created!
            if (newVal.usuarioCreador !== selfCreator) {
              playSound("notify");
              showToast(`Nueva solicitud creada: ${newVal.numeroSolicitud} - ${newVal.departamento}`);
            }
          } else if (oldVal.estado !== newVal.estado) {
            // Status changed!
            const belongsToDept = currentUser.departamento === newVal.departamento;
            const canSeeAll = currentUser.rol === "Administrador" || currentUser.departamento === "Almacén y Suministro" || currentUser.departamento === "Farmacia";
            
            if (belongsToDept || canSeeAll) {
              playSound("notify");
              showToast(`Solicitud ${newVal.numeroSolicitud} cambió a: ${newVal.estado}`);
            }
          }
        });
      }

      knownRequestsMap = newRequestsMap;
      isFirstLoad = false;
    });

    // Listen to global history
    const histCol = collection(db, "historial");
    const qHist = query(histCol, orderBy("timestamp", "desc"), limit(100));
    const unsubHist = onSnapshot(qHist, (snapshot) => {
      const list: RegistroHistorial[] = [];
      snapshot.forEach(docSnap => {
        list.push({ id: docSnap.id, ...docSnap.data() } as RegistroHistorial);
      });
      setHistorialList(list);
    });

    return () => {
      unsubAll();
      unsub();
      unsubHist();
    };
  }, [activePeriod, currentUser]);

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creating) return;

    if (!solicitudCatalogId) {
      alert("Por favor seleccione un catálogo de trabajo antes de registrar la solicitud.");
      return;
    }

    const desc = description.trim();
    if (!desc && solicitudItems.length === 0) {
      alert("Por favor agregue una descripción o añada insumos específicos a la solicitud.");
      return;
    }

    setCreating(true);
    playSound("action");

    const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";

    const effectiveDept = (currentUser.rol === "Administrador" || currentUser.departamento === "Almacén y Suministro")
      ? (solicitudDept || currentUser.departamento || "Almacén y Suministro")
      : (currentUser.departamento || solicitudDept || "Laboratorio");

    try {
      if (isLocalFileMode) {
        let storedSol = localStorage.getItem("offline_solicitudes");
        let solList: Solicitud[] = [];
        if (storedSol) {
          try { solList = JSON.parse(storedSol); } catch (e) {}
        }
        const nextNum = String(solList.length + 1).padStart(4, "0");
        const numeroSolicitud = `SOL-${nextNum}`;

        const now = new Date();
        const localDate = now.toLocaleDateString("en-CA"); // YYYY-MM-DD
        const localTime = now.toLocaleTimeString("es-DO", { hour12: false }).slice(0, 5); // HH:MM

        const finalDesc = desc || (solicitudItems.map(it => `${it.productoNombre} (Cant: ${it.cantidadSolicitada})`).join(", "));

        const newId = `sol-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const docData: Solicitud = {
          id: newId,
          numeroSolicitud,
          fecha: localDate,
          hora: localTime,
          departamento: effectiveDept,
          usuarioCreador: `${currentUser.nombre} (${currentUser.usuario})`,
          descripcion: finalDesc,
          prioridad: priority,
          estado: "Pendiente",
          observaciones: observations.trim(),
          periodo: activePeriod,
          timestamp: Date.now(),
          catalogId: solicitudCatalogId,
          historialCambios: [
            {
              estado: "Pendiente",
              usuarioResponsable: `${currentUser.nombre} (${currentUser.usuario})`,
              fecha: localDate,
              hora: localTime
            }
          ],
          items: solicitudItems.map(it => ({
            id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            ...it
          }))
        };

        solList.unshift(docData);
        localStorage.setItem("offline_solicitudes", JSON.stringify(solList));

        // Create global history entry
        let storedHist = localStorage.getItem("offline_historial");
        let histList: RegistroHistorial[] = [];
        if (storedHist) {
          try { histList = JSON.parse(storedHist); } catch (e) {}
        }
        const histData: RegistroHistorial = {
          id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          tipo: "Creación",
          solicitudId: newId,
          numeroSolicitud,
          descripcionEvent: `Se creó la solicitud ${numeroSolicitud} para el departamento de ${effectiveDept}.`,
          usuarioResponsable: `${currentUser.nombre} (${currentUser.usuario})`,
          fecha: localDate,
          hora: localTime,
          timestamp: Date.now(),
          catalogId: solicitudCatalogId
        };
        histList.unshift(histData);
        localStorage.setItem("offline_historial", JSON.stringify(histList));

        // Notify chat
        logSystemEvent(`🆕 **Nueva Solicitud**: Se creó la solicitud **${numeroSolicitud}** de **${effectiveDept}** por el usuario **${currentUser.nombre}** (Prioridad: ${priority}).`);

        window.dispatchEvent(new Event("offline_solicitudes_update"));
        window.dispatchEvent(new Event("offline_historial_update"));

        setDescription("");
        setObservations("");
        setPriority("Media");
        setSolicitudItems([]);
        setSolicitudCatalogId("");
        setActiveSubTab("list");
        playSound("positive");
        showToast(`Solicitud ${numeroSolicitud} creada exitosamente.`);
        setCreating(false);
        return;
      }

      // 1. Get next auto SOL-XXXX number
      const colRef = collection(db, "solicitudes");
      const countSnapshot = await getCountFromServer(colRef);
      const nextNum = String(countSnapshot.data().count + 1).padStart(4, "0");
      const numeroSolicitud = `SOL-${nextNum}`;

      const now = new Date();
      const localDate = now.toLocaleDateString("en-CA"); // YYYY-MM-DD
      const localTime = now.toLocaleTimeString("es-DO", { hour12: false }).slice(0, 5); // HH:MM

      // If desc is empty but we have items, create an auto-description listing the products
      const finalDesc = desc || (solicitudItems.map(it => `${it.productoNombre} (Cant: ${it.cantidadSolicitada})`).join(", "));

      // Create Solicitud document
      const docData: Omit<Solicitud, "id"> = {
        numeroSolicitud,
        fecha: localDate,
        hora: localTime,
        departamento: effectiveDept,
        usuarioCreador: `${currentUser.nombre} (${currentUser.usuario})`,
        descripcion: finalDesc,
        prioridad: priority,
        estado: "Pendiente",
        observaciones: observations.trim(),
        periodo: activePeriod,
        timestamp: Date.now(),
        catalogId: solicitudCatalogId,
        historialCambios: [
          {
            estado: "Pendiente",
            usuarioResponsable: `${currentUser.nombre} (${currentUser.usuario})`,
            fecha: localDate,
            hora: localTime
          }
        ],
        items: solicitudItems.map(it => ({
          id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          ...it
        }))
      };

      const docRef = await addDoc(colRef, docData);

      // Create global history entry
      const histCol = collection(db, "historial");
      const histData: Omit<RegistroHistorial, "id"> = {
        tipo: "Creación",
        solicitudId: docRef.id,
        numeroSolicitud,
        descripcionEvent: `Se creó la solicitud ${numeroSolicitud} para el departamento de ${effectiveDept}.`,
        usuarioResponsable: `${currentUser.nombre} (${currentUser.usuario})`,
        fecha: localDate,
        hora: localTime,
        timestamp: Date.now(),
        catalogId: solicitudCatalogId
      };
      await addDoc(histCol, histData);
      
      // Notify chat
      logSystemEvent(`🆕 **Nueva Solicitud**: Se creó la solicitud **${numeroSolicitud}** de **${effectiveDept}** por el usuario **${currentUser.nombre}** (Prioridad: ${priority}).`);

      setDescription("");
      setObservations("");
      setPriority("Media");
      setSolicitudItems([]);
      setSolicitudCatalogId("");
      setActiveSubTab("list");
      playSound("positive");
      showToast(`Solicitud ${numeroSolicitud} creada exitosamente.`);
    } catch (err) {
      console.error("Error creating request:", err);
      alert("Error al guardar la solicitud.");
    } finally {
      setCreating(false);
    }
  };

  const [deliveryItems, setDeliveryItems] = useState<SolicitudItem[]>([]);

  const getExportItems = (sol: Solicitud) => {
    if (selectedSolicitud && selectedSolicitud.id === sol.id && deliveryItems && deliveryItems.length > 0) {
      return deliveryItems;
    }
    const itemsList = sol.items || [];
    if (itemsList.length === 0) {
      return [{
        id: "fallback-item",
        productoCodigo: "Gral",
        productoNombre: sol.descripcion,
        cantidadSolicitada: 1,
        cantidadEntregada: 1,
        motivoDiferencia: ""
      }];
    }
    return itemsList.map(item => ({
      ...item,
      cantidadEntregada: item.cantidadEntregada !== undefined ? item.cantidadEntregada : item.cantidadSolicitada
    }));
  };

  const exportToWord = (sol: Solicitud) => {
    const items = getExportItems(sol);
    let total = 0;
    
    const itemsRows = items.map((item, idx) => {
      const prod = products?.find(p => p.codigo === item.productoCodigo);
      const price = item.loteId && prod 
        ? prod.lotes?.find((l: Lote) => l.id === item.loteId)?.precio || prod.lotes?.[0]?.precio || 0
        : prod?.lotes?.[0]?.precio || 0;
      const qty = item.cantidadEntregada;
      const sub = qty * price;
      total += sub;
      
      return `
        <tr style="page-break-inside: avoid;">
          <td style="border: 1px solid #cbd5e1; padding: 7pt 5pt; text-align: center; font-size: 9pt; color: #64748b;">${idx + 1}</td>
          <td style="border: 1px solid #cbd5e1; padding: 7pt 5pt; text-align: left; font-size: 9pt; font-weight: bold; color: #0f766e;">${item.productoCodigo}</td>
          <td style="border: 1px solid #cbd5e1; padding: 7pt 5pt; text-align: left; font-size: 9pt; color: #1e293b;">${item.productoNombre}</td>
          <td style="border: 1px solid #cbd5e1; padding: 7pt 5pt; text-align: center; font-size: 9pt; font-weight: bold; color: #475569;">${item.cantidadSolicitada}</td>
          <td style="border: 1px solid #cbd5e1; padding: 7pt 5pt; text-align: center; font-size: 9pt; font-weight: bold; color: #0f766e;">${qty}</td>
          <td style="border: 1px solid #cbd5e1; padding: 7pt 5pt; text-align: right; font-size: 9pt; color: #475569;">RD$ ${price.toFixed(2)}</td>
          <td style="border: 1px solid #cbd5e1; padding: 7pt 5pt; text-align: right; font-size: 9pt; font-weight: bold; color: #0f766e;">RD$ ${sub.toFixed(2)}</td>
        </tr>
      `;
    }).join("");

    const wordHtml = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8">
        <title>Orden de Suministros - ${sol.numeroSolicitud}</title>
        <!--[if gte mso 9]>
        <xml>
          <w:WordDocument>
            <w:View>Print</w:View>
            <w:Zoom>100</w:Zoom>
            <w:DoNotOptimizeForBrowser/>
          </w:WordDocument>
        </xml>
        <![endif]-->
        <style>
          @page Section1 {
            size: 8.5in 11in;
            margin: 0.75in 0.75in 0.75in 0.75in;
            mso-header-margin: 0.5in;
            mso-footer-margin: 0.5in;
          }
          div.Section1 {
            page: Section1;
          }
          body {
            font-family: Arial, 'Segoe UI', sans-serif;
            color: #334155;
            margin: 0;
            padding: 0;
          }
          table {
            border-collapse: collapse;
            mso-table-lspace: 0pt;
            mso-table-rspace: 0pt;
          }
          .header-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
            border-bottom: 2px solid #0f766e;
            padding-bottom: 12px;
          }
          .title {
            font-size: 16pt;
            font-weight: bold;
            color: #0f766e;
            text-transform: uppercase;
          }
          .subtitle {
            font-size: 9pt;
            color: #64748b;
            margin-top: 3px;
          }
          .info-box {
            background-color: #f8fafc;
            border: 1px solid #e2e8f0;
            padding: 12px;
            margin-bottom: 20px;
          }
          .info-table {
            width: 100%;
            border-collapse: collapse;
          }
          .info-table td {
            padding: 4px 6px;
            font-size: 9pt;
            vertical-align: top;
          }
          .info-label {
            font-weight: bold;
            color: #475569;
            width: 22%;
          }
          .info-value {
            color: #1e293b;
            width: 28%;
          }
          .product-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
            margin-bottom: 20px;
          }
          .product-table th {
            background-color: #0f766e;
            color: #ffffff;
            font-size: 9pt;
            font-weight: bold;
            text-transform: uppercase;
            padding: 8pt 6pt;
            border: 1px solid #0f766e;
          }
          .obs-box {
            margin-top: 20px;
            padding: 10pt;
            border-left: 4px solid #0f766e;
            background-color: #f8fafc;
            font-size: 9pt;
          }
          .signatures {
            margin-top: 45px;
            width: 100%;
            page-break-inside: avoid;
          }
          .signatures td {
            text-align: center;
            font-size: 9pt;
            width: 50%;
            vertical-align: top;
          }
          .sig-line {
            width: 70%;
            border-top: 1px solid #94a3b8;
            margin: 0 auto 6px auto;
          }
        </style>
      </head>
      <body>
        <div class="Section1">
          <table class="header-table">
            <tr>
              <td style="vertical-align: middle;">
                <div class="title">CONTROL DE STOCK - ORDEN DE SERVICIO</div>
                <div class="subtitle">Suministros Hospitalarios &bull; Dr. José Manuel Rodríguez</div>
              </td>
              <td style="text-align: right; vertical-align: middle;">
                <div style="font-size: 13pt; font-weight: bold; color: #0f766e; background-color: #f0fdfa; border: 1px solid #ccfbf1; padding: 6px 12px; display: inline-block;">
                  ${sol.numeroSolicitud}
                </div>
                <div style="font-size: 8pt; color: #64748b; margin-top: 4px;">Fecha: ${new Date(sol.fecha + "T00:00:00").toLocaleDateString("es-DO")} | ${sol.hora}</div>
              </td>
            </tr>
          </table>

          <div class="info-box">
            <table class="info-table">
              <tr>
                <td class="info-label">Departamento Solicitante:</td>
                <td class="info-value"><strong>${sol.departamento}</strong></td>
                <td class="info-label">Usuario Solicitante:</td>
                <td class="info-value">${sol.usuarioCreador}</td>
              </tr>
              <tr>
                <td class="info-label">Estado de la Orden:</td>
                <td class="info-value"><span style="color: #0f766e; font-weight: bold;">${sol.estado}</span></td>
                <td class="info-label">Periodo Mensual:</td>
                <td class="info-value">${sol.periodo}</td>
              </tr>
              ${sol.descripcion ? `
              <tr>
                <td class="info-label">Justificación:</td>
                <td class="info-value" colspan="3">${sol.descripcion}</td>
              </tr>` : ""}
            </table>
          </div>

          <table class="product-table">
            <thead>
              <tr>
                <th style="width: 5%; text-align: center;">N.º</th>
                <th style="width: 14%;">Código</th>
                <th style="width: 35%;">Descripción del Insumo</th>
                <th style="width: 11%; text-align: center;">Cant. Sol.</th>
                <th style="width: 11%; text-align: center;">Cant. Ent.</th>
                <th style="width: 12%; text-align: right;">Precio Unit.</th>
                <th style="width: 12%; text-align: right;">Importe</th>
              </tr>
            </thead>
            <tbody>
              ${itemsRows}
              <tr>
                <td colspan="6" style="border: 1px solid #cbd5e1; padding: 8pt 6pt; text-align: right; font-weight: bold; background-color: #f8fafc; font-size: 9.5pt;">TOTAL NETO:</td>
                <td style="border: 1px solid #cbd5e1; padding: 8pt 6pt; text-align: right; font-weight: bold; background-color: #f8fafc; color: #0f766e; font-size: 9.5pt;">RD$ ${total.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>

          ${sol.observaciones ? `
          <div class="obs-box">
            <strong>Observaciones Generales de Entrega:</strong><br/>
            <span style="font-style: italic; color: #475569;">${sol.observaciones}</span>
          </div>
          ` : ""}

          <table class="signatures">
            <tr>
              <td>
                <div class="sig-line"></div>
                <strong>Entregado por (Almacén)</strong><br/>
                <span style="font-size: 8pt; color: #64748b;">Firma y Sello</span>
              </td>
              <td>
                <div class="sig-line"></div>
                <strong>Recibido por (${sol.departamento})</strong><br/>
                <span style="font-size: 8pt; color: #64748b;">Firma y Sello</span>
              </td>
            </tr>
          </table>
        </div>
      </body>
      </html>
    `;

    const blob = new Blob(['\ufeff' + wordHtml], { type: "application/msword;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Orden_${sol.numeroSolicitud}_${(sol.departamento || "General").replace(/[^a-zA-Z0-9]/g, "_")}.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    playSound("positive");
    showToast("Orden exportada a Word (.doc) correctamente.");
  };

  const exportToPDF = (sol: Solicitud) => {
    const items = getExportItems(sol);
    let total = 0;
    
    const doc = new jsPDF("p", "pt", "a4"); // Portrait A4 size (595.28 x 841.89 pt)

    // Header background banner
    doc.setFillColor(248, 250, 252);
    doc.rect(40, 30, 515, 55, "F");

    // Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(15, 118, 110); // Teal 700
    doc.text("CONTROL DE STOCK - ORDEN DE SERVICIO", 55, 52);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text("Suministros Hospitalarios • Dr. José Manuel Rodríguez", 55, 68);

    // Solicitud Number Badge on top-right
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(15, 118, 110);
    doc.text(sol.numeroSolicitud, 470, 52);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`${new Date(sol.fecha + "T00:00:00").toLocaleDateString("es-DO")} ${sol.hora}`, 450, 68);

    // Divider line
    doc.setDrawColor(13, 148, 136); // Teal 600
    doc.setLineWidth(2);
    doc.line(40, 85, 555, 85);

    // Metadata section box
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(40, 95, 515, 60, 4, 4, "F");
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(1);
    doc.roundedRect(40, 95, 515, 60, 4, 4, "S");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text("Departamento Solicitante:", 52, 113);
    doc.text("Usuario Solicitante:", 52, 130);
    doc.text("Estado de la Orden:", 310, 113);
    doc.text("Período Mensual:", 310, 130);

    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 118, 110);
    doc.text(sol.departamento || "General", 175, 113);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(30, 41, 59);
    doc.text(sol.usuarioCreador || "Sistema", 175, 130);

    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 118, 110);
    doc.text((sol.estado || "Pendiente").toUpperCase(), 410, 113);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(30, 41, 59);
    doc.text(sol.periodo || "—", 410, 130);

    if (sol.descripcion) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text("Justificación:", 52, 147);
      doc.setFont("helvetica", "normal");
      doc.text(sol.descripcion.length > 75 ? sol.descripcion.slice(0, 75) + "..." : sol.descripcion, 115, 147);
    }

    // Table rows
    const columns = [
      { header: "N.º", dataKey: "index" },
      { header: "Código", dataKey: "code" },
      { header: "Descripción del Insumo", dataKey: "name" },
      { header: "Cant. Sol.", dataKey: "requested" },
      { header: "Cant. Ent.", dataKey: "delivered" },
      { header: "Precio Unit.", dataKey: "price" },
      { header: "Importe", dataKey: "subtotal" }
    ];

    const rows = items.map((item, idx) => {
      const prod = products?.find(p => p.codigo === item.productoCodigo);
      const price = item.loteId && prod 
        ? prod.lotes?.find((l: Lote) => l.id === item.loteId)?.precio || prod.lotes?.[0]?.precio || 0
        : prod?.lotes?.[0]?.precio || 0;
      const qty = item.cantidadEntregada;
      const sub = qty * price;
      total += sub;

      return {
        index: idx + 1,
        code: item.productoCodigo,
        name: item.productoNombre,
        requested: item.cantidadSolicitada,
        delivered: qty,
        price: `RD$ ${price.toFixed(2)}`,
        subtotal: `RD$ ${sub.toFixed(2)}`
      };
    });

    // Total row
    rows.push({
      index: "",
      code: "",
      name: "TOTAL NETO",
      requested: "",
      delivered: "",
      price: "",
      subtotal: `RD$ ${total.toFixed(2)}`
    } as any);

    autoTable(doc, {
      columns: columns,
      body: rows,
      startY: 165,
      theme: "striped",
      headStyles: {
        fillColor: [15, 118, 110], // Teal 700
        textColor: 255,
        fontSize: 8.5,
        fontStyle: "bold"
      },
      styles: {
        fontSize: 8,
        cellPadding: 5,
        overflow: "linebreak",
        valign: "middle"
      },
      columnStyles: {
        index: { cellWidth: 25, halign: "center" },
        code: { cellWidth: 60, fontStyle: "bold", textColor: [15, 118, 110] },
        name: { cellWidth: 200 },
        requested: { cellWidth: 50, halign: "center" },
        delivered: { cellWidth: 50, halign: "center", fontStyle: "bold" },
        price: { cellWidth: 65, halign: "right" },
        subtotal: { cellWidth: 65, halign: "right", fontStyle: "bold" }
      },
      margin: { left: 40, right: 40 },
      willDrawCell: (data) => {
        if (data.row.index === rows.length - 1) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [248, 250, 252];
          if (data.column.index === 2 || data.column.index === 6) {
            data.cell.styles.textColor = [15, 118, 110];
          }
        }
      }
    });

    let finalY = (doc as any).lastAutoTable?.finalY || 400;

    // Observations
    if (sol.observaciones && finalY < 680) {
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(40, finalY + 15, 515, 35, 3, 3, "F");
      doc.setDrawColor(15, 118, 110);
      doc.setLineWidth(1.5);
      doc.line(40, finalY + 15, 40, finalY + 50);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(15, 118, 110);
      doc.text("Observaciones Generales de Entrega:", 50, finalY + 28);

      doc.setFont("helvetica", "italic");
      doc.setTextColor(71, 85, 105);
      doc.text(sol.observaciones.length > 90 ? sol.observaciones.slice(0, 90) + "..." : sol.observaciones, 50, finalY + 42);
      finalY += 50;
    }

    // Dual Signatures
    const sigY = Math.min(finalY + 55, 730);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(1);
    doc.line(70, sigY, 230, sigY);
    doc.line(365, sigY, 525, sigY);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(30, 41, 59);
    doc.text("Entregado por (Almacén)", 150, sigY + 12, { align: "center" });
    doc.text(`Recibido por (${sol.departamento || "Solicitante"})`, 445, sigY + 12, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text("Firma y Sello", 150, sigY + 23, { align: "center" });
    doc.text("Firma y Sello", 445, sigY + 23, { align: "center" });

    // Page footer
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(`Orden de Servicio • Generado el ${new Date().toLocaleDateString("es-DO")}`, 40, 780);
    doc.text("Página 1 de 1", 520, 780);

    doc.save(`Orden_${sol.numeroSolicitud}_${(sol.departamento || "General").replace(/[^a-zA-Z0-9]/g, "_")}.pdf`);
    playSound("positive");
    showToast("Orden exportada a PDF correctamente.");
  };

  const handleOpenStatusModal = (sol: Solicitud) => {
    setSelectedSolicitud(sol);
    setNewState(sol.estado);
    setStatusObs("");

    const itemsList = sol.items || [];
    if (itemsList.length === 0) {
      setDeliveryItems([
        {
          id: "fallback-item",
          productoCodigo: "Gral",
          productoNombre: sol.descripcion,
          cantidadSolicitada: 1,
          cantidadAprobada: 1,
          cantidadEntregada: 1,
          motivoDiferencia: ""
        }
      ]);
    } else {
      setDeliveryItems(
        itemsList.map(item => ({
          ...item,
          cantidadAprobada: item.cantidadAprobada !== undefined ? item.cantidadAprobada : item.cantidadSolicitada,
          cantidadEntregada: item.cantidadEntregada !== undefined ? item.cantidadEntregada : item.cantidadSolicitada,
          motivoDiferencia: item.motivoDiferencia || ""
        }))
      );
    }
  };

  const handleUpdateApprovedQty = (itemId: string, qty: number) => {
    setDeliveryItems(prev =>
      prev.map(item => (item.id === itemId ? { ...item, cantidadAprobada: qty } : item))
    );
  };

  const handleUpdateDeliveryQty = (itemId: string, qty: number) => {
    setDeliveryItems(prev =>
      prev.map(item => (item.id === itemId ? { ...item, cantidadEntregada: qty } : item))
    );
  };

  const handleUpdateDeliveryReason = (itemId: string, reason: string) => {
    setDeliveryItems(prev =>
      prev.map(item => (item.id === itemId ? { ...item, motivoDiferencia: reason } : item))
    );
  };

  const handleUpdateDeliveryLot = (itemId: string, lotId: string, lotNum: string) => {
    setDeliveryItems(prev =>
      prev.map(item => (item.id === itemId ? { ...item, loteId: lotId, loteNumero: lotNum } : item))
    );
  };

  const handleUpdateStatusSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSolicitud || updating) return;

    // Validation
    for (const item of deliveryItems) {
      if (item.cantidadEntregada < 0) {
        alert("La cantidad entregada no puede ser negativa.");
        return;
      }
      if (item.cantidadEntregada !== item.cantidadSolicitada && !item.motivoDiferencia?.trim()) {
        alert(`Por favor ingrese el motivo de la diferencia para el producto: ${item.productoNombre}`);
        return;
      }
      if (item.productoCodigo !== "Gral" && item.cantidadEntregada > 0) {
        const matchingProduct = products?.find(p => p.codigo === item.productoCodigo);
        if (matchingProduct && matchingProduct.lotes.length > 0) {
          if (!item.loteId) {
            alert(`Por favor seleccione el lote de despacho para el producto: ${item.productoNombre}`);
            return;
          }
          const lot = matchingProduct.lotes.find(l => l.id === item.loteId);
          if (!lot || lot.cantidad < item.cantidadEntregada) {
            alert(`Stock insuficiente en el lote seleccionado para ${item.productoNombre}. Disponible: ${lot ? lot.cantidad : 0}`);
            return;
          }
        }
      }
    }

    setUpdating(true);
    playSound("action");

    const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";

    try {
      if (isLocalFileMode) {
        const now = new Date();
        const localDate = now.toLocaleDateString("en-CA");
        const localTime = now.toLocaleTimeString("es-DO", { hour12: false }).slice(0, 5);

        const nuevoCambio: CambioEstado = {
          estado: newStatus,
          usuarioResponsable: `${currentUser.nombre} (${currentUser.usuario})`,
          fecha: localDate,
          hora: localTime
        };

        const updatedHistory = [...selectedSolicitud.historialCambios, nuevoCambio];

        // 1. Update offline solicitudes
        let storedSol = localStorage.getItem("offline_solicitudes");
        let solList: Solicitud[] = [];
        if (storedSol) {
          try { solList = JSON.parse(storedSol); } catch (e) {}
        }
        solList = solList.map(s => {
          if (s.id === selectedSolicitud.id) {
            return {
              ...s,
              estado: newStatus,
              observaciones: statusObs.trim() || s.observaciones,
              historialCambios: updatedHistory,
              items: deliveryItems.filter(item => item.id !== "fallback-item")
            };
          }
          return s;
        });
        localStorage.setItem("offline_solicitudes", JSON.stringify(solList));

        // 2. Update offline products & movements
        let storedProds = localStorage.getItem("offline_productos");
        let prodList: Producto[] = [];
        if (storedProds) {
          try { prodList = JSON.parse(storedProds); } catch (e) {}
        }

        let storedMovs = localStorage.getItem("offline_movimientos");
        let movList: Movimiento[] = [];
        if (storedMovs) {
          try { movList = JSON.parse(storedMovs); } catch (e) {}
        }

        for (const item of deliveryItems) {
          if (item.productoCodigo !== "Gral" && item.cantidadEntregada > 0 && item.loteId) {
            prodList = prodList.map(prod => {
              if (prod.codigo === item.productoCodigo) {
                const nextLotes = prod.lotes.map((l: Lote) => {
                  if (l.id === item.loteId) {
                    let nextQty = l.cantidad;
                    let nextQtyF = l.cantidadF;

                    if (l.cantidad >= item.cantidadEntregada) {
                      nextQty = l.cantidad - item.cantidadEntregada;
                    }
                    if (l.cantidadF !== undefined && l.cantidadF !== null && l.cantidadF >= item.cantidadEntregada) {
                      nextQtyF = l.cantidadF - item.cantidadEntregada;
                    }

                    return { ...l, cantidad: nextQty, cantidadF: nextQtyF };
                  }
                  return l;
                });
                return { ...prod, lotes: nextLotes, verificado: false, updatedAt: Date.now() };
              }
              return prod;
            });

            // Create movement log
            const matchingProd = products?.find(p => p.codigo === item.productoCodigo);
            const movId = `mov-${item.productoCodigo}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const mov: Movimiento = {
              id: movId,
              productoCodigo: item.productoCodigo,
              productoNombre: item.productoNombre,
              lote: item.loteNumero || "S/L",
              cantidad: item.cantidadEntregada,
              precio: matchingProd?.lotes.find((l: Lote) => l.id === item.loteId)?.precio || 0,
              tipoMovimiento: "Salida",
              usuario: `${currentUser.nombre} (${currentUser.usuario})`,
              fecha: new Date().toISOString(),
              timestamp: Date.now(),
              catalogId: activeCatalogId
            };
            movList.unshift(mov);
          }
        }

        localStorage.setItem("offline_productos", JSON.stringify(prodList));
        localStorage.setItem("offline_movimientos", JSON.stringify(movList));

        // 3. Register in global history
        let storedHist = localStorage.getItem("offline_historial");
        let histList: RegistroHistorial[] = [];
        if (storedHist) {
          try { histList = JSON.parse(storedHist); } catch (e) {}
        }
        const histId = `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const histData: RegistroHistorial = {
          id: histId,
          tipo: "Cambio de Estado",
          solicitudId: selectedSolicitud.id,
          numeroSolicitud: selectedSolicitud.numeroSolicitud,
          descripcionEvent: `La orden ${selectedSolicitud.numeroSolicitud} actualizó entrega y cambió su estado a "${newStatus}".`,
          usuarioResponsable: `${currentUser.nombre} (${currentUser.usuario})`,
          fecha: localDate,
          hora: localTime,
          timestamp: Date.now(),
          catalogId: activeCatalogId
        };
        histList.unshift(histData);
        localStorage.setItem("offline_historial", JSON.stringify(histList));

        // Notify chat & dispatches
        logSystemEvent(`🚚 **Entrega de Orden**: La orden **${selectedSolicitud.numeroSolicitud}** del departamento **${selectedSolicitud.departamento}** ha sido actualizada por **${currentUser.nombre}**. Nuevo estado: **${newStatus}**.`);

        window.dispatchEvent(new Event("offline_solicitudes_update"));
        window.dispatchEvent(new Event("offline_historial_update"));
        window.dispatchEvent(new Event("offline_productos_update"));
        window.dispatchEvent(new Event("offline_movimientos_update"));

        setSelectedSolicitud(null);
        playSound("positive");
        showToast(`Estado y entrega de la orden ${selectedSolicitud.numeroSolicitud} actualizados con éxito.`);
        setUpdating(false);
        return;
      }

      const now = new Date();
      const localDate = now.toLocaleDateString("en-CA");
      const localTime = now.toLocaleTimeString("es-DO", { hour12: false }).slice(0, 5);

      const nuevoCambio: CambioEstado = {
        estado: newStatus,
        usuarioResponsable: `${currentUser.nombre} (${currentUser.usuario})`,
        fecha: localDate,
        hora: localTime
      };

      const updatedHistory = [...selectedSolicitud.historialCambios, nuevoCambio];
      const docRef = doc(db, "solicitudes", selectedSolicitud.id);

      // Save delivery details inside the order
      await updateDoc(docRef, {
        estado: newStatus,
        observaciones: statusObs.trim() || selectedSolicitud.observaciones,
        historialCambios: updatedHistory,
        items: deliveryItems.filter(item => item.id !== "fallback-item")
      });

      // Update inventory and log movements in batch
      const batch = writeBatch(db);
      const productsCol = collection(db, "productos");
      const movementsCol = collection(db, "movimientos");
      const productsToUpdateMap = new Map<string, Producto>();

      for (const item of deliveryItems) {
        if (item.productoCodigo !== "Gral" && item.cantidadEntregada > 0 && item.loteId) {
          const matchingProduct = products?.find(p => p.codigo === item.productoCodigo);
          if (matchingProduct) {
            const prod = productsToUpdateMap.get(item.productoCodigo) || JSON.parse(JSON.stringify(matchingProduct));
            
            prod.lotes = prod.lotes.map((l: Lote) => {
              if (l.id === item.loteId) {
                let nextQty = l.cantidad;
                let nextQtyF = l.cantidadF;

                if (l.cantidad >= item.cantidadEntregada) {
                  nextQty = l.cantidad - item.cantidadEntregada;
                }
                if (l.cantidadF !== undefined && l.cantidadF !== null && l.cantidadF >= item.cantidadEntregada) {
                  nextQtyF = l.cantidadF - item.cantidadEntregada;
                }

                return { ...l, cantidad: nextQty, cantidadF: nextQtyF };
              }
              return l;
            });

            productsToUpdateMap.set(item.productoCodigo, prod);

            // Create movement log
            const movId = `mov-${prod.codigo}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const mov: Movimiento = {
              id: movId,
              productoCodigo: prod.codigo,
              productoNombre: prod.nombre,
              lote: item.loteNumero || "S/L",
              cantidad: item.cantidadEntregada,
              precio: prod.lotes.find((l: Lote) => l.id === item.loteId)?.precio || 0,
              tipoMovimiento: "Salida",
              usuario: `${currentUser.nombre} (${currentUser.usuario})`,
              fecha: new Date().toISOString(),
              timestamp: Date.now(),
              catalogId: activeCatalogId
            };
            batch.set(doc(movementsCol, movId), mov);
          }
        }
      }

      for (const [code, updatedProd] of productsToUpdateMap.entries()) {
        batch.set(doc(productsCol, code.replace(/\//g, "_")), { ...updatedProd, verificado: false });
      }

      await batch.commit();

      // Register in global history
      const histCol = collection(db, "historial");
      const histData: Omit<RegistroHistorial, "id"> = {
        tipo: "Cambio de Estado",
        solicitudId: selectedSolicitud.id,
        numeroSolicitud: selectedSolicitud.numeroSolicitud,
        descripcionEvent: `La orden ${selectedSolicitud.numeroSolicitud} actualizó entrega y cambió su estado a "${newStatus}".`,
        usuarioResponsable: `${currentUser.nombre} (${currentUser.usuario})`,
        fecha: localDate,
        hora: localTime,
        timestamp: Date.now(),
        catalogId: activeCatalogId
      };
      await addDoc(histCol, histData);
      
      // Notify chat
      logSystemEvent(`🚚 **Entrega de Orden**: La orden **${selectedSolicitud.numeroSolicitud}** del departamento **${selectedSolicitud.departamento}** ha sido actualizada por **${currentUser.nombre}**. Nuevo estado: **${newStatus}**.`);

      setSelectedSolicitud(null);
      playSound("positive");
      showToast(`Estado y entrega de la orden ${selectedSolicitud.numeroSolicitud} actualizados con éxito.`);
    } catch (err) {
      console.error("Error updating order delivery:", err);
      alert("Error al actualizar la entrega.");
    } finally {
      setUpdating(false);
    }
  };

  const handleDirectStatusChange = async (
    sol: Solicitud,
    nextStatus: "Pendiente" | "Aprobada" | "Rechazada" | "En Proceso" | "Entregada" | "En proceso" | "Completada" | "En preparación" | "Parcialmente entregada" | "Cancelada",
    obs = ""
  ) => {
    playSound("action");
    try {
      const now = new Date();
      const localDate = now.toLocaleDateString("en-CA");
      const localTime = now.toLocaleTimeString("es-DO", { hour12: false }).slice(0, 5);

      const nuevoCambio: CambioEstado = {
        estado: nextStatus,
        usuarioResponsable: `${currentUser.nombre} (${currentUser.usuario})`,
        fecha: localDate,
        hora: localTime
      };

      const updatedHistory = [...sol.historialCambios, nuevoCambio];
      const docRef = doc(db, "solicitudes", sol.id);

      // If nextStatus is "Entregada", we discount inventory automatically!
      const batch = writeBatch(db);
      const productsCol = collection(db, "productos");
      const movementsCol = collection(db, "movimientos");
      const productsToUpdateMap = new Map<string, Producto>();

      if (nextStatus === "Entregada") {
        const itemsToProcess = sol.items || [];
        for (const item of itemsToProcess) {
          if (item.productoCodigo !== "Gral") {
            const matchingProduct = products?.find(p => p.codigo === item.productoCodigo);
            if (matchingProduct && matchingProduct.lotes.length > 0) {
              const prod = productsToUpdateMap.get(item.productoCodigo) || JSON.parse(JSON.stringify(matchingProduct));
              
              // Find first lote that has sufficient system or physical stock
              let targetLote = prod.lotes.find((l: Lote) => l.cantidad >= item.cantidadSolicitada || l.cantidadF >= item.cantidadSolicitada);
              if (!targetLote && prod.lotes.length > 0) {
                targetLote = prod.lotes[0];
              }

              if (targetLote) {
                const qty = item.cantidadSolicitada;

                prod.lotes = prod.lotes.map((l: Lote) => {
                  if (l.id === targetLote.id) {
                    let nextQty = l.cantidad;
                    let nextQtyF = l.cantidadF;

                    // "si una de las dos no tiene suficiente, solo se descontará de la que si tenga."
                    if (l.cantidad >= qty) {
                      nextQty = l.cantidad - qty;
                    }
                    if (l.cantidadF !== undefined && l.cantidadF !== null && l.cantidadF >= qty) {
                      nextQtyF = l.cantidadF - qty;
                    }

                    return { ...l, cantidad: nextQty, cantidadF: nextQtyF };
                  }
                  return l;
                });

                productsToUpdateMap.set(item.productoCodigo, prod);

                // Create movement log
                const movId = `mov-${prod.codigo}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                const mov: Movimiento = {
                  id: movId,
                  productoCodigo: prod.codigo,
                  productoNombre: prod.nombre,
                  lote: targetLote.numeroLote || "S/L",
                  cantidad: qty,
                  precio: targetLote.precio || 0,
                  tipoMovimiento: "Salida",
                  usuario: `${currentUser.nombre} (${currentUser.usuario})`,
                  fecha: new Date().toISOString(),
                  timestamp: Date.now(),
                  catalogId: activeCatalogId
                };
                batch.set(doc(movementsCol, movId), mov);
              }
            }
          }
        }
      }

      // Prepare update for the request
      await updateDoc(docRef, {
        estado: nextStatus,
        observaciones: obs.trim() || sol.observaciones,
        historialCambios: updatedHistory
      });

      // Commit product updates in batch
      for (const [code, updatedProd] of productsToUpdateMap.entries()) {
        batch.set(doc(productsCol, code.replace(/\//g, "_")), { ...updatedProd, verificado: false });
      }
      await batch.commit();

      // Register in global history
      const histCol = collection(db, "historial");
      const histData: Omit<RegistroHistorial, "id"> = {
        tipo: "Cambio de Estado",
        solicitudId: sol.id,
        numeroSolicitud: sol.numeroSolicitud,
        descripcionEvent: `La solicitud ${sol.numeroSolicitud} de ${sol.departamento} cambió su estado a "${nextStatus}".`,
        usuarioResponsable: `${currentUser.nombre} (${currentUser.usuario})`,
        fecha: localDate,
        hora: localTime,
        timestamp: Date.now(),
        catalogId: activeCatalogId
      };
      await addDoc(histCol, histData);
      
      // Notify chat
      logSystemEvent(`📢 **Actualización de Solicitud**: La solicitud **${sol.numeroSolicitud}** de **${sol.departamento}** cambió su estado a **"${nextStatus}"** (por ${currentUser.nombre}).`);

      playSound("positive");
      showToast(`Solicitud ${sol.numeroSolicitud} cambiada a ${nextStatus} correctamente.`);
    } catch (err) {
      console.error("Error updating status:", err);
      alert("Error al actualizar el estado de la solicitud.");
    }
  };

  const handleDeleteRequest = async (sol: Solicitud) => {
    const isAnyer = currentUser.usuario.toLowerCase() === "anyer" || currentUser.nombre.toLowerCase() === "anyer";
    if (!isAnyer) {
      alert("No tiene permisos para eliminar órdenes. Esta función es de acceso exclusivo para el usuario Anyer.");
      return;
    }

    const confirmed = window.confirm(`¿Está seguro de que desea eliminar permanentemente la orden ${sol.numeroSolicitud} del departamento ${sol.departamento}? Esta acción es irreversible.`);
    if (!confirmed) return;

    playSound("action");

    const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";

    try {
      if (isLocalFileMode) {
        // 1. Delete from offline solicitudes
        let storedSol = localStorage.getItem("offline_solicitudes");
        let solList: Solicitud[] = [];
        if (storedSol) {
          try { solList = JSON.parse(storedSol); } catch (e) {}
        }
        solList = solList.filter(s => s.id !== sol.id);
        localStorage.setItem("offline_solicitudes", JSON.stringify(solList));

        // 2. Register in global history
        const now = new Date();
        const localDate = now.toLocaleDateString("en-CA");
        const localTime = now.toLocaleTimeString("es-DO", { hour12: false }).slice(0, 5);

        let storedHist = localStorage.getItem("offline_historial");
        let histList: RegistroHistorial[] = [];
        if (storedHist) {
          try { histList = JSON.parse(storedHist); } catch (e) {}
        }
        const histId = `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const histData: RegistroHistorial = {
          id: histId,
          tipo: "Eliminación",
          solicitudId: sol.id,
          numeroSolicitud: sol.numeroSolicitud,
          descripcionEvent: `El usuario Anyer eliminó de forma permanente la orden ${sol.numeroSolicitud} de ${sol.departamento}.`,
          usuarioResponsable: `${currentUser.nombre} (${currentUser.usuario})`,
          fecha: localDate,
          hora: localTime,
          timestamp: Date.now()
        };
        histList.unshift(histData);
        localStorage.setItem("offline_historial", JSON.stringify(histList));

        // Notify chat
        logSystemEvent(`🚨 **Orden Eliminada**: La orden **${sol.numeroSolicitud}** del departamento **${sol.departamento}** fue eliminada de forma permanente por el usuario Anyer.`);

        window.dispatchEvent(new Event("offline_solicitudes_update"));
        window.dispatchEvent(new Event("offline_historial_update"));

        if (selectedSolicitud?.id === sol.id) {
          setSelectedSolicitud(null);
        }

        playSound("positive");
        showToast(`La orden ${sol.numeroSolicitud} fue eliminada permanentemente.`);
        return;
      }

      // 1. Delete document
      await deleteDoc(doc(db, "solicitudes", sol.id));

      // 2. Register in global history
      const now = new Date();
      const localDate = now.toLocaleDateString("en-CA");
      const localTime = now.toLocaleTimeString("es-DO", { hour12: false }).slice(0, 5);

      const histCol = collection(db, "historial");
      const histData: Omit<RegistroHistorial, "id"> = {
        tipo: "Eliminación",
        solicitudId: sol.id,
        numeroSolicitud: sol.numeroSolicitud,
        descripcionEvent: `El usuario Anyer eliminó de forma permanente la orden ${sol.numeroSolicitud} de ${sol.departamento}.`,
        usuarioResponsable: `${currentUser.nombre} (${currentUser.usuario})`,
        fecha: localDate,
        hora: localTime,
        timestamp: Date.now()
      };
      await addDoc(histCol, histData);
      
      // Notify chat
      logSystemEvent(`🚨 **Orden Eliminada**: La orden **${sol.numeroSolicitud}** del departamento **${sol.departamento}** fue eliminada de forma permanente por el usuario Anyer.`);

      // 3. Clear selected if it was the deleted one
      if (selectedSolicitud?.id === sol.id) {
        setSelectedSolicitud(null);
      }

      playSound("positive");
      showToast(`La orden ${sol.numeroSolicitud} fue eliminada permanentemente.`);
    } catch (err) {
      console.error("Error deleting order:", err);
      alert("Error al intentar eliminar la orden.");
    }
  };

  const filteredList = solicitudes.filter((item) => {
    // 0. Catalog Filter
    const solCatalogId = item.catalogId || "default-cat";
    if (catalogFilterState !== "todos" && solCatalogId !== catalogFilterState) return false;
    if (catalogFilterState === "todos" && solCatalogId !== activeCatalogId) return false;

    // 1. Period Filter
    if (periodFilter !== "todos" && item.periodo !== periodFilter) return false;

    // 2. Department Filter
    if (deptFilter !== "todos" && item.departamento !== deptFilter) return false;

    // 3. Status Filter
    if (statusFilter !== "todos" && item.estado !== statusFilter) return false;

    // 4. Date Filter (Fecha)
    if (dateFilter && item.fecha !== dateFilter) return false;

    // 5. Order Number Filter (Número de orden)
    if (orderNumberFilter && !item.numeroSolicitud.toLowerCase().includes(orderNumberFilter.toLowerCase())) return false;

    // 6. Creator Filter (Usuario solicitante)
    if (creatorFilter && !item.usuarioCreador.toLowerCase().includes(creatorFilter.toLowerCase())) return false;

    // 7. Role & Department permissions: Almacén y Suministro see all, others only see their own department orders.
    const canSeeAll = currentUser.rol === "Administrador" || currentUser.departamento === "Almacén y Suministro" || currentUser.departamento === "Farmacia";
    if (!canSeeAll && item.departamento !== currentDepartment) {
      return false;
    }

    // 8. Search by number or creator name
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      return (
        item.numeroSolicitud.toLowerCase().includes(search) ||
        item.usuarioCreador.toLowerCase().includes(search) ||
        item.descripcion.toLowerCase().includes(search)
      );
    }

    return true;
  });

  const getPriorityBadgeClass = (priority: string) => {
    switch (priority) {
      case "Alta":
        return "bg-rose-50 text-rose-700 border border-rose-200";
      case "Media":
        return "bg-amber-50 text-amber-700 border border-amber-200";
      case "Baja":
        return "bg-slate-100 text-slate-700 border border-slate-200";
      default:
        return "bg-slate-100 text-slate-600";
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case "Pendiente":
        return "bg-amber-100 text-amber-800 border border-amber-200";
      case "En preparación":
        return "bg-blue-100 text-blue-800 border border-blue-200";
      case "Parcialmente entregada":
        return "bg-indigo-100 text-indigo-800 border border-indigo-200";
      case "Entregada":
        return "bg-emerald-100 text-emerald-800 border border-emerald-200";
      case "Cancelada":
        return "bg-rose-100 text-rose-800 border border-rose-200";
      default:
        return "bg-slate-100 text-slate-800 border border-slate-200";
    }
  };

  return (
    <div className="space-y-6">
      {/* Selector de periodo y controles principales */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-teal-600" />
              {currentUser.rol === "Administrador" ? "Gestión de Órdenes de Servicio" : "Mis Solicitudes de Departamento"}
            </h3>
            <p className="text-slate-500 text-xs mt-1">
              {currentUser.rol === "Administrador"
                ? "Consulta, monitorea y autoriza todas las solicitudes departamentales de insumos"
                : "Crea y supervisa las solicitudes de medicamentos y materiales para tu área"}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setActiveSubTab("list");
                playSound("click");
              }}
              className={`px-4 py-2 text-xs font-bold rounded-xl transition ${
                activeSubTab === "list" ? "bg-teal-800 text-white shadow-sm" : "bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200"
              }`}
            >
              {currentUser.rol === "Administrador" ? "Órdenes" : "Ver Solicitudes"}
            </button>
            <button
              onClick={() => {
                setActiveSubTab("create");
                playSound("click");
              }}
              className={`px-4 py-2 text-xs font-bold rounded-xl transition flex items-center gap-1.5 ${
                activeSubTab === "create" ? "bg-teal-800 text-white shadow-sm" : "bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200"
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              Nueva Solicitud
            </button>
            <button
              onClick={() => {
                setActiveSubTab("history");
                playSound("click");
              }}
              className={`px-4 py-2 text-xs font-bold rounded-xl transition flex items-center gap-1.5 ${
                activeSubTab === "history" ? "bg-teal-800 text-white shadow-sm" : "bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200"
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Historial de Eventos
            </button>
          </div>
        </div>

        {activeSubTab === "list" && (
          <div className="mt-6 border-t border-slate-100 pt-5 space-y-4">
            <div className="flex items-center gap-2 text-xs font-black text-slate-500 uppercase tracking-wider">
              <Filter className="w-4 h-4 text-teal-600" />
              <span>Filtros de Búsqueda Avanzada</span>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              {/* 1. N.º de Orden */}
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">N.º de Orden</label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Ej: ORD-001..."
                    value={orderNumberFilter}
                    onChange={(e) => setOrderNumberFilter(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8.5 pr-3 py-2 text-xs font-bold text-slate-700 outline-none focus:ring-1 focus:ring-teal-400 placeholder:text-slate-400"
                  />
                </div>
              </div>

              {/* 2. Catálogo */}
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">Catálogo</label>
                <select
                  value={catalogFilterState}
                  onChange={(e) => setCatalogFilterState(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 text-xs font-semibold text-slate-700 outline-none focus:ring-1 focus:ring-teal-400 animate-fade-in"
                >
                  <option value="todos">Todos los catálogos</option>
                  {getAvailableCatalogos().map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.nombre}</option>
                  ))}
                </select>
              </div>

              {/* 3. Departamento */}
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">Departamento</label>
                <select
                  value={deptFilter}
                  onChange={(e) => setDeptFilter(e.target.value)}
                  disabled={!isWarehouseOrAdmin}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 text-xs font-semibold text-slate-700 outline-none focus:ring-1 focus:ring-teal-400 disabled:opacity-60"
                >
                  {isWarehouseOrAdmin ? (
                    <>
                      <option value="todos">Todos los depts.</option>
                      {dynamicDepts.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </>
                  ) : (
                    <option value={currentUser.departamento}>{currentUser.departamento}</option>
                  )}
                </select>
              </div>

              {/* 4. Estado */}
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">Estado de Orden</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 text-xs font-semibold text-slate-700 outline-none focus:ring-1 focus:ring-teal-400"
                >
                  <option value="todos">Todos los estados</option>
                  <option value="Pendiente">Pendiente</option>
                  <option value="En preparación">En preparación</option>
                  <option value="Parcialmente entregada">Parcialmente entregada</option>
                  <option value="Entregada">Entregada</option>
                  <option value="Cancelada">Cancelada</option>
                </select>
              </div>

              {/* 5. Fecha de Orden */}
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">Fecha de Orden</label>
                <input
                  type="date"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-700 outline-none focus:ring-1 focus:ring-teal-400"
                />
              </div>

              {/* 6. Usuario Solicitante */}
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">Usuario Solicitante</label>
                <div className="relative">
                  <User className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Buscar creador..."
                    value={creatorFilter}
                    onChange={(e) => setCreatorFilter(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8.5 pr-3 py-2 text-xs font-bold text-slate-700 outline-none focus:ring-1 focus:ring-teal-400 placeholder:text-slate-400"
                  />
                </div>
              </div>

              {/* 7. Búsqueda General (Texto libre) */}
              <div className="sm:col-span-2">
                <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">Búsqueda General</label>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Buscar en descripción, justificación, responsable..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs font-bold text-slate-700 outline-none focus:ring-1 focus:ring-teal-400 placeholder:text-slate-400"
                  />
                </div>
              </div>
            </div>

            {/* Botón de limpiar filtros si hay alguno activo */}
            {(orderNumberFilter || dateFilter || creatorFilter || deptFilter !== "todos" || statusFilter !== "todos" || searchTerm || catalogFilterState !== "todos") && (
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setOrderNumberFilter("");
                    setDateFilter("");
                    setCreatorFilter("");
                    setDeptFilter("todos");
                    setStatusFilter("todos");
                    setSearchTerm("");
                    setCatalogFilterState("todos");
                    playSound("click");
                  }}
                  className="inline-flex items-center gap-1 text-[10px] font-black text-rose-600 hover:text-rose-700 uppercase tracking-wider cursor-pointer border border-rose-200/50 hover:bg-rose-50 px-2.5 py-1 rounded-lg transition"
                >
                  <X className="w-3.5 h-3.5" />
                  Limpiar Filtros
                </button>
              </div>
            )}

            {/* Período de registros */}
            <div className="sm:col-span-4 mt-2 border-t border-slate-100 pt-3 flex items-center justify-between flex-wrap gap-2 text-xs text-slate-500 font-bold uppercase tracking-wider">
              <span>Período de registros:</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPeriodFilter("todos")}
                  className={`rounded-full px-3 py-1.5 font-bold border ${
                    periodFilter === "todos" ? "bg-teal-50 border-teal-200 text-teal-800" : "bg-white border-slate-200"
                  }`}
                >
                  Ver Todo el Historial
                </button>
                {availablePeriods.map((per) => (
                  <button
                    key={per}
                    onClick={() => setPeriodFilter(per)}
                    className={`rounded-full px-3 py-1.5 font-bold border ${
                      periodFilter === per ? "bg-teal-50 border-teal-200 text-teal-800" : "bg-white border-slate-200"
                    }`}
                  >
                    {per}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Contenido de pestañas */}
      {loading ? (
        <div className="bg-white rounded-3xl p-12 text-center border border-slate-200 shadow-sm flex flex-col items-center justify-center">
          <LoaderCircle className="w-10 h-10 animate-spin text-teal-600 mb-3" />
          <p className="text-sm font-semibold text-slate-500">Cargando módulos de solicitudes...</p>
        </div>
      ) : activeSubTab === "list" ? (
        <div className="space-y-4">
          {filteredList.length === 0 ? (
            <div className="bg-white rounded-3xl p-12 text-center border border-slate-200 shadow-sm text-slate-400">
              <ClipboardList className="w-12 h-12 text-slate-300 mx-auto mb-3 animate-pulse" />
              <p className="font-bold text-slate-600">No se encontraron solicitudes u órdenes</p>
              <p className="text-xs text-slate-400 mt-1">Intente cambiar los filtros o el periodo mensual.</p>
            </div>
          ) : (
            filteredList.map((sol) => (
              <div key={sol.id} className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-black text-teal-800 bg-teal-50 border border-teal-200 px-3 py-1.5 rounded-2xl">
                      {sol.numeroSolicitud}
                    </span>
                    <span className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full ${getPriorityBadgeClass(sol.prioridad)}`}>
                      Prioridad {sol.prioridad}
                    </span>
                    <span className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full ${getStatusBadgeClass(sol.estado)}`}>
                      {sol.estado}
                    </span>
                  </div>
                  <div className="text-slate-400 text-xs font-semibold flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-300" />
                    <span>
                      {new Date(sol.fecha + "T00:00:00").toLocaleDateString("es-DO")} • {sol.hora}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="md:col-span-2 space-y-3">
                    <div>
                      <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Departamento que solicita</p>
                      <p className="text-slate-800 font-bold mt-0.5">{sol.departamento}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Descripción del Pedido</p>
                      <p className="text-slate-600 text-sm whitespace-pre-wrap mt-0.5">{sol.descripcion}</p>
                    </div>
                    {sol.observaciones && (
                      <div className="bg-slate-50 border border-slate-200/50 rounded-2xl p-3.5">
                        <p className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Observaciones / Respuestas</p>
                        <p className="text-xs text-slate-600 mt-1 italic">{sol.observaciones}</p>
                      </div>
                    )}
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col justify-between gap-4">
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-7 rounded-full bg-teal-600"></div>
                        <div>
                          <p className="text-[9px] font-black uppercase text-slate-400 leading-none">Creado por</p>
                          <p className="text-xs font-bold text-slate-800 mt-1">{sol.usuarioCreador}</p>
                        </div>
                      </div>
                      <div className="border-t border-slate-200/50 pt-2.5">
                        <p className="text-[9px] font-black uppercase text-slate-400">Período Mensual</p>
                        <p className="text-xs font-bold text-slate-700 mt-0.5">{sol.periodo}</p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <button
                        onClick={() => {
                          handleOpenStatusModal(sol);
                          playSound("click");
                        }}
                        className="w-full py-2 px-3 text-xs font-bold rounded-xl transition bg-slate-100 text-slate-600 hover:bg-slate-200 cursor-pointer text-center"
                      >
                        {currentUser.rol === "Administrador" || currentUser.departamento === "Almacén y Suministro" || currentUser.departamento === "Farmacia"
                          ? "Modificar Detalle / Lotes"
                          : "Ver Historial de Cambios"}
                      </button>

                      {/* Exportación rápida */}
                      <div className="grid grid-cols-2 gap-1.5 pt-1">
                        <button
                          type="button"
                          onClick={() => exportToWord(sol)}
                          className="bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 font-extrabold text-[10px] py-1.5 px-1.5 rounded-lg transition active:scale-95 cursor-pointer text-center flex items-center justify-center gap-1"
                        >
                          <FileText className="w-3.5 h-3.5 text-blue-600" />
                          Word (.doc)
                        </button>
                        <button
                          type="button"
                          onClick={() => exportToPDF(sol)}
                          className="bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 font-extrabold text-[10px] py-1.5 px-1.5 rounded-lg transition active:scale-95 cursor-pointer text-center flex items-center justify-center gap-1"
                        >
                          <FileText className="w-3.5 h-3.5 text-rose-600" />
                          PDF (.pdf)
                        </button>
                      </div>

                      {/* Botón Eliminar Orden (exclusivo Anyer) */}
                      {(currentUser.usuario.toLowerCase() === "anyer" || currentUser.nombre.toLowerCase() === "anyer") && (
                        <button
                          type="button"
                          onClick={() => handleDeleteRequest(sol)}
                          className="w-full mt-2 py-2 px-3 text-xs font-black text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition active:scale-95 cursor-pointer text-center flex items-center justify-center gap-1.5 shadow-xs"
                        >
                          <Trash2 className="w-4 h-4 text-rose-600" />
                          Eliminar Orden
                        </button>
                      )}

                      {/* Botones rápidos para Administrador, Farmacia y Almacén */}
                      {(currentUser.rol === "Administrador" || currentUser.departamento === "Almacén y Suministro" || currentUser.departamento === "Farmacia") && (
                        <div className="grid grid-cols-2 gap-1.5 pt-1.5 border-t border-slate-200/40">
                          {sol.estado === "Pendiente" && (
                            <>
                              <button
                                onClick={() => handleDirectStatusChange(sol, "Aprobada")}
                                className="bg-teal-700 hover:bg-teal-800 text-white font-black text-[10px] py-1.5 px-2 rounded-lg transition active:scale-95 cursor-pointer text-center"
                              >
                                Aprobar
                              </button>
                              <button
                                onClick={() => handleDirectStatusChange(sol, "Rechazada")}
                                className="bg-rose-600 hover:bg-rose-700 text-white font-black text-[10px] py-1.5 px-2 rounded-lg transition active:scale-95 cursor-pointer text-center"
                              >
                                Rechazar
                              </button>
                              <button
                                onClick={() => handleDirectStatusChange(sol, "En Proceso")}
                                className="col-span-2 bg-blue-600 hover:bg-blue-700 text-white font-black text-[10px] py-1.5 px-2 rounded-lg transition active:scale-95 cursor-pointer text-center"
                              >
                                En Proceso
                              </button>
                            </>
                          )}

                          {(sol.estado === "Aprobada" || sol.estado === "En Proceso") && (
                            <>
                              <button
                                onClick={() => handleDirectStatusChange(sol, "Entregada")}
                                className="col-span-2 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[10px] py-2 px-2 rounded-lg transition active:scale-95 cursor-pointer text-center flex items-center justify-center gap-1"
                              >
                                <RefreshCw className="w-3.5 h-3.5 animate-spin-slow" />
                                Entregar y Descontar
                              </button>
                              <button
                                onClick={() => handleDirectStatusChange(sol, "Rechazada")}
                                className="col-span-2 bg-rose-600 hover:bg-rose-700 text-white font-black text-[10px] py-1.5 px-2 rounded-lg transition active:scale-95 cursor-pointer text-center"
                              >
                                Rechazar
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      ) : activeSubTab === "create" ? (
        <form onSubmit={handleCreateRequest} className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-6 anim-card-in">
          <div className="border-b border-slate-100 pb-4">
            <h3 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
              <PlusCircle className="w-6 h-6 text-teal-600" />
              Registrar Nueva Solicitud Departamental
            </h3>
            <p className="text-slate-500 text-xs mt-1">
              Seleccione productos del catálogo digital o ingrese los insumos requeridos de forma manual.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* COLUMNA IZQUIERDA: DATOS DE LA SOLICITUD Y DRAFT */}
            <div className="lg:col-span-7 space-y-5">
              <h4 className="text-sm font-black uppercase text-slate-700 tracking-wider flex items-center gap-2">
                <span className="w-1.5 h-4 rounded-full bg-teal-600"></span>
                1. Información General de la Solicitud
              </h4>

              {/* Selector de Catálogo para Pedidos/Solicitudes */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <label className="block text-xs font-black uppercase text-slate-500 tracking-wider">
                    Catálogo de Trabajo *
                  </label>
                  <p className="text-[10px] text-slate-400">Seleccione el catálogo para solicitar insumos</p>
                </div>
                <select
                  value={solicitudCatalogId}
                  onChange={(e) => handleSetSolicitudCatalogId(e.target.value)}
                  className="w-full sm:max-w-xs rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-teal-400 cursor-pointer animate-pulse"
                >
                  <option value="">-- Seleccione un catálogo --</option>
                  {getAvailableCatalogos().map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black uppercase text-slate-500 tracking-wider mb-1.5">
                    Departamento Solicitante *
                  </label>
                  {(currentUser.rol === "Administrador" || currentUser.departamento === "Almacén y Suministro") ? (
                    <select
                      value={solicitudDept}
                      onChange={(e) => setSolicitudDept(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-400 font-bold text-teal-900 cursor-pointer"
                    >
                      {dynamicDepts.map((dept) => (
                        <option key={dept} value={dept}>
                          {dept}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="w-full bg-teal-50/70 border border-teal-200/80 rounded-xl px-4 py-2.5 text-sm font-extrabold text-teal-900 h-[44px] flex items-center shadow-inner">
                      {currentUser.departamento || "Laboratorio"}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-black uppercase text-slate-500 tracking-wider mb-1.5">
                    Prioridad de Entrega *
                  </label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-400 font-semibold text-slate-700"
                  >
                    <option value="Baja">Baja - Ordinario</option>
                    <option value="Media">Media - Normal</option>
                    <option value="Alta">Alta - Urgente</option>
                  </select>
                </div>
              </div>

              {/* DETALLES DE ITEMS AGREGADOS */}
              <div className="space-y-2">
                <label className="block text-xs font-black uppercase text-slate-500 tracking-wider">
                  Insumos Añadidos a la Solicitud ({solicitudItems.length})
                </label>
                {solicitudItems.length === 0 ? (
                  <div className="border border-dashed border-slate-200 rounded-2xl p-6 text-center text-slate-400 text-xs">
                    <Layers className="w-8 h-8 text-slate-300 mx-auto mb-2 animate-pulse" />
                    No has añadido ningún producto. Selecciona del catálogo de la derecha.
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-sm max-h-60 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-500 uppercase font-black text-[9px] sticky top-0 border-b border-slate-100">
                        <tr>
                          <th className="px-4 py-2.5">Código / Insumo</th>
                          <th className="px-4 py-2.5 text-center">Cant. Solicitada</th>
                          <th className="px-4 py-2.5 text-right">Acción</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {solicitudItems.map((item, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/50">
                            <td className="px-4 py-2.5 font-medium text-slate-800">
                              <span className="block text-teal-700 font-extrabold text-[9px] uppercase leading-none mb-0.5">{item.productoCodigo}</span>
                              {item.productoNombre}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <input
                                type="number"
                                min="1"
                                value={item.cantidadSolicitada}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value);
                                  if (!isNaN(val) && val > 0) {
                                    setSolicitudItems(prev => prev.map((it, i) => i === idx ? { ...it, cantidadSolicitada: val, cantidadEntregada: val } : it));
                                  }
                                }}
                                className="w-16 bg-slate-50 border border-slate-200 rounded-md text-center py-1 text-xs font-black text-slate-700"
                              />
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <button
                                type="button"
                                onClick={() => {
                                  setSolicitudItems(prev => prev.filter((_, i) => i !== idx));
                                  playSound("click");
                                }}
                                className="text-rose-500 hover:text-rose-700 font-bold text-[11px] hover:underline cursor-pointer"
                              >
                                Quitar
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-slate-500 tracking-wider mb-1.5">
                  Descripción textual / Justificación de la Solicitud
                </label>
                <textarea
                  required={solicitudItems.length === 0}
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Detalla los motivos, concentraciones específicas, o cualquier insumo que no encuentres en el catálogo..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-teal-400 text-slate-800 placeholder:text-slate-400 font-sans"
                ></textarea>
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-slate-500 tracking-wider mb-1.5">
                  Observaciones Internas (Opcional)
                </label>
                <input
                  type="text"
                  value={observations}
                  onChange={(e) => setObservations(e.target.value)}
                  placeholder="Escribe alguna acotación del pedido..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-teal-400 text-slate-800"
                />
              </div>

              <div className="pt-4 flex gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setActiveSubTab("list");
                    playSound("close");
                  }}
                  className="flex-1 rounded-xl border border-slate-200 text-slate-600 py-3 text-xs font-bold hover:bg-slate-50 transition cursor-pointer text-center"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 rounded-xl bg-teal-800 hover:bg-teal-700 text-white py-3 text-xs font-bold shadow-sm transition flex items-center justify-center gap-2 cursor-pointer text-center"
                >
                  {creating ? "Enviando..." : "Enviar Solicitud"}
                </button>
              </div>
            </div>

            {/* COLUMNA DERECHA: CATÁLOGO DIGITAL CON STOCK FÍSICO Y SISTEMA */}
            <div className="lg:col-span-5 bg-slate-50/50 rounded-2xl p-5 border border-slate-200/60 flex flex-col h-[650px]">
              <div className="mb-4 space-y-3 shrink-0">
                <h4 className="text-sm font-black uppercase text-slate-700 tracking-wider flex items-center gap-2">
                  <Layers className="w-5 h-5 text-teal-600" />
                  2. Catálogo Digital de Medicamentos
                </h4>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Buscar por nombre, código..."
                      value={itemSearch}
                      onChange={(e) => setItemSearch(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-4 py-2.5 text-xs outline-none focus:ring-2 focus:ring-teal-400"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setOnlyUnverified(prev => !prev);
                      playSound("click");
                    }}
                    className={`text-[11px] font-bold px-3 py-2 rounded-xl border transition flex items-center justify-center gap-1.5 cursor-pointer shrink-0 ${
                      onlyUnverified
                        ? "bg-amber-100 text-amber-800 border-amber-300 shadow-xs"
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${onlyUnverified ? "bg-amber-600 animate-pulse" : "bg-slate-300"}`}></span>
                    Sin verificar
                  </button>
                </div>
              </div>

              {/* Grid Scrollable de Productos */}
              <div className="flex-1 overflow-y-auto pr-1 space-y-2.5">
                {!solicitudCatalogId ? (
                  <div className="text-center py-12 px-4 bg-amber-50/40 border border-dashed border-amber-200 rounded-2xl">
                    <span className="text-2xl block mb-2">⚠️</span>
                    <span className="font-extrabold text-amber-800 uppercase tracking-wider text-[10px]">No se muestran productos</span>
                    <p className="text-slate-500 mt-1 font-medium text-xs leading-relaxed">Debe seleccionar un catálogo de trabajo a la izquierda primero.</p>
                  </div>
                ) : (() => {
                  const itemsToShow = products?.filter(p => {
                    const pCatalogId = p.catalogId || "default-cat";
                    if (pCatalogId !== solicitudCatalogId) return false;
                    if (onlyUnverified && p.verificado) return false;
                    if (!itemSearch.trim()) return true;
                    const term = itemSearch.toLowerCase();
                    return p.nombre.toLowerCase().includes(term) || p.codigo.toLowerCase().includes(term);
                  }) || [];

                  if (itemsToShow.length === 0) {
                    return (
                      <div className="text-center py-12 text-slate-400 text-xs font-semibold">
                        No se encontraron productos en este catálogo.
                      </div>
                    );
                  }

                  return itemsToShow.map(p => {
                    const totalSys = p.lotes?.reduce((acc, l) => acc + l.cantidad, 0) || 0;
                    const totalPhys = p.lotes?.reduce((acc, l) => acc + (l.cantidadF ?? 0), 0) || 0;
                    const inDraft = solicitudItems.some(it => it.productoCodigo === p.codigo);

                    return (
                      <div key={p.codigo} className="bg-white border border-slate-200 rounded-xl p-3.5 flex items-center justify-between gap-3 shadow-xs hover:border-teal-400 transition animate-fade-in">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[9px] font-black text-teal-800 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-200/50 uppercase leading-none">
                              {p.codigo}
                            </span>
                            <span className="text-[9px] text-slate-400 font-extrabold uppercase">
                              FARMACIA
                            </span>
                          </div>
                          <p className="text-xs font-bold text-slate-800 mt-1.5 truncate" title={p.nombre}>{p.nombre}</p>
                          {p.descripcion && (
                            <p className="text-[10px] text-slate-500 mt-1 italic line-clamp-2 border-t border-slate-100 pt-1" title={p.descripcion}>
                              {p.descripcion}
                            </p>
                          )}
                          
                          {/* Información de Stock Físico y de Sistema */}
                          <div className="flex gap-3 mt-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
                            <div>
                              Stock Sis: <span className="font-extrabold text-teal-700">{totalSys}</span>
                            </div>
                            <div className="border-l border-slate-200 pl-3">
                              Stock Fís: <span className="font-extrabold text-blue-700">{totalPhys}</span>
                            </div>
                          </div>
                        </div>

                        <div className="shrink-0 flex items-center gap-1.5">
                          <input
                            type="number"
                            min="1"
                            defaultValue="1"
                            id={`qty-catalog-${p.codigo}`}
                            className="w-12 bg-slate-50 border border-slate-200 rounded-lg text-center text-xs py-1.5 font-bold outline-none"
                          />
                          <button
                            type="button"
                            disabled={inDraft}
                            onClick={() => {
                              const qtyInput = document.getElementById(`qty-catalog-${p.codigo}`) as HTMLInputElement;
                              const qty = parseInt(qtyInput?.value || "1");
                              if (isNaN(qty) || qty <= 0) {
                                alert("Ingrese una cantidad válida mayor a cero.");
                                return;
                              }
                              setSolicitudItems(prev => [
                                ...prev,
                                {
                                  productoCodigo: p.codigo,
                                  productoNombre: p.nombre,
                                  cantidadSolicitada: qty,
                                  cantidadEntregada: qty
                                }
                              ]);
                              playSound("click");
                            }}
                            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition active:scale-95 cursor-pointer ${
                              inDraft
                                ? "bg-slate-100 text-slate-400 border border-slate-200"
                                : "bg-teal-800 hover:bg-teal-700 text-white shadow-xs"
                            }`}
                          >
                            {inDraft ? "Añadido" : "+ Añadir"}
                          </button>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        </form>
      ) : (
        activeSubTab === "history" && (() => {
          const filteredHistorial = historialList.filter((hist) => {
            const histCatalogId = hist.catalogId || "default-cat";
            if (histCatalogId !== activeCatalogId) return false;

            // Strict Role-Based and Department-Based Access Control for History events
            const canSeeAll = currentUser.rol === "Administrador" || currentUser.departamento === "Almacén y Suministro" || currentUser.departamento === "Farmacia";
            if (!canSeeAll) {
              const sol = solicitudes.find(s => s.id === hist.solicitudId || s.numeroSolicitud === hist.numeroSolicitud);
              if (sol) {
                if (sol.departamento !== currentDepartment) return false;
              } else {
                // Only allow history that clearly belongs to the user's department if no linked solicitud is available.
                if (!hist.descripcionEvent.toLowerCase().includes(currentDepartment.toLowerCase())) return false;
              }
            }

            if (histDeptFilter !== "todos") {
              const sol = solicitudes.find(s => s.id === hist.solicitudId || s.numeroSolicitud === hist.numeroSolicitud);
              if (sol) {
                if (sol.departamento !== histDeptFilter) return false;
              } else {
                if (!hist.descripcionEvent.toLowerCase().includes(histDeptFilter.toLowerCase())) return false;
              }
            }
            if (histDateFilter && hist.fecha !== histDateFilter) {
              return false;
            }
            if (histStatusFilter !== "todos") {
              const sol = solicitudes.find(s => s.id === hist.solicitudId || s.numeroSolicitud === hist.numeroSolicitud);
              if (sol) {
                if (sol.estado !== histStatusFilter) return false;
              } else {
                if (!hist.descripcionEvent.toLowerCase().includes(histStatusFilter.toLowerCase())) return false;
              }
            }
            if (histUserFilter) {
              const u = histUserFilter.toLowerCase();
              if (!hist.usuarioResponsable.toLowerCase().includes(u)) return false;
            }
            return true;
          });

          return (
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden anim-card-in">
              <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <ClipboardList className="w-5 h-5 text-teal-600" />
                    Historial de Eventos del Módulo Solicitudes
                  </h4>
                </div>

                {/* Panel de Filtros para el Historial */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-white p-4 rounded-2xl border border-slate-200/80">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">Departamento</label>
                    <select
                      value={histDeptFilter}
                      onChange={(e) => setHistDeptFilter(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 text-xs font-semibold text-slate-700 outline-none focus:ring-1 focus:ring-teal-400"
                    >
                      <option value="todos">Todos los depts.</option>
                      {dynamicDepts.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">Fecha</label>
                    <input
                      type="date"
                      value={histDateFilter}
                      onChange={(e) => setHistDateFilter(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-700 outline-none focus:ring-1 focus:ring-teal-400"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">Estado</label>
                    <select
                      value={histStatusFilter}
                      onChange={(e) => setHistStatusFilter(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 text-xs font-semibold text-slate-700 outline-none focus:ring-1 focus:ring-teal-400"
                    >
                      <option value="todos">Todos los estados</option>
                      <option value="Pendiente">Pendiente</option>
                      <option value="Aprobada">Aprobada</option>
                      <option value="Rechazada">Rechazada</option>
                      <option value="En Proceso">En Proceso</option>
                      <option value="Entregada">Entregada</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">Usuario</label>
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Buscar por usuario..."
                        value={histUserFilter}
                        onChange={(e) => setHistUserFilter(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-2 py-2 text-xs font-semibold text-slate-700 outline-none focus:ring-1 focus:ring-teal-400"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-6">
                {filteredHistorial.length === 0 ? (
                  <div className="text-center py-12 text-slate-400">
                    <AlertCircle className="w-8 h-8 mx-auto mb-2 text-slate-300 animate-bounce" />
                    <p className="text-xs font-semibold">No se encontraron eventos con los filtros seleccionados.</p>
                  </div>
                ) : (
                  <div className="flow-root">
                    <ul className="-mb-8">
                      {filteredHistorial.map((hist, histIdx) => (
                        <li key={hist.id}>
                          <div className="relative pb-8">
                            {histIdx !== filteredHistorial.length - 1 ? (
                              <span className="absolute top-4 left-4 -ml-px h-full w-0.5 bg-slate-200" aria-hidden="true" />
                            ) : null}
                            <div className="relative flex space-x-3">
                              <div>
                                <span className={`h-8 w-8 rounded-full flex items-center justify-center ring-8 ring-white ${
                                  hist.tipo === "Creación" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-blue-50 text-blue-700 border border-blue-200"
                                }`}>
                                  {hist.tipo === "Creación" ? <Plus className="w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}
                                </span>
                              </div>
                              <div className="flex-1 min-w-0 pt-1.5 flex justify-between space-x-4">
                                <div>
                                  <p className="text-sm font-semibold text-slate-800">
                                    {hist.descripcionEvent}{" "}
                                    <span className="font-black text-teal-800 bg-teal-50 px-2 py-0.5 rounded-md border border-teal-100 text-xs">
                                      {hist.numeroSolicitud}
                                    </span>
                                  </p>
                                  <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                                    <User className="w-3.5 h-3.5 text-slate-400" /> Responsable: <span className="font-semibold text-slate-700">{hist.usuarioResponsable}</span>
                                  </p>
                                </div>
                                <div className="text-right text-xs whitespace-nowrap text-slate-400 font-semibold flex flex-col sm:flex-row items-end sm:items-center gap-1">
                                  <Calendar className="w-3.5 h-3.5 text-slate-300" />
                                  <span>{new Date(hist.fecha + "T00:00:00").toLocaleDateString("es-DO")} • {hist.hora}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          );
        })()
      )}

      {/* Modal para Ver Historial de Cambios / Modificar Estado */}
      {selectedSolicitud && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-xs animate-fade-in" onClick={() => setSelectedSolicitud(null)}></div>
          <div className="relative bg-white rounded-3xl border border-slate-200 shadow-xl max-w-4xl w-full overflow-hidden anim-pop-in flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50 shrink-0">
              <h3 className="font-black text-slate-900 flex items-center gap-2 font-sans text-base">
                <Layers className="w-5 h-5 text-teal-600" />
                Detalle de Orden {selectedSolicitud.numeroSolicitud}
              </h3>
              <button
                onClick={() => setSelectedSolicitud(null)}
                className="rounded-xl border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Export Actions Bar */}
            <div className="px-6 py-3 bg-teal-50/50 border-b border-slate-200 flex flex-wrap gap-2 justify-end shrink-0">
              {/* Botón Eliminar Orden (exclusivo Anyer) */}
              {(currentUser.usuario.toLowerCase() === "anyer" || currentUser.nombre.toLowerCase() === "anyer") && (
                <button
                  type="button"
                  onClick={() => handleDeleteRequest(selectedSolicitud)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs shadow-xs transition active:scale-95 cursor-pointer border border-rose-750/10"
                >
                  <Trash2 className="w-4 h-4" />
                  Eliminar Orden
                </button>
              )}
              <button
                type="button"
                onClick={() => exportToWord(selectedSolicitud)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-extrabold text-xs shadow-xs transition active:scale-95 cursor-pointer border border-teal-800/10"
              >
                <FileText className="w-4 h-4" />
                Exportar a Word (.docx)
              </button>
              <button
                type="button"
                onClick={() => exportToPDF(selectedSolicitud)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-extrabold text-xs shadow-xs transition active:scale-95 cursor-pointer border border-slate-950/10"
              >
                <FileText className="w-4 h-4" />
                Exportar a PDF (.pdf)
              </button>
            </div>

            {/* Content (Scrollable) */}
            <div className="p-6 space-y-6 overflow-y-auto flex-1 text-slate-700 font-sans">
              {/* Info General en Grid Responsivo */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-200/80 text-xs sm:text-sm">
                <div>
                  <p className="text-[10px] font-black uppercase text-slate-400">Número de Orden</p>
                  <p className="font-extrabold text-teal-900">{selectedSolicitud.numeroSolicitud}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase text-slate-400">Estado Actual</p>
                  <span className={`inline-block text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full mt-1 ${getStatusBadgeClass(selectedSolicitud.estado)}`}>
                    {selectedSolicitud.estado}
                  </span>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase text-slate-400">Fecha y Hora de Solicitud</p>
                  <p className="font-bold text-slate-800">
                    {new Date(selectedSolicitud.fecha + "T00:00:00").toLocaleDateString("es-DO")} a las {selectedSolicitud.hora}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase text-slate-400">Departamento Solicitante</p>
                  <p className="font-bold text-slate-800">{selectedSolicitud.departamento}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase text-slate-400">Usuario Solicitante</p>
                  <p className="font-bold text-slate-800">{selectedSolicitud.usuarioCreador}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase text-slate-400">Período de Registro</p>
                  <p className="font-bold text-slate-800">{selectedSolicitud.periodo}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase text-slate-400">Catálogo de Suministros</p>
                  <p className="font-extrabold text-teal-800">
                    {catalogos?.find((c) => c.id === selectedSolicitud.catalogId)?.nombre || "General / Suministros"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase text-slate-400">Prioridad</p>
                  <span className={`inline-block text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full mt-1 ${getPriorityBadgeClass(selectedSolicitud.prioridad)}`}>
                    {selectedSolicitud.prioridad}
                  </span>
                </div>
                <div className="sm:col-span-2 border-t border-slate-200/60 pt-2 mt-2">
                  <p className="text-[10px] font-black uppercase text-slate-400">Descripción / Justificación</p>
                  <p className="text-slate-600 text-sm mt-1 whitespace-pre-wrap font-medium">{selectedSolicitud.descripcion}</p>
                </div>
                {selectedSolicitud.observaciones && (
                  <div className="sm:col-span-2 border-t border-slate-200/60 pt-2">
                    <p className="text-[10px] font-black uppercase text-slate-500">Observaciones Generales de Entrega</p>
                    <p className="text-xs text-slate-600 mt-1 italic font-medium">{selectedSolicitud.observaciones}</p>
                  </div>
                )}
              </div>

              {/* Confirmación de Entrega */}
              <div className="space-y-3">
                <h4 className="text-xs font-black uppercase text-teal-800 tracking-wider flex items-center gap-1.5 border-b border-teal-100 pb-1">
                  <Layers className="w-4 h-4" />
                  Confirmación de Entrega & Despacho
                </h4>

                <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs min-w-[700px]">
                      <thead className="bg-slate-50 text-slate-500 uppercase font-black text-[9px] border-b border-slate-200">
                        <tr>
                          <th className="px-4 py-3">Insumo / Medicamento</th>
                          <th className="px-3 py-3 text-center">Cant. Solicitada</th>
                          <th className="px-3 py-3 text-center w-28">Cant. Aprobada</th>
                          <th className="px-3 py-3 text-center w-28">Cant. Despachada</th>
                          <th className="px-3 py-3 text-center">Cant. Pendiente</th>
                          {isWarehouseOrAdmin && selectedSolicitud.estado !== "Entregada" && selectedSolicitud.estado !== "Cancelada" && (
                            <th className="px-3 py-3 w-40">Lote Despacho</th>
                          )}
                          <th className="px-4 py-3">Observación / Motivo Diferencia</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {deliveryItems.map((item) => {
                          const matchingProduct = products?.find(p => p.codigo === item.productoCodigo);
                          const availableLots = matchingProduct?.lotes || [];
                          const isEditable = isWarehouseOrAdmin && selectedSolicitud.estado !== "Entregada" && selectedSolicitud.estado !== "Cancelada";

                          const approvedVal = item.cantidadAprobada !== undefined ? item.cantidadAprobada : item.cantidadSolicitada;
                          const deliveredVal = item.cantidadEntregada !== undefined ? item.cantidadEntregada : item.cantidadSolicitada;
                          const pendingVal = Math.max(0, approvedVal - deliveredVal);

                          return (
                            <tr key={item.id} className="hover:bg-slate-50/50">
                              <td className="px-4 py-3 font-semibold text-slate-800">
                                {item.productoCodigo !== "Gral" && (
                                  <span className="block text-teal-700 font-bold text-[9px] uppercase leading-none mb-0.5">{item.productoCodigo}</span>
                                )}
                                {item.productoNombre}
                              </td>
                              <td className="px-3 py-3 text-center font-extrabold text-slate-700 text-sm">
                                {item.cantidadSolicitada}
                              </td>
                              <td className="px-3 py-3 text-center">
                                {isEditable ? (
                                  <input
                                    type="number"
                                    min="0"
                                    value={approvedVal}
                                    onChange={(e) => handleUpdateApprovedQty(item.id, Number(e.target.value))}
                                    className="w-20 text-center rounded-lg border border-slate-200 px-2 py-1.5 font-bold text-slate-800 bg-slate-50 focus:ring-1 focus:ring-teal-400"
                                  />
                                ) : (
                                  <span className="font-extrabold text-slate-700 text-sm">{approvedVal}</span>
                                )}
                              </td>
                              <td className="px-3 py-3 text-center">
                                {isEditable ? (
                                  <input
                                    type="number"
                                    min="0"
                                    value={deliveredVal}
                                    onChange={(e) => handleUpdateDeliveryQty(item.id, Number(e.target.value))}
                                    className="w-20 text-center rounded-lg border border-slate-200 px-2 py-1.5 font-bold text-slate-800 bg-slate-50 focus:ring-1 focus:ring-teal-400"
                                  />
                                ) : (
                                  <span className="font-extrabold text-slate-700 text-sm">{deliveredVal}</span>
                                )}
                              </td>
                              <td className="px-3 py-3 text-center">
                                <span className={`font-black text-sm px-2 py-1 rounded-md ${pendingVal > 0 ? "bg-amber-50 text-amber-800 border border-amber-250/30" : "bg-emerald-50 text-emerald-800"}`}>
                                  {pendingVal}
                                </span>
                              </td>
                              {isWarehouseOrAdmin && selectedSolicitud.estado !== "Entregada" && selectedSolicitud.estado !== "Cancelada" && (
                                <td className="px-3 py-3">
                                  {item.productoCodigo !== "Gral" && availableLots.length > 0 ? (
                                    <select
                                      value={item.loteId || ""}
                                      onChange={(e) => {
                                        const selectedLot = availableLots.find(l => l.id === e.target.value);
                                        handleUpdateDeliveryLot(item.id, e.target.value, selectedLot?.numeroLote || "");
                                      }}
                                      className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[10px] font-semibold text-slate-700 outline-none"
                                    >
                                      <option value="">-- Seleccione Lote --</option>
                                      {availableLots.map(l => {
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
                                            {prefix} Lote: {l.numeroLote} (Stock: {l.cantidad}){suffix}
                                          </option>
                                        );
                                      })}
                                    </select>
                                  ) : (
                                    <span className="text-[10px] text-slate-400 font-medium">No requiere lote</span>
                                  )}
                                </td>
                              )}
                              <td className="px-4 py-3">
                                {isEditable ? (
                                  <input
                                    type="text"
                                    value={item.motivoDiferencia || ""}
                                    onChange={(e) => handleUpdateDeliveryReason(item.id, e.target.value)}
                                    placeholder={deliveredVal !== item.cantidadSolicitada ? "Ej: Existencia insuficiente *" : "Sin diferencia..."}
                                    className={`w-full rounded-lg border px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-teal-400 ${
                                      deliveredVal !== item.cantidadSolicitada && !item.motivoDiferencia?.trim()
                                        ? "border-amber-300 bg-amber-50/20"
                                        : "border-slate-200 bg-slate-50"
                                    }`}
                                  />
                                ) : (
                                  <span className="text-xs text-slate-600 font-medium italic">
                                    {item.motivoDiferencia || (deliveredVal !== item.cantidadSolicitada ? "N/A" : "Sin diferencia")}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Sección Inferior de Detalle y Seguimiento */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 border-t border-slate-100">
                {/* Columna Izquierda: Línea de Tiempo de Cambios / Historial (Siempre visible) */}
                <div className="space-y-3 bg-slate-50 p-4 rounded-2xl border border-slate-200/80">
                  <h4 className="text-xs font-black uppercase text-slate-500 tracking-wider flex items-center gap-1.5 mb-3">
                    <Clock className="w-4 h-4 text-slate-400" />
                    Línea de Tiempo de Cambios / Historial
                  </h4>
                  <div className="flow-root max-h-[220px] overflow-y-auto pr-1">
                    <ul className="-mb-8">
                      {selectedSolicitud.historialCambios.map((cambio, cIdx) => (
                        <li key={cIdx}>
                          <div className="relative pb-8">
                            {cIdx !== selectedSolicitud.historialCambios.length - 1 ? (
                              <span className="absolute top-4 left-4 -ml-px h-full w-0.5 bg-slate-200" aria-hidden="true" />
                            ) : null}
                            <div className="relative flex space-x-3">
                              <div>
                                <span className={`h-8 w-8 rounded-full flex items-center justify-center ring-8 ring-white text-xs font-bold text-white shadow-sm ${
                                  getStatusBadgeClass(cambio.estado)
                                }`}>
                                  {cambio.estado.charAt(0)}
                                </span>
                              </div>
                              <div className="flex-1 min-w-0 pt-1.5 flex justify-between space-x-4">
                                <div>
                                  <p className="text-xs font-semibold text-slate-800">
                                    El estado cambió a <span className="font-black text-teal-800">{cambio.estado}</span>
                                  </p>
                                  <p className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1">
                                    <User className="w-3.5 h-3.5 text-slate-400" /> Modificado por: <span className="font-semibold text-slate-700">{cambio.usuarioResponsable}</span>
                                  </p>
                                </div>
                                <div className="text-right text-[10px] whitespace-nowrap text-slate-400 font-bold flex items-center gap-1">
                                  <Calendar className="w-3.5 h-3.5 text-slate-300" />
                                  <span>
                                    {new Date(cambio.fecha + "T00:00:00").toLocaleDateString("es-DO")} • {cambio.hora}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Columna Derecha: Formulario de Modificación de Estado u Hoja de Resumen de Estado */}
                {isWarehouseOrAdmin && selectedSolicitud.estado !== "Entregada" && selectedSolicitud.estado !== "Cancelada" ? (
                  <form onSubmit={handleUpdateStatusSubmit} className="bg-teal-50/20 border border-teal-100 rounded-2xl p-4 space-y-4 flex flex-col justify-between">
                    <div>
                      <h4 className="text-xs font-black uppercase text-teal-800 tracking-wider mb-3">Modificar Estado de la Orden</h4>
                      
                      <div className="space-y-3">
                        <div>
                          <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider mb-1">Nuevo Estado de Orden</label>
                          <select
                            value={newStatus}
                            onChange={(e) => setNewState(e.target.value as any)}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:ring-1 focus:ring-teal-400"
                          >
                            <option value="Pendiente">Pendiente</option>
                            <option value="En preparación">En preparación</option>
                            <option value="Parcialmente entregada">Parcialmente entregada</option>
                            <option value="Entregada">Entregada</option>
                            <option value="Cancelada">Cancelada</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider mb-1">Anotaciones Generales / Observaciones</label>
                          <input
                            type="text"
                            value={statusObs}
                            onChange={(e) => setStatusObs(e.target.value)}
                            placeholder="Comentario sobre el despacho o entrega..."
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-teal-400 text-slate-800"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2.5 pt-3 mt-auto">
                      <button
                        type="button"
                        onClick={() => setSelectedSolicitud(null)}
                        className="flex-1 rounded-xl border border-slate-200 bg-white text-slate-600 py-2 text-xs font-bold hover:bg-slate-100 transition cursor-pointer active:scale-95"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={updating}
                        className="flex-1 rounded-xl bg-teal-600 hover:bg-teal-700 text-white py-2 text-xs font-bold shadow-sm transition active:scale-95 cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        {updating && <LoaderCircle className="w-3.5 h-3.5 animate-spin" />}
                        {updating ? "Guardando..." : "Confirmar y Despachar"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col justify-between">
                    <div>
                      <h4 className="text-xs font-black uppercase text-slate-600 tracking-wider mb-2">Información del Despacho</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Esta orden se encuentra en estado <span className="font-extrabold text-teal-800">{selectedSolicitud.estado}</span>.
                        {selectedSolicitud.observaciones ? (
                          <>
                            {" "}Las anotaciones registradas son: <span className="italic">"{selectedSolicitud.observaciones}"</span>.
                          </>
                        ) : (
                          " No se han registrado anotaciones generales adicionales."
                        )}
                      </p>
                      <div className="mt-4 p-3 bg-white border border-slate-200 rounded-xl flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-teal-600 shrink-0" />
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                          {selectedSolicitud.estado === "Entregada" ? "✓ Entrega Completada con éxito" : "ℹ Solo lectura para esta etapa"}
                        </span>
                      </div>
                    </div>
                    <div className="flex justify-end pt-3 mt-auto">
                      <button
                        type="button"
                        onClick={() => setSelectedSolicitud(null)}
                        className="w-full sm:w-auto rounded-xl bg-slate-800 hover:bg-slate-900 text-white px-6 py-2 text-xs font-bold shadow-xs transition cursor-pointer active:scale-95"
                      >
                        Cerrar Detalle
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export { DEPARTAMENTOS };
