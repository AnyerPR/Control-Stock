import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Producto, Movimiento, InstitucionInfo, FacturaVenta } from "../types";

export const getActiveInstitucionInfo = (): InstitucionInfo => {
  if (typeof window !== "undefined") {
    const saved = localStorage.getItem("active_institucion_info");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {}
    }
    const meta = localStorage.getItem("active_farmacia_meta");
    if (meta) {
      try {
        const parsed = JSON.parse(meta);
        return {
          nombre: parsed.subtitulo || parsed.nombre || "Suministros Hospitalarios • Dr. José Manuel Rodríguez"
        };
      } catch {}
    }
  }
  return {
    nombre: "Suministros Hospitalarios • Dr. José Manuel Rodríguez"
  };
};

/**
 * Calculates the number of days from today until the expiration date.
 */
const getDaysToExpiration = (dateStr: string): number => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expDate = new Date(dateStr + "T00:00:00");
  return Math.ceil((expDate.getTime() - today.getTime()) / 86400000);
};

/**
 * Computes general statistics/warnings for a single product.
 */
const getProductStats = (p: Producto) => {
  const totalStock = p.lotes.reduce((sum, l) => sum + Number(l.cantidad || 0), 0);
  const physicalStock = p.lotes.reduce((sum, l) => sum + Number(l.cantidadF || 0), 0);
  const hasExpired = p.lotes.some((l) => getDaysToExpiration(l.fechaVencimiento) < 0);
  const hasSoonToExpire = p.lotes.some((l) => {
    const days = getDaysToExpiration(l.fechaVencimiento);
    return days >= 0 && days <= 30;
  });
  const hasNextToExpire = p.lotes.some((l) => {
    const days = getDaysToExpiration(l.fechaVencimiento);
    return days > 30 && days <= 90;
  });
  return {
    totalStock,
    physicalStock,
    hasExpired,
    hasSoonToExpire,
    hasNextToExpire,
    verificado: !!p.verificado,
    mismatch: totalStock !== physicalStock
  };
};

const buildWordInstitutionHeader = (title: string, inst: InstitucionInfo) => {
  const detailsParts: string[] = [];
  if (inst.rnc) detailsParts.push(`<strong>RNC / ID Fiscal:</strong> ${inst.rnc}`);
  if (inst.telefono) detailsParts.push(`<strong>Tel:</strong> ${inst.telefono}`);
  if (inst.correo) detailsParts.push(`<strong>Email:</strong> ${inst.correo}`);
  if (inst.paginaWeb) detailsParts.push(`<strong>Web:</strong> ${inst.paginaWeb}`);
  const extraParts = (inst.camposExtra || [])
    .filter((c) => c.etiqueta && c.valor)
    .map((c) => `<strong>${c.etiqueta}:</strong> ${c.valor}`);

  return `
    <table class="header-table">
      <tr>
        ${
          inst.logoUrl
            ? `<td style="width: 90px; vertical-align: middle; padding-right: 15px;">
                <img src="${inst.logoUrl}" width="80" style="max-height: 70px; width: auto; object-fit: contain;" alt="Logo" />
               </td>`
            : ""
        }
        <td style="vertical-align: middle;">
          <div class="header-title">${title}</div>
          <div class="header-subtitle" style="font-weight: bold; color: #1e293b; font-size: 14px;">${inst.nombre || "Suministros Hospitalarios • Dr. José Manuel Rodríguez"}</div>
          ${detailsParts.length > 0 ? `<div style="font-size: 11px; color: #475569; margin-top: 3px;">${detailsParts.join(" &nbsp;|&nbsp; ")}</div>` : ""}
          ${inst.direccion ? `<div style="font-size: 11px; color: #64748b; margin-top: 2px;">${inst.direccion}</div>` : ""}
          ${extraParts.length > 0 ? `<div style="font-size: 11px; color: #475569; margin-top: 2px;">${extraParts.join(" &nbsp;|&nbsp; ")}</div>` : ""}
        </td>
      </tr>
    </table>
  `;
};

