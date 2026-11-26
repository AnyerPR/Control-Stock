import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeDepartamentosSinDuplicados,
  getDefaultTiposConsumo,
  getDefaultResponsables,
  ensureLicIrisAybarPresent,
  getPersonalPorDepartamento,
  getResponsablesTitularesPorDepartamento,
  registrarNuevoResponsableRapido,
  validarRelacionResponsableDepartamento,
  procesarConsumoEnMemoria,
  calcularResumenPorDepartamento,
  agregarNotaCorreccionConsumo,
  mergeResponsablesLists
} from "./consumosUtils";
import { Producto, RegistroConsumo } from "../types";

function createMockInventory(): Producto[] {
  return [
    {
      codigo: "MED-001",
      nombre: "Paracetamol 500mg Tabletas",
      descripcion: "Analgésico y antipirético",
      updatedAt: 1700000000000,
      lotes: [
        {
          id: "lote-1a",
          numeroLote: "L2026-A",
          fechaVencimiento: "2027-06-30",
          cantidad: 100,
          cantidadF: 100,
          precio: 12.5
        },
        {
          id: "lote-1b",
          numeroLote: "L2026-B",
          fechaVencimiento: "2027-12-31",
          cantidad: 50,
          cantidadF: 50,
          precio: 12.5
        }
      ]
    },
    {
      codigo: "QUIR-010",
      nombre: "Guantes Quirúrgicos Estériles Talla M",
      descripcion: "Guantes de látex estériles",
      updatedAt: 1700000000000,
      lotes: [
        {
          id: "lote-2a",
          numeroLote: "GQ-990",
          fechaVencimiento: "2028-01-15",
          cantidad: 40,
          cantidadF: 40,
          precio: 45
        }
      ]
    }
  ];
}

test("1. Existencia del registro inicial de prueba 'Lic. Iris Aybar' asociado a un departamento y fusión sin duplicados", () => {
  const departamentos = mergeDepartamentosSinDuplicados([
    { id: "d1", nombre: "Enfermería", activo: true, createdAt: 1700000000000 },
    { id: "d2", nombre: "Laboratorio", activo: true, createdAt: 1700000000000 }
  ]);

  const nombres = departamentos.map((d) => d.nombre);
  assert.ok(nombres.includes("Farmacia"), "Debe incluir Farmacia");
  assert.ok(nombres.includes("Laboratorio"), "Debe incluir Laboratorio");
  assert.ok(nombres.includes("Enfermería"), "Debe incluir Enfermería");
  assert.ok(nombres.includes("Administración"), "Debe incluir Administración");
  assert.ok(nombres.includes("Emergencia"), "Debe incluir Emergencia");

  const enfermeriaCount = departamentos.filter((d) => d.nombre.toLowerCase() === "enfermería").length;
  assert.equal(enfermeriaCount, 1, "No debe duplicar departamentos existentes");

  const responsables = ensureLicIrisAybarPresent(getDefaultResponsables("sede-central"), "sede-central");
  const licIris = responsables.find((r) => r.nombre === "Lic. Iris Aybar");

  assert.ok(licIris, "Debe existir el registro inicial 'Lic. Iris Aybar'");
  assert.equal(licIris.departamentoNombre, "Enfermería", "Lic. Iris Aybar debe estar asociada al departamento Enfermería");
  assert.equal(licIris.activo, true, "Lic. Iris Aybar debe estar activa por defecto");
});

test("2. Creación de un nuevo responsable desde el botón 'Nuevo' y asociación correcta con su departamento", async () => {
  const iniciales = getDefaultResponsables("sede-central");

  const creacion = await registrarNuevoResponsableRapido({
    nombre: "Dr. Carlos Méndez",
    cargo: "Coordinador de Laboratorio",
    departamentoId: "dept-laboratorio",
    departamentoNombre: "Laboratorio",
    telefono: "809-555-0144",
    sedeId: "sede-central",
    existingResponsables: iniciales
  });

  assert.equal(creacion.exito, true);
  assert.ok(creacion.responsable);
  assert.equal(creacion.responsable.nombre, "Dr. Carlos Méndez");
  assert.equal(creacion.responsable.departamentoNombre, "Laboratorio");

  // Intentar duplicar el mismo responsable en el mismo departamento debe ser rechazado
  const duplicado = await registrarNuevoResponsableRapido({
    nombre: "Dr. Carlos Méndez",
    departamentoId: "dept-laboratorio",
    departamentoNombre: "Laboratorio",
    sedeId: "sede-central",
    existingResponsables: creacion.listaActualizada
  });
  assert.equal(duplicado.exito, false);
});

