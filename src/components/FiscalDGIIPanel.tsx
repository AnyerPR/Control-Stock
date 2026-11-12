import React, { useState, useEffect, useMemo, useRef } from "react";
import { getDoc, setDoc } from "firebase/firestore";
import { tenantCollection, tenantDoc } from "../firebase";
import { getDocs } from "firebase/firestore";
import {
  AmbienteDGII,
  ConfiguracionFiscalDGII,
  EventoAuditoriaFiscal,
  FacturaVenta,
  FormaPagoDGII,
  InstitucionInfo,
  Movimiento,
  RegimenTributarioDGII,
  RegistroAnulacion608,
  RegistroCompra606,
  SecuenciaFiscalDGII,
  TipoComprobanteDGII,
  Usuario
} from "../types";
import {
  CATALOGO_TIPOS_COMPROBANTE,
  FORMAS_PAGO_DGII,
  MOTIVOS_ANULACION_608,
  TIPOS_BIENES_SERVICIOS_606,
  TIPOS_RETENCION_ISR_606,
  appendAuditoriaFiscal,
  cleanRncCedula,
  downloadTextFile,
  export606Excel,
  export607Excel,
  export608Excel,
  formatNCFSequence,
  generate606Txt,
  generate607Txt,
  generate608Txt,
  getDefaultConfiguracionDGII,
  loadAnulaciones608,
  loadAuditoriaFiscal,
  loadCompras606,
  loadConfiguracionDGII,
  saveCompras606List,
  saveConfiguracionDGII,
  signAndProcessECF,
  validateECFXmlAgainstXSD,
  validateNCFFormat,
  validateRncOrCedulaDGII
} from "../utils/dgiiUtils";
import { exportSaleInvoiceToPDF, getActiveInstitucionInfo } from "../utils/exportUtils";
import { playSound } from "../utils/audio";
import {
  ShieldCheck,
  Building2,
  FileSpreadsheet,
  FileCode2,
  FileDown,
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  RefreshCw,
  Plus,
  Trash2,
  Search,
  Lock,
  Send,
  Eye,
  X,
  Calendar,
  Hash,
  Upload,
  Server,
  History,
  Layers,
  Ban,
  Check,
  Package
} from "lucide-react";

interface FiscalDGIIPanelProps {
  currentUser: Usuario;
  showToast: (message: string) => void;
  institucion?: InstitucionInfo;
  onNavigateTab?: (tabId: string) => void;
}

type FiscalTab =
  | "dashboard"
  | "configuracion"
  | "secuencias"
  | "ecf_monitor"
  | "reporte_606"
  | "reporte_607"
  | "reporte_608"
  | "auditoria";

