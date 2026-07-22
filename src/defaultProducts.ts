import { Producto } from "./types";

export const bH: Producto[] = [
  {
    codigo: "PAR-500",
    nombre: "Paracetamol 500mg",
    descripcion: "Analgésico y antipirético, comprimidos",
    verificado: false,
    updatedAt: Date.now(),
    lotes: [
      {
        id: "lote-par-001",
        numeroLote: "L-PAR23",
        cantidad: 150,
        cantidadF: 150,
        fechaVencimiento: "2027-05-15",
        precio: 5.5,
        loteFisico: "Estante A-1",
        fechaFisica: "2027-05-15"
      }
    ]
  },
  {
    codigo: "AMO-250",
    nombre: "Amoxicilina Suspensión 250mg/5ml",
    descripcion: "Antibiótico de amplio espectro, frasco",
    verificado: false,
    updatedAt: Date.now(),
    lotes: [
      {
        id: "lote-amo-001",
        numeroLote: "L-AMO45",
        cantidad: 80,
        cantidadF: 78,
        fechaVencimiento: "2026-11-20",
        precio: 45.0,
        loteFisico: "Refrigerador 1",
        fechaFisica: "2026-11-20"
      }
    ]
  },
  {
    codigo: "IBU-400",
    nombre: "Ibuprofeno 400mg",
    descripcion: "Antiinflamatorio no esteroideo, tabletas",
    verificado: false,
    updatedAt: Date.now(),
    lotes: [
      {
        id: "lote-ibu-001",
        numeroLote: "L-IBU12",
        cantidad: 200,
        cantidadF: 200,
        fechaVencimiento: "2026-08-30",
        precio: 8.0,
        loteFisico: "Estante A-3",
        fechaFisica: "2026-08-30"
      }
    ]
  },
  {
    codigo: "JER-10ML",
    nombre: "Jeringas de 10ml con Aguja",
    descripcion: "Insumo desechable estéril, caja de 100 u.",
    verificado: false,
    updatedAt: Date.now(),
    lotes: [
      {
        id: "lote-jer-001",
        numeroLote: "L-JER99",
        cantidad: 15,
        cantidadF: 15,
        fechaVencimiento: "2029-01-01",
        precio: 350.0,
        loteFisico: "Pasillo C-2",
        fechaFisica: "2029-01-01"
      }
    ]
  },
  {
    codigo: "GAZ-3X3",
    nombre: "Gasa Estéril 3\"x3\"",
    descripcion: "Compresa de gasa de algodón, paquete de 100 u.",
    verificado: false,
    updatedAt: Date.now(),
    lotes: [
      {
        id: "lote-gaz-001",
        numeroLote: "L-GAZ55",
        cantidad: 45,
        cantidadF: 45,
        fechaVencimiento: "2028-06-12",
        precio: 180.0,
        loteFisico: "Pasillo B-1",
        fechaFisica: "2028-06-12"
      }
    ]
  }
];
