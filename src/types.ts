export interface Lote {
  id: string;
  numeroLote: string;
  cantidad: number;
  cantidadF: number; // Cantidad física
  fechaVencimiento: string; // YYYY-MM-DD
  precio: number;
  loteFisico?: string; // Ubicación física
  fechaFisica?: string; // Fecha de vencimiento física
  articuloAjustado?: boolean; // Indica si se completó el ajuste
}

export interface Catalogo {
  id: string;
  nombre: string;
  descripcion?: string;
  activo: boolean;
  createdAt: number;
}

export interface Producto {
  codigo: string;
  nombre: string;
  descripcion?: string;
  imagen?: string;
  imagenURL?: string;
  imagenes?: string[];
  verificado?: boolean;
  lotes: Lote[];
  updatedAt: number;
  catalogId?: string;
  categoria?: string;
  consumoMensualEstimado?: number;
  tasaItbis?: 18 | 16 | 0; // Tasa ITBIS aplicable según DGII (18% general, 16% reducida, 0% exento medicamentos)
  indicadorFacturacion?: 1 | 2 | 3 | 4; // 1: Gravado 18%, 2: Gravado 16%, 3: Gravado 0%, 4: Exento (E)
  tipoBienServicio606?: string; // 01 a 11 (por defecto "09" Compras y Gastos que forman parte del Costo de Venta)
}

export interface Movimiento {
  id: string;
  productoCodigo: string;
  productoNombre: string;
  descripcion?: string;
  lote: string;
  loteFisico?: string;
  cantidad: number;
  cantidadF?: number;
  fechaVencimiento?: string;
  fechaFisica?: string;
  precio: number;
  tipoMovimiento: "Entrada" | "Salida" | "Ajuste" | "Producto eliminado";
  usuario: string; // Nombre (usuario)
  fecha: string; // ISO string
  timestamp: number;
  catalogId?: string;
  numeroFactura?: string;
  fechaEntrada?: string; // YYYY-MM-DD
  proveedor?: string;
  // Trazabilidad Fiscal DGII (606 / 607 / Notas de Crédito)
  rncProveedor?: string;
  ncfCompra?: string;
  itbisCompra?: number;
  tipoBienServicio606?: string;
  formaPago606?: string;
  compra606Id?: string;
  comprobanteFiscalId?: string;
  ncfEmitido?: string;
}

export interface Usuario {
  id: string;
  nombre: string;
  usuario: string;
  contrasenaHash: string;
  rol: "Administrador" | "Operador";
  estado: "Activo" | "Inactivo";
  updatedAt: number;
  departamento: string;
  modulos?: string[];
  catalogos?: string[]; // IDs de catálogos habilitados
  farmaciaId?: string;
  authUid?: string;
}

export interface CampoVariableCliente {
  etiqueta: string;
  valor: string;
}

export interface InstitucionInfo {
  nombre: string; // Razón social / Nombre de la Institución / Empresa
  nombreComercial?: string; // Nombre comercial registrado en DGII / ONAPI
  subtitulo?: string;
  rnc?: string; // RNC / NIT / ID Fiscal
  telefono?: string;
  correo?: string;
  paginaWeb?: string;
  direccion?: string;
  municipio?: string;
  provincia?: string;
  piePagina?: string; // Información adicional (Pie de página de facturas)
  logoUrl?: string; // Base64 o URL del logotipo institucional
  camposExtra?: CampoVariableCliente[];
  updatedAt?: number;
}

export interface FarmaciaTenant extends InstitucionInfo {
  id: string; // código único ej: "principal", "farmacia-central"
  activa: boolean;
  adminUsuario: string;
  createdAt: number;
}

export interface ConceptoFactura {
  id: string;
  nombre: string;
  descripcion?: string;
  activo: boolean;
  createdAt: number;
}