test("3. Validación de relación departamento-responsable y asignación especial por Administrador", () => {
  const responsables = getDefaultResponsables("sede-central");
  const licIris = responsables.find((r) => r.nombre === "Lic. Iris Aybar")!;

  // Coincidencia válida (Enfermería)
  const validMatch = validarRelacionResponsableDepartamento({
    responsable: licIris,
    departamentoNombre: "Enfermería",
    esAdmin: false
  });
  assert.equal(validMatch.valido, true);

  // Departamento distinto sin autorización especial -> inválido
  const mismatch = validarRelacionResponsableDepartamento({
    responsable: licIris,
    departamentoNombre: "Laboratorio",
    esAdmin: false
  });
  assert.equal(mismatch.valido, false);

  // Departamento distinto CON asignación especial de Administrador -> válido
  const adminOverride = validarRelacionResponsableDepartamento({
    responsable: licIris,
    departamentoNombre: "Laboratorio",
    esAdmin: true,
    asignacionEspecialAdmin: true
  });
  assert.equal(adminOverride.valido, true);
});

test("4. Registro de consumo Interno y descuento exacto del inventario", () => {
  const inventory = createMockInventory();
  const responsables = getDefaultResponsables("sede-central");
  const tipos = getDefaultTiposConsumo("sede-central");
  const licIris = responsables.find((r) => r.nombre === "Lic. Iris Aybar")!;
  const tipoInterno = tipos.find((t) => t.categoria === "Interno")!;

  const result = procesarConsumoEnMemoria({
    sedeId: "sede-central",
    sedeNombre: "Hospital Central",
    departamentoId: licIris.departamentoId,
    departamentoNombre: "Enfermería",
    responsable: licIris,
    tipoConsumo: tipoInterno,
    catalogId: "meds",
    catalogNombre: "Medicamentos",
    fecha: "2026-11-19",
    observaciones: "Entrega de turno matutino",
    usuarioRegistro: "admin_farmacia",
    productosActuales: inventory,
    consumosActuales: [],
    items: [
      {
        id: "item-1",
        productoCodigo: "MED-001",
        productoNombre: "Paracetamol 500mg Tabletas",
        catalogId: "meds",
        loteId: "lote-1a",
        numeroLote: "L2026-A",
        fechaVencimiento: "2027-06-30",
        stockDisponibleAlMomento: 100,
        stockFisicoAlMomento: 100,
        cantidadEntregada: 25,
        precioUnitario: 12.5,
        subtotal: 312.5
      }
    ]
  });

  assert.equal(result.exito, true);
  assert.ok(result.consumo);
  assert.equal(result.consumo.numeroOperacion, "CON-00001");
  assert.equal(result.consumo.categoriaConsumo, "Interno");
  assert.equal(result.consumo.responsableNombre, "Lic. Iris Aybar");

  const updatedProd = result.productosActualizados.find((p) => p.codigo === "MED-001")!;
  const updatedLote = updatedProd.lotes.find((l) => l.id === "lote-1a")!;
  assert.equal(updatedLote.cantidad, 75, "El stock del sistema debe descontar exactamente 25 unidades (100 - 25 = 75)");
  assert.equal(updatedLote.cantidadF, 75, "El stock físico debe descontar exactamente 25 unidades (100 - 25 = 75)");
  assert.equal(result.movimientosGenerados.length, 1, "Debe generar el movimiento de Salida correspondiente");
  assert.equal(result.movimientosGenerados[0].tipoMovimiento, "Salida");
});

