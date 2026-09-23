import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Producto, Lote, InstitucionConfig } from "../types";
import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  HeadingLevel,
  AlignmentType,
  WidthType,
  BorderStyle,
  ImageRun
} from "docx";

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
        @page Section1 {
          size: 8.5in 11in;
          margin: 0.75in 0.75in 0.75in 0.75in;
          mso-header-margin: 0.5in;
          mso-footer-margin: 0.5in;
          mso-paper-source: 0;
        }
        div.Section1 {
          page: Section1;
        }
        body {
          font-family: Arial, Helvetica, sans-serif;
          color: #1e293b;
          font-size: 10pt;
          line-height: 1.3;
          margin: 0;
          padding: 0;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          mso-table-lspace: 0pt;
          mso-table-rspace: 0pt;
        }
        .header-table {
          width: 100%;
          border-collapse: collapse;
          border: none;
          margin-bottom: 16pt;
        }
        .header-title {
          font-size: 16pt;
          font-weight: bold;
          color: #0f766e;
          font-family: Arial, sans-serif;
          margin: 0;
        }
        .header-subtitle {
          font-size: 9pt;
          color: #64748b;
          margin-top: 3pt;
          margin-bottom: 0;
        }
        .metadata-box {
          background-color: #f8fafc;
          border: 1px solid #cbd5e1;
          border-left: 4pt solid #0f766e;
          padding: 8pt 10pt;
          margin-bottom: 16pt;
          font-size: 9pt;
        }
        .metadata-table {
          width: 100%;
          border-collapse: collapse;
        }
        .metadata-label {
          font-weight: bold;
          color: #475569;
          width: 20%;
          padding: 3pt 0;
        }
        .metadata-value {
          color: #0f172a;
          padding: 3pt 0;
          width: 30%;
        }
        .main-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          font-size: 9pt;
          font-family: Arial, sans-serif;
        }
        .main-table th {
          background-color: #0f766e;
          color: #ffffff;
          font-weight: bold;
          font-size: 8.5pt;
          text-transform: uppercase;
          text-align: left;
          padding: 7pt 6pt;
          border: 1px solid #0d9488;
        }
        .main-table td {
          padding: 6pt 6pt;
          border: 1px solid #cbd5e1;
          font-size: 8.5pt;
          vertical-align: middle;
        }
      </style>
    </head>
    <body>
      <div class="Section1">
        <table class="header-table">
          <tr>
            <td>
              <div class="header-title">Pedido de Salida de Suministros</div>
              <div class="header-subtitle">Suministros Hospitalarios &bull; Dr. José Manuel Rodríguez</div>
            </td>
          </tr>
        </table>

        <div class="metadata-box">
          <table class="metadata-table">
            <tr>
              <td class="metadata-label">Catálogo:</td>
              <td class="metadata-value"><strong>${catalogName || "Medicamentos e Insumos"}</strong></td>
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
              <th style="width: 14%;">Código</th>
              <th style="width: 33%;">Medicamento / Insumo</th>
              <th style="width: 12%; text-align: center;">Lote</th>
              <th style="width: 12%; text-align: center;">Vencimiento</th>
              <th style="width: 8%; text-align: right;">Cantidad</th>
              <th style="width: 8%; text-align: right;">Precio Unit.</th>
              <th style="width: 8%; text-align: right;">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
            <tr>
              <td colspan="5" style="border: 1px solid #cbd5e1; padding: 8pt 6pt; text-align: right; font-weight: bold; background-color: #f8fafc; font-size: 9.5pt;">TOTAL GENERAL:</td>
              <td style="border: 1px solid #cbd5e1; padding: 8pt 6pt; text-align: right; font-weight: bold; background-color: #f8fafc; color: #0f766e; font-size: 9.5pt;">${totalCantidad}</td>
              <td style="border: 1px solid #cbd5e1; padding: 8pt 6pt; text-align: right; font-weight: bold; background-color: #f8fafc; font-size: 9.5pt;">—</td>
              <td style="border: 1px solid #cbd5e1; padding: 8pt 6pt; text-align: right; font-weight: bold; background-color: #f8fafc; color: #0f766e; font-size: 9.5pt;">RD$ ${totalPrecio.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </div>
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

export interface FacturaExportItem {
  productoCodigo: string;
  productoNombre: string;
  descripcion?: string;
  lote: string;
  cantidad: number;
  precio: number;
}

export interface FacturaExportData {
  facturaId: string;
  facturaDisplay: string;
  isHistoricalLegacy?: boolean;
  fecha: string;
  usuario: string;
  proveedor?: string;
  estado?: string;
  items: FacturaExportItem[];
  totalCantidad: number;
  totalCosto: number;
  institucion?: InstitucionConfig | null;
}

const safeBase64ToUint8Array = (str: string): Uint8Array | null => {
  try {
    const commaIndex = str.indexOf(",");
    const b64 = commaIndex >= 0 ? str.slice(commaIndex + 1) : str;
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch (err) {
    console.warn("Error converting base64 to Uint8Array:", err);
    return null;
  }
};

/**
 * Exports a grouped invoice/entry to a professional, printable PDF document.
 */
export const exportFacturaToPDF = (data: FacturaExportData) => {
  const doc = new jsPDF("p", "pt", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;

  const inst = data.institucion || ({} as Partial<InstitucionConfig>);
  const instNombre = (inst.nombre && inst.nombre.trim()) || "Suministros Hospitalarios";
  const instFiscal = inst.identificadorFiscal && inst.identificadorFiscal.trim();
  const instDir = inst.direccion && inst.direccion.trim();
  const instTel = inst.telefono && inst.telefono.trim();
  const instEmail = inst.correo && inst.correo.trim();
  const instWeb = inst.paginaWeb && inst.paginaWeb.trim();
  const instInfoExtra = inst.informacionAdicional && inst.informacionAdicional.trim();

  let headerCurrentY = 36;
  let textStartX = margin;

  // 1. Draw Logo if available
  if (inst.logo && inst.logo.startsWith("data:image/")) {
    try {
      const props = doc.getImageProperties(inst.logo);
      const maxW = 95;
      const maxH = 50;
      const scale = Math.min(maxW / props.width, maxH / props.height);
      const logoW = Math.max(20, props.width * scale);
      const logoH = Math.max(20, props.height * scale);

      doc.addImage(inst.logo, margin, headerCurrentY, logoW, logoH);
      textStartX = margin + logoW + 16;
    } catch (e) {
      console.warn("Could not draw logo in PDF:", e);
    }
  }

  // 2. Institution Details (Right of Logo or Full Width)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(15, 118, 110); // Teal 700
  doc.text(instNombre, textStartX, headerCurrentY + 12);

  let subY = headerCurrentY + 25;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105); // Slate 600

  if (instFiscal) {
    doc.text(`RNC / ID Fiscal: ${instFiscal}`, textStartX, subY);
    subY += 12;
  }

  const contactParts = [instDir, instTel, instEmail].filter(Boolean);
  if (contactParts.length > 0) {
    doc.text(contactParts.join(" • "), textStartX, subY);
    subY += 12;
  }

  if (instWeb) {
    doc.setTextColor(13, 148, 136); // Teal 600
    doc.text(instWeb, textStartX, subY);
    subY += 12;
  }

  const dividerY = Math.max(headerCurrentY + 58, subY + 6);

  // Decorative Accent Line
  doc.setDrawColor(13, 148, 136); // Teal 600
  doc.setLineWidth(2);
  doc.line(margin, dividerY, pageWidth - margin, dividerY);

  // 3. Invoice Summary Banner Box
  const bannerY = dividerY + 14;
  const bannerH = 78;
  doc.setFillColor(248, 250, 252); // Slate 50
  doc.setDrawColor(226, 232, 240); // Slate 200
  doc.setLineWidth(1);
  doc.roundedRect(margin, bannerY, contentWidth, bannerH, 6, 6, "FD");

  // Left Banner Section
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42); // Slate 900
  doc.text("COMPROBANTE DE ENTRADA DE SUMINISTROS", margin + 14, bannerY + 18);

  doc.setFontSize(9);
  doc.setTextColor(15, 118, 110); // Teal 700
  const facLabel = data.isHistoricalLegacy
    ? `${data.facturaDisplay}`
    : `FACTURA N.º: ${data.facturaDisplay}`;
  doc.text(facLabel, margin + 14, bannerY + 34);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105); // Slate 600

  const formattedDate = data.fecha
    ? new Date(data.fecha).toLocaleString("es-DO", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      })
    : "No especificada";

  doc.text(`Fecha y Hora de Entrada: ${formattedDate}`, margin + 14, bannerY + 48);

  if (data.proveedor && data.proveedor.trim()) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 41, 59); // Slate 800
    doc.text(`Proveedor: ${data.proveedor.trim()}`, margin + 14, bannerY + 63);
  }

  // Right Banner Section
  const rightColX = margin + contentWidth - 190;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text(`Responsable: ${data.usuario || "Sistema"}`, rightColX, bannerY + 22);
  doc.text(`Estado: ${data.estado || "Completada"}`, rightColX, bannerY + 36);
  doc.text(`Total Ítems: ${data.items.length} productos (${data.totalCantidad} unds.)`, rightColX, bannerY + 50);

  if (data.totalCosto > 0) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 118, 110);
    doc.text(
      `Monto Total: RD$ ${data.totalCosto.toLocaleString("es-DO", { minimumFractionDigits: 2 })}`,
      rightColX,
      bannerY + 65
    );
  }

  // 4. Products Table
  const tableStartY = bannerY + bannerH + 16;
  const tableRows = data.items.map((it, idx) => {
    const subtotal = Number(it.cantidad || 0) * Number(it.precio || 0);
    return [
      (idx + 1).toString(),
      it.productoCodigo,
      it.productoNombre,
      it.lote || "—",
      it.cantidad.toString(),
      it.precio > 0 ? `RD$ ${it.precio.toFixed(2)}` : "—",
      subtotal > 0 ? `RD$ ${subtotal.toFixed(2)}` : "—"
    ];
  });

  // Summary row at the bottom
  tableRows.push([
    "",
    "",
    `TOTALES (${data.items.length} productos)`,
    "",
    data.totalCantidad.toString(),
    "",
    data.totalCosto > 0 ? `RD$ ${data.totalCosto.toLocaleString("es-DO", { minimumFractionDigits: 2 })}` : "—"
  ]);

  autoTable(doc, {
    startY: tableStartY,
    margin: { left: margin, right: margin },
    head: [["#", "Código", "Medicamento / Suministro", "Lote", "Cantidad", "Costo Unit.", "Subtotal"]],
    body: tableRows,
    theme: "striped",
    headStyles: {
      fillColor: [15, 118, 110], // Teal 700
      textColor: [255, 255, 255],
      fontSize: 8,
      fontStyle: "bold",
      halign: "left"
    },
    styles: {
      fontSize: 8,
      cellPadding: 5.5,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.5
    },
    columnStyles: {
      0: { halign: "center", cellWidth: 26 },
      1: { halign: "left", cellWidth: 68, fontStyle: "bold", textColor: [15, 118, 110] },
      2: { halign: "left" }, // Auto-expands
      3: { halign: "left", cellWidth: 72 },
      4: { halign: "right", cellWidth: 50, fontStyle: "bold" },
      5: { halign: "right", cellWidth: 68 },
      6: { halign: "right", cellWidth: 72, fontStyle: "bold" }
    },
    willDrawCell: (cellData) => {
      // Bold highlight for totals row
      if (cellData.row.index === tableRows.length - 1) {
        cellData.cell.styles.fontStyle = "bold";
        cellData.cell.styles.fillColor = [241, 245, 249]; // Slate 100
        if (cellData.column.index === 2 || cellData.column.index === 4 || cellData.column.index === 6) {
          cellData.cell.styles.textColor = [15, 118, 110];
        }
      }
    },
    didDrawPage: (pageData) => {
      // Document Footer on each page
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184); // Slate 400
      const footerDate = new Date().toLocaleString("es-DO");
      doc.text(
        `Comprobante de Entrada de Factura • Generado el ${footerDate}`,
        margin,
        pageHeight - 22
      );
      doc.text(
        `Página ${pageData.pageNumber}`,
        pageWidth - margin - 45,
        pageHeight - 22
      );
    }
  });

  // 5. Signatures and Additional Info
  const finalY = (doc as any).lastAutoTable ? (doc as any).lastAutoTable.finalY + 25 : tableStartY + 100;
  
  if (finalY + 90 < pageHeight) {
    if (instInfoExtra) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text(`Nota: ${instInfoExtra}`, margin, finalY);
    }

    const signY = finalY + (instInfoExtra ? 28 : 16);
    const boxW = 200;

    // Delivery signature
    doc.setDrawColor(203, 213, 225);
    doc.line(margin + 20, signY + 30, margin + 20 + boxW, signY + 30);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text("Entregado Conforme (Proveedor / Despacho)", margin + 35, signY + 42);

    // Reception signature
    const signRightX = pageWidth - margin - boxW - 20;
    doc.line(signRightX, signY + 30, signRightX + boxW, signY + 30);
    doc.text("Recibido Conforme (Almacén y Suministros)", signRightX + 20, signY + 42);
  }

  const cleanFileName = (data.facturaDisplay || "Factura").replace(/[^a-zA-Z0-9_-]/g, "_");
  doc.save(`Factura_${cleanFileName}_${new Date().toISOString().slice(0, 10)}.pdf`);
};