export const DEFAULT_CONCEPTOS_FACTURA: ConceptoFactura[] = [
  {
    id: "conc-venta",
    nombre: "Venta",
    descripcion: "Facturación general de medicamentos, insumos y artículos",
    activo: true,
    createdAt: 1700000000000
  },
  {
    id: "conc-compra",
    nombre: "Compra",
    descripcion: "Operación por concepto de compra o adquisición",
    activo: true,
    createdAt: 1700000001000
  },
  {
    id: "conc-transferencia",
    nombre: "Transferencia",
    descripcion: "Traslado o transferencia de suministros entre áreas o sedes",
    activo: true,
    createdAt: 1700000002000
  },
  {
    id: "conc-donacion",
    nombre: "Donación",
    descripcion: "Entrega o despacho en calidad de donación institucional",
    activo: true,
    createdAt: 1700000003000
  },
  {
    id: "conc-consumo",
    nombre: "Consumo Interno",
    descripcion: "Despacho para uso interno del centro o departamento",
    activo: true,
    createdAt: 1700000004000
  }
];

// ============================================================================
// TIPOS Y MODELOS DE CUMPLIMIENTO FISCAL DGII (REPÚBLICA DOMINICANA)
// ============================================================================

export type TipoComprobanteDGII =
  | "B01" // Factura de Crédito Fiscal
  | "B02" // Factura de Consumo
  | "B03" // Nota de Débito
  | "B04" // Nota de Crédito
  | "B11" // Comprobante de Compras
  | "B12" // Registro Único de Ingresos
  | "B14" // Comprobante para Regímenes Especiales
  | "B15" // Comprobante Gubernamental
  | "B16" // Comprobante para Exportaciones
  | "E31" // Factura de Crédito Fiscal Electrónica
  | "E32" // Factura de Consumo Electrónica
  | "E33" // Nota de Débito Electrónica
  | "E34" // Nota de Crédito Electrónica
  | "E41" // Compras Electrónico
  | "E43" // Gastos Menores Electrónico
  | "E44" // Regímenes Especiales Electrónico
  | "E45" // Gubernamental Electrónico
  | "E46" // Exportaciones Electrónico
  | "E47"; // Pagos al Exterior Electrónico

export type AmbienteDGII = "TesteCF" | "CerteCF" | "eCF";

export type RegimenTributarioDGII =
  | "Ordinario"
  | "RST_Compras"
  | "RST_Ingresos"
  | "Regimen_Especial_Zonas_Francas"
  | "Regimen_Especial_Ley_28_01"
  | "Exento_Sin_Fines_Lucro";

export type FormaPagoDGII =
  | "01" // Efectivo
  | "02" // Cheques / Transferencias / Depósito
  | "03" // Tarjeta Crédito / Débito
  | "04" // Venta a Crédito
  | "05" // Bonos o Certificados de Regalo
  | "06" // Permuta
  | "07"; // Otras Formas de Venta

export type EstadoComprobanteDGII =
  | "EMITIDO_NCF" // Comprobante Serie B tradicional emitido
  | "GENERADO_LOCAL" // XML e-CF generado localmente, pendiente de firma/envío
  | "FIRMADO_XML" // XML e-CF firmado digitalmente con .p12, pendiente de transmisión a DGII
  | "ENVIADO_DGII" // Transmitido a DGII, esperando validación
  | "EN_PROCESO_DGII" // TrackId recibido, en procesamiento en DGII
  | "ACEPTADO_DGII" // Aceptado oficialmente por DGII
  | "ACEPTADO_CONDICIONAL_DGII" // Aceptado con observaciones por DGII
  | "RECHAZADO_DGII" // Rechazado por DGII
  | "EN_CONTINGENCIA" // En contingencia conforme normativa e-CF
  | "ANULADO"; // Anulado y reportado en Formato 608

export interface DesglosePagoDGII {
  efectivo: number;
  chequeTransferenciaDeposito: number;
  tarjetaDebitoCredito: number;
  ventaACredito: number;
  bonosCertificados: number;
  permuta: number;
  otrasFormasVenta: number;
}