export default function FiscalDGIIPanel({
  currentUser,
  showToast,
  institucion,
  onNavigateTab
}: FiscalDGIIPanelProps) {
  const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";
  const isAdmin = currentUser?.rol === "Administrador";
  const currentInst = useMemo(() => institucion || getActiveInstitucionInfo(), [institucion]);

  const [activeSubTab, setActiveSubTab] = useState<FiscalTab>("dashboard");
  const [periodoFiscal, setPeriodoFiscal] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  // Core Fiscal Data State
  const [config, setConfig] = useState<ConfiguracionFiscalDGII>(() =>
    getDefaultConfiguracionDGII(currentInst)
  );
  const [facturasVentas, setFacturasVentas] = useState<FacturaVenta[]>([]);
  const [compras606, setCompras606] = useState<RegistroCompra606[]>([]);
  const [anulaciones608, setAnulaciones608] = useState<RegistroAnulacion608[]>([]);
  const [auditoriaEventos, setAuditoriaEventos] = useState<EventoAuditoriaFiscal[]>([]);
  const [movimientosEntrada, setMovimientosEntrada] = useState<Movimiento[]>([]);
  const [savingConfig, setSavingConfig] = useState<boolean>(false);

  // Digital Certificate (.p12 / .pfx) upload state
  const certFileInputRef = useRef<HTMLInputElement>(null);
  const [certPassword, setCertPassword] = useState<string>("");
  const [uploadingCert, setUploadingCert] = useState<boolean>(false);
  const [serverCertStatus, setServerCertStatus] = useState<boolean>(false);

  // e-CF Monitor & XML Inspector state
  const [selectedEcfXmlModal, setSelectedEcfXmlModal] = useState<FacturaVenta | null>(null);
  const [processingEcfId, setProcessingEcfId] = useState<string | null>(null);
  const [trackIdQueryInput, setTrackIdQueryInput] = useState<string>("");
  const [consultingTrackId, setConsultingTrackId] = useState<boolean>(false);

  // New 606 Purchase / Expense Form state
  const [rncProveedor606, setRncProveedor606] = useState<string>("");
  const [nombreProveedor606, setNombreProveedor606] = useState<string>("");
  const [tipoBienServicio606, setTipoBienServicio606] = useState<string>("09");
  const [ncfCompra606, setNcfCompra606] = useState<string>("");
  const [ncfModificado606, setNcfModificado606] = useState<string>("");
  const [fechaComprobante606, setFechaComprobante606] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [fechaPago606, setFechaPago606] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [montoServicios606, setMontoServicios606] = useState<string>("0");
  const [montoBienes606, setMontoBienes606] = useState<string>("");
  const [itbisFacturado606, setItbisFacturado606] = useState<string>("0");
  const [itbisRetenido606, setItbisRetenido606] = useState<string>("0");
  const [itbisAlCosto606, setItbisAlCosto606] = useState<string>("0");
  const [tipoRetencionIsr606, setTipoRetencionIsr606] = useState<string>("");
  const [montoRetencionIsr606, setMontoRetencionIsr606] = useState<string>("0");
  const [formaPago606, setFormaPago606] = useState<FormaPagoDGII>("01");
  const [facturaInternaRef606, setFacturaInternaRef606] = useState<string>("");

  // Filters
  const [searchTerm, setSearchTerm] = useState<string>("");

  // Load all fiscal datasets
  const refreshAllFiscalData = async () => {
    const farmaciaId = currentUser?.farmaciaId;
    const [cfg, list606, list608, listAud] = await Promise.all([
      loadConfiguracionDGII(farmaciaId, currentInst),
      loadCompras606(farmaciaId),
      loadAnulaciones608(farmaciaId),
      loadAuditoriaFiscal(farmaciaId)
    ]);
    setConfig(cfg);
    setCompras606(list606);
    setAnulaciones608(list608);
    setAuditoriaEventos(listAud);

    // Load sales invoices (for 607 & e-CF Monitor)
    if (isLocalFileMode) {
      const savedSales = localStorage.getItem("offline_facturas_venta");
      if (savedSales) {
        try {
          setFacturasVentas(JSON.parse(savedSales));
        } catch {}
      }
      const savedMovs = localStorage.getItem("offline_movimientos");
      if (savedMovs) {
        try {
          const allMovs = JSON.parse(savedMovs) as Movimiento[];
          setMovimientosEntrada(allMovs.filter((m) => m.tipoMovimiento === "Entrada"));
        } catch {}
      }
    } else {
      try {
        const snap = await getDoc(tenantDoc("configuracion", "registro_ventas", farmaciaId));
        if (snap.exists() && Array.isArray(snap.data()?.facturas)) {
          setFacturasVentas(snap.data().facturas as FacturaVenta[]);
        }
      } catch {}

      try {
        const movSnap = await getDocs(tenantCollection("movimientos", farmaciaId));
        const entradas: Movimiento[] = [];
        movSnap.forEach((d) => {
          const m = d.data() as Movimiento;
          if (m.tipoMovimiento === "Entrada") entradas.push(m);
        });
        entradas.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        setMovimientosEntrada(entradas.slice(0, 150));
      } catch {}

      // Check Express server status for digital certificate (.p12)
      try {
        const resp = await fetch(
          `/api/dgii/status?tenant=${encodeURIComponent(farmaciaId || "principal")}`
        );
        if (resp.ok) {
          const st = await resp.json();
          setServerCertStatus(Boolean(st.certificadoCargado));
          if (st.certificadoCargado && st.certificadoInfo) {
            setConfig((prev) => ({
              ...prev,
              certificadoInfo: st.certificadoInfo
            }));
          }
        }
      } catch {}
    }
  };

  useEffect(() => {
    refreshAllFiscalData();
  }, [currentUser?.farmaciaId]);

  // Facturas de entrada de inventario agrupadas que aún no están en 606
  const facturasInventarioPendientes606 = useMemo(() => {
    const grouped = new Map<
      string,
      {
        numeroFactura: string;
        fecha: string;
        proveedor: string;
        rncProveedor?: string;
        ncfCompra?: string;
        montoTotalBienes: number;
        movimientoIds: string[];
      }
    >();

    for (const mov of movimientosEntrada) {
      const numFac = (mov.numeroFactura || "").trim();
      if (!numFac) continue;
      // Ignorar devoluciones internas de Notas de Crédito
      if (mov.proveedor?.includes("Nota de Crédito")) continue;

      const existing = grouped.get(numFac);
      const lineTotal = Number(mov.cantidad || 0) * Number(mov.precio || 0);
      if (existing) {
        existing.montoTotalBienes += lineTotal;
        existing.movimientoIds.push(mov.id);
      } else {
        grouped.set(numFac, {
          numeroFactura: numFac,
          fecha: mov.fechaEntrada || (mov.fecha ? mov.fecha.slice(0, 10) : new Date().toISOString().slice(0, 10)),
          proveedor: mov.proveedor || "Suplidor de Inventario",
          rncProveedor: mov.rncProveedor,
          ncfCompra: mov.ncfCompra,
          montoTotalBienes: lineTotal,
          movimientoIds: [mov.id]
        });
      }
    }

    return Array.from(grouped.values()).filter(
      (g) => !compras606.some((c) => c.numeroFacturaInterna === g.numeroFactura && !c.anulado)
    );
  }, [movimientosEntrada, compras606]);

  // Cálculos del Dashboard Fiscal por Período (AAAAMM)
  const ventasPeriodo607 = useMemo(() => {
    return facturasVentas.filter((f) => {
      if (f.anulada || f.estadoFiscal === "ANULADO") return false;
      const fMes = (f.fecha || "").replace(/-/g, "").slice(0, 6);
      return fMes === periodoFiscal;
    });
  }, [facturasVentas, periodoFiscal]);

  const comprasPeriodo606 = useMemo(() => {
    return compras606.filter((c) => !c.anulado && c.periodoMes === periodoFiscal);
  }, [compras606, periodoFiscal]);

  const anulacionesPeriodo608 = useMemo(() => {
    return anulaciones608.filter((a) => a.periodoMes === periodoFiscal);
  }, [anulaciones608, periodoFiscal]);

  const metricasFiscales = useMemo(() => {
    const totalVentasSinItbis = ventasPeriodo607.reduce(
      (acc, f) =>
        acc +
        Number(
          f.subtotalMonto !== undefined ? f.subtotalMonto : f.totalMonto - (f.itbisMonto || 0)
        ),
      0
    );
    const itbisCobrado607 = ventasPeriodo607.reduce((acc, f) => acc + Number(f.itbisMonto || 0), 0);
    const totalFacturadoVentas = ventasPeriodo607.reduce(
      (acc, f) => acc + Number(f.totalMonto || 0),
      0
    );

    const totalCompras606 = comprasPeriodo606.reduce(
      (acc, c) => acc + Number(c.totalMontoFacturado || 0),
      0
    );
    const itbisAdelantado606 = comprasPeriodo606.reduce(
      (acc, c) => acc + Number(c.itbisPorAdelantar || 0),
      0
    );
    const itbisRetenido606 = comprasPeriodo606.reduce(
      (acc, c) => acc + Number(c.itbisRetenido || 0),
      0
    );
    const isrRetenido606 = comprasPeriodo606.reduce(
      (acc, c) => acc + Number(c.montoRetencionRenta || 0),
      0
    );

    const balanceItbisPagar = itbisCobrado607 - itbisAdelantado606;

    const ecfEmitidos = ventasPeriodo607.filter((f) => f.ncf?.startsWith("E"));
    const ncfSerieBEmitidos = ventasPeriodo607.filter((f) => f.ncf?.startsWith("B"));
    const ecfAceptados = ecfEmitidos.filter(
      (f) => f.estadoFiscal === "ACEPTADO_DGII" || f.estadoFiscal === "ACEPTADO_CONDICIONAL_DGII"
    ).length;
    const ecfRechazados = ecfEmitidos.filter((f) => f.estadoFiscal === "RECHAZADO_DGII").length;
    const ecfPendientesEnvio = ecfEmitidos.filter(
      (f) =>
        f.estadoFiscal === "GENERADO_LOCAL" ||
        f.estadoFiscal === "FIRMADO_XML" ||
        f.estadoFiscal === "EN_PROCESO_DGII"
    ).length;

    return {
      totalVentasSinItbis,
      itbisCobrado607,
      totalFacturadoVentas,
      totalCompras606,
      itbisAdelantado606,
      itbisRetenido606,
      isrRetenido606,
      balanceItbisPagar,
      totalEcf: ecfEmitidos.length,
      totalNcfB: ncfSerieBEmitidos.length,
      ecfAceptados,
      ecfRechazados,
      ecfPendientesEnvio,
      totalAnulados608: anulacionesPeriodo608.length
    };
  }, [ventasPeriodo607, comprasPeriodo606, anulacionesPeriodo608]);

  // Alertas de Consistencia Tributaria
  const alertasFiscales = useMemo(() => {
    const list: Array<{ nivel: "alta" | "media"; mensaje: string }> = [];
    const rncCheck = validateRncOrCedulaDGII(config.rncEmisor);
    if (!rncCheck.valid) {
      list.push({
        nivel: "alta",
        mensaje:
          "El RNC del Contribuyente Emisor aún no está configurado con 9 u 11 dígitos válidos en la pestaña «Configuración Fiscal»."
      });
    }
    if (!config.certificadoInfo?.configurado && !serverCertStatus) {
      list.push({
        nivel: "media",
        mensaje:
          "Certificado Digital (.p12 / .pfx) pendiente de carga en el servidor Express. Los e-CF se generan localmente con estructura XML oficial listos para firma."
      });
    }
    const todayStr = new Date().toISOString().slice(0, 10);
    for (const seq of config.secuencias) {
      if (!seq.activa) continue;
      const disp = seq.secuenciaFinal - seq.secuenciaActual + 1;
      if (disp <= seq.alertaMinima) {
        list.push({
          nivel: "alta",
          mensaje: `Secuencia ${seq.tipo} próxima a agotarse: quedan ${Math.max(0, disp)} números disponibles.`
        });
      }
      if (seq.fechaVencimiento && seq.fechaVencimiento < todayStr) {
        list.push({
          nivel: "alta",
          mensaje: `La secuencia ${seq.tipo} venció el ${seq.fechaVencimiento}. Renueve la autorización en la OFV DGII.`
        });
      }
    }
    if (facturasInventarioPendientes606.length > 0) {
      list.push({
        nivel: "media",
        mensaje: `Existen ${facturasInventarioPendientes606.length} factura(s) de Entrada de Inventario pendientes de vincular al Formato 606 de Compras.`
      });
    }
    return list;
  }, [config, serverCertStatus, facturasInventarioPendientes606]);

  // Guardar Configuración Fiscal DGII (Exclusivo ADMIN)
  const handleSaveConfigDGII = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) {
      alert("Solo un usuario con perfil Administrador (ADMIN) puede modificar la Configuración Fiscal DGII.");
      return;
    }
    const rncCheck = validateRncOrCedulaDGII(config.rncEmisor);
    if (!rncCheck.valid) {
      alert(`RNC Emisor inválido: ${rncCheck.message}`);
      return;
    }

    setSavingConfig(true);
    playSound("action");
    try {
      const nextCfg: ConfiguracionFiscalDGII = {
        ...config,
        rncEmisor: rncCheck.clean,
        updatedAt: Date.now(),
        updatedBy: `${currentUser.nombre} (${currentUser.usuario})`
      };
      await saveConfiguracionDGII(nextCfg, currentUser?.farmaciaId);
      setConfig(nextCfg);

      await appendAuditoriaFiscal(
        {
          tipoAccion: "CONFIGURACION_FISCAL",
          descripcion: `Actualización de Configuración Fiscal DGII (RNC: ${rncCheck.clean} • Ambiente: ${nextCfg.ambienteDGII} • Régimen: ${nextCfg.regimenTributario})`,
          usuario: `${currentUser.nombre} (${currentUser.usuario})`,
          rolUsuario: currentUser.rol,
          ambienteDGII: nextCfg.ambienteDGII,
          resultado: "EXITO"
        },
        currentUser?.farmaciaId
      );

      playSound("positive");
      showToast("Configuración Fiscal DGII guardada y aplicada exitosamente.");
    } catch (err) {
      console.error("Error guardando configuración DGII:", err);
      alert("Ocurrió un error al guardar la Configuración Fiscal.");
    } finally {
      setSavingConfig(false);
    }
  };

  // Cargar Certificado Digital (.p12 / .pfx / .pem) al Servidor Express Seguro
  const handleUploadCertificate = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isAdmin) {
      alert("Solo el Administrador puede cargar certificados digitales de firma.");
      return;
    }

    setUploadingCert(true);
    playSound("action");
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const resultStr = String(reader.result || "");
        const base64Data = resultStr.includes(",") ? resultStr.split(",")[1] : resultStr;

        const resp = await fetch("/api/dgii/certificate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenant: currentUser?.farmaciaId || "principal",
            base64Data,
            password: certPassword,
            fileName: file.name
          })
        });

        const data = await resp.json();
        if (!resp.ok || !data.ok) {
          alert(data.error || "No se pudo verificar el certificado digital (.p12 / .pfx).");
          setUploadingCert(false);
          return;
        }

        const nextCfg: ConfiguracionFiscalDGII = {
          ...config,
          certificadoInfo: data.certificadoInfo,
          updatedAt: Date.now()
        };
        setConfig(nextCfg);
        setServerCertStatus(true);
        setCertPassword("");
        await saveConfiguracionDGII(nextCfg, currentUser?.farmaciaId);

        await appendAuditoriaFiscal(
          {
            tipoAccion: "CARGA_CERTIFICADO_P12",
            descripcion: `Certificado digital "${file.name}" verificado y cargado en almacén seguro del servidor (Titular: ${data.certificadoInfo.titularSubject})`,
            usuario: `${currentUser.nombre} (${currentUser.usuario})`,
            rolUsuario: currentUser.rol,
            ambienteDGII: config.ambienteDGII,
            resultado: "EXITO"
          },
          currentUser?.farmaciaId
        );

        playSound("positive");
        showToast("Certificado digital (.p12/.pfx) verificado y activo para firma XMLDSig.");
        setUploadingCert(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error("Error subiendo certificado:", err);
      alert("Error al enviar el certificado al servidor.");
      setUploadingCert(false);
    }
  };

  // Actualizar Secuencia NCF / e-CF
  const handleUpdateSecuencia = async (
    seqId: string,
    field: keyof SecuenciaFiscalDGII,
    value: any
  ) => {
    if (!isAdmin) return;
    const nextSecuencias = config.secuencias.map((s) =>
      s.id === seqId ? { ...s, [field]: value, updatedAt: Date.now() } : s
    );
    const nextCfg = { ...config, secuencias: nextSecuencias, updatedAt: Date.now() };
    setConfig(nextCfg);
  };

  const handleSaveAllSecuencias = async () => {
    if (!isAdmin) {
      alert("Solo el Administrador puede modificar las secuencias autorizadas de NCF y e-CF.");
      return;
    }
    playSound("action");
    await saveConfiguracionDGII(config, currentUser?.farmaciaId);
    await appendAuditoriaFiscal(
      {
        tipoAccion: "SECUENCIA_NCF_ECF",
        descripcion: "Actualización de rangos y fechas de vencimiento de secuencias NCF Serie B y e-CF Serie E",
        usuario: `${currentUser.nombre} (${currentUser.usuario})`,
        rolUsuario: currentUser.rol,
        ambienteDGII: config.ambienteDGII,
        resultado: "EXITO"
      },
      currentUser?.farmaciaId
    );
    playSound("positive");
    showToast("Secuencias fiscales NCF y e-CF actualizadas correctamente.");
  };

  // Re-firmar y transmitir un e-CF existente al Web Service de la DGII
  const handleSignAndSendExistingECF = async (fac: FacturaVenta, sendToWS: boolean) => {
    setProcessingEcfId(fac.id);
    playSound("action");
    try {
      const res = await signAndProcessECF(fac, config, sendToWS);
      const updatedList = facturasVentas.map((f) =>
        f.id === fac.id
          ? {
              ...f,
              xmlGenerado: res.xmlGenerado,
              xmlFirmado: res.xmlFirmado,
              codigoSeguridadECF: res.codigoSeguridad,
              fechaHoraFirmaECF: res.fechaHoraFirma,
              urlQrDGII: res.urlQrDGII,
              trackIdDGII: res.trackId || f.trackIdDGII,
              estadoFiscal: res.estadoFiscal,
              respuestaDGII: res.respuestaDGII,
              erroresValidacionXSD: res.erroresValidacionXSD
            }
          : f
      );

      setFacturasVentas(updatedList);
      if (isLocalFileMode) {
        localStorage.setItem("offline_facturas_venta", JSON.stringify(updatedList));
      } else {
        await setDoc(
          tenantDoc("configuracion", "registro_ventas", currentUser?.farmaciaId),
          { facturas: updatedList, updatedAt: Date.now() },
          { merge: true }
        );
      }

      await appendAuditoriaFiscal(
        {
          tipoAccion: sendToWS ? "ENVIO_WS_DGII" : "FIRMA_XML_ECF",
          comprobanteNcf: fac.ncf,
          tipoComprobante: fac.tipoComprobante,
          documentoReferenciaId: fac.id,
          descripcion: `${sendToWS ? "Transmisión WS DGII" : "Generación/Firma XML"} de ${
            fac.ncf
          } -> Estado: ${res.estadoFiscal}${res.trackId ? ` (TrackId: ${res.trackId})` : ""}`,
          usuario: `${currentUser.nombre} (${currentUser.usuario})`,
          rolUsuario: currentUser.rol,
          ambienteDGII: config.ambienteDGII,
          resultado: res.erroresValidacionXSD.length === 0 ? "EXITO" : "ADVERTENCIA",
          detalleTecnico: res.respuestaDGII
        },
        currentUser?.farmaciaId
      );

      playSound("positive");
      showToast(
        `Comprobante ${fac.ncf} procesado (${res.estadoFiscal}). Código de seguridad: ${res.codigoSeguridad}`
      );
    } catch (err) {
      console.error("Error procesando e-CF:", err);
      alert("Error al procesar el comprobante electrónico.");
    } finally {
      setProcessingEcfId(null);
    }
  };

  // Consultar TrackId en DGII
  const handleConsultarTrackIdDGII = async (targetTrackId?: string, facturaRef?: FacturaVenta) => {
    const tid = (targetTrackId || trackIdQueryInput).trim();
    if (!tid) {
      alert("Ingrese el número de TrackId devuelto por la DGII para consultar su estado.");
      return;
    }

    setConsultingTrackId(true);
    playSound("action");
    try {
      const resp = await fetch("/api/dgii/consulta-trackid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant: currentUser?.farmaciaId || "principal",
          trackId: tid,
          ambiente: config.ambienteDGII
        })
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        alert(data.error || "No se pudo consultar el TrackId en la DGII.");
        return;
      }

      if (facturaRef) {
        const updatedList = facturasVentas.map((f) =>
          f.id === facturaRef.id
            ? {
                ...f,
                estadoFiscal: data.estadoFiscal,
                respuestaDGII: data.respuestaDGII
              }
            : f
        );
        setFacturasVentas(updatedList);
        if (!isLocalFileMode) {
          await setDoc(
            tenantDoc("configuracion", "registro_ventas", currentUser?.farmaciaId),
            { facturas: updatedList, updatedAt: Date.now() },
            { merge: true }
          );
        }
      }

      await appendAuditoriaFiscal(
        {
          tipoAccion: "CONSULTA_ESTADO_DGII",
          comprobanteNcf: facturaRef?.ncf,
          descripcion: `Consulta de TrackId ${tid} en DGII (${config.ambienteDGII}) -> Resultado: ${data.estadoFiscal}`,
          usuario: `${currentUser.nombre} (${currentUser.usuario})`,
          rolUsuario: currentUser.rol,
          ambienteDGII: config.ambienteDGII,
          resultado: "EXITO",
          detalleTecnico: data.respuestaDGII
        },
        currentUser?.farmaciaId
      );

      playSound("positive");
      showToast(`TrackId ${tid}: Estado reportado por DGII: ${data.estadoFiscal}`);
    } catch (err) {
      console.error(err);
      alert("Error de red al consultar TrackId.");
    } finally {
      setConsultingTrackId(false);
    }
  };

  // Registrar Compra / Gasto en Formato 606
  const handleAddCompra606 = async (e: React.FormEvent) => {
    e.preventDefault();
    const rncVal = validateRncOrCedulaDGII(rncProveedor606);
    if (!rncVal.valid) {
      alert(`RNC / Cédula del proveedor inválido:\n${rncVal.message}`);
      return;
    }

    const ncfVal = validateNCFFormat(ncfCompra606);
    if (!ncfVal.valid) {
      alert(`NCF / e-CF de compra inválido:\n${ncfVal.message}`);
      return;
    }

    // Evitar duplicados en el Formato 606 (mismo RNC proveedor + mismo NCF)
    const duplicate = compras606.find(
      (c) =>
        !c.anulado &&
        cleanRncCedula(c.rncCedulaProveedor) === rncVal.clean &&
        c.ncf.toUpperCase() === ncfVal.clean
    );
    if (duplicate) {
      alert(
        `El comprobante ${ncfVal.clean} del proveedor RNC ${rncVal.clean} ya se encuentra registrado en el Formato 606.`
      );
      return;
    }

    const mServ = Math.max(0, Number(montoServicios606 || 0));
    const mBien = Math.max(0, Number(montoBienes606 || 0));
    const totalFact = Number((mServ + mBien).toFixed(2));
    if (totalFact <= 0) {
      alert("El monto facturado en bienes o servicios debe ser mayor que 0.");
      return;
    }

    const itbisFact = Math.max(0, Number(itbisFacturado606 || 0));
    const itbisRet = Math.max(0, Number(itbisRetenido606 || 0));
    const itbisCosto = Math.max(0, Number(itbisAlCosto606 || 0));
    const itbisAdelantar = Math.max(0, Number((itbisFact - itbisCosto).toFixed(2)));
    const isrRet = Math.max(0, Number(montoRetencionIsr606 || 0));
    const perMes = fechaComprobante606.replace(/-/g, "").slice(0, 6) || periodoFiscal;

    const nuevo606: RegistroCompra606 = {
      id: `c606-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      periodoMes: perMes,
      rncCedulaProveedor: rncVal.clean,
      tipoIdentificacion: rncVal.tipoId === "2" ? "2" : "1",
      nombreProveedor: nombreProveedor606.trim() || "Suplidor Registrado",
      tipoBienesServicios: tipoBienServicio606 || "09",
      ncf: ncfVal.clean,
      ncfModificado: ncfModificado606.trim().toUpperCase() || undefined,
      fechaComprobante: fechaComprobante606,
      fechaPago: fechaPago606 || fechaComprobante606,
      montoFacturadoServicios: mServ,
      montoFacturadoBienes: mBien,
      totalMontoFacturado: totalFact,
      itbisFacturado: itbisFact,
      itbisRetenido: itbisRet,
      itbisSujetoProporcionalidad: 0,
      itbisLlevadoAlCosto: itbisCosto,
      itbisPorAdelantar: itbisAdelantar,
      itbisPercibidoEnCompras: 0,
      tipoRetencionISR: tipoRetencionIsr606 || "",
      montoRetencionRenta: isrRet,
      isrPercibidoEnCompras: 0,
      impuestoSelectivoConsumo: 0,
      otrosImpuestosTasas: 0,
      montoPropinaLegal: 0,
      formaPago: formaPago606,
      numeroFacturaInterna: facturaInternaRef606.trim() || undefined,
      usuarioRegistro: `${currentUser.nombre} (${currentUser.usuario})`,
      createdAt: Date.now()
    };

    const nextList = [nuevo606, ...compras606];
    setCompras606(nextList);
    await saveCompras606List(nextList, currentUser?.farmaciaId);

    await appendAuditoriaFiscal(
      {
        tipoAccion: "REGISTRO_COMPRA_606",
        comprobanteNcf: nuevo606.ncf,
        documentoReferenciaId: nuevo606.id,
        descripcion: `Registro de compra/gasto 606: Suplidor ${nuevo606.nombreProveedor} (RNC ${
          nuevo606.rncCedulaProveedor
        }) • NCF ${nuevo606.ncf} por RD$ ${nuevo606.totalMontoFacturado.toFixed(2)}`,
        usuario: nuevo606.usuarioRegistro,
        rolUsuario: currentUser.rol,
        ambienteDGII: config.ambienteDGII,
        resultado: "EXITO"
      },
      currentUser?.farmaciaId
    );

    setRncProveedor606("");
    setNombreProveedor606("");
    setNcfCompra606("");
    setNcfModificado606("");
    setMontoServicios606("0");
    setMontoBienes606("");
    setItbisFacturado606("0");
    setItbisRetenido606("0");
    setItbisAlCosto606("0");
    setMontoRetencionIsr606("0");
    setFacturaInternaRef606("");
    playSound("positive");
    showToast(`Factura de compra ${nuevo606.ncf} agregada al Formato 606 (${perMes}).`);
  };

  // Pre-llenar formulario 606 desde una Entrada de Inventario existente
  const handleLoadFromInventoryEntry = (entry: {
    numeroFactura: string;
    fecha: string;
    proveedor: string;
    rncProveedor?: string;
    ncfCompra?: string;
    montoTotalBienes: number;
  }) => {
    setNombreProveedor606(entry.proveedor);
    if (entry.rncProveedor) setRncProveedor606(entry.rncProveedor);
    if (entry.ncfCompra) setNcfCompra606(entry.ncfCompra);
    setFechaComprobante606(entry.fecha);
    setFechaPago606(entry.fecha);
    setTipoBienServicio606("09"); // 09 = Compras que forman parte del costo de venta (Inventario)
    setMontoBienes606(entry.montoTotalBienes.toFixed(2));
    setMontoServicios606("0");
    setFacturaInternaRef606(entry.numeroFactura);
    playSound("click");
    showToast(
      `Datos de la Factura de Entrada "${entry.numeroFactura}" cargados. Complete el RNC y NCF del suplidor para guardar en el 606.`
    );
  };

  // Exportar Archivos Oficiales DGII (.TXT y .XLSX)
  const handleExportReport = async (
    formato: "606" | "607" | "608",
    tipoArchivo: "TXT" | "EXCEL"
  ) => {
    playSound("action");
    const rnc = cleanRncCedula(config.rncEmisor) || "000000000";

    if (formato === "606") {
      if (tipoArchivo === "TXT") {
        const txt = generate606Txt(rnc, periodoFiscal, compras606);
        downloadTextFile(txt, `DGII_F_606_${rnc}_${periodoFiscal}.txt`);
      } else {
        export606Excel(rnc, periodoFiscal, compras606);
      }
    } else if (formato === "607") {
      if (tipoArchivo === "TXT") {
        const txt = generate607Txt(rnc, periodoFiscal, facturasVentas);
        downloadTextFile(txt, `DGII_F_607_${rnc}_${periodoFiscal}.txt`);
      } else {
        export607Excel(rnc, periodoFiscal, facturasVentas);
      }
    } else if (formato === "608") {
      if (tipoArchivo === "TXT") {
        const txt = generate608Txt(rnc, periodoFiscal, anulaciones608);
        downloadTextFile(txt, `DGII_F_608_${rnc}_${periodoFiscal}.txt`);
      } else {
        export608Excel(rnc, periodoFiscal, anulaciones608);
      }
    }

    await appendAuditoriaFiscal(
      {
        tipoAccion: "EXPORTACION_REPORTE_DGII",
        descripcion: `Exportación oficial del Formato ${formato} (${tipoArchivo}) correspondiente al período fiscal ${periodoFiscal}`,
        usuario: `${currentUser.nombre} (${currentUser.usuario})`,
        rolUsuario: currentUser.rol,
        ambienteDGII: config.ambienteDGII,
        resultado: "EXITO"
      },
      currentUser?.farmaciaId
    );

    showToast(`Reporte Oficial DGII Formato ${formato} (${tipoArchivo}) generado para el período ${periodoFiscal}.`);
  };

  const navTabs: Array<{ id: FiscalTab; label: string }> = [
    { id: "dashboard", label: "Panel Fiscal DGII" },
    { id: "configuracion", label: "Configuración y Firma .p12" },
    { id: "secuencias", label: "Secuencias NCF / e-CF" },
    { id: "ecf_monitor", label: "Facturación Electrónica (e-CF)" },
    { id: "reporte_606", label: "Formato 606 (Compras)" },
    { id: "reporte_607", label: "Formato 607 (Ventas)" },
    { id: "reporte_608", label: "Formato 608 (Anulados)" },
    { id: "auditoria", label: "Auditoría Fiscal" }
  ];

  return (
    <div className="w-full min-w-0 max-w-full space-y-5 sm:space-y-6 anim-card-in">
      {/* Cabecera Principal del Módulo de Cumplimiento Fiscal DGII */}
      <div className="bg-white rounded-3xl p-4 sm:p-6 border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5 min-w-0">
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-slate-900 text-teal-400 flex items-center justify-center shrink-0 shadow-sm border border-slate-800">
              <ShieldCheck className="w-6 h-6 sm:w-7 sm:h-7" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg sm:text-2xl font-black text-slate-900 tracking-tight">
                  Cumplimiento Tributario DGII y Facturación Electrónica (e-CF)
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-1">
                <span className="font-bold text-slate-800">
                  {config.razonSocial || currentInst.nombre}
                </span>
                <span>·</span>
                <span className="font-mono tabular-nums font-bold text-teal-700">
                  RNC: {config.rncEmisor || "Pendiente"}
                </span>
                <span>·</span>
                <span>Ambiente DGII: {config.ambienteDGII}</span>
                <span>·</span>
                <span>Ley 32-23 & Norma 07-2018</span>
              </div>
            </div>
          </div>

          {/* Selector de Período Fiscal (AAAAMM) */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
              <Calendar className="w-4 h-4 text-teal-600 shrink-0" />
              <div>
                <span className="text-[10px] font-black uppercase text-slate-400 block leading-none">
                  Período Fiscal (AAAAMM)
                </span>
                <input
                  type="month"
                  value={`${periodoFiscal.slice(0, 4)}-${periodoFiscal.slice(4, 6)}`}
                  onChange={(e) => {
                    const clean = e.target.value.replace("-", "");
                    if (clean.length === 6) setPeriodoFiscal(clean);
                  }}
                  className="text-xs font-mono tabular-nums font-black text-slate-900 bg-transparent outline-none cursor-pointer mt-0.5"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                refreshAllFiscalData();
                playSound("click");
                showToast("Datos fiscales sincronizados.");
              }}
              className="h-11 px-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Actualizar</span>
            </button>
          </div>
        </div>

        {/* Barra de Navegación Interna (Sub-pestañas del Módulo Fiscal) */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-2 border-t border-slate-100">
          {navTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveSubTab(tab.id);
                playSound("click");
              }}
              className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition cursor-pointer whitespace-nowrap shrink-0 ${
                activeSubTab === tab.id
                  ? "bg-slate-900 text-white shadow-2xs"
                  : "bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* =====================================================================
          1. PANEL DE CONTROL FISCAL (DASHBOARD DGII)
         ===================================================================== */}
      {activeSubTab === "dashboard" && (
        <div className="space-y-5">
          {/* Alertas de Consistencia Tributaria */}
          {alertasFiscales.length > 0 && (
            <div className="bg-amber-50/90 border border-amber-200 rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-amber-900 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Alertas de Control y Consistencia Fiscal DGII ({alertasFiscales.length})</span>
                </span>
                <button
                  type="button"
                  onClick={() => setActiveSubTab("configuracion")}
                  className="text-xs font-extrabold text-amber-900 underline cursor-pointer"
                >
                  Revisar Configuración
                </button>
              </div>
              <ul className="space-y-1 text-xs text-amber-950 font-medium pl-6 list-disc">
                {alertasFiscales.map((al, i) => (
                  <li key={i}>{al.mensaje}</li>
                ))}
              </ul>
            </div>
          )}

          {/* KPIs Fiscales del Período (4 Columnas con Tabular Numerals) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-2xs space-y-1.5">
              <span className="text-xs font-bold text-slate-500 block">
                Ventas del Período (607 · {periodoFiscal})
              </span>
              <p className="text-2xl font-black font-mono tabular-nums text-slate-900">
                RD$ {metricasFiscales.totalFacturadoVentas.toLocaleString("es-DO", { minimumFractionDigits: 2 })}
              </p>
              <div className="text-xs text-slate-500 font-mono tabular-nums pt-1 border-t border-slate-100">
                Base: RD$ {metricasFiscales.totalVentasSinItbis.toFixed(2)} · ITBIS:{" "}
                <strong className="text-teal-700">RD$ {metricasFiscales.itbisCobrado607.toFixed(2)}</strong>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-2xs space-y-1.5">
              <span className="text-xs font-bold text-slate-500 block">
                Compras y Gastos (606 · {periodoFiscal})
              </span>
              <p className="text-2xl font-black font-mono tabular-nums text-slate-900">
                RD$ {metricasFiscales.totalCompras606.toLocaleString("es-DO", { minimumFractionDigits: 2 })}
              </p>
              <div className="text-xs text-slate-500 font-mono tabular-nums pt-1 border-t border-slate-100">
                ITBIS Adelantado:{" "}
                <strong className="text-indigo-700">RD$ {metricasFiscales.itbisAdelantado606.toFixed(2)}</strong> · Ret:{" "}
                RD$ {metricasFiscales.itbisRetenido606.toFixed(2)}
              </div>
            </div>

            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-2xs space-y-1.5">
              <span className="text-xs font-bold text-slate-500 block">
                Liquidación Estimada ITBIS (IT-1)
              </span>
              <p
                className={`text-2xl font-black font-mono tabular-nums ${
                  metricasFiscales.balanceItbisPagar >= 0 ? "text-amber-700" : "text-emerald-700"
                }`}
              >
                RD$ {Math.abs(metricasFiscales.balanceItbisPagar).toLocaleString("es-DO", { minimumFractionDigits: 2 })}
              </p>
              <div className="text-xs text-slate-500 pt-1 border-t border-slate-100">
                {metricasFiscales.balanceItbisPagar >= 0
                  ? "ITBIS Estimado a Pagar (Cobrado > Adelantado)"
                  : "Saldo a Favor del Contribuyente"}
              </div>
            </div>

            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-2xs space-y-1.5">
              <span className="text-xs font-bold text-slate-500 block">
                Comprobantes Fiscales del Período
              </span>
              <p className="text-2xl font-black font-mono tabular-nums text-slate-900">
                {metricasFiscales.totalEcf + metricasFiscales.totalNcfB} emitidos
              </p>
              <div className="text-xs text-slate-500 font-mono tabular-nums pt-1 border-t border-slate-100">
                e-CF: {metricasFiscales.totalEcf} · NCF B: {metricasFiscales.totalNcfB} · Anulados (608):{" "}
                <strong className="text-rose-600">{metricasFiscales.totalAnulados608}</strong>
              </div>
            </div>
          </div>

          {/* Resumen de Exportación Rápida 606 / 607 / 608 y Estado e-CF */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-7 bg-white rounded-3xl p-5 border border-slate-200 shadow-2xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm sm:text-base font-black text-slate-900">
                    Envío de Datos Mensuales OFV DGII ({periodoFiscal})
                  </h3>
                  <p className="text-xs text-slate-500">
                    Descargue los archivos oficiales .TXT (separados por pipes) o Excel listos para la Oficina Virtual
                  </p>
                </div>
              </div>

              <div className="divide-y divide-slate-100 text-xs">
                <div className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-extrabold text-slate-900">
                      Formato 606 · Compras de Bienes y Servicios
                    </p>
                    <p className="text-slate-500 font-mono tabular-nums">
                      {comprasPeriodo606.length} registros en {periodoFiscal} · Total: RD${" "}
                      {metricasFiscales.totalCompras606.toFixed(2)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleExportReport("606", "TXT")}
                      className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold cursor-pointer"
                    >
                      Descargar 606 .TXT
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExportReport("606", "EXCEL")}
                      className="px-3 py-2 rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-900 border border-teal-200 font-bold cursor-pointer"
                    >
                      Excel
                    </button>
                  </div>
                </div>

                <div className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-extrabold text-slate-900">
                      Formato 607 · Ventas de Bienes y Servicios
                    </p>
                    <p className="text-slate-500 font-mono tabular-nums">
                      {ventasPeriodo607.filter((v) => v.ncf).length} comprobantes fiscales en {periodoFiscal} · Total: RD${" "}
                      {metricasFiscales.totalFacturadoVentas.toFixed(2)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleExportReport("607", "TXT")}
                      className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold cursor-pointer"
                    >
                      Descargar 607 .TXT
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExportReport("607", "EXCEL")}
                      className="px-3 py-2 rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-900 border border-teal-200 font-bold cursor-pointer"
                    >
                      Excel
                    </button>
                  </div>
                </div>

                <div className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-extrabold text-slate-900">
                      Formato 608 · Comprobantes Anulados
                    </p>
                    <p className="text-slate-500 font-mono tabular-nums">
                      {anulacionesPeriodo608.length} comprobantes anulados en {periodoFiscal}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleExportReport("608", "TXT")}
                      className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold cursor-pointer"
                    >
                      Descargar 608 .TXT
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExportReport("608", "EXCEL")}
                      className="px-3 py-2 rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-900 border border-teal-200 font-bold cursor-pointer"
                    >
                      Excel
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Estado del Conector de Facturación Electrónica e-CF */}
            <div className="lg:col-span-5 bg-white rounded-3xl p-5 border border-slate-200 shadow-2xs space-y-4">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-sm sm:text-base font-black text-slate-900">
                  Estado de Facturación Electrónica (Ley 32-23)
                </h3>
                <p className="text-xs text-slate-500">
                  Trazabilidad real de estados sin simulaciones de aprobación
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2.5 text-center">
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3">
                  <span className="text-xl font-black font-mono tabular-nums text-emerald-800 block">
                    {metricasFiscales.ecfAceptados}
                  </span>
                  <span className="text-[11px] font-bold text-emerald-900">Aceptados DGII</span>
                </div>
                <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-3">
                  <span className="text-xl font-black font-mono tabular-nums text-indigo-800 block">
                    {metricasFiscales.ecfPendientesEnvio}
                  </span>
                  <span className="text-[11px] font-bold text-indigo-900">Locales / Firmados</span>
                </div>
                <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3">
                  <span className="text-xl font-black font-mono tabular-nums text-rose-800 block">
                    {metricasFiscales.ecfRechazados}
                  </span>
                  <span className="text-[11px] font-bold text-rose-900">Rechazados</span>
                </div>
              </div>

              <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-200 text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-500 font-semibold">Ambiente Web Service:</span>
                  <span className="font-mono font-bold text-slate-900">{config.ambienteDGII}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-semibold">Certificado Digital (.p12):</span>
                  <span
                    className={`font-bold ${
                      serverCertStatus || config.certificadoInfo?.configurado
                        ? "text-emerald-700"
                        : "text-amber-700"
                    }`}
                  >
                    {serverCertStatus
                      ? "Activo en Servidor (XMLDSig)"
                      : config.certificadoInfo?.configurado
                      ? "Registrado (Recargar en sesión)"
                      : "No cargado"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 font-semibold">Modo Contingencia:</span>
                  <span className="font-bold text-slate-800">
                    {config.modoContingenciaActivo ? "ACTIVO (Serie B)" : "Operación Normal"}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {onNavigateTab && (
                  <button
                    type="button"
                    onClick={() => onNavigateTab("venta")}
                    className="flex-1 py-2.5 px-3 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-black text-xs text-center cursor-pointer"
                  >
                    Ir a Emitir Comprobante
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setActiveSubTab("ecf_monitor")}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs text-center cursor-pointer"
                >
                  Abrir Monitor e-CF
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          2. CONFIGURACIÓN FISCAL DGII & CERTIFICADO DIGITAL (.P12 / .PFX)
         ===================================================================== */}
      {activeSubTab === "configuracion" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <form
            onSubmit={handleSaveConfigDGII}
            className="lg:col-span-7 bg-white rounded-3xl p-5 sm:p-6 border border-slate-200 shadow-2xs space-y-5"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3.5">
              <div>
                <h3 className="text-base font-black text-slate-900">
                  1. Datos del Contribuyente Emisor y Régimen Tributario
                </h3>
                <p className="text-xs text-slate-500">
                  Información oficial utilizada en el nodo &lt;Emisor&gt; de los XML e-CF y en las cabeceras 606/607/608
                </p>
              </div>
              {!isAdmin && (
                <span className="text-xs font-bold text-rose-600 flex items-center gap-1">
                  <Lock className="w-3.5 h-3.5" /> Solo lectura (Requiere ADMIN)
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block font-extrabold text-slate-700 mb-1">
                  RNC o Cédula del Contribuyente Emisor *
                </label>
                <input
                  type="text"
                  disabled={!isAdmin}
                  value={config.rncEmisor}
                  onChange={(e) => setConfig({ ...config, rncEmisor: e.target.value })}
                  placeholder="Ej. 101000001 (9 u 11 dígitos)"
                  className="w-full h-11 bg-slate-50 border border-slate-300 rounded-xl px-3.5 font-mono tabular-nums font-black text-slate-900"
                />
              </div>

              <div>
                <label className="block font-extrabold text-slate-700 mb-1">
                  Régimen Tributario DGII *
                </label>
                <select
                  disabled={!isAdmin}
                  value={config.regimenTributario}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      regimenTributario: e.target.value as RegimenTributarioDGII
                    })
                  }
                  className="w-full h-11 bg-slate-50 border border-slate-300 rounded-xl px-3 font-bold text-slate-900"
                >
                  <option value="Ordinario">Régimen Ordinario de Tributación</option>
                  <option value="RST_Compras">RST Basado en Compras</option>
                  <option value="RST_Ingresos">RST Basado en Ingresos</option>
                  <option value="Regimen_Especial_Zonas_Francas">Régimen Especial / Zonas Francas</option>
                  <option value="Regimen_Especial_Ley_28_01">Desarrollo Fronterizo (Ley 28-01)</option>
                  <option value="Exento_Sin_Fines_Lucro">Institución Sin Fines de Lucro / Pública</option>
                </select>
              </div>

              <div>
                <label className="block font-extrabold text-slate-700 mb-1">
                  Razón Social Registrada en DGII *
                </label>
                <input
                  type="text"
                  disabled={!isAdmin}
                  value={config.razonSocial}
                  onChange={(e) => setConfig({ ...config, razonSocial: e.target.value })}
                  className="w-full h-11 bg-slate-50 border border-slate-300 rounded-xl px-3.5 font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block font-extrabold text-slate-700 mb-1">
                  Nombre Comercial (ONAPI / DGII)
                </label>
                <input
                  type="text"
                  disabled={!isAdmin}
                  value={config.nombreComercial}
                  onChange={(e) => setConfig({ ...config, nombreComercial: e.target.value })}
                  className="w-full h-11 bg-slate-50 border border-slate-300 rounded-xl px-3.5 font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block font-extrabold text-slate-700 mb-1">
                  Código CIIU Actividad Económica
                </label>
                <input
                  type="text"
                  disabled={!isAdmin}
                  value={config.codigoActividadEconomicaCIIU}
                  onChange={(e) =>
                    setConfig({ ...config, codigoActividadEconomicaCIIU: e.target.value })
                  }
                  placeholder="4772"
                  className="w-full h-11 bg-slate-50 border border-slate-300 rounded-xl px-3.5 font-mono tabular-nums font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block font-extrabold text-slate-700 mb-1">
                  Descripción Actividad Económica
                </label>
                <input
                  type="text"
                  disabled={!isAdmin}
                  value={config.descripcionActividadEconomica}
                  onChange={(e) =>
                    setConfig({ ...config, descripcionActividadEconomica: e.target.value })
                  }
                  className="w-full h-11 bg-slate-50 border border-slate-300 rounded-xl px-3.5 font-semibold text-slate-800"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-extrabold text-slate-700 mb-1">
                  Dirección Fiscal Completa *
                </label>
                <input
                  type="text"
                  disabled={!isAdmin}
                  value={config.direccionFiscal}
                  onChange={(e) => setConfig({ ...config, direccionFiscal: e.target.value })}
                  className="w-full h-11 bg-slate-50 border border-slate-300 rounded-xl px-3.5 font-semibold text-slate-800"
                />
              </div>

              <div>
                <label className="block font-extrabold text-slate-700 mb-1">
                  Modalidad de Emisión Activa
                </label>
                <select
                  disabled={!isAdmin}
                  value={config.modalidadEmisionActiva}
                  onChange={(e) =>
                    setConfig({ ...config, modalidadEmisionActiva: e.target.value as any })
                  }
                  className="w-full h-11 bg-slate-50 border border-slate-300 rounded-xl px-3 font-bold text-slate-900"
                >
                  <option value="DUAL_B_E">Modo Dual: NCF Serie B y e-CF Serie E</option>
                  <option value="SOLO_ECF_E">Priorizar Facturación Electrónica (e-CF Serie E)</option>
                  <option value="SOLO_NCF_B">Solo Comprobantes Tradicionales (NCF Serie B)</option>
                </select>
              </div>

              <div>
                <label className="block font-extrabold text-slate-700 mb-1">
                  Ambiente Oficial Web Services DGII *
                </label>
                <select
                  disabled={!isAdmin}
                  value={config.ambienteDGII}
                  onChange={(e) =>
                    setConfig({ ...config, ambienteDGII: e.target.value as AmbienteDGII })
                  }
                  className="w-full h-11 bg-indigo-50 border border-indigo-300 rounded-xl px-3 font-extrabold text-indigo-950"
                >
                  <option value="TesteCF">TesteCF • Pre-Certificación (Pruebas DGII)</option>
                  <option value="CerteCF">CerteCF • Certificación Emisor Electrónico</option>
                  <option value="eCF">eCF • Producción Oficial DGII</option>
                </select>
              </div>
            </div>

            {/* Modo Contingencia */}
            <div className="bg-amber-50/70 border border-amber-200 rounded-2xl p-4 space-y-2 text-xs">
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <span className="font-black text-amber-950 block">
                    Activar Modo de Contingencia Fiscal (Ley 32-23)
                  </span>
                  <span className="text-amber-800">
                    Permite operar temporalmente con NCF Serie B o diferir el envío de XML cuando no hay conectividad con la DGII
                  </span>
                </div>
                <input
                  type="checkbox"
                  disabled={!isAdmin}
                  checked={config.modoContingenciaActivo}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      modoContingenciaActivo: e.target.checked,
                      fechaInicioContingencia: e.target.checked
                        ? new Date().toISOString()
                        : undefined
                    })
                  }
                  className="w-5 h-5 accent-amber-600 rounded"
                />
              </label>
            </div>

            {isAdmin && (
              <button
                type="submit"
                disabled={savingConfig}
                className="w-full h-12 rounded-2xl bg-teal-700 hover:bg-teal-800 text-white font-black text-xs sm:text-sm uppercase tracking-wider shadow-sm cursor-pointer"
              >
                {savingConfig ? "Guardando..." : "Guardar Configuración Fiscal DGII"}
              </button>
            )}
          </form>

          {/* Columna Derecha: Certificado Digital .p12 y Endpoints Oficiales */}
          <div className="lg:col-span-5 space-y-5">
            <div className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200 shadow-2xs space-y-4">
              <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
                <KeyRound className="w-5 h-5 text-indigo-600 shrink-0" />
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    2. Certificado Digital (.p12 / .pfx) y Firma XMLDSig
                  </h3>
                  <p className="text-xs text-slate-500">
                    Almacenado en memoria segura del servidor Express (la clave privada nunca queda expuesta en el navegador)
                  </p>
                </div>
              </div>

              {config.certificadoInfo?.configurado ? (
                <div className="bg-emerald-50/80 border border-emerald-200 rounded-2xl p-4 text-xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-black text-emerald-950 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>Certificado Verificado</span>
                    </span>
                    <span className="font-mono text-[11px] text-emerald-800">
                      {config.certificadoInfo.algoritmoFirma || "RSA-SHA256"}
                    </span>
                  </div>
                  <p className="text-slate-700">
                    <strong>Archivo:</strong> {config.certificadoInfo.nombreArchivo}
                  </p>
                  <p className="text-slate-700 break-all">
                    <strong>Titular:</strong> {config.certificadoInfo.titularSubject}
                  </p>
                  <p className="text-slate-700 break-all">
                    <strong>Emisor:</strong> {config.certificadoInfo.emisorIssuer}
                  </p>
                  <p className="text-slate-700 font-mono tabular-nums">
                    <strong>Vigencia:</strong> {config.certificadoInfo.validoDesde} →{" "}
                    {config.certificadoInfo.validoHasta}
                  </p>
                </div>
              ) : (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs text-slate-600">
                  No se ha cargado aún un certificado digital `.p12` / `.pfx`. Cargue su certificado emitido por una entidad autorizada por INDOTEL (Cámara de Comercio, Viafirma, Avansi, DigiCert) para firmar y autenticar ante la DGII.
                </div>
              )}

              {isAdmin && (
                <div className="space-y-3 text-xs pt-1">
                  <div>
                    <label className="block font-extrabold text-slate-700 mb-1">
                      Contraseña del Certificado (.p12 / .pfx)
                    </label>
                    <input
                      type="password"
                      value={certPassword}
                      onChange={(e) => setCertPassword(e.target.value)}
                      placeholder="Ingrese la clave privada del archivo .p12..."
                      className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3 font-semibold text-slate-900"
                    />
                  </div>

                  <input
                    ref={certFileInputRef}
                    type="file"
                    accept=".p12,.pfx,.pem"
                    onChange={handleUploadCertificate}
                    className="hidden"
                  />

                  <button
                    type="button"
                    disabled={uploadingCert}
                    onClick={() => certFileInputRef.current?.click()}
                    className="w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Upload className="w-4 h-4" />
                    <span>
                      {uploadingCert
                        ? "Verificando Certificado..."
                        : "Seleccionar y Cargar Certificado (.p12 / .pfx)"}
                    </span>
                  </button>
                </div>
              )}
            </div>

            {/* Endpoints Oficiales DGII Activos */}
            <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-2xs space-y-3 text-xs">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
                <Server className="w-4 h-4 text-teal-600" />
                <h4 className="font-black text-slate-900">
                  Endpoints Oficiales DGII ({config.ambienteDGII})
                </h4>
              </div>
              <div className="space-y-1.5 font-mono text-[11px] text-slate-600 break-all">
                <p>
                  <strong className="text-slate-800">Semilla:</strong>{" "}
                  {config.endpointsOficiales[config.ambienteDGII].semilla}
                </p>
                <p>
                  <strong className="text-slate-800">Validar Semilla:</strong>{" "}
                  {config.endpointsOficiales[config.ambienteDGII].validarSemilla}
                </p>
                <p>
                  <strong className="text-slate-800">Recepción e-CF:</strong>{" "}
                  {config.endpointsOficiales[config.ambienteDGII].recepcionEcf}
                </p>
                <p>
                  <strong className="text-slate-800">Recepción FC (&lt;250k):</strong>{" "}
                  {config.endpointsOficiales[config.ambienteDGII].recepcionResumenConsumo}
                </p>
                <p>
                  <strong className="text-slate-800">Consulta Estado:</strong>{" "}
                  {config.endpointsOficiales[config.ambienteDGII].consultaResultado}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          3. CONTROL DE SECUENCIAS DE COMPROBANTES (NCF SERIE B Y e-CF SERIE E)
         ===================================================================== */}
      {activeSubTab === "secuencias" && (
        <div className="bg-white rounded-3xl p-4 sm:p-6 border border-slate-200 shadow-2xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-black text-slate-900">
                Control de Secuencias Fiscales Autorizadas (Serie B y Serie E)
              </h3>
              <p className="text-xs text-slate-500">
                Configure el correlativo actual, límite autorizado y fecha de vencimiento de cada tipo de comprobante
              </p>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={handleSaveAllSecuencias}
                className="px-4 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-black text-xs flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
              >
                <Check className="w-4 h-4" />
                <span>Guardar Cambios de Secuencias</span>
              </button>
            )}
          </div>

          <div className="w-full overflow-x-auto border border-slate-200 rounded-2xl">
            <table className="min-w-[920px] w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 text-[11px] font-black text-slate-600 uppercase">
                  <th className="px-3.5 py-3 sticky left-0 bg-slate-100 z-10">Tipo / Serie</th>
                  <th className="px-3 py-3">Próximo NCF / e-CF</th>
                  <th className="px-3 py-3 text-right">Secuencia Actual</th>
                  <th className="px-3 py-3 text-right">Final Autorizado</th>
                  <th className="px-3 py-3 text-right">Disponibles</th>
                  <th className="px-3 py-3">Fecha Vencimiento</th>
                  <th className="px-3 py-3 text-center">Sucursal</th>
                  <th className="px-3 py-3 text-center">Activa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {config.secuencias.map((seq) => {
                  const disponibles = Math.max(0, seq.secuenciaFinal - seq.secuenciaActual + 1);
                  const proximoFormateado = formatNCFSequence(seq.tipo, seq.secuenciaActual);
                  return (
                    <tr key={seq.id} className="hover:bg-slate-50/80">
                      <td className="px-3.5 py-2.5 sticky left-0 bg-white font-bold text-slate-900">
                        <span className="font-mono font-black text-indigo-900 mr-1.5">
                          {seq.tipo}
                        </span>
                        <span className="text-slate-600">{seq.descripcion}</span>
                      </td>
                      <td className="px-3 py-2.5 font-mono tabular-nums font-black text-teal-800">
                        {proximoFormateado}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <input
                          type="number"
                          min="1"
                          disabled={!isAdmin}
                          value={seq.secuenciaActual}
                          onChange={(e) =>
                            handleUpdateSecuencia(
                              seq.id,
                              "secuenciaActual",
                              Math.max(1, parseInt(e.target.value, 10) || 1)
                            )
                          }
                          className="w-24 text-right bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 font-mono tabular-nums font-bold text-slate-900"
                        />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <input
                          type="number"
                          min="1"
                          disabled={!isAdmin}
                          value={seq.secuenciaFinal}
                          onChange={(e) =>
                            handleUpdateSecuencia(
                              seq.id,
                              "secuenciaFinal",
                              Math.max(1, parseInt(e.target.value, 10) || 1)
                            )
                          }
                          className="w-28 text-right bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 font-mono tabular-nums font-bold text-slate-900"
                        />
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-mono tabular-nums font-black ${
                          disponibles <= seq.alertaMinima ? "text-rose-600" : "text-emerald-700"
                        }`}
                      >
                        {disponibles}
                      </td>
                      <td className="px-3 py-2.5">
                        <input
                          type="date"
                          disabled={!isAdmin}
                          value={seq.fechaVencimiento}
                          onChange={(e) =>
                            handleUpdateSecuencia(seq.id, "fechaVencimiento", e.target.value)
                          }
                          className="bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 font-mono tabular-nums text-xs font-bold text-slate-800"
                        />
                      </td>
                      <td className="px-3 py-2.5 text-center font-mono tabular-nums text-slate-600">
                        {seq.sucursalId}-{seq.puntoEmision}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <input
                          type="checkbox"
                          disabled={!isAdmin}
                          checked={seq.activa}
                          onChange={(e) =>
                            handleUpdateSecuencia(seq.id, "activa", e.target.checked)
                          }
                          className="w-4 h-4 accent-teal-700 rounded cursor-pointer"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          4. MONITOR DE FACTURACIÓN ELECTRÓNICA (e-CF LEY 32-23, XML, XSD Y TRACKID)
         ===================================================================== */}
      {activeSubTab === "ecf_monitor" && (
        <div className="bg-white rounded-3xl p-4 sm:p-6 border border-slate-200 shadow-2xs space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-black text-slate-900">
                Monitor de Comprobantes Fiscales Electrónicos (e-CF E31–E47)
              </h3>
              <p className="text-xs text-slate-500">
                Validación XSD oficial, firma digital XMLDSig, envío a Web Services DGII y consulta de TrackId
              </p>
            </div>

            {/* Consulta directa de TrackId en DGII */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={trackIdQueryInput}
                onChange={(e) => setTrackIdQueryInput(e.target.value)}
                placeholder="Consultar TrackId DGII..."
                className="h-10 bg-slate-50 border border-slate-300 rounded-xl px-3 text-xs font-mono font-bold text-slate-900"
              />
              <button
                type="button"
                disabled={consultingTrackId}
                onClick={() => handleConsultarTrackIdDGII()}
                className="h-10 px-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs cursor-pointer whitespace-nowrap"
              >
                {consultingTrackId ? "Consultando..." : "Consultar TrackId"}
              </button>
            </div>
          </div>

          <div className="w-full overflow-x-auto border border-slate-200 rounded-2xl">
            <table className="min-w-[960px] w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 text-[11px] font-black text-slate-600 uppercase">
                  <th className="px-4 py-3 sticky left-0 bg-slate-100 z-10">e-NCF / Fecha</th>
                  <th className="px-3 py-3">Tipo</th>
                  <th className="px-3 py-3">Comprador / RNC</th>
                  <th className="px-3 py-3 text-right">Monto Total</th>
                  <th className="px-3 py-3">Cód. Seguridad</th>
                  <th className="px-3 py-3">Estado Real DGII / TrackId</th>
                  <th className="px-4 py-3 text-right">Operaciones e-CF</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {facturasVentas.filter((f) => f.ncf?.startsWith("E")).length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-slate-400">
                      Aún no se han emitido comprobantes electrónicos Serie E (E31–E47).
                    </td>
                  </tr>
                ) : (
                  facturasVentas
                    .filter((f) => f.ncf?.startsWith("E"))
                    .map((fac) => (
                      <tr key={fac.id} className="hover:bg-slate-50/80">
                        <td className="px-4 py-3 sticky left-0 bg-white font-mono tabular-nums">
                          <span className="font-black text-indigo-950 block">{fac.ncf}</span>
                          <span className="text-[10px] text-slate-500">
                            {fac.fecha} {fac.hora}
                          </span>
                        </td>
                        <td className="px-3 py-3 font-bold text-slate-800">
                          {fac.tipoComprobante}
                        </td>
                        <td className="px-3 py-3">
                          <span className="font-bold text-slate-800 block">
                            {fac.clienteNombre || "CONSUMIDOR FINAL"}
                          </span>
                          {fac.rncCliente && (
                            <span className="text-[11px] font-mono tabular-nums text-slate-500">
                              RNC: {fac.rncCliente}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums font-black text-teal-900">
                          RD$ {Number(fac.totalMonto || 0).toFixed(2)}
                        </td>
                        <td className="px-3 py-3 font-mono tabular-nums font-bold text-indigo-700">
                          {fac.codigoSeguridadECF || "—"}
                        </td>
                        <td className="px-3 py-3">
                          <span className="font-bold text-slate-800 block">
                            {fac.estadoFiscal || "GENERADO_LOCAL"}
                          </span>
                          {fac.trackIdDGII && (
                            <span className="font-mono text-[10px] text-slate-500 block">
                              TrackId: {fac.trackIdDGII}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setSelectedEcfXmlModal(fac)}
                              className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-[11px] cursor-pointer"
                            >
                              Ver XML / XSD
                            </button>
                            <button
                              type="button"
                              disabled={processingEcfId === fac.id}
                              onClick={() => handleSignAndSendExistingECF(fac, true)}
                              className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] cursor-pointer"
                            >
                              {processingEcfId === fac.id ? "..." : "Firmar y Enviar DGII"}
                            </button>
                            <button
                              type="button"
                              onClick={() => exportSaleInvoiceToPDF(fac, currentInst)}
                              className="px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-[11px] cursor-pointer"
                            >
                              RI PDF
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          5. FORMATO 606: COMPRAS DE BIENES Y SERVICIOS + VÍNCULO INVENTARIO
         ===================================================================== */}
      {activeSubTab === "reporte_606" && (
        <div className="space-y-5">
          {/* Entradas de Inventario Pendientes de Vincular al 606 */}
          {facturasInventarioPendientes606.length > 0 && (
            <div className="bg-teal-50/80 border border-teal-200 rounded-3xl p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-teal-700" />
                  <h4 className="text-xs sm:text-sm font-black text-teal-950">
                    Entradas de Inventario Recientes Disponibles para Vincular al Formato 606 (
                    {facturasInventarioPendientes606.length})
                  </h4>
                </div>
              </div>
              <div className="flex items-center gap-2.5 overflow-x-auto pb-1">
                {facturasInventarioPendientes606.map((ent) => (
                  <button
                    key={ent.numeroFactura}
                    type="button"
                    onClick={() => handleLoadFromInventoryEntry(ent)}
                    className="px-3.5 py-2 rounded-xl bg-white hover:bg-teal-600 hover:text-white border border-teal-200 text-left text-xs transition cursor-pointer shrink-0 shadow-2xs"
                  >
                    <span className="font-mono font-black block">
                      Factura: {ent.numeroFactura} · RD$ {ent.montoTotalBienes.toFixed(2)}
                    </span>
                    <span className="text-[11px] opacity-80 block">
                      {ent.proveedor} ({ent.fecha})
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Formulario para Registrar Compra / Gasto en el 606 */}
          <form
            onSubmit={handleAddCompra606}
            className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200 shadow-2xs space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-black text-slate-900">
                  Registrar Factura de Compra o Gasto Operativo (Formato 606 DGII)
                </h3>
                <p className="text-xs text-slate-500">
                  Valida el RNC del proveedor, NCF/e-CF, clasificación del costo/gasto (01–11) y retenciones de ITBIS/ISR
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleExportReport("606", "TXT")}
                  className="px-3 py-2 rounded-xl bg-slate-900 text-white font-bold text-xs cursor-pointer"
                >
                  Exportar 606 .TXT
                </button>
                <button
                  type="button"
                  onClick={() => handleExportReport("606", "EXCEL")}
                  className="px-3 py-2 rounded-xl bg-teal-50 text-teal-900 border border-teal-200 font-bold text-xs cursor-pointer"
                >
                  Exportar Excel
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 text-xs">
              <div>
                <label className="block font-extrabold text-slate-700 mb-1">
                  RNC / Cédula Suplidor *
                </label>
                <input
                  type="text"
                  required
                  value={rncProveedor606}
                  onChange={(e) => setRncProveedor606(e.target.value)}
                  placeholder="9 u 11 dígitos"
                  className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3 font-mono tabular-nums font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block font-extrabold text-slate-700 mb-1">
                  Nombre o Razón Social Suplidor *
                </label>
                <input
                  type="text"
                  required
                  value={nombreProveedor606}
                  onChange={(e) => setNombreProveedor606(e.target.value)}
                  placeholder="Ej. Distribuidora Farmacéutica SRL"
                  className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3 font-semibold text-slate-900"
                />
              </div>

              <div>
                <label className="block font-extrabold text-slate-700 mb-1">
                  NCF o e-CF de Compra *
                </label>
                <input
                  type="text"
                  required
                  value={ncfCompra606}
                  onChange={(e) => setNcfCompra606(e.target.value.toUpperCase())}
                  placeholder="Ej. B0100000125 o E310000000125"
                  className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3 font-mono tabular-nums font-black text-indigo-950"
                />
              </div>

              <div>
                <label className="block font-extrabold text-slate-700 mb-1">
                  Tipo de Bienes y Servicios (01–11) *
                </label>
                <select
                  value={tipoBienServicio606}
                  onChange={(e) => setTipoBienServicio606(e.target.value)}
                  className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-2.5 font-bold text-slate-900"
                >
                  {TIPOS_BIENES_SERVICIOS_606.map((tb) => (
                    <option key={tb.codigo} value={tb.codigo}>
                      {tb.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-extrabold text-slate-700 mb-1">
                  Fecha Comprobante *
                </label>
                <input
                  type="date"
                  required
                  value={fechaComprobante606}
                  onChange={(e) => setFechaComprobante606(e.target.value)}
                  className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3 font-mono tabular-nums font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block font-extrabold text-slate-700 mb-1">
                  Monto en Bienes (RD$)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={montoBienes606}
                  onChange={(e) => setMontoBienes606(e.target.value)}
                  placeholder="0.00"
                  className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3 font-mono tabular-nums font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block font-extrabold text-slate-700 mb-1">
                  Monto en Servicios (RD$)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={montoServicios606}
                  onChange={(e) => setMontoServicios606(e.target.value)}
                  placeholder="0.00"
                  className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3 font-mono tabular-nums font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block font-extrabold text-slate-700 mb-1">
                  ITBIS Facturado (RD$)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={itbisFacturado606}
                  onChange={(e) => setItbisFacturado606(e.target.value)}
                  placeholder="0.00"
                  className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3 font-mono tabular-nums font-bold text-amber-900"
                />
              </div>

              <div>
                <label className="block font-extrabold text-slate-700 mb-1">
                  ITBIS Retenido (RD$)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={itbisRetenido606}
                  onChange={(e) => setItbisRetenido606(e.target.value)}
                  className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3 font-mono tabular-nums font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block font-extrabold text-slate-700 mb-1">
                  Tipo Retención ISR (01–08)
                </label>
                <select
                  value={tipoRetencionIsr606}
                  onChange={(e) => setTipoRetencionIsr606(e.target.value)}
                  className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-2.5 font-bold text-slate-900"
                >
                  {TIPOS_RETENCION_ISR_606.map((tr) => (
                    <option key={tr.codigo} value={tr.codigo}>
                      {tr.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-extrabold text-slate-700 mb-1">
                  Monto Retención ISR (RD$)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={montoRetencionIsr606}
                  onChange={(e) => setMontoRetencionIsr606(e.target.value)}
                  className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-3 font-mono tabular-nums font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block font-extrabold text-slate-700 mb-1">
                  Forma de Pago DGII *
                </label>
                <select
                  value={formaPago606}
                  onChange={(e) => setFormaPago606(e.target.value as FormaPagoDGII)}
                  className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl px-2.5 font-bold text-slate-900"
                >
                  {FORMAS_PAGO_DGII.map((fp) => (
                    <option key={fp.codigo} value={fp.codigo}>
                      {fp.nombre}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              type="submit"
              className="h-11 px-5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-black text-xs uppercase tracking-wider flex items-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Registrar Compra / Gasto en Formato 606</span>
            </button>
          </form>

          {/* Tabla de Compras 606 del Período */}
          <div className="bg-white rounded-3xl p-4 sm:p-6 border border-slate-200 shadow-2xs space-y-4">
            <h4 className="text-sm font-black text-slate-900">
              Registros del Formato 606 en Período {periodoFiscal} ({comprasPeriodo606.length})
            </h4>
            <div className="w-full overflow-x-auto border border-slate-200 rounded-2xl">
              <table className="min-w-[960px] w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-[11px] font-black text-slate-600 uppercase">
                    <th className="px-3.5 py-3 sticky left-0 bg-slate-100 z-10">Suplidor / RNC</th>
                    <th className="px-3 py-3">NCF / e-CF</th>
                    <th className="px-3 py-3">Tipo Costo</th>
                    <th className="px-3 py-3">Fecha</th>
                    <th className="px-3 py-3 text-right">Bienes</th>
                    <th className="px-3 py-3 text-right">Servicios</th>
                    <th className="px-3 py-3 text-right">Total Facturado</th>
                    <th className="px-3 py-3 text-right">ITBIS Adelantar</th>
                    <th className="px-3 py-3 text-right">Ret. ISR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {comprasPeriodo606.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-10 text-center text-slate-400">
                        No hay compras o gastos registrados para el período {periodoFiscal}.
                      </td>
                    </tr>
                  ) : (
                    comprasPeriodo606.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50">
                        <td className="px-3.5 py-2.5 sticky left-0 bg-white">
                          <span className="font-bold text-slate-900 block">{c.nombreProveedor}</span>
                          <span className="font-mono tabular-nums text-[11px] text-slate-500">
                            RNC: {c.rncCedulaProveedor}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-mono tabular-nums font-black text-indigo-900">
                          {c.ncf}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">{c.tipoBienesServicios}</td>
                        <td className="px-3 py-2.5 font-mono tabular-nums text-slate-600">
                          {c.fechaComprobante}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                          RD$ {c.montoFacturadoBienes.toFixed(2)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                          RD$ {c.montoFacturadoServicios.toFixed(2)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums font-black text-slate-900">
                          RD$ {c.totalMontoFacturado.toFixed(2)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums font-bold text-teal-700">
                          RD$ {c.itbisPorAdelantar.toFixed(2)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">
                          RD$ {c.montoRetencionRenta.toFixed(2)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          6. FORMATO 607: REPORTE OFICIAL DE VENTAS DE BIENES Y SERVICIOS
         ===================================================================== */}
      {activeSubTab === "reporte_607" && (
        <div className="bg-white rounded-3xl p-4 sm:p-6 border border-slate-200 shadow-2xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-black text-slate-900">
                Formato 607 · Ventas de Bienes y Servicios ({periodoFiscal})
              </h3>
              <p className="text-xs text-slate-500">
                Consolidado automático de comprobantes NCF Serie B y e-CF Serie E emitidos en el período
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleExportReport("607", "TXT")}
                className="px-3.5 py-2 rounded-xl bg-slate-900 text-white font-bold text-xs cursor-pointer"
              >
                Descargar 607 Oficial (.TXT)
              </button>
              <button
                type="button"
                onClick={() => handleExportReport("607", "EXCEL")}
                className="px-3.5 py-2 rounded-xl bg-teal-50 text-teal-900 border border-teal-200 font-bold text-xs cursor-pointer"
              >
                Exportar Excel (.XLSX)
              </button>
            </div>
          </div>

          <div className="w-full overflow-x-auto border border-slate-200 rounded-2xl">
            <table className="min-w-[960px] w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 text-[11px] font-black text-slate-600 uppercase">
                  <th className="px-3.5 py-3 sticky left-0 bg-slate-100 z-10">NCF / e-CF</th>
                  <th className="px-3 py-3">RNC / Cédula Cliente</th>
                  <th className="px-3 py-3">Razón Social / Cliente</th>
                  <th className="px-3 py-3">NCF Modificado</th>
                  <th className="px-3 py-3">Fecha</th>
                  <th className="px-3 py-3 text-right">Monto Sin ITBIS</th>
                  <th className="px-3 py-3 text-right">ITBIS Facturado</th>
                  <th className="px-3 py-3 text-right">Total Cobrado</th>
                  <th className="px-3 py-3">Forma Pago</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {ventasPeriodo607.filter((v) => v.ncf).length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-10 text-center text-slate-400">
                      No hay ventas con NCF/e-CF registradas para el período {periodoFiscal}.
                    </td>
                  </tr>
                ) : (
                  ventasPeriodo607
                    .filter((v) => v.ncf)
                    .map((v) => {
                      const base =
                        v.subtotalMonto !== undefined
                          ? v.subtotalMonto
                          : v.totalMonto - (v.itbisMonto || 0);
                      return (
                        <tr key={v.id} className="hover:bg-slate-50">
                          <td className="px-3.5 py-2.5 sticky left-0 bg-white font-mono tabular-nums font-black text-indigo-900">
                            {v.ncf}
                          </td>
                          <td className="px-3 py-2.5 font-mono tabular-nums text-slate-700">
                            {v.rncCliente || "—"}
                          </td>
                          <td className="px-3 py-2.5 font-bold text-slate-800">
                            {v.clienteNombre || "CONSUMIDOR FINAL"}
                          </td>
                          <td className="px-3 py-2.5 font-mono tabular-nums text-amber-800">
                            {v.ncfModificado || "—"}
                          </td>
                          <td className="px-3 py-2.5 font-mono tabular-nums text-slate-600">
                            {v.fecha}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                            RD$ {base.toFixed(2)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums font-bold text-amber-800">
                            RD$ {Number(v.itbisMonto || 0).toFixed(2)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums font-black text-teal-900">
                            RD$ {Number(v.totalMonto || 0).toFixed(2)}
                          </td>
                          <td className="px-3 py-2.5 text-slate-600">
                            {v.formaPagoDGII || "01"}
                          </td>
                        </tr>
                      );
                    })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          7. FORMATO 608: COMPROBANTES ANULADOS
         ===================================================================== */}
      {activeSubTab === "reporte_608" && (
        <div className="bg-white rounded-3xl p-4 sm:p-6 border border-slate-200 shadow-2xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-black text-slate-900">
                Formato 608 · Comprobantes Fiscales Anulados ({periodoFiscal})
              </h3>
              <p className="text-xs text-slate-500">
                Registro oficial de NCF y e-CF anulados con código de motivo DGII (01–10) y administrador responsable
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleExportReport("608", "TXT")}
                className="px-3.5 py-2 rounded-xl bg-slate-900 text-white font-bold text-xs cursor-pointer"
              >
                Descargar 608 Oficial (.TXT)
              </button>
              <button
                type="button"
                onClick={() => handleExportReport("608", "EXCEL")}
                className="px-3.5 py-2 rounded-xl bg-teal-50 text-teal-900 border border-teal-200 font-bold text-xs cursor-pointer"
              >
                Exportar Excel (.XLSX)
              </button>
            </div>
          </div>

          <div className="w-full overflow-x-auto border border-slate-200 rounded-2xl">
            <table className="min-w-[820px] w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 text-[11px] font-black text-slate-600 uppercase">
                  <th className="px-3.5 py-3 sticky left-0 bg-slate-100 z-10">NCF / e-CF Anulado</th>
                  <th className="px-3 py-3">Fecha Comprobante</th>
                  <th className="px-3 py-3">Tipo de Anulación DGII</th>
                  <th className="px-3 py-3">Justificación</th>
                  <th className="px-3 py-3">Autorizado Por (ADMIN)</th>
                  <th className="px-3 py-3">Fecha Anulación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {anulacionesPeriodo608.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-400">
                      No existen comprobantes anulados en el período {periodoFiscal}.
                    </td>
                  </tr>
                ) : (
                  anulacionesPeriodo608.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50">
                      <td className="px-3.5 py-2.5 sticky left-0 bg-white font-mono tabular-nums font-black text-rose-700">
                        {a.ncfAnulado}
                      </td>
                      <td className="px-3 py-2.5 font-mono tabular-nums text-slate-600">
                        {a.fechaComprobante}
                      </td>
                      <td className="px-3 py-2.5 font-bold text-slate-800">
                        {MOTIVOS_ANULACION_608.find((m) => m.codigo === a.tipoAnulacion)?.nombre ||
                          a.tipoAnulacion}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">{a.descripcionMotivo}</td>
                      <td className="px-3 py-2.5 font-bold text-slate-800">
                        {a.usuarioAutorizador}
                      </td>
                      <td className="px-3 py-2.5 font-mono tabular-nums text-slate-500">
                        {a.fechaAnulacion.slice(0, 16).replace("T", " ")}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          8. BÓVEDA DE AUDITORÍA FISCAL INMUTABLE
         ===================================================================== */}
      {activeSubTab === "auditoria" && (
        <div className="bg-white rounded-3xl p-4 sm:p-6 border border-slate-200 shadow-2xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-black text-slate-900">
                Bitácora de Auditoría Fiscal y Trazabilidad DGII ({auditoriaEventos.length})
              </h3>
              <p className="text-xs text-slate-500">
                Registro cronológico inmutable de emisiones, firmas XML, envíos WS DGII, anulaciones y cambios de secuencias
              </p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Filtrar por NCF, usuario, acción..."
                className="w-full h-10 bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-3 text-xs font-semibold text-slate-800"
              />
            </div>
          </div>

          <div className="w-full overflow-x-auto border border-slate-200 rounded-2xl">
            <table className="min-w-[880px] w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 text-[11px] font-black text-slate-600 uppercase">
                  <th className="px-3.5 py-3">Fecha / Hora</th>
                  <th className="px-3 py-3">Acción Fiscal</th>
                  <th className="px-3 py-3">NCF / e-CF</th>
                  <th className="px-3 py-3">Descripción del Evento</th>
                  <th className="px-3 py-3">Usuario / Rol</th>
                  <th className="px-3 py-3">Ambiente</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {auditoriaEventos
                  .filter((ev) => {
                    const q = searchTerm.trim().toLowerCase();
                    if (!q) return true;
                    return (
                      ev.descripcion.toLowerCase().includes(q) ||
                      ev.usuario.toLowerCase().includes(q) ||
                      ev.tipoAccion.toLowerCase().includes(q) ||
                      (ev.comprobanteNcf && ev.comprobanteNcf.toLowerCase().includes(q))
                    );
                  })
                  .map((ev) => (
                    <tr key={ev.id} className="hover:bg-slate-50">
                      <td className="px-3.5 py-2.5 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        {ev.fecha} {ev.hora}
                      </td>
                      <td className="px-3 py-2.5 font-mono font-bold text-slate-900">
                        {ev.tipoAccion}
                      </td>
                      <td className="px-3 py-2.5 font-mono tabular-nums font-black text-indigo-800">
                        {ev.comprobanteNcf || "—"}
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">{ev.descripcion}</td>
                      <td className="px-3 py-2.5 font-semibold text-slate-800">
                        {ev.usuario} <span className="text-slate-400">({ev.rolUsuario})</span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-slate-500">{ev.ambienteDGII}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Inspector de XML e-CF y Validación XSD */}
      {selectedEcfXmlModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
          <div
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs"
            onClick={() => setSelectedEcfXmlModal(null)}
          />
          <div className="relative bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-3xl w-full max-h-[90dvh] flex flex-col overflow-hidden anim-card-in">
            <div className="p-4 sm:p-5 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <h3 className="text-sm sm:text-base font-black">
                  Inspector XML e-CF Oficial DGII · {selectedEcfXmlModal.ncf}
                </h3>
                <p className="text-xs text-slate-300 font-mono">
                  Código Seguridad: {selectedEcfXmlModal.codigoSeguridadECF || "N/A"} · Estado:{" "}
                  {selectedEcfXmlModal.estadoFiscal}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEcfXmlModal(null)}
                className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs flex-1">
              {(() => {
                const xmlContent =
                  selectedEcfXmlModal.xmlFirmado || selectedEcfXmlModal.xmlGenerado || "";
                const xsdCheck = validateECFXmlAgainstXSD(
                  xmlContent,
                  selectedEcfXmlModal,
                  config
                );
                return (
                  <div
                    className={`p-3.5 rounded-2xl border ${
                      xsdCheck.valid
                        ? "bg-emerald-50 border-emerald-200 text-emerald-950"
                        : "bg-rose-50 border-rose-200 text-rose-950"
                    }`}
                  >
                    <p className="font-black">
                      {xsdCheck.valid
                        ? "Validación Estructural XSD Oficial DGII: APROBADA (Sin errores de esquema)"
                        : `Observaciones de Validación XSD (${xsdCheck.errors.length}):`}
                    </p>
                    {xsdCheck.errors.length > 0 && (
                      <ul className="list-disc pl-5 mt-1 space-y-0.5">
                        {xsdCheck.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })()}

              {selectedEcfXmlModal.respuestaDGII && (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5">
                  <span className="font-black text-slate-800 block mb-1">
                    Respuesta Técnica del Servicio Web / Conector DGII:
                  </span>
                  <pre className="font-mono text-[11px] text-slate-700 whitespace-pre-wrap break-all">
                    {selectedEcfXmlModal.respuestaDGII}
                  </pre>
                </div>
              )}

              <div>
                <span className="font-black text-slate-800 block mb-1.5">
                  Documento XML e-CF (Estándar DGII v1.0 + XMLDSig):
                </span>
                <pre className="bg-slate-950 text-emerald-300 p-4 rounded-2xl font-mono text-[11px] overflow-x-auto max-h-80 leading-relaxed">
                  {selectedEcfXmlModal.xmlFirmado ||
                    selectedEcfXmlModal.xmlGenerado ||
                    "XML no disponible"}
                </pre>
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() =>
                  downloadTextFile(
                    selectedEcfXmlModal.xmlFirmado || selectedEcfXmlModal.xmlGenerado || "",
                    `${selectedEcfXmlModal.ncf || selectedEcfXmlModal.numeroFactura}.xml`,
                    "application/xml;charset=utf-8"
                  )
                }
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs cursor-pointer"
              >
                Descargar Archivo .XML
              </button>
              <button
                type="button"
                onClick={() => setSelectedEcfXmlModal(null)}
                className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
