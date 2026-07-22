import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Producto, Lote } from "../types";

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

/**
 * Exports the filtered products list to Microsoft Word (.doc/.docx equivalent).
 */
export const exportToWord = (products: Producto[], filterName: string, catalogName: string) => {
  let rowsHtml = "";
  products.forEach((p, idx) => {
    const stats = getProductStats(p);
    
    // Create nested lots detail list
    let lotsHtml = "<ul style='margin: 0; padding-left: 15px; font-family: Arial, sans-serif; font-size: 11px;'>";
    p.lotes.forEach((l) => {
      const days = getDaysToExpiration(l.fechaVencimiento);
      let statusStyle = "color: #065f46; font-weight: bold;"; // Vigente Green
      let statusLabel = "Vigente";
      
      if (days < 0) {
        statusStyle = "color: #991b1b; font-weight: bold;"; // Vencido Red
        statusLabel = `Vencido (${Math.abs(days)} días atrás)`;
      } else if (days <= 30) {
        statusStyle = "color: #92400e; font-weight: bold;"; // Por vencer Orange
        statusLabel = `Por vencer (${days} días)`;
      } else if (days <= 90) {
        statusStyle = "color: #854d0e; font-weight: bold;"; // Próximo Yellow
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

    // Format status labels
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
        @page {
          size: 11in 8.5in; /* Landscape standard */
          margin: 1.0in 1.0in 1.0in 1.0in;
        }
        body {
          font-family: Arial, sans-serif;
          color: #333333;
          line-height: 1.4;
        }
        .header-table {
          width: 100%;
          border-collapse: collapse;
          border: none;
          margin-bottom: 25px;
        }
        .header-title {
          font-size: 22px;
          font-weight: bold;
          color: #0f766e;
          font-family: Arial, sans-serif;
          margin: 0;
        }
        .header-subtitle {
          font-size: 12px;
          color: #4b5563;
          margin-top: 5px;
          margin-bottom: 0;
        }
        .metadata-box {
          background-color: #f8fafc;
          border-left: 4px solid #0f766e;
          padding: 12px;
          margin-bottom: 25px;
          font-size: 12px;
        }
        .metadata-box table {
          width: 100%;
          border-collapse: collapse;
          border: none;
        }
        .metadata-label {
          font-weight: bold;
          color: #475569;
          width: 15%;
          padding: 3px 0;
        }
        .metadata-value {
          color: #1e293b;
          padding: 3px 0;
        }
        .main-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
          font-family: Arial, sans-serif;
        }
        .main-table th {
          background-color: #0f766e;
          color: #ffffff;
          font-weight: bold;
          text-align: left;
          padding: 12px 10px;
          border: 1px solid #0d9488;
        }
      </style>
    </head>
    <body>
      <table class="header-table">
        <tr>
          <td>
            <div class="header-title">Control de Stock - Reporte de Suministros</div>
            <div class="header-subtitle">Suministros Hospitalarios &bull; Dr. José Manuel Rodríguez</div>
          </td>
        </tr>
      </table>

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
export const exportToPDF = (products: Producto[], filterName: string, catalogName: string) => {
  const doc = new jsPDF("l", "pt", "a4"); // Landscape A4 size

  // Main banner background decoration
  doc.setFillColor(248, 250, 252);
  doc.rect(40, 30, 762, 50, "F");

  // Title text
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(15, 118, 110); // Teal 700
  doc.text("Control de Stock - Reporte de Suministros", 55, 52);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text("Suministros Hospitalarios • Dr. José Manuel Rodríguez", 55, 68);

  // Divider
  doc.setDrawColor(13, 148, 136); // Teal 600
  doc.setLineWidth(2);
  doc.line(40, 80, 802, 80);

  // Metadata boxes
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(30, 41, 59);
  doc.text("Catálogo:", 45, 105);
  doc.text("Filtro Aplicado:", 45, 120);

  doc.text("Fecha Reporte:", 445, 105);
  doc.text("Total Suministros:", 445, 120);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(71, 85, 105);
  doc.text(catalogName, 135, 105);
  doc.text(filterName, 135, 120);
  doc.text(new Date().toLocaleString(), 545, 105);
  doc.text(`${products.length} productos`, 545, 120);

  // Set columns
  const columns = [
    { header: "N.º", dataKey: "index" },
    { header: "Código", dataKey: "code" },
    { header: "Insumo / Medicamento", dataKey: "name" },
    { header: "Lotes (Lote | Stock Sis/Fís | Vence)", dataKey: "lots" },
    { header: "Cant. Sis", dataKey: "sysStock" },
    { header: "Cant. Fís", dataKey: "physStock" },
    { header: "Estado / Verificación", dataKey: "status" }
  ];

  // Map product rows
  const rows = products.map((p, idx) => {
    const stats = getProductStats(p);

    const lotsText = p.lotes.map((l) => {
      const days = getDaysToExpiration(l.fechaVencimiento);
      let statusStr = "Vigente";
      if (days < 0) statusStr = "Vencido";
      else if (days <= 30) statusStr = "Por vencer";
      else if (days <= 90) statusStr = "Próximo";

      const parts = l.fechaVencimiento.split("-");
      const formattedDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : l.fechaVencimiento;
      return `Lot: ${l.numeroLote} | Qty: ${l.cantidad} sist / ${l.cantidadF !== undefined ? l.cantidadF : l.cantidad} fís | Vence: ${formattedDate} (${statusStr})`;
    }).join("\n");

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

  // Call autoTable with custom layout styling
  autoTable(doc, {
    columns: columns,
    body: rows,
    startY: 140,
    theme: "striped",
    headStyles: {
      fillColor: [15, 118, 110], // Teal 700 (#0f766e)
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
      // Footer page numbering
      const totalPages = doc.getNumberOfPages();
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184); // Slate 400
      doc.text(
        `Control de Stock - Reporte Generado el ${new Date().toLocaleDateString()}`,
        40,
        doc.internal.pageSize.height - 20
      );
      doc.text(
        `Página ${data.pageNumber}`,
        doc.internal.pageSize.width - 80,
        doc.internal.pageSize.height - 20
      );
    }
  });

  // Download the PDF
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
export const exportOrderToWord = (orderItems: ExportOrderItem[], catalogName: string) => {
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
        @page {
          size: 8.5in 11in; /* Portrait standard */
          margin: 1.0in 1.0in 1.0in 1.0in;
        }
        body {
          font-family: Arial, sans-serif;
          color: #333333;
          line-height: 1.4;
        }
        .header-table {
          width: 100%;
          border-collapse: collapse;
          border: none;
          margin-bottom: 25px;
        }
        .header-title {
          font-size: 22px;
          font-weight: bold;
          color: #0f766e;
          font-family: Arial, sans-serif;
          margin: 0;
        }
        .header-subtitle {
          font-size: 12px;
          color: #4b5563;
          margin-top: 5px;
          margin-bottom: 0;
        }
        .metadata-box {
          background-color: #f8fafc;
          border-left: 4px solid #0f766e;
          padding: 12px;
          margin-bottom: 25px;
          font-size: 12px;
        }
        .metadata-box table {
          width: 100%;
          border-collapse: collapse;
          border: none;
        }
        .metadata-label {
          font-weight: bold;
          color: #475569;
          width: 20%;
          padding: 3px 0;
        }
        .metadata-value {
          color: #1e293b;
          padding: 3px 0;
        }
        .main-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
          font-family: Arial, sans-serif;
        }
        .main-table th {
          background-color: #0f766e;
          color: #ffffff;
          font-weight: bold;
          text-align: left;
          padding: 12px 10px;
          border: 1px solid #0d9488;
        }
      </style>
    </head>
    <body>
      <table class="header-table">
        <tr>
          <td>
            <div class="header-title">Pedido de Salida de Suministros</div>
            <div class="header-subtitle">Suministros Hospitalarios &bull; Dr. José Manuel Rodríguez</div>
          </td>
        </tr>
      </table>

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
export const exportOrderToPDF = (orderItems: ExportOrderItem[], catalogName: string) => {
  const doc = new jsPDF("p", "pt", "a4"); // Portrait A4 size (595.28 x 841.89 pt)

  // Header background block
  doc.setFillColor(248, 250, 252);
  doc.rect(40, 30, 515, 50, "F");

  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(15, 118, 110); // Teal 700
  doc.text("Pedido de Salida de Suministros", 55, 52);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text("Suministros Hospitalarios • Dr. José Manuel Rodríguez", 55, 68);

  // Divider line
  doc.setDrawColor(13, 148, 136); // Teal 600
  doc.setLineWidth(2);
  doc.line(40, 80, 555, 80);

  // Metadata labels & values
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(30, 41, 59);
  doc.text("Catálogo:", 45, 105);
  doc.text("Tipo de Salida:", 45, 120);

  doc.text("Fecha Pedido:", 320, 105);
  doc.text("Total Ítems:", 320, 120);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(71, 85, 105);
  doc.text(catalogName || "Medicamentos e Insumos", 125, 105);
  doc.text("Despacho / Pedido de Stock", 125, 120);
  doc.text(new Date().toLocaleString(), 400, 105);
  doc.text(`${orderItems.length} tipos de suministros`, 400, 120);

  // Columns for the table
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

  // Append total row
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

  // Render Table
  autoTable(doc, {
    columns: columns,
    body: rows,
    startY: 140,
    theme: "striped",
    headStyles: {
      fillColor: [15, 118, 110], // Teal 700 (#0f766e)
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
      // Bold style for totals row
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
      doc.setTextColor(148, 163, 184); // Slate 400
      doc.text(
        `Pedido de Stock - Documento Generado el ${new Date().toLocaleDateString()}`,
        40,
        doc.internal.pageSize.height - 20
      );
      doc.text(
        `Página ${data.pageNumber}`,
        doc.internal.pageSize.width - 80,
        doc.internal.pageSize.height - 20
      );
    }
  });

  doc.save(`Pedido_Stock_${new Date().toISOString().slice(0, 10)}.pdf`);
};