export interface SecuenciaFiscalDGII {
  id: string;
  tipo: TipoComprobanteDGII;
  serie: "B" | "E";
  descripcion: string;
  prefijo: string; // Ej: "B01" o "E31"
  secuenciaInicial: number;
  secuenciaActual: number; // Próximo correlativo a emitir
  secuenciaFinal: number;
  fechaAutorizacion: string; // YYYY-MM-DD
  fechaVencimiento: string; // YYYY-MM-DD (Ej: 2027-12-31)
  numeroAutorizacion?: string; // Número de solicitud/autorización OFV DGII
  sucursalId: string; // Ej: "001"
  puntoEmision: string; // Ej: "001"
  alertaMinima: number; // Cantidad restante para disparar alerta
  activa: boolean;
  updatedAt: number;
}

export interface SucursalEstablecimientoDGII {
  id: string;
  codigoEstablecimiento: string; // 3 dígitos ej: "001"
  codigoPuntoEmision: string; // 3 dígitos ej: "001"
  nombreSucursal: string;
  direccion: string;
  municipio?: string;
  provincia?: string;
  telefono?: string;
  responsable?: string;
  principal: boolean;
  activa: boolean;
}

export interface CertificadoDigitalInfo {
  configurado: boolean;
  nombreArchivo?: string;
  titularSubject?: string;
  emisorIssuer?: string;
  numeroSerie?: string;
  validoDesde?: string;
  validoHasta?: string;
  algoritmoFirma?: string;
  huellaSha256?: string;
  cargadoEnServidor?: boolean;
  updatedAt?: number;
}

export interface ConfiguracionFiscalDGII {
  rncEmisor: string; // 9 u 11 dígitos sin guiones
  razonSocial: string;
  nombreComercial: string;
  direccionFiscal: string;
  municipio: string;
  provincia: string;
  telefonoEmisor: string;
  correoEmisor: string;
  sitioWeb?: string;
  regimenTributario: RegimenTributarioDGII;
  codigoActividadEconomicaCIIU: string; // Ej: "4772" Venta al por menor de productos farmacéuticos y medicinales
  descripcionActividadEconomica: string;
  modalidadEmisionActiva: "DUAL_B_E" | "SOLO_NCF_B" | "SOLO_ECF_E";
  ambienteDGII: AmbienteDGII;
  tasaItbisGeneral: number; // 18
  tasaItbisReducida: number; // 16
  aplicaExencionMedicamentos: boolean; // Exención por defecto en medicamentos (0%)
  aplicaPropinaLegal: boolean; // 10% si aplica
  modoContingenciaActivo: boolean;
  motivoContingencia?: string;
  fechaInicioContingencia?: string;
  sucursales: SucursalEstablecimientoDGII[];
  secuencias: SecuenciaFiscalDGII[];
  certificadoInfo: CertificadoDigitalInfo;
  endpointsOficiales: {
    TesteCF: {
      semilla: string;
      validarSemilla: string;
      recepcionEcf: string;
      recepcionResumenConsumo: string;
      consultaEstado: string;
      consultaResultado: string;
      consultaTrackIds: string;
      aprobacionComercial: string;
      directorioServicios: string;
      consultaTimbreQr: string;
    };
    CerteCF: {
      semilla: string;
      validarSemilla: string;
      recepcionEcf: string;
      recepcionResumenConsumo: string;
      consultaEstado: string;
      consultaResultado: string;
      consultaTrackIds: string;
      aprobacionComercial: string;
      directorioServicios: string;
      consultaTimbreQr: string;
    };
    eCF: {
      semilla: string;
      validarSemilla: string;
      recepcionEcf: string;
      recepcionResumenConsumo: string;
      consultaEstado: string;
      consultaResultado: string;
      consultaTrackIds: string;
      aprobacionComercial: string;
      directorioServicios: string;
      consultaTimbreQr: string;
    };
  };
  updatedAt: number;
  updatedBy?: string;
}