test("5. Registro de consumo Externo y validación de destino externo", () => {
  const inventory = createMockInventory();
  const responsables = getDefaultResponsables("sede-central");
  const tipos = getDefaultTiposConsumo("sede-central");
  const licIris = responsables.find((r) => r.nombre === "Lic. Iris Aybar")!;
  const tipoExterno = tipos.find((t) => t.categoria === "Externo")!;

  // 5a. Consumo externo sin institución receptora debe fallar
  const failedExternal = procesarConsumoEnMemoria({
    sedeId: "sede-central",
    sedeNombre: "Hospital Central",
    departamentoId: licIris.departamentoId,
    departamentoNombre: "Enfermería",
    responsable: licIris,
    tipoConsumo: tipoExterno,
    destinoExternoInstitucion: "",
    destinoExternoPersona: "",
    catalogId: "quir",
    fecha: "2026-11-19",
    usuarioRegistro: "admin",
    productosActuales: inventory,
    consumosActuales: [],
    items: [
      {
        id: "item-ext-1",
        productoCodigo: "QUIR-010",
        productoNombre: "Guantes Quirúrgicos Estériles Talla M",
        catalogId: "quir",
        loteId: "lote-2a",
        numeroLote: "GQ-990",
        fechaVencimiento: "2028-01-15",
        stockDisponibleAlMomento: 40,
        stockFisicoAlMomento: 40,
        cantidadEntregada: 10
      }
    ]
  });

  assert.equal(failedExternal.exito, false, "Debe rechazar consumo Externo sin institución/destino externo");

  // 5b. Consumo externo con destino externo completo debe aprobarse
  const validExternal = procesarConsumoEnMemoria({
    sedeId: "sede-central",
    sedeNombre: "Hospital Central",
    departamentoId: licIris.departamentoId,
    departamentoNombre: "Enfermería",
    responsable: licIris,
    tipoConsumo: tipoExterno,
    destinoExternoInstitucion: "Centro Diagnóstico Municipal",
    destinoExternoPersona: "Dra. Laura Gómez",
    destinoExternoDocumento: "OF-2026-88",
    catalogId: "quir",
    fecha: "2026-11-19",
    usuarioRegistro: "admin",
    productosActuales: inventory,
    consumosActuales: [],
    items: [
      {
        id: "item-ext-2",
        productoCodigo: "QUIR-010",
        productoNombre: "Guantes Quirúrgicos Estériles Talla M",
        catalogId: "quir",
        loteId: "lote-2a",
        numeroLote: "GQ-990",
        fechaVencimiento: "2028-01-15",
        stockDisponibleAlMomento: 40,
        stockFisicoAlMomento: 40,
        cantidadEntregada: 10
      }
    ]
  });

  assert.equal(validExternal.exito, true);
  assert.equal(validExternal.consumo?.categoriaConsumo, "Externo");
  assert.equal(validExternal.consumo?.destinoExternoInstitucion, "Centro Diagnóstico Municipal");
});