/**
 * Exports a grouped invoice/entry to a native Microsoft Word (.docx) document.
 */
export const exportFacturaToWord = async (data: FacturaExportData) => {
  const inst = data.institucion || ({} as Partial<InstitucionConfig>);
  const instNombre = (inst.nombre && inst.nombre.trim()) || "Suministros Hospitalarios";
  const instFiscal = inst.identificadorFiscal && inst.identificadorFiscal.trim();
  const instDir = inst.direccion && inst.direccion.trim();
  const instTel = inst.telefono && inst.telefono.trim();
  const instEmail = inst.correo && inst.correo.trim();
  const instWeb = inst.paginaWeb && inst.paginaWeb.trim();
  const instInfoExtra = inst.informacionAdicional && inst.informacionAdicional.trim();

  const formattedDate = data.fecha
    ? new Date(data.fecha).toLocaleString("es-DO", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      })
    : "No especificada";

  try {
    // Convert logo image if provided as base64
    let logoImageRun: ImageRun | null = null;
    if (inst.logo && inst.logo.startsWith("data:image/")) {
      const u8 = safeBase64ToUint8Array(inst.logo);
      if (u8) {
        try {
          logoImageRun = new ImageRun({
            data: u8,
            transformation: {
              width: 110,
              height: 48
            },
            type: "png"
          } as any);
        } catch (imgErr) {
          console.warn("Could not create ImageRun for Word:", imgErr);
        }
      }
    }

    // 1. Institution Header Table / Paragraphs
    const headerParagraphs: Paragraph[] = [
      new Paragraph({
        children: [
          new TextRun({
            text: instNombre,
            bold: true,
            size: 28, // 14pt
            color: "0F766E" // Teal 700
          })
        ]
      })
    ];

    if (instFiscal) {
      headerParagraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `RNC / ID Fiscal: ${instFiscal}`,
              size: 18, // 9pt
              color: "475569"
            })
          ]
        })
      );
    }

    const contactStr = [instDir, instTel, instEmail, instWeb].filter(Boolean).join(" • ");
    if (contactStr) {
      headerParagraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: contactStr,
              size: 17, // 8.5pt
              color: "64748B"
            })
          ]
        })
      );
    }

    let topHeaderTable: Table | Paragraph;
    if (logoImageRun) {
      topHeaderTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 25, type: WidthType.PERCENTAGE },
                borders: {
                  top: { style: BorderStyle.NONE },
                  bottom: { style: BorderStyle.NONE },
                  left: { style: BorderStyle.NONE },
                  right: { style: BorderStyle.NONE }
                },
                children: [new Paragraph({ children: [logoImageRun] })]
              }),
              new TableCell({
                width: { size: 75, type: WidthType.PERCENTAGE },
                borders: {
                  top: { style: BorderStyle.NONE },
                  bottom: { style: BorderStyle.NONE },
                  left: { style: BorderStyle.NONE },
                  right: { style: BorderStyle.NONE }
                },
                children: headerParagraphs
              })
            ]
          })
        ]
      });
    } else {
      topHeaderTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                borders: {
                  top: { style: BorderStyle.NONE },
                  bottom: { style: BorderStyle.NONE },
                  left: { style: BorderStyle.NONE },
                  right: { style: BorderStyle.NONE }
                },
                children: headerParagraphs
              })
            ]
          })
        ]
      });
    }

    // 2. Invoice Details Box
    const invoiceDetailsTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 55, type: WidthType.PERCENTAGE },
              shading: { fill: "F8FAFC" },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: "COMPROBANTE DE ENTRADA DE SUMINISTROS",
                      bold: true,
                      size: 20,
                      color: "0F172A"
                    })
                  ]
                }),
                new Paragraph({
                  children: [
                    new TextRun({
                      text: data.isHistoricalLegacy ? data.facturaDisplay : `FACTURA N.º: ${data.facturaDisplay}`,
                      bold: true,
                      size: 19,
                      color: "0F766E"
                    })
                  ]
                }),
                new Paragraph({
                  children: [
                    new TextRun({
                      text: `Fecha de Entrada: ${formattedDate}`,
                      size: 17,
                      color: "475569"
                    })
                  ]
                }),
                ...(data.proveedor && data.proveedor.trim()
                  ? [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: `Proveedor: ${data.proveedor.trim()}`,
                            bold: true,
                            size: 18,
                            color: "1E293B"
                          })
                        ]
                      })
                    ]
                  : [])
              ]
            }),
            new TableCell({
              width: { size: 45, type: WidthType.PERCENTAGE },
              shading: { fill: "F8FAFC" },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: `Responsable: ${data.usuario || "Sistema"}`,
                      size: 17,
                      color: "475569"
                    })
                  ]
                }),
                new Paragraph({
                  children: [
                    new TextRun({
                      text: `Estado: ${data.estado || "Completada"}`,
                      size: 17,
                      color: "475569"
                    })
                  ]
                }),
                new Paragraph({
                  children: [
                    new TextRun({
                      text: `Productos: ${data.items.length} (${data.totalCantidad} unidades)`,
                      size: 17,
                      color: "475569"
                    })
                  ]
                }),
                ...(data.totalCosto > 0
                  ? [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: `Total Factura: RD$ ${data.totalCosto.toLocaleString("es-DO", {
                              minimumFractionDigits: 2
                            })}`,
                            bold: true,
                            size: 18,
                            color: "0F766E"
                          })
                        ]
                      })
                    ]
                  : [])
              ]
            })
          ]
        })
      ]
    });

    // 3. Products Table Rows
    const tableHeaderRow = new TableRow({
      tableHeader: true,
      children: [
        new TableCell({
          shading: { fill: "0F766E" },
          children: [new Paragraph({ children: [new TextRun({ text: "#", bold: true, color: "FFFFFF", size: 17 })] })]
        }),
        new TableCell({
          shading: { fill: "0F766E" },
          children: [new Paragraph({ children: [new TextRun({ text: "CÓDIGO", bold: true, color: "FFFFFF", size: 17 })] })]
        }),
        new TableCell({
          shading: { fill: "0F766E" },
          children: [new Paragraph({ children: [new TextRun({ text: "MEDICAMENTO / SUMINISTRO", bold: true, color: "FFFFFF", size: 17 })] })]
        }),
        new TableCell({
          shading: { fill: "0F766E" },
          children: [new Paragraph({ children: [new TextRun({ text: "LOTE", bold: true, color: "FFFFFF", size: 17 })] })]
        }),
        new TableCell({
          shading: { fill: "0F766E" },
          children: [new Paragraph({ children: [new TextRun({ text: "CANTIDAD", bold: true, color: "FFFFFF", size: 17 })] })]
        }),
        new TableCell({
          shading: { fill: "0F766E" },
          children: [new Paragraph({ children: [new TextRun({ text: "COSTO UNIT.", bold: true, color: "FFFFFF", size: 17 })] })]
        }),
        new TableCell({
          shading: { fill: "0F766E" },
          children: [new Paragraph({ children: [new TextRun({ text: "SUBTOTAL", bold: true, color: "FFFFFF", size: 17 })] })]
        })
      ]
    });

    const itemRows = data.items.map((it, idx) => {
      const subtotal = Number(it.cantidad || 0) * Number(it.precio || 0);
      const isEven = idx % 2 === 0;
      const bg = isEven ? "FFFFFF" : "F8FAFC";

      return new TableRow({
        children: [
          new TableCell({
            shading: { fill: bg },
            children: [new Paragraph({ children: [new TextRun({ text: (idx + 1).toString(), size: 16 })] })]
          }),
          new TableCell({
            shading: { fill: bg },
            children: [
              new Paragraph({
                children: [new TextRun({ text: it.productoCodigo, bold: true, color: "0F766E", size: 16 })]
              })
            ]
          }),
          new TableCell({
            shading: { fill: bg },
            children: [new Paragraph({ children: [new TextRun({ text: it.productoNombre, size: 16 })] })]
          }),
          new TableCell({
            shading: { fill: bg },
            children: [new Paragraph({ children: [new TextRun({ text: it.lote || "—", size: 16 })] })]
          }),
          new TableCell({
            shading: { fill: bg },
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ text: it.cantidad.toString(), bold: true, size: 16 })]
              })
            ]
          }),
          new TableCell({
            shading: { fill: bg },
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: it.precio > 0 ? `RD$ ${it.precio.toFixed(2)}` : "—",
                    size: 16
                  })
                ]
              })
            ]
          }),
          new TableCell({
            shading: { fill: bg },
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: subtotal > 0 ? `RD$ ${subtotal.toFixed(2)}` : "—",
                    bold: true,
                    size: 16
                  })
                ]
              })
            ]
          })
        ]
      });
    });

    // Total Row
    const totalsRow = new TableRow({
      children: [
        new TableCell({
          shading: { fill: "F1F5F9" },
          children: [new Paragraph({ children: [] })]
        }),
        new TableCell({
          shading: { fill: "F1F5F9" },
          children: [new Paragraph({ children: [] })]
        }),
        new TableCell({
          shading: { fill: "F1F5F9" },
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: `TOTALES (${data.items.length} productos)`,
                  bold: true,
                  color: "0F766E",
                  size: 17
                })
              ]
            })
          ]
        }),
        new TableCell({
          shading: { fill: "F1F5F9" },
          children: [new Paragraph({ children: [] })]
        }),
        new TableCell({
          shading: { fill: "F1F5F9" },
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: data.totalCantidad.toString(), bold: true, color: "0F766E", size: 17 })]
            })
          ]
        }),
        new TableCell({
          shading: { fill: "F1F5F9" },
          children: [new Paragraph({ children: [] })]
        }),
        new TableCell({
          shading: { fill: "F1F5F9" },
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [
                new TextRun({
                  text:
                    data.totalCosto > 0
                      ? `RD$ ${data.totalCosto.toLocaleString("es-DO", { minimumFractionDigits: 2 })}`
                      : "—",
                  bold: true,
                  color: "0F766E",
                  size: 17
                })
              ]
            })
          ]
        })
      ]
    });

    const productsTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [tableHeaderRow, ...itemRows, totalsRow]
    });

    // 4. Signatures Table
    const signaturesTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              borders: {
                top: { style: BorderStyle.NONE },
                bottom: { style: BorderStyle.NONE },
                left: { style: BorderStyle.NONE },
                right: { style: BorderStyle.NONE }
              },
              children: [
                new Paragraph({ text: "" }),
                new Paragraph({ text: "" }),
                new Paragraph({ text: "____________________________________", alignment: AlignmentType.CENTER }),
                new Paragraph({
                  text: "Entregado Conforme (Proveedor / Despacho)",
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: "Entregado Conforme (Proveedor / Despacho)", size: 16, color: "475569" })]
                })
              ]
            }),
            new TableCell({
              borders: {
                top: { style: BorderStyle.NONE },
                bottom: { style: BorderStyle.NONE },
                left: { style: BorderStyle.NONE },
                right: { style: BorderStyle.NONE }
              },
              children: [
                new Paragraph({ text: "" }),
                new Paragraph({ text: "" }),
                new Paragraph({ text: "____________________________________", alignment: AlignmentType.CENTER }),
                new Paragraph({
                  text: "Recibido Conforme (Almacén y Suministros)",
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: "Recibido Conforme (Almacén y Suministros)", size: 16, color: "475569" })]
                })
              ]
            })
          ]
        })
      ]
    });

    const docChildren: any[] = [
      topHeaderTable,
      new Paragraph({ text: "" }),
      invoiceDetailsTable,
      new Paragraph({ text: "" }),
      productsTable,
      new Paragraph({ text: "" })
    ];

    if (instInfoExtra) {
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `Nota institucional: ${instInfoExtra}`,
              italics: true,
              size: 16,
              color: "64748B"
            })
          ]
        })
      );
    }

    docChildren.push(signaturesTable);

    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 720,
                bottom: 720,
                left: 720,
                right: 720
              }
            }
          },
          children: docChildren
        }
      ]
    });

    const blob = await Packer.toBlob(doc);
    const cleanFileName = (data.facturaDisplay || "Factura").replace(/[^a-zA-Z0-9_-]/g, "_");
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = `Factura_${cleanFileName}_${new Date().toISOString().slice(0, 10)}.docx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);
  } catch (docxErr) {
    console.warn("docx export failed, using HTML docx fallback:", docxErr);
    // Bulletproof fallback using Word-compliant HTML document
    exportFacturaToWordHtmlFallback(data);
  }
};

/**
 * Fallback Word exporter using high-compatibility HTML format.
 */
const exportFacturaToWordHtmlFallback = (data: FacturaExportData) => {
  const inst = data.institucion || ({} as Partial<InstitucionConfig>);
  const instNombre = (inst.nombre && inst.nombre.trim()) || "Suministros Hospitalarios";
  const instFiscal = inst.identificadorFiscal && inst.identificadorFiscal.trim();
  const instDir = inst.direccion && inst.direccion.trim();
  const instTel = inst.telefono && inst.telefono.trim();
  const instEmail = inst.correo && inst.correo.trim();
  const instWeb = inst.paginaWeb && inst.paginaWeb.trim();
  const instInfoExtra = inst.informacionAdicional && inst.informacionAdicional.trim();

  const formattedDate = data.fecha
    ? new Date(data.fecha).toLocaleString("es-DO")
    : "No especificada";

  let html = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head><meta charset='utf-8'><title>Factura ${data.facturaDisplay}</title>
    <style>
      body { font-family: Calibri, Arial, sans-serif; margin: 20px; color: #1e293b; }
      .header-title { font-size: 16pt; font-weight: bold; color: #0f766e; }
      .header-sub { font-size: 9.5pt; color: #475569; }
      .card-box { background: #f8fafc; border: 1px solid #cbd5e1; padding: 12px; margin-top: 15px; margin-bottom: 15px; }
      table.data-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
      table.data-table th { background: #0f766e; color: #ffffff; padding: 6px 8px; font-size: 9pt; border: 1px solid #0f766e; text-align: left; }
      table.data-table td { padding: 5px 8px; font-size: 8.5pt; border: 1px solid #cbd5e1; }
      .text-right { text-align: right; }
      .bold { font-weight: bold; }
    </style>
    </head>
    <body>
      <div>
        ${inst.logo ? `<img src="${inst.logo}" style="max-height: 50px; float: left; margin-right: 15px;" />` : ""}
        <div class="header-title">${instNombre}</div>
        ${instFiscal ? `<div class="header-sub">RNC / ID Fiscal: ${instFiscal}</div>` : ""}
        <div class="header-sub">${[instDir, instTel, instEmail, instWeb].filter(Boolean).join(" • ")}</div>
      </div>
      <div style="clear: both; height: 10px;"></div>
      <hr style="border: 1px solid #0f766e;" />

      <div class="card-box">
        <table style="width: 100%;">
          <tr>
            <td style="vertical-align: top; width: 60%;">
              <strong style="font-size: 11pt; color: #0f172a;">COMPROBANTE DE ENTRADA DE SUMINISTROS</strong><br/>
              <strong style="color: #0f766e;">${data.isHistoricalLegacy ? data.facturaDisplay : `FACTURA N.º: ${data.facturaDisplay}`}</strong><br/>
              <span>Fecha: ${formattedDate}</span><br/>
              ${data.proveedor ? `<strong>Proveedor: ${data.proveedor}</strong><br/>` : ""}
            </td>
            <td style="vertical-align: top; width: 40%;">
              <span>Responsable: ${data.usuario}</span><br/>
              <span>Estado: ${data.estado || "Completada"}</span><br/>
              <span>Ítems: ${data.items.length} productos (${data.totalCantidad} unds.)</span><br/>
              ${data.totalCosto > 0 ? `<strong style="color: #0f766e;">Monto Total: RD$ ${data.totalCosto.toFixed(2)}</strong>` : ""}
            </td>
          </tr>
        </table>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 30px; text-align: center;">#</th>
            <th>Código</th>
            <th>Medicamento / Suministro</th>
            <th>Lote</th>
            <th class="text-right">Cantidad</th>
            <th class="text-right">Costo Unit.</th>
            <th class="text-right">Subtotal</th>
          </tr>
        </thead>
        <tbody>
  `;

  data.items.forEach((it, idx) => {
    const subtotal = Number(it.cantidad || 0) * Number(it.precio || 0);
    html += `
      <tr>
        <td style="text-align: center;">${idx + 1}</td>
        <td class="bold" style="color: #0f766e;">${it.productoCodigo}</td>
        <td>${it.productoNombre}</td>
        <td>${it.lote || "—"}</td>
        <td class="text-right bold">${it.cantidad}</td>
        <td class="text-right">${it.precio > 0 ? `RD$ ${it.precio.toFixed(2)}` : "—"}</td>
        <td class="text-right bold">${subtotal > 0 ? `RD$ ${subtotal.toFixed(2)}` : "—"}</td>
      </tr>
    `;
  });

  html += `
      <tr style="background: #f1f5f9; font-weight: bold;">
        <td colspan="4" style="color: #0f766e;">TOTALES (${data.items.length} productos)</td>
        <td class="text-right" style="color: #0f766e;">${data.totalCantidad}</td>
        <td></td>
        <td class="text-right" style="color: #0f766e;">${data.totalCosto > 0 ? `RD$ ${data.totalCosto.toFixed(2)}` : "—"}</td>
      </tr>
    </tbody>
  </table>
  `;

  if (instInfoExtra) {
    html += `<p style="font-size: 8.5pt; color: #64748b; font-style: italic; margin-top: 15px;">Nota: ${instInfoExtra}</p>`;
  }

  html += `
      <br/><br/>
      <table style="width: 100%; margin-top: 30px;">
        <tr>
          <td style="text-align: center; width: 50%;">
            __________________________________________<br/>
            <span style="font-size: 8pt; color: #475569;">Entregado Conforme (Proveedor / Despacho)</span>
          </td>
          <td style="text-align: center; width: 50%;">
            __________________________________________<br/>
            <span style="font-size: 8pt; color: #475569;">Recibido Conforme (Almacén y Suministros)</span>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  const blob = new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const cleanFileName = (data.facturaDisplay || "Factura").replace(/[^a-zA-Z0-9_-]/g, "_");
  const a = document.createElement("a");
  a.href = url;
  a.download = `Factura_${cleanFileName}_${new Date().toISOString().slice(0, 10)}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