export interface RegistroCompra606 {
  id: string;
  periodoMes: string; // Formato AAAAMM (ej: "202611")
  rncCedulaProveedor: string; // Columna 1: 9 u 11 dígitos sin guiones
  tipoIdentificacion: "1" | "2"; // Columna 2: 1=RNC, 2=Cédula
  nombreProveedor: string;
  tipoBienesServicios: string; // Columna 3: "01" a "11"
  ncf: string; // Columna 4: 11 caracteres (Serie B) o 13 caracteres (Serie E)
  ncfModificado?: string; // Columna 5: NCF o e-CF afectado por Nota de Débito/Crédito
  fechaComprobante: string; // YYYY-MM-DD (se exporta AAAAMMDD en Columna 6 + DD en Columna 7)
  fechaPago?: string; // YYYY-MM-DD (se exporta AAAAMMDD en Columna 8 + DD en Columna 9)
  montoFacturadoServicios: number; // Columna 10
  montoFacturadoBienes: number; // Columna 11
  totalMontoFacturado: number; // Columna 12 (Servicios + Bienes)
  itbisFacturado: number; // Columna 13
  itbisRetenido: number; // Columna 14
  itbisSujetoProporcionalidad: number; // Columna 15
  itbisLlevadoAlCosto: number; // Columna 16
  itbisPorAdelantar: number; // Columna 17 (ITBIS Facturado - ITBIS al Costo)
  itbisPercibidoEnCompras: number; // Columna 18
  tipoRetencionISR?: string; // Columna 19: "" o "01" a "08"
  montoRetencionRenta: number; // Columna 20
  isrPercibidoEnCompras: number; // Columna 21
  impuestoSelectivoConsumo: number; // Columna 22
  otrosImpuestosTasas: number; // Columna 23
  montoPropinaLegal: number; // Columna 24
  formaPago: FormaPagoDGII; // Columna 25: "01" a "07"
  numeroFacturaInterna?: string;
  movimientoInventarioIds?: string[]; // Vínculo único con entradas de lotes
  catalogId?: string;
  observaciones?: string;
  usuarioRegistro: string;
  createdAt: number;
  anulado?: boolean;
}

export interface RegistroAnulacion608 {
  id: string;
  periodoMes: string; // Formato AAAAMM
  ncfAnulado: string; // NCF (11 chars) o e-CF (13 chars)
  tipoComprobante: TipoComprobanteDGII;
  fechaComprobante: string; // YYYY-MM-DD (se exporta AAAAMMDD)
  tipoAnulacion:
    | "01" // Deterioro de Factura Pre-impresa
    | "02" // Errores de Impresión (Factura Pre-impresa)
    | "03" // Impresión Defectuosa
    | "04" // Corrección de la Información
    | "05" // Cambio de Productos
    | "06" // Devolución de Productos
    | "07" // Omisión de Productos
    | "08" // Errores en Secuencia de NCF
    | "09" // Por Cese de Operaciones
    | "10"; // Pérdida o Hurto de Talonarios
  descripcionMotivo: string;
  facturaIdRelacionada?: string;
  numeroFacturaInterna?: string;
  montoOriginal?: number;
  usuarioAutorizador: string;
  rolAutorizador: string;
  fechaAnulacion: string; // ISO string
  timestamp: number;
}

export interface EventoAuditoriaFiscal {
  id: string;
  fecha: string; // YYYY-MM-DD
  hora: string; // HH:MM:SS
  timestamp: number;
  tipoAccion:
    | "CONFIGURACION_FISCAL"
    | "CARGA_CERTIFICADO_P12"
    | "SECUENCIA_NCF_ECF"
    | "EMISION_COMPROBANTE"
    | "FIRMA_XML_ECF"
    | "ENVIO_WS_DGII"
    | "CONSULTA_ESTADO_DGII"
    | "NOTA_CREDITO_DEBITO"
    | "ANULACION_608"
    | "REGISTRO_COMPRA_606"
    | "EXPORTACION_REPORTE_DGII"
    | "CONTINGENCIA_FISCAL";
  comprobanteNcf?: string;
  tipoComprobante?: TipoComprobanteDGII;
  documentoReferenciaId?: string;
  descripcion: string;
  usuario: string;
  rolUsuario: string;
  ambienteDGII: AmbienteDGII;
  resultado: "EXITO" | "ADVERTENCIA" | "ERROR";
  detalleTecnico?: string;
}