test("6. Consumo con múltiples productos y rechazo cuando cantidad supera stock disponible", () => {
  const inventory = createMockInventory();
  const responsables = getDefaultResponsables("sede-central");
  const tipos = getDefaultTiposConsumo("sede-central");
  const licIris = responsables.find((r) => r.nombre === "Lic. Iris Aybar")!;
  const tipoInterno = tipos.find((t) => t.categoria === "Interno")!;

  // 6a. Múltiples productos válidos
  const multiResult = procesarConsumoEnMemoria({
    sedeId: "sede-central",
    sedeNombre: "Hospital Central",
    departamentoId: licIris.departamentoId,
    departamentoNombre: "Enfermería",
    responsable: licIris,
    tipoConsumo: tipoInterno,
    catalogId: "meds",
    fecha: "2026-11-19",
    usuarioRegistro: "admin",
    productosActuales: inventory,
    consumosActuales: [],
    items: [
      {
        id: "m1",
        productoCodigo: "MED-001",
        productoNombre: "Paracetamol 500mg Tabletas",
        catalogId: "meds",
        loteId: "lote-1a",
        numeroLote: "L2026-A",
        fechaVencimiento: "2027-06-30",
        stockDisponibleAlMomento: 100,
        stockFisicoAlMomento: 100,
        cantidadEntregada: 15
      },
      {
        id: "m2",
        productoCodigo: "QUIR-010",
        productoNombre: "Guantes Quirúrgicos Estériles Talla M",
        catalogId: "quir",
        loteId: "lote-2a",
        numeroLote: "GQ-990",
        fechaVencimiento: "2028-01-15",
        stockDisponibleAlMomento: 40,
        stockFisicoAlMomento: 40,
        cantidadEntregada: 5
      }
    ]
  });

  assert.equal(multiResult.exito, true);
  assert.equal(multiResult.consumo?.totalProductos, 2);
  assert.equal(multiResult.consumo?.totalUnidades, 20);

  // 6b. Intento de entregar más que el stock disponible (40 disponibles, pide 45)
  const overStockResult = procesarConsumoEnMemoria({
    sedeId: "sede-central",
    sedeNombre: "Hospital Central",
    departamentoId: licIris.departamentoId,
    departamentoNombre: "Enfermería",
    responsable: licIris,
    tipoConsumo: tipoInterno,
    catalogId: "quir",
    fecha: "2026-11-19",
    usuarioRegistro: "admin",
    productosActuales: inventory,
    consumosActuales: [],
    items: [
      {
        id: "over1",
        productoCodigo: "QUIR-010",
        productoNombre: "Guantes Quirúrgicos Estériles Talla M",
        catalogId: "quir",
        loteId: "lote-2a",
        numeroLote: "GQ-990",
        fechaVencimiento: "2028-01-15",
        stockDisponibleAlMomento: 40,
        stockFisicoAlMomento: 40,
        cantidadEntregada: 45
      }
    ]
  });

  assert.equal(overStockResult.exito, false, "No debe permitir entregar una cantidad superior al stock disponible");
});

test("7. Prevención de duplicados por doble clic o solicitudes simultáneas", () => {
  const inventory = createMockInventory();
  const responsables = getDefaultResponsables("sede-central");
  const tipos = getDefaultTiposConsumo("sede-central");
  const licIris = responsables.find((r) => r.nombre === "Lic. Iris Aybar")!;
  const tipoInterno = tipos.find((t) => t.categoria === "Interno")!;

  const first = procesarConsumoEnMemoria({
    sedeId: "sede-central",
    sedeNombre: "Hospital Central",
    departamentoId: licIris.departamentoId,
    departamentoNombre: "Enfermería",
    responsable: licIris,
    tipoConsumo: tipoInterno,
    catalogId: "meds",
    fecha: "2026-11-19",
    usuarioRegistro: "admin",
    productosActuales: inventory,
    consumosActuales: [],
    items: [
      {
        id: "dup1",
        productoCodigo: "MED-001",
        productoNombre: "Paracetamol 500mg Tabletas",
        catalogId: "meds",
        loteId: "lote-1a",
        numeroLote: "L2026-A",
        fechaVencimiento: "2027-06-30",
        stockDisponibleAlMomento: 100,
        stockFisicoAlMomento: 100,
        cantidadEntregada: 10
      }
    ]
  });

  assert.equal(first.exito, true);

  // Segunda solicitud idéntica inmediata (simulando doble clic en < 8 segundos)
  const duplicate = procesarConsumoEnMemoria({
    sedeId: "sede-central",
    sedeNombre: "Hospital Central",
    departamentoId: licIris.departamentoId,
    departamentoNombre: "Enfermería",
    responsable: licIris,
    tipoConsumo: tipoInterno,
    catalogId: "meds",
    fecha: "2026-11-19",
    usuarioRegistro: "admin",
    productosActuales: first.productosActualizados,
    consumosActuales: [first.consumo!],
    items: [
      {
        id: "dup1",
        productoCodigo: "MED-001",
        productoNombre: "Paracetamol 500mg Tabletas",
        catalogId: "meds",
        loteId: "lote-1a",
        numeroLote: "L2026-A",
        fechaVencimiento: "2027-06-30",
        stockDisponibleAlMomento: 90,
        stockFisicoAlMomento: 90,
        cantidadEntregada: 10
      }
    ]
  });

  assert.equal(duplicate.exito, false, "Debe bloquear el registro duplicado por doble clic");
});