const drawPdfInstitutionHeader = (doc: jsPDF, title: string, inst: InstitucionInfo, width: number) => {
  doc.setFillColor(248, 250, 252);
  doc.rect(40, 26, width, 64, "F");

  let textStartX = 55;
  if (inst.logoUrl && inst.logoUrl.startsWith("data:image/")) {
    try {
      const format = inst.logoUrl.includes("image/png") ? "PNG" : "JPEG";
      doc.addImage(inst.logoUrl, format, 48, 33, 46, 46, undefined, "FAST");
      textStartX = 104;
    } catch {}
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(15, 118, 110);
  doc.text(title, textStartX, 46);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(30, 41, 59);
  doc.text(inst.nombre || "Suministros Hospitalarios • Dr. José Manuel Rodríguez", textStartX, 60);

  const metaLine1: string[] = [];
  if (inst.rnc) metaLine1.push(`RNC/NIT: ${inst.rnc}`);
  if (inst.telefono) metaLine1.push(`Tel: ${inst.telefono}`);
  if (inst.correo) metaLine1.push(inst.correo);
  if (inst.paginaWeb) metaLine1.push(inst.paginaWeb);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  if (metaLine1.length > 0) {
    doc.text(metaLine1.join("  •  "), textStartX, 72);
  }
  if (inst.direccion) {
    doc.text(inst.direccion, textStartX, 83);
  }

  doc.setDrawColor(13, 148, 136);
  doc.setLineWidth(2);
  doc.line(40, 92, 40 + width, 92);
};

/**
 * Exports the filtered products list to Microsoft Word (.doc/.docx equivalent).
 */
export const exportToWord = (products: Producto[], filterName: string, catalogName: string, institucion?: InstitucionInfo) => {
  const inst = institucion || getActiveInstitucionInfo();
  let rowsHtml = "";
  products.forEach((p, idx) => {
    const stats = getProductStats(p);

    let lotsHtml = "<ul style='margin: 0; padding-left: 15px; font-family: Arial, sans-serif; font-size: 11px;'>";
    p.lotes.forEach((l) => {
      const days = getDaysToExpiration(l.fechaVencimiento);
      let statusStyle = "color: #065f46; font-weight: bold;";
      let statusLabel = "Vigente";

      if (days < 0) {
        statusStyle = "color: #991b1b; font-weight: bold;";
        statusLabel = `Vencido (${Math.abs(days)} días atrás)`;
      } else if (days <= 30) {
        statusStyle = "color: #92400e; font-weight: bold;";
        statusLabel = `Por vencer (${days} días)`;
      } else if (days <= 90) {
        statusStyle = "color: #854d0e; font-weight: bold;";
        statusLabel = `Próx. vencer (${days} días)`;
      }

      const parts = l.fechaVencimiento.split("-");
      const formattedDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : l.fechaVencimiento;
      lotsHtml += `
        <li style='margin-bottom: 4px;'>
          <strong>Lote:</strong> ${l.numeroLote} | 
          <strong>Cant:</strong> ${l.cantidad} sist / ${l.cantidadF !== undefined ? l.cantidadF : l.cantidad} fís | 
          <strong>Vence:</strong> ${formattedDate} 
          (<span style='${statusStyle}'>${statusLabel}</span>)
        </li>
      `;
    });
    lotsHtml += "</ul>";

    let statusLabels = "";
    if (stats.hasExpired) statusLabels += "<span style='background-color: #ffe4e6; color: #991b1b; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 9px; margin-right: 4px;'>VENCIDO</span>";
    if (stats.hasSoonToExpire) statusLabels += "<span style='background-color: #fef3c7; color: #92400e; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 9px; margin-right: 4px;'>&le;30 DÍAS</span>";
    if (stats.hasNextToExpire) statusLabels += "<span style='background-color: #fef9c3; color: #854d0e; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 9px; margin-right: 4px;'>&le;90 DÍAS</span>";
    statusLabels += stats.verificado
      ? "<span style='background-color: #d1fae5; color: #065f46; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 9px;'>VERIFICADO</span>"
      : "<span style='background-color: #f1f5f9; color: #475569; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 9px;'>SIN VERIFICAR</span>";

    if (stats.mismatch) statusLabels += "<br/><span style='background-color: #e0e7ff; color: #3730a3; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 9px; margin-top: 4px; display: inline-block;'>DIFERENCIA FÍSICA</span>";

    rowsHtml += `
      <tr style='page-break-inside: avoid;'>
        <td style='border: 1px solid #dddddd; padding: 10px; text-align: center;'>${idx + 1}</td>
        <td style='border: 1px solid #dddddd; padding: 10px; font-weight: bold; color: #0f766e;'>${p.codigo}</td>
        <td style='border: 1px solid #dddddd; padding: 10px;'>
          <div style='font-weight: bold; font-size: 13px; color: #1e293b;'>${p.nombre}</div>
          <div style='color: #64748b; font-size: 11px; margin-top: 3px; font-style: italic;'>${p.descripcion || "Sin descripción adicional"}</div>
        </td>
        <td style='border: 1px solid #dddddd; padding: 10px;'>${lotsHtml}</td>
        <td style='border: 1px solid #dddddd; padding: 10px; text-align: center; font-weight: bold;'>${stats.totalStock}</td>
        <td style='border: 1px solid #dddddd; padding: 10px; text-align: center; font-weight: bold;'>${stats.physicalStock}</td>
        <td style='border: 1px solid #dddddd; padding: 10px; font-size: 11px;'>${statusLabels}</td>
      </tr>
    `;
  });

  const htmlContent = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head>
      <meta charset='utf-8'>
      <title>Reporte de Inventario de Suministros</title>
      <style>
        @page { size: 11in 8.5in; margin: 1.0in; }
        body { font-family: Arial, sans-serif; color: #333333; line-height: 1.4; }
        .header-table { width: 100%; border-collapse: collapse; border: none; margin-bottom: 20px; }
        .header-title { font-size: 20px; font-weight: bold; color: #0f766e; margin: 0; }
        .header-subtitle { font-size: 12px; color: #4b5563; margin-top: 4px; margin-bottom: 0; }
        .metadata-box { background-color: #f8fafc; border-left: 4px solid #0f766e; padding: 12px; margin-bottom: 20px; font-size: 12px; }
        .metadata-box table { width: 100%; border-collapse: collapse; border: none; }
        .metadata-label { font-weight: bold; color: #475569; width: 15%; padding: 3px 0; }
        .metadata-value { color: #1e293b; padding: 3px 0; }
        .main-table { width: 100%; border-collapse: collapse; font-size: 12px; font-family: Arial, sans-serif; }
        .main-table th { background-color: #0f766e; color: #ffffff; font-weight: bold; text-align: left; padding: 10px; border: 1px solid #0d9488; }
      </style>
    </head>
    <body>
      ${buildWordInstitutionHeader("Control de Stock - Reporte de Suministros", inst)}

      <div class="metadata-box">
        <table>
          <tr>
            <td class="metadata-label">Catálogo:</td>
            <td class="metadata-value">${catalogName}</td>
            <td class="metadata-label">Fecha Reporte:</td>
            <td class="metadata-value">${new Date().toLocaleString()}</td>
          </tr>
          <tr>
            <td class="metadata-label">Filtro Aplicado:</td>
            <td class="metadata-value"><strong>${filterName}</strong></td>
            <td class="metadata-label">Total Suministros:</td>
            <td class="metadata-value">${products.length} productos</td>
          </tr>
        </table>
      </div>

      <table class="main-table">
        <thead>
          <tr>
            <th style="width: 5%; text-align: center;">N.º</th>
            <th style="width: 12%;">Código</th>
            <th style="width: 25%;">Insumo / Medicamento</th>
            <th style="width: 35%;">Lotes Registrados</th>
            <th style="width: 8%; text-align: center;">Cant. Sis</th>
            <th style="width: 8%; text-align: center;">Cant. Fís</th>
            <th style="width: 17%;">Estado / Verificación</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
      ${inst.piePagina ? `<p style="margin-top: 20px; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 8px;">${inst.piePagina}</p>` : ""}
    </body>
    </html>
  `;

  const blob = new Blob(["\ufeff" + htmlContent], { type: "application/msword;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Reporte_Inventario_${filterName.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * Exports the filtered products list to PDF using jsPDF and jspdf-autotable.
 */
export const exportToPDF = (products: Producto[], filterName: string, catalogName: string, institucion?: InstitucionInfo) => {
  const inst = institucion || getActiveInstitucionInfo();
  const doc = new jsPDF("l", "pt", "a4");

  drawPdfInstitutionHeader(doc, "Control de Stock - Reporte de Suministros", inst, 762);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(30, 41, 59);
  doc.text("Catálogo:", 45, 112);
  doc.text("Filtro Aplicado:", 45, 126);

  doc.text("Fecha Reporte:", 445, 112);
  doc.text("Total Suministros:", 445, 126);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(71, 85, 105);
  doc.text(catalogName, 135, 112);
  doc.text(filterName, 135, 126);
  doc.text(new Date().toLocaleString(), 545, 112);
  doc.text(`${products.length} productos`, 545, 126);

  const columns = [
    { header: "N.º", dataKey: "index" },
    { header: "Código", dataKey: "code" },
    { header: "Insumo / Medicamento", dataKey: "name" },
    { header: "Lotes (Lote | Stock Sis/Fís | Vence)", dataKey: "lots" },
    { header: "Cant. Sis", dataKey: "sysStock" },
    { header: "Cant. Fís", dataKey: "physStock" },
    { header: "Estado / Verificación", dataKey: "status" }
  ];

  const rows = products.map((p, idx) => {
    const stats = getProductStats(p);

    const lotsText = p.lotes
      .map((l) => {
        const days = getDaysToExpiration(l.fechaVencimiento);
        let statusStr = "Vigente";
        if (days < 0) statusStr = "Vencido";
        else if (days <= 30) statusStr = "Por vencer";
        else if (days <= 90) statusStr = "Próximo";

        const parts = l.fechaVencimiento.split("-");
        const formattedDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : l.fechaVencimiento;
        return `Lot: ${l.numeroLote} | Qty: ${l.cantidad} sist / ${l.cantidadF !== undefined ? l.cantidadF : l.cantidad} fís | Vence: ${formattedDate} (${statusStr})`;
      })
      .join("\n");

    const statusParts = [];
    if (stats.hasExpired) statusParts.push("VENCIDO");
    if (stats.hasSoonToExpire) statusParts.push("≤30 DÍAS");
    if (stats.hasNextToExpire) statusParts.push("≤90 DÍAS");
    statusParts.push(stats.verificado ? "Verificado" : "Sin verificar");
    if (stats.mismatch) statusParts.push("DIFERENCIA FÍSICA");

    return {
      index: idx + 1,
      code: p.codigo,
      name: `${p.nombre}\n${p.descripcion || "Sin descripción"}`,
      lots: lotsText,
      sysStock: stats.totalStock,
      physStock: stats.physicalStock,
      status: statusParts.join(" | ")
    };
  });

  autoTable(doc, {
    columns,
    body: rows,
    startY: 142,
    theme: "striped",
    headStyles: {
      fillColor: [15, 118, 110],
      textColor: 255,
      fontSize: 8.5,
      fontStyle: "bold"
    },
    styles: {
      fontSize: 7.5,
      cellPadding: 5,
      overflow: "linebreak",
      valign: "middle"
    },
    columnStyles: {
      index: { cellWidth: 30, halign: "center" },
      code: { cellWidth: 60, fontStyle: "bold", textColor: [15, 118, 110] },
      name: { cellWidth: 150 },
      lots: { cellWidth: 310 },
      sysStock: { cellWidth: 50, halign: "center" },
      physStock: { cellWidth: 50, halign: "center" },
      status: { cellWidth: 110 }
    },
    margin: { left: 40, right: 40 },
    didDrawPage: (data: any) => {
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184);
      const footerLeft = inst.piePagina || `Control de Stock - Reporte Generado el ${new Date().toLocaleDateString()}`;
      doc.text(footerLeft, 40, doc.internal.pageSize.height - 20);
      doc.text(`Página ${data.pageNumber}`, doc.internal.pageSize.width - 80, doc.internal.pageSize.height - 20);
    }
  });

  doc.save(`Reporte_Inventario_${filterName.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.pdf`);
};

export interface ExportOrderItem {
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

/**
 * Exports active order to Word
 */
export const exportOrderToWord = (orderItems: ExportOrderItem[], catalogName: string, institucion?: InstitucionInfo) => {
  const inst = institucion || getActiveInstitucionInfo();
  let rowsHtml = "";
  let totalCantidad = 0;
  let totalPrecio = 0;

  orderItems.forEach((item, idx) => {
    totalCantidad += item.cantidadAprobada;
    const subtotal = item.cantidadAprobada * item.precio;
    totalPrecio += subtotal;

    const parts = item.fecha.split("-");
    const formattedDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : item.fecha;

    rowsHtml += `
      <tr style='page-break-inside: avoid;'>
        <td style='border: 1px solid #dddddd; padding: 10px; text-align: center;'>${idx + 1}</td>
        <td style='border: 1px solid #dddddd; padding: 10px; font-weight: bold; color: #0f766e;'>${item.codigo}</td>
        <td style='border: 1px solid #dddddd; padding: 10px;'>
          <div style='font-weight: bold; font-size: 13px; color: #1e293b;'>${item.nombre}</div>
          <div style='color: #64748b; font-size: 11px; margin-top: 3px; font-style: italic;'>${item.descripcion || "Sin descripción adicional"}</div>
        </td>
        <td style='border: 1px solid #dddddd; padding: 10px; text-align: center; font-family: monospace;'>${item.loteNumero}</td>
        <td style='border: 1px solid #dddddd; padding: 10px; text-align: center;'>${formattedDate}</td>
        <td style='border: 1px solid #dddddd; padding: 10px; text-align: right; font-weight: bold;'>${item.cantidadAprobada}</td>
        <td style='border: 1px solid #dddddd; padding: 10px; text-align: right;'>RD$ ${item.precio.toFixed(2)}</td>
        <td style='border: 1px solid #dddddd; padding: 10px; text-align: right; font-weight: bold;'>RD$ ${subtotal.toFixed(2)}</td>
      </tr>
    `;
  });

  const htmlContent = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head>
      <meta charset='utf-8'>
      <title>Pedido de Salida de Suministros</title>
      <style>
        @page { size: 8.5in 11in; margin: 1.0in; }
        body { font-family: Arial, sans-serif; color: #333333; line-height: 1.4; }
        .header-table { width: 100%; border-collapse: collapse; border: none; margin-bottom: 20px; }
        .header-title { font-size: 20px; font-weight: bold; color: #0f766e; margin: 0; }
        .header-subtitle { font-size: 12px; color: #4b5563; margin-top: 4px; margin-bottom: 0; }
        .metadata-box { background-color: #f8fafc; border-left: 4px solid #0f766e; padding: 12px; margin-bottom: 20px; font-size: 12px; }
        .metadata-box table { width: 100%; border-collapse: collapse; border: none; }
        .metadata-label { font-weight: bold; color: #475569; width: 20%; padding: 3px 0; }
        .metadata-value { color: #1e293b; padding: 3px 0; }
        .main-table { width: 100%; border-collapse: collapse; font-size: 12px; font-family: Arial, sans-serif; }
        .main-table th { background-color: #0f766e; color: #ffffff; font-weight: bold; text-align: left; padding: 10px; border: 1px solid #0d9488; }
      </style>
    </head>
    <body>
      ${buildWordInstitutionHeader("Pedido de Salida de Suministros", inst)}

      <div class="metadata-box">
        <table>
          <tr>
            <td class="metadata-label">Catálogo:</td>
            <td class="metadata-value">${catalogName || "Medicamentos e Insumos"}</td>
            <td class="metadata-label">Fecha Pedido:</td>
            <td class="metadata-value">${new Date().toLocaleString()}</td>
          </tr>
          <tr>
            <td class="metadata-label">Tipo de Salida:</td>
            <td class="metadata-value">Despacho / Pedido de Stock</td>
            <td class="metadata-label">Total Ítems:</td>
            <td class="metadata-value">${orderItems.length} tipos de suministros</td>
          </tr>
        </table>
      </div>

      <table class="main-table">
        <thead>
          <tr>
            <th style="width: 5%; text-align: center;">N.º</th>
            <th style="width: 12%;">Código</th>
            <th style="width: 28%;">Medicamento / Insumo</th>
            <th style="width: 12%; text-align: center;">Lote</th>
            <th style="width: 13%; text-align: center;">Vencimiento</th>
            <th style="width: 10%; text-align: right;">Cantidad</th>
            <th style="width: 10%; text-align: right;">Precio Unit.</th>
            <th style="width: 10%; text-align: right;">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
          <tr>
            <td colspan="5" style="border: 1px solid #dddddd; padding: 12px 10px; text-align: right; font-weight: bold; background-color: #f8fafc; font-size: 13px;">TOTAL GENERAL:</td>
            <td style="border: 1px solid #dddddd; padding: 12px 10px; text-align: right; font-weight: bold; background-color: #f8fafc; color: #0f766e; font-size: 13px;">${totalCantidad}</td>
            <td style="border: 1px solid #dddddd; padding: 12px 10px; text-align: right; font-weight: bold; background-color: #f8fafc; font-size: 13px;">—</td>
            <td style="border: 1px solid #dddddd; padding: 12px 10px; text-align: right; font-weight: bold; background-color: #f8fafc; color: #0f766e; font-size: 13px;">RD$ ${totalPrecio.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
      ${inst.piePagina ? `<p style="margin-top: 20px; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 8px;">${inst.piePagina}</p>` : ""}
    </body>
    </html>
  `;

  const blob = new Blob(["\ufeff" + htmlContent], { type: "application/msword;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Pedido_Stock_${new Date().toISOString().slice(0, 10)}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * Exports active order to PDF
 */
export const exportOrderToPDF = (orderItems: ExportOrderItem[], catalogName: string, institucion?: InstitucionInfo) => {
  const inst = institucion || getActiveInstitucionInfo();
  const doc = new jsPDF("p", "pt", "a4");

  drawPdfInstitutionHeader(doc, "Pedido de Salida de Suministros", inst, 515);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(30, 41, 59);
  doc.text("Catálogo:", 45, 112);
  doc.text("Tipo de Salida:", 45, 126);

  doc.text("Fecha Pedido:", 320, 112);
  doc.text("Total Ítems:", 320, 126);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(71, 85, 105);
  doc.text(catalogName || "Medicamentos e Insumos", 125, 112);
  doc.text("Despacho / Pedido de Stock", 125, 126);
  doc.text(new Date().toLocaleString(), 400, 112);
  doc.text(`${orderItems.length} tipos de suministros`, 400, 126);

  const columns = [
    { header: "N.º", dataKey: "index" },
    { header: "Código", dataKey: "code" },
    { header: "Medicamento / Insumo", dataKey: "name" },
    { header: "Lote", dataKey: "lot" },
    { header: "Vencimiento", dataKey: "expiration" },
    { header: "Cant", dataKey: "quantity" },
    { header: "Precio", dataKey: "price" },
    { header: "Subtotal", dataKey: "subtotal" }
  ];

  let totalCantidad = 0;
  let totalPrecio = 0;

  const rows = orderItems.map((item, idx) => {
    totalCantidad += item.cantidadAprobada;
    const subtotal = item.cantidadAprobada * item.precio;
    totalPrecio += subtotal;

    const parts = item.fecha.split("-");
    const formattedDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : item.fecha;

    return {
      index: idx + 1,
      code: item.codigo,
      name: `${item.nombre}${item.descripcion ? `\n(${item.descripcion})` : ""}`,
      lot: item.loteNumero,
      expiration: formattedDate,
      quantity: item.cantidadAprobada,
      price: `RD$ ${item.precio.toFixed(2)}`,
      subtotal: `RD$ ${subtotal.toFixed(2)}`
    };
  });

  rows.push({
    index: "",
    code: "",
    name: "TOTAL GENERAL",
    lot: "",
    expiration: "",
    quantity: totalCantidad as any,
    price: "—",
    subtotal: `RD$ ${totalPrecio.toFixed(2)}`
  } as any);

  autoTable(doc, {
    columns,
    body: rows,
    startY: 142,
    theme: "striped",
    headStyles: {
      fillColor: [15, 118, 110],
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
      code: { cellWidth: 50, fontStyle: "bold", textColor: [15, 118, 110] },
      name: { cellWidth: 160 },
      lot: { cellWidth: 60, halign: "center" },
      expiration: { cellWidth: 65, halign: "center" },
      quantity: { cellWidth: 45, halign: "right", fontStyle: "bold" },
      price: { cellWidth: 55, halign: "right" },
      subtotal: { cellWidth: 55, halign: "right", fontStyle: "bold" }
    },
    margin: { left: 40, right: 40 },
    willDrawCell: (data) => {
      if (data.row.index === rows.length - 1) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [248, 250, 252];
        if (data.column.index === 2 || data.column.index === 5 || data.column.index === 7) {
          data.cell.styles.textColor = [15, 118, 110];
        }
      }
    },
    didDrawPage: (data) => {
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184);
      const footerLeft = inst.piePagina || `Pedido de Stock - Documento Generado el ${new Date().toLocaleDateString()}`;
      doc.text(footerLeft, 40, doc.internal.pageSize.height - 20);
      doc.text(`Página ${data.pageNumber}`, doc.internal.pageSize.width - 80, doc.internal.pageSize.height - 20);
    }
  });

  doc.save(`Pedido_Stock_${new Date().toISOString().slice(0, 10)}.pdf`);
};

/**
 * Exports a grouped Invoice (Factura de Entrada) to PDF
 */
export const exportInvoiceToPDF = (
  numeroFactura: string,
  fechaEntrada: string,
  proveedor: string,
  items: Movimiento[],
  institucion?: InstitucionInfo
) => {
  const inst = institucion || getActiveInstitucionInfo();
  const doc = new jsPDF("p", "pt", "a4");

  drawPdfInstitutionHeader(doc, `Comprobante de Entrada • Factura ${numeroFactura}`, inst, 515);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(30, 41, 59);
  doc.text("N.º de Factura:", 45, 112);
  doc.text("Proveedor / Obs:", 45, 126);

  doc.text("Fecha Entrada:", 320, 112);
  doc.text("Registrado por:", 320, 126);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(71, 85, 105);
  doc.text(numeroFactura, 130, 112);
  doc.text(proveedor || "Recepción de Abastecimiento", 130, 126);
  doc.text(fechaEntrada || new Date().toLocaleDateString(), 400, 112);
  doc.text(items[0]?.usuario || "Sistema", 400, 126);

  const columns = [
    { header: "N.º", dataKey: "index" },
    { header: "Código", dataKey: "code" },
    { header: "Medicamento / Insumo", dataKey: "name" },
    { header: "Lote", dataKey: "lot" },
    { header: "Cant.", dataKey: "quantity" },
    { header: "Costo Unit.", dataKey: "price" },
    { header: "Subtotal", dataKey: "subtotal" }
  ];

  let totalCantidad = 0;
  let totalPrecio = 0;

  const rows = items.map((item, idx) => {
    totalCantidad += Number(item.cantidad || 0);
    const subtotal = Number(item.cantidad || 0) * Number(item.precio || 0);
    totalPrecio += subtotal;

    return {
      index: idx + 1,
      code: item.productoCodigo,
      name: `${item.productoNombre}${item.descripcion ? `\n(${item.descripcion})` : ""}`,
      lot: item.lote,
      quantity: item.cantidad,
      price: `RD$ ${Number(item.precio || 0).toFixed(2)}`,
      subtotal: `RD$ ${subtotal.toFixed(2)}`
    };
  });

  rows.push({
    index: "",
    code: "",
    name: "TOTAL FACTURA",
    lot: "",
    quantity: totalCantidad as any,
    price: "—",
    subtotal: `RD$ ${totalPrecio.toFixed(2)}`
  } as any);

  autoTable(doc, {
    columns,
    body: rows,
    startY: 142,
    theme: "striped",
    headStyles: {
      fillColor: [15, 118, 110],
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
      index: { cellWidth: 28, halign: "center" },
      code: { cellWidth: 55, fontStyle: "bold", textColor: [15, 118, 110] },
      name: { cellWidth: 185 },
      lot: { cellWidth: 70, halign: "center" },
      quantity: { cellWidth: 50, halign: "right", fontStyle: "bold" },
      price: { cellWidth: 62, halign: "right" },
      subtotal: { cellWidth: 65, halign: "right", fontStyle: "bold" }
    },
    margin: { left: 40, right: 40 },
    willDrawCell: (data) => {
      if (data.row.index === rows.length - 1) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [248, 250, 252];
        if (data.column.index === 2 || data.column.index === 4 || data.column.index === 6) {
          data.cell.styles.textColor = [15, 118, 110];
        }
      }
    },
    didDrawPage: (data) => {
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184);
      const footerLeft = inst.piePagina || `Comprobante de Entrada - Factura ${numeroFactura}`;
      doc.text(footerLeft, 40, doc.internal.pageSize.height - 20);
      doc.text(`Página ${data.pageNumber}`, doc.internal.pageSize.width - 80, doc.internal.pageSize.height - 20);
    }
  });

  doc.save(`Factura_Entrada_${numeroFactura.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`);
};

/**
 * Exports a grouped Invoice (Factura de Entrada) to Word
 */
export const exportInvoiceToWord = (
  numeroFactura: string,
  fechaEntrada: string,
  proveedor: string,
  items: Movimiento[],
  institucion?: InstitucionInfo
) => {
  const inst = institucion || getActiveInstitucionInfo();
  let rowsHtml = "";
  let totalCantidad = 0;
  let totalPrecio = 0;

  items.forEach((item, idx) => {
    totalCantidad += Number(item.cantidad || 0);
    const subtotal = Number(item.cantidad || 0) * Number(item.precio || 0);
    totalPrecio += subtotal;

    rowsHtml += `
      <tr style='page-break-inside: avoid;'>
        <td style='border: 1px solid #dddddd; padding: 10px; text-align: center;'>${idx + 1}</td>
        <td style='border: 1px solid #dddddd; padding: 10px; font-weight: bold; color: #0f766e;'>${item.productoCodigo}</td>
        <td style='border: 1px solid #dddddd; padding: 10px;'>
          <div style='font-weight: bold; font-size: 13px; color: #1e293b;'>${item.productoNombre}</div>
          ${item.descripcion ? `<div style='color: #64748b; font-size: 11px; margin-top: 2px;'>${item.descripcion}</div>` : ""}
        </td>
        <td style='border: 1px solid #dddddd; padding: 10px; text-align: center; font-family: monospace;'>${item.lote}</td>
        <td style='border: 1px solid #dddddd; padding: 10px; text-align: right; font-weight: bold;'>+${item.cantidad}</td>
        <td style='border: 1px solid #dddddd; padding: 10px; text-align: right;'>RD$ ${Number(item.precio || 0).toFixed(2)}</td>
        <td style='border: 1px solid #dddddd; padding: 10px; text-align: right; font-weight: bold;'>RD$ ${subtotal.toFixed(2)}</td>
      </tr>
    `;
  });

  const htmlContent = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head>
      <meta charset='utf-8'>
      <title>Factura de Entrada ${numeroFactura}</title>
      <style>
        @page { size: 8.5in 11in; margin: 1.0in; }
        body { font-family: Arial, sans-serif; color: #333333; line-height: 1.4; }
        .header-table { width: 100%; border-collapse: collapse; border: none; margin-bottom: 20px; }
        .header-title { font-size: 20px; font-weight: bold; color: #0f766e; margin: 0; }
        .header-subtitle { font-size: 12px; color: #4b5563; margin-top: 4px; margin-bottom: 0; }
        .metadata-box { background-color: #f8fafc; border-left: 4px solid #0f766e; padding: 12px; margin-bottom: 20px; font-size: 12px; }
        .metadata-box table { width: 100%; border-collapse: collapse; border: none; }
        .metadata-label { font-weight: bold; color: #475569; width: 20%; padding: 3px 0; }
        .metadata-value { color: #1e293b; padding: 3px 0; }
        .main-table { width: 100%; border-collapse: collapse; font-size: 12px; font-family: Arial, sans-serif; }
        .main-table th { background-color: #0f766e; color: #ffffff; font-weight: bold; text-align: left; padding: 10px; border: 1px solid #0d9488; }
      </style>
    </head>
    <body>
      ${buildWordInstitutionHeader(`Comprobante de Entrada • Factura ${numeroFactura}`, inst)}

      <div class="metadata-box">
        <table>
          <tr>
            <td class="metadata-label">N.º de Factura:</td>
            <td class="metadata-value"><strong>${numeroFactura}</strong></td>
            <td class="metadata-label">Fecha de Entrada:</td>
            <td class="metadata-value">${fechaEntrada || new Date().toLocaleDateString()}</td>
          </tr>
          <tr>
            <td class="metadata-label">Proveedor / Obs:</td>
            <td class="metadata-value">${proveedor || "Recepción de Abastecimiento"}</td>
            <td class="metadata-label">Registrado por:</td>
            <td class="metadata-value">${items[0]?.usuario || "Sistema"}</td>
          </tr>
        </table>
      </div>

      <table class="main-table">
        <thead>
          <tr>
            <th style="width: 6%; text-align: center;">N.º</th>
            <th style="width: 14%;">Código</th>
            <th style="width: 34%;">Medicamento / Insumo</th>
            <th style="width: 14%; text-align: center;">Lote</th>
            <th style="width: 10%; text-align: right;">Cant.</th>
            <th style="width: 11%; text-align: right;">Costo Unit.</th>
            <th style="width: 11%; text-align: right;">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
          <tr>
            <td colspan="4" style="border: 1px solid #dddddd; padding: 12px 10px; text-align: right; font-weight: bold; background-color: #f8fafc; font-size: 13px;">TOTAL FACTURA:</td>
            <td style="border: 1px solid #dddddd; padding: 12px 10px; text-align: right; font-weight: bold; background-color: #f8fafc; color: #0f766e; font-size: 13px;">${totalCantidad}</td>
            <td style="border: 1px solid #dddddd; padding: 12px 10px; text-align: right; font-weight: bold; background-color: #f8fafc; font-size: 13px;">—</td>
            <td style="border: 1px solid #dddddd; padding: 12px 10px; text-align: right; font-weight: bold; background-color: #f8fafc; color: #0f766e; font-size: 13px;">RD$ ${totalPrecio.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
      ${inst.piePagina ? `<p style="margin-top: 20px; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 8px;">${inst.piePagina}</p>` : ""}
    </body>
    </html>
  `;

  const blob = new Blob(["\ufeff" + htmlContent], { type: "application/msword;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Factura_Entrada_${numeroFactura.replace(/[^a-zA-Z0-9_-]/g, "_")}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * Exports a Sale / Operation Invoice (Módulo de Venta) to PDF with Institutional Logo
 */
export const exportSaleInvoiceToPDF = (
  factura: FacturaVenta,
  institucion?: InstitucionInfo
) => {
  const inst = institucion || getActiveInstitucionInfo();
  const doc = new jsPDF("p", "pt", "a4");

  drawPdfInstitutionHeader(
    doc,
    `Factura de ${factura.concepto || "Venta"} • N.º ${factura.numeroFactura}`,
    inst,
    515
  );

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(30, 41, 59);
  doc.text("N.º de Factura:", 45, 110);
  doc.text("Concepto:", 45, 123);
  doc.text("Cliente:", 45, 136);

  doc.text("Fecha / Hora:", 315, 110);
  doc.text("Contacto Cliente:", 315, 123);
  doc.text("Catálogo / Resp.:", 315, 136);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(71, 85, 105);
  doc.text(factura.numeroFactura, 125, 110);
  doc.text(factura.concepto || "Venta", 125, 123);
  doc.text((factura.clienteNombre || "Consumidor Final / General").slice(0, 38), 125, 136);

  doc.text(`${factura.fecha} ${factura.hora || ""}`, 400, 110);
  doc.text(factura.clienteContacto || "No especificado", 400, 123);
  doc.text(
    `${(factura.catalogNombre || "General").slice(0, 18)} • ${factura.usuarioResponsable}`.slice(0, 32),
    400,
    136
  );

  let startY = 150;
  if (factura.observaciones) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`Nota / Observación: ${factura.observaciones.slice(0, 95)}`, 45, 148);
    startY = 160;
  }

  const columns = [
    { header: "N.º", dataKey: "index" },
    { header: "Código", dataKey: "code" },
    { header: "Descripción del Producto / Insumo", dataKey: "name" },
    { header: "Lote", dataKey: "lot" },
    { header: "Vence", dataKey: "expiration" },
    { header: "Cant.", dataKey: "quantity" },
    { header: "Precio Unit.", dataKey: "price" },
    { header: "ITBIS 18%", dataKey: "itbis" },
    { header: "Subtotal", dataKey: "subtotal" }
  ];

  const calcSubtotal =
    factura.subtotalMonto !== undefined
      ? Number(factura.subtotalMonto)
      : factura.items.reduce((acc, i) => acc + Number(i.subtotal || 0), 0);

  const calcItbis =
    factura.itbisMonto !== undefined
      ? Number(factura.itbisMonto)
      : factura.items.reduce(
          (acc, i) =>
            acc +
            (i.itbisMonto !== undefined
              ? Number(i.itbisMonto)
              : i.aplicaItbis
              ? Number(i.subtotal || 0) * 0.18
              : 0),
          0
        );

  const calcTotal =
    factura.totalMonto !== undefined
      ? Number(factura.totalMonto)
      : calcSubtotal + calcItbis;

  const rows: any[] = factura.items.map((item, idx) => {
    const parts = (item.fechaVencimiento || "").split("-");
    const formattedDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : item.fechaVencimiento || "—";
    const itemItbis =
      item.itbisMonto !== undefined
        ? Number(item.itbisMonto)
        : item.aplicaItbis
        ? Number(item.subtotal || 0) * 0.18
        : 0;

    return {
      index: idx + 1,
      code: item.productoCodigo,
      name: `${item.productoNombre}${item.descripcion ? `\n(${item.descripcion})` : ""}`,
      lot: item.numeroLote,
      expiration: formattedDate,
      quantity: item.cantidad,
      price: `RD$ ${Number(item.precioUnitario || 0).toFixed(2)}`,
      itbis: item.aplicaItbis || itemItbis > 0 ? `RD$ ${itemItbis.toFixed(2)}` : "Exento",
      subtotal: `RD$ ${Number(item.subtotal || 0).toFixed(2)}`
    };
  });

  rows.push({
    index: "",
    code: "",
    name: "SUBTOTAL BASE",
    lot: "",
    expiration: "",
    quantity: factura.totalUnidades as any,
    price: "—",
    itbis: "—",
    subtotal: `RD$ ${calcSubtotal.toFixed(2)}`
  });

  rows.push({
    index: "",
    code: "",
    name: "ITBIS (18%)",
    lot: "",
    expiration: "",
    quantity: "" as any,
    price: "—",
    itbis: calcItbis > 0 ? "18%" : "0%",
    subtotal: `RD$ ${calcItbis.toFixed(2)}`
  });

  rows.push({
    index: "",
    code: "",
    name: `TOTAL FACTURA (${(factura.concepto || "VENTA").toUpperCase()})`,
    lot: "",
    expiration: "",
    quantity: factura.totalUnidades as any,
    price: "—",
    itbis: `RD$ ${calcItbis.toFixed(2)}`,
    subtotal: `RD$ ${calcTotal.toFixed(2)}`
  });

  autoTable(doc, {
    columns,
    body: rows,
    startY,
    theme: "striped",
    headStyles: {
      fillColor: [15, 118, 110],
      textColor: 255,
      fontSize: 8,
      fontStyle: "bold"
    },
    styles: {
      fontSize: 7.5,
      cellPadding: 4.5,
      overflow: "linebreak",
      valign: "middle"
    },
    columnStyles: {
      index: { cellWidth: 22, halign: "center" },
      code: { cellWidth: 45, fontStyle: "bold", textColor: [15, 118, 110] },
      name: { cellWidth: 135 },
      lot: { cellWidth: 52, halign: "center" },
      expiration: { cellWidth: 52, halign: "center" },
      quantity: { cellWidth: 35, halign: "right", fontStyle: "bold" },
      price: { cellWidth: 55, halign: "right" },
      itbis: { cellWidth: 55, halign: "right" },
      subtotal: { cellWidth: 64, halign: "right", fontStyle: "bold" }
    },
    margin: { left: 40, right: 40 },
    willDrawCell: (data) => {
      if (data.row.index >= rows.length - 3) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor =
          data.row.index === rows.length - 1 ? [240, 253, 250] : [248, 250, 252];
        if (data.row.index === rows.length - 1) {
          data.cell.styles.textColor = [15, 118, 110];
        }
      }
    },
    didDrawPage: (data) => {
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184);
      const footerLeft =
        inst.piePagina || `Factura ${factura.numeroFactura} (${factura.concepto}) • ${inst.nombre}`;
      doc.text(footerLeft, 40, doc.internal.pageSize.height - 20);
      doc.text(`Página ${data.pageNumber}`, doc.internal.pageSize.width - 80, doc.internal.pageSize.height - 20);
    }
  });

  doc.save(`Factura_${factura.numeroFactura.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`);
};

/**
 * Exports a Sale / Operation Invoice (Módulo de Venta) to Word with Institutional Logo
 */
export const exportSaleInvoiceToWord = (
  factura: FacturaVenta,
  institucion?: InstitucionInfo
) => {
  const inst = institucion || getActiveInstitucionInfo();
  let rowsHtml = "";

  const calcSubtotal =
    factura.subtotalMonto !== undefined
      ? Number(factura.subtotalMonto)
      : factura.items.reduce((acc, i) => acc + Number(i.subtotal || 0), 0);

  const calcItbis =
    factura.itbisMonto !== undefined
      ? Number(factura.itbisMonto)
      : factura.items.reduce(
          (acc, i) =>
            acc +
            (i.itbisMonto !== undefined
              ? Number(i.itbisMonto)
              : i.aplicaItbis
              ? Number(i.subtotal || 0) * 0.18
              : 0),
          0
        );

  const calcTotal =
    factura.totalMonto !== undefined
      ? Number(factura.totalMonto)
      : calcSubtotal + calcItbis;

  factura.items.forEach((item, idx) => {
    const parts = (item.fechaVencimiento || "").split("-");
    const formattedDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : item.fechaVencimiento || "—";
    const itemItbis =
      item.itbisMonto !== undefined
        ? Number(item.itbisMonto)
        : item.aplicaItbis
        ? Number(item.subtotal || 0) * 0.18
        : 0;

    rowsHtml += `
      <tr style='page-break-inside: avoid;'>
        <td style='border: 1px solid #dddddd; padding: 9px; text-align: center;'>${idx + 1}</td>
        <td style='border: 1px solid #dddddd; padding: 9px; font-weight: bold; color: #0f766e;'>${item.productoCodigo}</td>
        <td style='border: 1px solid #dddddd; padding: 9px;'>
          <div style='font-weight: bold; font-size: 12px; color: #1e293b;'>${item.productoNombre}</div>
          ${item.descripcion ? `<div style='color: #64748b; font-size: 10.5px; margin-top: 2px;'>${item.descripcion}</div>` : ""}
        </td>
        <td style='border: 1px solid #dddddd; padding: 9px; text-align: center; font-family: monospace;'>${item.numeroLote}</td>
        <td style='border: 1px solid #dddddd; padding: 9px; text-align: center;'>${formattedDate}</td>
        <td style='border: 1px solid #dddddd; padding: 9px; text-align: right; font-weight: bold;'>${item.cantidad}</td>
        <td style='border: 1px solid #dddddd; padding: 9px; text-align: right;'>RD$ ${Number(item.precioUnitario || 0).toFixed(2)}</td>
        <td style='border: 1px solid #dddddd; padding: 9px; text-align: right; color: #475569;'>${item.aplicaItbis || itemItbis > 0 ? `RD$ ${itemItbis.toFixed(2)}` : "Exento"}</td>
        <td style='border: 1px solid #dddddd; padding: 9px; text-align: right; font-weight: bold;'>RD$ ${Number(item.subtotal || 0).toFixed(2)}</td>
      </tr>
    `;
  });

  const htmlContent = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head>
      <meta charset='utf-8'>
      <title>Factura ${factura.numeroFactura}</title>
      <style>
        @page { size: 8.5in 11in; margin: 0.9in; }
        body { font-family: Arial, sans-serif; color: #333333; line-height: 1.4; }
        .header-table { width: 100%; border-collapse: collapse; border: none; margin-bottom: 18px; }
        .header-title { font-size: 20px; font-weight: bold; color: #0f766e; margin: 0; }
        .header-subtitle { font-size: 12px; color: #4b5563; margin-top: 4px; margin-bottom: 0; }
        .metadata-box { background-color: #f8fafc; border-left: 4px solid #0f766e; padding: 12px; margin-bottom: 18px; font-size: 12px; }
        .metadata-box table { width: 100%; border-collapse: collapse; border: none; }
        .metadata-label { font-weight: bold; color: #475569; width: 18%; padding: 3px 0; }
        .metadata-value { color: #1e293b; width: 32%; padding: 3px 0; }
        .main-table { width: 100%; border-collapse: collapse; font-size: 11px; font-family: Arial, sans-serif; }
        .main-table th { background-color: #0f766e; color: #ffffff; font-weight: bold; text-align: left; padding: 8px; border: 1px solid #0d9488; }
      </style>
    </head>
    <body>
      ${buildWordInstitutionHeader(`Factura de ${factura.concepto || "Venta"} • N.º ${factura.numeroFactura}`, inst)}

      <div class="metadata-box">
        <table>
          <tr>
            <td class="metadata-label">N.º de Factura:</td>
            <td class="metadata-value"><strong>${factura.numeroFactura}</strong></td>
            <td class="metadata-label">Fecha y Hora:</td>
            <td class="metadata-value">${factura.fecha} ${factura.hora || ""}</td>
          </tr>
          <tr>
            <td class="metadata-label">Concepto:</td>
            <td class="metadata-value"><strong>${factura.concepto || "Venta"}</strong></td>
            <td class="metadata-label">Catálogo:</td>
            <td class="metadata-value">${factura.catalogNombre || "Medicamentos e Insumos"}</td>
          </tr>
          <tr>
            <td class="metadata-label">Cliente:</td>
            <td class="metadata-value">${factura.clienteNombre || "Consumidor Final / General"}</td>
            <td class="metadata-label">Contacto Cliente:</td>
            <td class="metadata-value">${factura.clienteContacto || "No especificado"}</td>
          </tr>
          <tr>
            <td class="metadata-label">Facturado por:</td>
            <td class="metadata-value">${factura.usuarioResponsable}</td>
            <td class="metadata-label">Observaciones:</td>
            <td class="metadata-value">${factura.observaciones || "—"}</td>
          </tr>
        </table>
      </div>

      <table class="main-table">
        <thead>
          <tr>
            <th style="width: 4%; text-align: center;">N.º</th>
            <th style="width: 11%;">Código</th>
            <th style="width: 28%;">Descripción del Producto / Insumo</th>
            <th style="width: 11%; text-align: center;">Lote</th>
            <th style="width: 10%; text-align: center;">Vence</th>
            <th style="width: 7%; text-align: right;">Cant.</th>
            <th style="width: 10%; text-align: right;">Precio Unit.</th>
            <th style="width: 9%; text-align: right;">ITBIS 18%</th>
            <th style="width: 10%; text-align: right;">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
          <tr>
            <td colspan="5" style="border: 1px solid #dddddd; padding: 9px; text-align: right; font-weight: bold; background-color: #f8fafc; font-size: 11.5px;">SUBTOTAL BASE:</td>
            <td style="border: 1px solid #dddddd; padding: 9px; text-align: right; font-weight: bold; background-color: #f8fafc; font-size: 11.5px;">${factura.totalUnidades}</td>
            <td colspan="2" style="border: 1px solid #dddddd; padding: 9px; text-align: right; background-color: #f8fafc;">—</td>
            <td style="border: 1px solid #dddddd; padding: 9px; text-align: right; font-weight: bold; background-color: #f8fafc; font-size: 11.5px;">RD$ ${calcSubtotal.toFixed(2)}</td>
          </tr>
          <tr>
            <td colspan="8" style="border: 1px solid #dddddd; padding: 9px; text-align: right; font-weight: bold; background-color: #f8fafc; font-size: 11.5px;">ITBIS (18%):</td>
            <td style="border: 1px solid #dddddd; padding: 9px; text-align: right; font-weight: bold; background-color: #f8fafc; color: #0369a1; font-size: 11.5px;">RD$ ${calcItbis.toFixed(2)}</td>
          </tr>
          <tr>
            <td colspan="5" style="border: 1px solid #dddddd; padding: 11px 9px; text-align: right; font-weight: bold; background-color: #f0fdfa; font-size: 12.5px;">TOTAL FACTURA (${(factura.concepto || "VENTA").toUpperCase()}):</td>
            <td style="border: 1px solid #dddddd; padding: 11px 9px; text-align: right; font-weight: bold; background-color: #f0fdfa; color: #0f766e; font-size: 12.5px;">${factura.totalUnidades}</td>
            <td colspan="2" style="border: 1px solid #dddddd; padding: 11px 9px; text-align: right; font-weight: bold; background-color: #f0fdfa; font-size: 12.5px;">—</td>
            <td style="border: 1px solid #dddddd; padding: 11px 9px; text-align: right; font-weight: bold; background-color: #f0fdfa; color: #0f766e; font-size: 12.5px;">RD$ ${calcTotal.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
      ${inst.piePagina ? `<p style="margin-top: 20px; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 8px;">${inst.piePagina}</p>` : ""}
    </body>
    </html>
  `;

  const blob = new Blob(["\ufeff" + htmlContent], { type: "application/msword;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Factura_${factura.numeroFactura.replace(/[^a-zA-Z0-9_-]/g, "_")}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * Normalizes a phone number for WhatsApp URL (supports RD 809/829/849 and international numbers)
 */
export const formatPhoneForWhatsApp = (rawPhone?: string): string => {
  if (!rawPhone) return "";
  const digits = rawPhone.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10 && /^(809|829|849)/.test(digits)) {
    return `1${digits}`;
  }
  return digits;
};

/**
 * Generates/downloads the Sale Invoice PDF and opens WhatsApp directly to the client's phone number
 */
export const shareSaleInvoiceViaWhatsApp = (
  factura: FacturaVenta,
  institucion?: InstitucionInfo,
  skipPdfDownload?: boolean
): boolean => {
  const inst = institucion || getActiveInstitucionInfo();
  const cleanPhone = formatPhoneForWhatsApp(factura.clienteContacto);
  if (!cleanPhone) {
    return false;
  }

  // 1. Generate and download the PDF so the user has the exact file ready to attach in WhatsApp
  if (!skipPdfDownload) {
    exportSaleInvoiceToPDF(factura, inst);
  }

  const calcSubtotal =
    factura.subtotalMonto !== undefined
      ? Number(factura.subtotalMonto)
      : factura.items.reduce((acc, i) => acc + Number(i.subtotal || 0), 0);

  const calcItbis =
    factura.itbisMonto !== undefined
      ? Number(factura.itbisMonto)
      : factura.items.reduce(
          (acc, i) =>
            acc +
            (i.itbisMonto !== undefined
              ? Number(i.itbisMonto)
              : i.aplicaItbis
              ? Number(i.subtotal || 0) * 0.18
              : 0),
          0
        );

  const calcTotal =
    factura.totalMonto !== undefined
      ? Number(factura.totalMonto)
      : calcSubtotal + calcItbis;

  const lines: string[] = [
    `*${(inst.nombre || "CONTROL DE STOCK").toUpperCase()}*`,
    ...(inst.rnc ? [`RNC: ${inst.rnc}`] : []),
    `--------------------------------`,
    `*FACTURA N.º:* ${factura.numeroFactura}`,
    `*Concepto:* ${factura.concepto || "Venta"}`,
    `*Fecha:* ${factura.fecha}${factura.hora ? ` ${factura.hora}` : ""}`,
    `*Cliente:* ${factura.clienteNombre || "Consumidor Final"}`,
    ...(factura.clienteContacto ? [`*Contacto:* ${factura.clienteContacto}`] : []),
    `--------------------------------`,
    `*DETALLE DE PRODUCTOS:*`
  ];

  factura.items.forEach((item, idx) => {
    const itemItbis =
      item.itbisMonto !== undefined
        ? Number(item.itbisMonto)
        : item.aplicaItbis
        ? Number(item.subtotal || 0) * 0.18
        : 0;
    lines.push(
      `${idx + 1}. *${item.productoNombre}* (${item.productoCodigo})`,
      `   Cant: ${item.cantidad} x RD$ ${Number(item.precioUnitario || 0).toFixed(2)} = RD$ ${Number(item.subtotal || 0).toFixed(2)}${item.aplicaItbis || itemItbis > 0 ? ` (+ITBIS 18%: RD$ ${itemItbis.toFixed(2)})` : ""}`
    );
  });

  lines.push(
    `--------------------------------`,
    `*Subtotal:* RD$ ${calcSubtotal.toFixed(2)}`,
    `*ITBIS (18%):* RD$ ${calcItbis.toFixed(2)}`,
    `*TOTAL FACTURA:* *RD$ ${calcTotal.toFixed(2)}*`,
    `--------------------------------`,
    `📄 _Se ha generado su comprobante PDF (${factura.numeroFactura})._`
  );

  const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(lines.join("\n"))}`;
  const link = document.createElement("a");
  link.href = whatsappUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  return true;
};