export interface VentaItem {
  id: string;
  productoCodigo: string;
  productoNombre: string;
  descripcion?: string;
  loteId: string;
  numeroLote: string;
  fechaVencimiento: string;
  cantidad: number;
  precioUnitario: number;
  descuentoPorcentaje?: number;
  descuentoMonto?: number;
  subtotal: number;
  aplicaItbis?: boolean;
  tasaItbis?: 18 | 16 | 0;
  indicadorFacturacion?: 1 | 2 | 3 | 4; // 1=18%, 2=16%, 3=0%, 4=Exento
  itbisMonto?: number;
  totalItem?: number;
}

export interface FacturaVenta {
  id: string;
  numeroFactura: string;
  fecha: string; // YYYY-MM-DD
  hora: string; // HH:MM
  timestamp: number;
  concepto: string; // Compra, Transferencia, Donación, Venta, etc.
  clienteNombre?: string; // Razón Social / Nombre del Comprador
  clienteContacto?: string; // Teléfono / Correo
  observaciones?: string;
  catalogId: string;
  catalogNombre?: string;
  usuarioResponsable: string;
  items: VentaItem[];
  totalUnidades: number;
  subtotalMonto?: number;
  aplicaItbis?: boolean;
  itbisMonto?: number;
  totalMonto: number;
  // --- Campos Fiscales DGII (NCF Serie B y e-CF Serie E Ley 32-23) ---
  modalidadFiscal?: "INTERNA" | "NCF_SERIE_B" | "ECF_SERIE_E";
  tipoComprobante?: TipoComprobanteDGII;
  ncf?: string; // Ej: B0100000001 o E310000000001
  ncfModificado?: string; // Requerido en B03, B04, E33, E34
  fechaNcfModificado?: string; // YYYY-MM-DD
  codigoModificacion?: "01" | "02" | "03" | "04"; // 01: Anula NCF modificado, 02: Corrige texto, 03: Corrige montos, 04: Reemplazo contingencia
  motivoModificacion?: string;
  rncCliente?: string; // RNC (9 dígitos), Cédula (11 dígitos) o Pasaporte
  tipoIdCliente?: "1" | "2" | "3"; // 1=RNC, 2=Cédula, 3=Pasaporte/Extranjero
  direccionCliente?: string;
  municipioCliente?: string;
  provinciaCliente?: string;
  sucursalEmision?: string; // Ej: "001"
  puntoEmision?: string; // Ej: "001"
  fechaVencimientoSecuencia?: string; // YYYY-MM-DD
  tipoIngreso607?: "01" | "02" | "03" | "04" | "05" | "06"; // 01=Ingresos por Operaciones (No Financieros)
  formaPagoDGII?: FormaPagoDGII; // 01 a 07
  condicionPagoECF?: 1 | 2 | 3; // 1=Contado, 2=Crédito, 3=Gratuito
  fechaLimitePagoCredito?: string;
  desglosePagosDGII?: DesglosePagoDGII;
  subtotalGravado18?: number;
  subtotalGravado16?: number;
  subtotalExento?: number;
  descuentoTotal?: number;
  itbis18Monto?: number;
  itbis16Monto?: number;
  propinaLegalMonto?: number;
  impuestoSelectivoMonto?: number;
  otrosImpuestosMonto?: number;
  itbisRetenidoTerceros?: number;
  isrRetenidoTerceros?: number;
  fechaRetencionTerceros?: string;
  estadoFiscal?: EstadoComprobanteDGII;
  ambienteDGII?: AmbienteDGII;
  trackIdDGII?: string;
  codigoSeguridadECF?: string; // 6 primeros dígitos del hash SignatureValue
  fechaHoraFirmaECF?: string; // DD-MM-YYYY HH:MM:SS
  urlQrDGII?: string;
  xmlGenerado?: string;
  xmlFirmado?: string;
  respuestaDGII?: string;
  erroresValidacionXSD?: string[];
  anulada?: boolean;
  motivoAnulacion608?: RegistroAnulacion608["tipoAnulacion"];
  descripcionAnulacion?: string;
  fechaAnulacion?: string;
  usuarioAnulacion?: string;
  reintegroInventarioAplicado?: boolean;
}

export const ALL_SYSTEM_MODULES = [
  "dashboard",
  "inventory",
  "venta",
  "dgii",
  "carga_masiva",
  "solicitudes",
  "historial",
  "usuarios",
  "configuracion"
] as const;