test("8. Integración con Pedidos: generación automática del Consumo al entregar pedido sin descontar inventario dos veces", () => {
  const inventory = createMockInventory();
  const responsables = getDefaultResponsables("sede-central");
  const tipos = getDefaultTiposConsumo("sede-central");
  const licIris = responsables.find((r) => r.nombre === "Lic. Iris Aybar")!;
  const tipoInterno = tipos.find((t) => t.categoria === "Interno")!;

  // Cuando el pedido se procesa/entrega, el flujo de Pedidos ya descontó 20 unidades del lote-1a (quedando 80).
  const inventoryAfterOrderDelivery = structuredClone(inventory);
  inventoryAfterOrderDelivery[0].lotes[0].cantidad = 80;
  inventoryAfterOrderDelivery[0].lotes[0].cantidadF = 80;

  // El pedido entregado dispara el registro automático en Consumos con descontarInventario: false
  const orderConsumo = procesarConsumoEnMemoria({
    sedeId: "sede-central",
    sedeNombre: "Hospital Central",
    departamentoId: licIris.departamentoId,
    departamentoNombre: "Enfermería",
    responsable: licIris,
    tipoConsumo: tipoInterno,
    catalogId: "meds",
    fecha: "2026-11-19",
    usuarioRegistro: "admin",
    origenOperacion: "SOLICITUD_ORDEN",
    pedidoReferenciaId: "sol-9001",
    numeroPedidoReferencia: "SOL-1042",
    descontarInventario: false,
    productosActuales: inventoryAfterOrderDelivery,
    consumosActuales: [],
    items: [
      {
        id: "ord-item-1",
        productoCodigo: "MED-001",
        productoNombre: "Paracetamol 500mg Tabletas",
        catalogId: "meds",
        loteId: "lote-1a",
        numeroLote: "L2026-A",
        fechaVencimiento: "2027-06-30",
        stockDisponibleAlMomento: 100,
        stockFisicoAlMomento: 100,
        cantidadEntregada: 20
      }
    ]
  });

  assert.equal(orderConsumo.exito, true);
  assert.equal(orderConsumo.consumo?.origenOperacion, "SOLICITUD_ORDEN");
  assert.equal(orderConsumo.consumo?.pedidoReferenciaId, "sol-9001");
  assert.equal(orderConsumo.consumo?.numeroPedidoReferencia, "SOL-1042");

  // Verificar que el stock NO se descontó por segunda vez (sigue en 80)
  const loteAfter = orderConsumo.productosActualizados[0].lotes[0];
  assert.equal(loteAfter.cantidad, 80, "El stock no debe descontarse dos veces al integrar con Pedidos");
  assert.equal(orderConsumo.movimientosGenerados.length, 0, "No debe duplicar movimientos de inventario ya generados por el pedido");
});

test("9. Consistencia del Resumen por Departamento, Responsable e Interno vs Externo y notas de auditoría", async () => {
  const sampleConsumos: RegistroConsumo[] = [
    {
      id: "c1",
      numeroOperacion: "CON-00001",
      sedeId: "sede-central",
      sedeNombre: "Hospital Central",
      fecha: "2026-11-18",
      hora: "09:30",
      timestamp: 1731900000000,
      departamentoId: "dept-enfermeria",
      departamentoNombre: "Enfermería",
      responsableId: "resp-iris",
      responsableNombre: "Lic. Iris Aybar",
      tipoConsumoId: "tipo-interno",
      tipoConsumoNombre: "Interno",
      categoriaConsumo: "Interno",
      catalogId: "meds",
      items: [
        {
          id: "i1",
          productoCodigo: "MED-001",
          productoNombre: "Paracetamol 500mg Tabletas",
          catalogId: "meds",
          loteId: "lote-1a",
          numeroLote: "L2026-A",
          fechaVencimiento: "2027-06-30",
          stockDisponibleAlMomento: 100,
          stockFisicoAlMomento: 100,
          cantidadEntregada: 30,
          precioUnitario: 10,
          subtotal: 300
        }
      ],
      totalProductos: 1,
      totalUnidades: 30,
      costoTotalEstimado: 300,
      usuarioRegistro: "admin",
      origenOperacion: "DIRECTO",
      estado: "CONFIRMADO"
    },
    {
      id: "c2",
      numeroOperacion: "CON-00002",
      sedeId: "sede-central",
      sedeNombre: "Hospital Central",
      fecha: "2026-11-19",
      hora: "14:15",
      timestamp: 1731980000000,
      departamentoId: "dept-enfermeria",
      departamentoNombre: "Enfermería",
      responsableId: "resp-iris",
      responsableNombre: "Lic. Iris Aybar",
      tipoConsumoId: "tipo-externo",
      tipoConsumoNombre: "Externo",
      categoriaConsumo: "Externo",
      destinoExternoInstitucion: "Hospital Regional",
      catalogId: "meds",
      items: [
        {
          id: "i2",
          productoCodigo: "MED-001",
          productoNombre: "Paracetamol 500mg Tabletas",
          catalogId: "meds",
          loteId: "lote-1a",
          numeroLote: "L2026-A",
          fechaVencimiento: "2027-06-30",
          stockDisponibleAlMomento: 70,
          stockFisicoAlMomento: 70,
          cantidadEntregada: 10,
          precioUnitario: 10,
          subtotal: 100
        }
      ],
      totalProductos: 1,
      totalUnidades: 10,
      costoTotalEstimado: 100,
      usuarioRegistro: "admin",
      origenOperacion: "PEDIDO_ALMACEN",
      numeroPedidoReferencia: "PED-001",
      estado: "CONFIRMADO"
    }
  ];

  const stats = calcularResumenPorDepartamento(sampleConsumos);
  assert.equal(stats.resumenDepartamentos.length, 1);
  assert.equal(stats.resumenDepartamentos[0].departamentoNombre, "Enfermería");
  assert.equal(stats.resumenDepartamentos[0].totalOperaciones, 2);
  assert.equal(stats.resumenDepartamentos[0].totalUnidades, 40);
  assert.equal(stats.resumenDepartamentos[0].operacionesInternas, 1);
  assert.equal(stats.resumenDepartamentos[0].unidadesInternas, 30);
  assert.equal(stats.resumenDepartamentos[0].operacionesExternas, 1);
  assert.equal(stats.resumenDepartamentos[0].unidadesExternas, 10);
  assert.equal(stats.resumenDepartamentos[0].consumoPorResponsable[0].responsableNombre, "Lic. Iris Aybar");
  assert.equal(stats.resumenDepartamentos[0].consumoPorResponsable[0].totalUnidades, 40);

  // Verificar trazabilidad de nota de corrección sin alterar silenciosamente el consumo confirmado
  const corr = await agregarNotaCorreccionConsumo({
    consumoId: "c1",
    motivo: "Ajuste documental en número de oficio interno autorizado por Dirección",
    usuario: "admin",
    sedeId: "sede-central",
    consumosActuales: sampleConsumos
  });
  assert.equal(corr.exito, true);
  assert.equal(corr.consumoActualizado?.estado, "CORREGIDO");
  assert.equal(corr.consumoActualizado?.historialCorrecciones?.length, 1);
  assert.equal(corr.consumoActualizado?.totalUnidades, 30, "Las unidades entregadas originales se mantienen auditables");
});