export function getEnabledModules(user: Usuario | null | undefined): string[] {
  if (!user) return [];
  if (user.modulos && Array.isArray(user.modulos)) {
    // Respetar estrictamente los módulos asignados al usuario, garantizando que el Administrador tenga acceso al módulo de Cumplimiento DGII
    const assigned = user.modulos.filter(Boolean);
    if (user.rol === "Administrador" && !assigned.includes("dgii")) {
      return [...assigned, "dgii"];
    }
    return assigned;
  }
  if (user.rol === "Administrador") {
    if (user.usuario?.toLowerCase() === "anyer") {
      return ["inventory", "venta", "dgii", "carga_masiva", "solicitudes", "historial", "usuarios", "configuracion"];
    }
    return ["inventory", "dgii", "carga_masiva", "solicitudes", "historial", "usuarios", "configuracion"];
  }
  return ["solicitudes", "historial"];
}

export function isModuleAuthorized(user: Usuario | null | undefined, moduleId: string): boolean {
  if (!user) return false;
  if (moduleId === "dashboard") return true;
  const enabled = getEnabledModules(user);
  return enabled.includes(moduleId);
}

export function resolveModuleFromSlug(rawSlug: string | null | undefined): string | null {
  if (!rawSlug) return null;
  const clean = rawSlug
    .trim()
    .toLowerCase()
    .replace(/^[#/?]+/, "")
    .split(/[/?&#]/)[0];

  const map: Record<string, string> = {
    dashboard: "dashboard",
    inicio: "dashboard",
    resumen: "dashboard",
    panel: "dashboard",
    inventory: "inventory",
    inventario: "inventory",
    suministros: "inventory",
    stock: "inventory",
    venta: "venta",
    ventas: "venta",
    facturacion: "venta",
    factura: "venta",
    dgii: "dgii",
    fiscal: "dgii",
    impuestos: "dgii",
    comprobantes: "dgii",
    ecf: "dgii",
    ncf: "dgii",
    "606": "dgii",
    "607": "dgii",
    "608": "dgii",
    carga_masiva: "carga_masiva",
    "carga-masiva": "carga_masiva",
    importar: "carga_masiva",
    solicitudes: "solicitudes",
    ordenes: "solicitudes",
    pedidos: "solicitudes",
    historial: "historial",
    movimientos: "historial",
    usuarios: "usuarios",
    personal: "usuarios",
    configuracion: "configuracion",
    configurar: "configuracion",
    ajustes: "configuracion"
  };

  return map[clean] || null;
}

function normalizeCatalogToken(val: string | undefined | null): string {
  return String(val || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getCanonicalCatalogKey(idOrName: string | undefined | null): string {
  const clean = normalizeCatalogToken(idOrName);
  if (!clean || clean === "default-cat" || clean === "medicamentos e insumos" || clean.startsWith("cat-medicamentos")) {
    return "default-cat";
  }
  if (clean === "laboratorio" || clean.startsWith("cat-laboratorio") || clean.includes("laboratorio")) {
    return "laboratorio";
  }
  if (clean === "odontologia" || clean.startsWith("cat-odontologia") || clean.includes("odontologia")) {
    return "odontologia";
  }
  return clean;
}

export function matchesCatalog(
  itemCatalogId: string | undefined | null,
  targetCatalogId: string | undefined | null,
  catalogos?: Catalogo[] | null
): boolean {
  const rawItem = (itemCatalogId || "default-cat").trim();
  const rawTarget = (targetCatalogId || "default-cat").trim();
  if (!rawTarget || rawTarget === "todos") return true;
  if (rawItem === rawTarget || normalizeCatalogToken(rawItem) === normalizeCatalogToken(rawTarget)) {
    return true;
  }

  const itemCanonical = getCanonicalCatalogKey(rawItem);
  const targetCanonical = getCanonicalCatalogKey(rawTarget);
  if (
    (itemCanonical === "laboratorio" || itemCanonical === "odontologia" || itemCanonical === "default-cat") &&
    itemCanonical === targetCanonical
  ) {
    return true;
  }

  if (catalogos && catalogos.length > 0) {
    const targetCat = catalogos.find(
      (c) =>
        c.id === rawTarget ||
        normalizeCatalogToken(c.id) === normalizeCatalogToken(rawTarget) ||
        normalizeCatalogToken(c.nombre) === normalizeCatalogToken(rawTarget)
    );
    if (targetCat) {
      const catIdNorm = normalizeCatalogToken(targetCat.id);
      const catNameNorm = normalizeCatalogToken(targetCat.nombre);
      const itemNorm = normalizeCatalogToken(rawItem);
      if (itemNorm === catIdNorm || itemNorm === catNameNorm) {
        return true;
      }
      const catCanonical = getCanonicalCatalogKey(targetCat.id !== "default-cat" ? targetCat.nombre : targetCat.id);
      if (
        (catCanonical === "laboratorio" || catCanonical === "odontologia" || catCanonical === "default-cat") &&
        itemCanonical === catCanonical
      ) {
        return true;
      }
    }
  }

  return false;
}

export function getUserAvailableCatalogos(
  user: Usuario | null | undefined,
  catalogos: Catalogo[] | null | undefined
): Catalogo[] {
  const activeCatalogos = (catalogos || []).filter((c) => c && c.activo !== false);
  if (activeCatalogos.length === 0) {
    return [
      {
        id: "default-cat",
        nombre: "Medicamentos e Insumos",
        activo: true,
        createdAt: Date.now()
      }
    ];
  }
  if (!user) return activeCatalogos;

  // Administradores sin restricción explícita o SuperAdmin ven todos los catálogos activos
  if (user.rol === "Administrador" && (!user.catalogos || user.catalogos.length === 0)) {
    return activeCatalogos;
  }

  const userCats = Array.isArray(user.catalogos) ? user.catalogos.filter(Boolean) : [];
  const isRossy =
    user.usuario?.toLowerCase().includes("rossy") ||
    user.nombre?.toLowerCase().includes("rossy");
  const isLabDept = normalizeCatalogToken(user.departamento) === "laboratorio";

  if (userCats.length > 0) {
    const matched = activeCatalogos.filter((c) =>
      userCats.some(
        (uc) =>
          uc === c.id ||
          normalizeCatalogToken(uc) === normalizeCatalogToken(c.id) ||
          normalizeCatalogToken(uc) === normalizeCatalogToken(c.nombre) ||
          matchesCatalog(uc, c.id, activeCatalogos)
      )
    );

    // Garantizar que si un usuario pertenece al departamento de Laboratorio y tiene "laboratorio" en sus catálogos
    // o su departamento es Laboratorio, el catálogo de Laboratorio esté siempre incluido si existe activo
    if (isLabDept) {
      const labCat = activeCatalogos.find(
        (c) =>
          c.id === "laboratorio" ||
          normalizeCatalogToken(c.nombre).includes("laboratorio") ||
          normalizeCatalogToken(c.id).includes("laboratorio")
      );
      if (labCat && !matched.some((m) => m.id === labCat.id)) {
        matched.unshift(labCat);
      }
    }

    // Garantizar que si Rossy tenía solo 1 catálogo sincronizado por restricción previa de Laboratorio,
    // pueda seleccionar tanto su catálogo de Laboratorio como el segundo catálogo habilitado (ej. Medicamentos e Insumos)
    if (isRossy && matched.length < 2 && activeCatalogos.length >= 2) {
      const labAndDefault = activeCatalogos.filter(
        (c) =>
          matched.some((m) => m.id === c.id) ||
          c.id === "laboratorio" ||
          c.id === "default-cat" ||
          normalizeCatalogToken(c.nombre).includes("laboratorio") ||
          normalizeCatalogToken(c.nombre).includes("medicamentos")
      );
      if (labAndDefault.length >= 2) {
        return labAndDefault;
      }
      return activeCatalogos;
    }

    if (matched.length > 0) {
      return matched;
    }
  }

  // Si no tiene catálogos restringidos en user.catalogos, permitir todos los catálogos activos,
  // priorizando el catálogo de su departamento (ej. Laboratorio) al inicio de la lista
  if (isLabDept) {
    return [...activeCatalogos].sort((a, b) => {
      const aIsLab =
        a.id === "laboratorio" || normalizeCatalogToken(a.nombre).includes("laboratorio") ? 1 : 0;
      const bIsLab =
        b.id === "laboratorio" || normalizeCatalogToken(b.nombre).includes("laboratorio") ? 1 : 0;
      return bIsLab - aIsLab;
    });
  }

  return activeCatalogos;
}

export function isCatalogAllowedForUser(
  user: Usuario | null | undefined,
  catalogId: string | undefined | null,
  catalogos: Catalogo[] | null | undefined
): boolean {
  if (!user) return false;
  if (user.rol === "Administrador" && (!user.catalogos || user.catalogos.length === 0)) {
    return true;
  }
  const targetId = (catalogId || "default-cat").trim();
  if (catalogos && catalogos.length > 0) {
    const allowed = getUserAvailableCatalogos(user, catalogos);
    return allowed.some((c) => matchesCatalog(targetId, c.id, catalogos));
  }
  const userCats = Array.isArray(user.catalogos) ? user.catalogos.filter(Boolean) : [];
  if (userCats.length === 0) return true;
  if (
    normalizeCatalogToken(user.departamento) === "laboratorio" &&
    getCanonicalCatalogKey(targetId) === "laboratorio"
  ) {
    return true;
  }
  return userCats.some((uc) => matchesCatalog(targetId, uc));
}

export interface Departamento {
  id: string;
  nombre: string;
  activo: boolean;
  createdAt: number;
}

export interface CambioEstado {
  estado: "Pendiente" | "Aprobada" | "Rechazada" | "En Proceso" | "Entregada" | "En proceso" | "Completada" | "En preparación" | "Parcialmente entregada" | "Cancelada";
  usuarioResponsable: string;
  fecha: string; // YYYY-MM-DD
  hora: string; // HH:MM
}

export interface DespachoLote {
  loteId: string;
  loteNumero: string;
  cantidad: number;
}

export interface SolicitudItem {
  id: string;
  productoCodigo: string;
  productoNombre: string;
  cantidadSolicitada: number;
  cantidadAprobada?: number;
  cantidadEntregada: number;
  motivoDiferencia?: string;
  loteId?: string;
  loteNumero?: string;
  despachoLotes?: DespachoLote[];
  categoria?: string;
  stockActualAlMomento?: number;
  justificacion?: string;
}

export interface Solicitud {
  id: string;
  numeroSolicitud: string; // Autogenerado: SOL-001, SOL-002...
  fecha: string; // YYYY-MM-DD
  hora: string; // HH:MM
  departamento: string; // Odontología, Laboratorio, etc.
  usuarioCreador: string; // Nombre (usuario) que la creó
  descripcion: string;
  prioridad: "Baja" | "Media" | "Alta";
  estado: "Pendiente" | "Aprobada" | "Rechazada" | "En Proceso" | "Entregada" | "En proceso" | "Completada" | "En preparación" | "Parcialmente entregada" | "Cancelada";
  observaciones: string;
  periodo: string; // Periodo mensual, ej: "Julio 2026"
  timestamp: number;
  historialCambios: CambioEstado[];
  items?: SolicitudItem[];
  catalogId?: string;
  usuarioAutorizador?: string;
  rolAutorizador?: string;
  fechaAutorizacion?: string;
  horaAutorizacion?: string;
  timestampAutorizacion?: number;
  accionAutorizacion?: "Autorizada" | "Rechazada";
  requestFingerprint?: string;
}

export interface RegistroHistorial {
  id: string;
  tipo: "Creación" | "Cambio de Estado" | "Eliminación";
  solicitudId: string;
  numeroSolicitud: string;
  descripcionEvent: string;
  usuarioResponsable: string;
  fecha: string; // YYYY-MM-DD
  hora: string; // HH:MM
  timestamp: number;
  catalogId?: string;
}

export interface ColoresConfig {
  primary: string;
  sidebar: string;
  buttons: string;
  headers: string;
  cards: string;
  tables: string;
  elements: string;
}

export interface ConfiguracionDoc {
  id: string;
  colores?: ColoresConfig;
  periodoActual?: string;
}