test("10. Gestión de subalternos por departamento, relación con su responsable y filtrado estricto por departamento", async () => {
  let lista = getDefaultResponsables("sede-central"); // Lic. Iris Aybar (Responsable de Enfermería)

  // 1. Crear un subalterno en Enfermería (checkbox 'Es subalterno' = true)
  const sub1 = await registrarNuevoResponsableRapido({
    nombre: "Aux. Pedro Santana",
    departamentoNombre: "Enfermería",
    cargo: "Auxiliar de Enfermería",
    esSubalterno: true,
    sedeId: "sede-central",
    existingResponsables: lista
  });

  assert.equal(sub1.exito, true);
  assert.ok(sub1.responsable);
  assert.equal(sub1.responsable.esSubalterno, true);
  assert.equal(sub1.responsable.departamentoNombre, "Enfermería");
  assert.equal(sub1.responsable.responsableSuperiorNombre, "Lic. Iris Aybar", "El subalterno debe quedar asociado automáticamente a Lic. Iris Aybar");
  lista = sub1.listaActualizada;

  // 2. Crear un segundo subalterno en Enfermería
  const sub2 = await registrarNuevoResponsableRapido({
    nombre: "Enf. Luisa Fernández",
    departamentoNombre: "Enfermería",
    esSubalterno: true,
    sedeId: "sede-central",
    existingResponsables: lista
  });
  assert.equal(sub2.exito, true);
  lista = sub2.listaActualizada;

  // 3. Crear un responsable titular y un subalterno en Laboratorio
  const respLab = await registrarNuevoResponsableRapido({
    nombre: "Lic. Roberto Díaz",
    departamentoNombre: "Laboratorio",
    esSubalterno: false,
    sedeId: "sede-central",
    existingResponsables: lista
  });
  assert.equal(respLab.exito, true);
  assert.equal(respLab.responsable?.esSubalterno, false);
  lista = respLab.listaActualizada;

  const subLab = await registrarNuevoResponsableRapido({
    nombre: "Téc. Ana Marte",
    departamentoNombre: "Laboratorio",
    esSubalterno: true,
    sedeId: "sede-central",
    existingResponsables: lista
  });
  assert.equal(subLab.exito, true);
  assert.equal(subLab.responsable?.responsableSuperiorNombre, "Lic. Roberto Díaz");
  lista = subLab.listaActualizada;

  // 4. Al seleccionar el departamento 'Enfermería', solo deben aparecer Lic. Iris Aybar y sus 2 subalternos (ninguno de Laboratorio)
  const personalEnfermeria = getPersonalPorDepartamento(lista, "Enfermería");
  assert.equal(personalEnfermeria.length, 3, "Enfermería debe tener 1 responsable y 2 subalternos");
  assert.equal(personalEnfermeria[0].nombre, "Lic. Iris Aybar", "El responsable titular debe listarse primero");
  assert.equal(
    personalEnfermeria.some((p) => p.departamentoNombre !== "Enfermería"),
    false,
    "No deben aparecer responsables ni subalternos de otros departamentos"
  );

  // 5. Al seleccionar el departamento 'Laboratorio', solo deben aparecer Lic. Roberto Díaz y Téc. Ana Marte
  const personalLaboratorio = getPersonalPorDepartamento(lista, "Laboratorio");
  assert.equal(personalLaboratorio.length, 2);
  assert.equal(personalLaboratorio[0].nombre, "Lic. Roberto Díaz");
  assert.equal(personalLaboratorio[1].nombre, "Téc. Ana Marte");

  // 6. getResponsablesTitularesPorDepartamento solo devuelve al responsable titular
  const titularesEnf = getResponsablesTitularesPorDepartamento(lista, "Enfermería");
  assert.equal(titularesEnf.length, 1);
  assert.equal(titularesEnf[0].nombre, "Lic. Iris Aybar");

  // 7. Ningún objeto responsable o subalterno debe tener valores 'undefined' (para evitar fallo de setDoc en Firestore)
  for (const r of lista) {
    for (const [k, v] of Object.entries(r)) {
      assert.notEqual(v, undefined, `El campo ${k} en ${r.nombre} no puede ser undefined para Firestore`);
    }
  }

  // 8. Al salir y volver a entrar al módulo de Consumos, incluso si Firestore devuelve inicialmente una lista anterior, mergeResponsablesLists conserva todos los responsables y subalternos creados
  const staleFirestoreList = getDefaultResponsables("sede-central");
  const mergedOnRemount = mergeResponsablesLists(staleFirestoreList, lista, "sede-central");
  const labPersonalAfterRemount = getPersonalPorDepartamento(mergedOnRemount, "Laboratorio");
  assert.equal(labPersonalAfterRemount.length, 2, "Debe conservar el responsable y subalterno de Laboratorio al volver a entrar");
  assert.equal(labPersonalAfterRemount[0].nombre, "Lic. Roberto Díaz");
  assert.equal(labPersonalAfterRemount[1].nombre, "Téc. Ana Marte");
});


