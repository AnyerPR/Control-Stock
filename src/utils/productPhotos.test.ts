import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "@keep-lts/xlsx";
import { createAdjustedLot, getProductImages, addProductImage, removeProductImage, replaceProductImage } from "./productPhotos";
import type { Lote } from "../types";

for (const bookType of ["xlsx", "xls"] as const) {
  test(`reads rows from ${bookType.toUpperCase()} workbooks`, () => {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([
      ["Medicamento", "Lote", "Cantidad"],
      ["Prueba", "L-01", 20]
    ]);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Inventario");

    const bytes = XLSX.write(workbook, { type: "array", bookType });
    const parsedWorkbook = XLSX.read(bytes, { type: "array" });
    const rows = XLSX.utils.sheet_to_json(parsedWorkbook.Sheets[parsedWorkbook.SheetNames[0]]);

    assert.deepEqual(rows, [{ Medicamento: "Prueba", Lote: "L-01", Cantidad: 20 }]);
  });
}

test("legacy product photo is returned when the photo array is missing", () => {
  assert.deepEqual(getProductImages({ imagen: "legacy" }), ["legacy"]);
  assert.deepEqual(getProductImages({ imagenURL: "legacy-url" }), ["legacy-url"]);
  assert.deepEqual(getProductImages({ imagenes: [], imagen: "legacy" }), ["legacy"]);
  assert.deepEqual(getProductImages({ imagenes: ["first", "second"], imagen: "legacy" }), ["first", "second"]);
});

test("supports adding one, two, and three photos but rejects a fourth", () => {
  const first = addProductImage([], "one");
  const second = addProductImage(first, "two");
  const third = addProductImage(second, "three");
  assert.deepEqual(third, ["one", "two", "three"]);
  assert.throws(() => addProductImage(third, "four"), /máximo de 3/);
});

test("replaces and removes photos without changing the others", () => {
  assert.deepEqual(replaceProductImage(["one", "two"], 0, "new-one"), ["new-one", "two"]);
  assert.deepEqual(removeProductImage(["one", "two", "three"], 1), ["one", "three"]);
  assert.throws(() => replaceProductImage(["one"], 1, "invalid"), /ya no está disponible/);
});

test("adjusts only system fields from physical data and retains unrelated lot values", () => {
  const lot: Lote = {
    id: "lot-1",
    numeroLote: "SYSTEM",
    cantidad: 10,
    cantidadF: 7,
    loteFisico: "PHYSICAL",
    fechaVencimiento: "2027-01-01",
    fechaFisica: "2027-02-01",
    precio: 4.5,
    articuloAjustado: false
  };
  assert.deepEqual(createAdjustedLot(lot, true), {
    ...lot,
    numeroLote: "PHYSICAL",
    cantidad: 7,
    fechaVencimiento: "2027-02-01",
    articuloAjustado: true
  });
  assert.equal(createAdjustedLot(lot, false).articuloAjustado, false);
  assert.equal(createAdjustedLot(lot, false).cantidad, lot.cantidad);
});

test("rejects invalid physical quantities and dates", () => {
  const lot: Lote = {
    id: "lot-1",
    numeroLote: "SYSTEM",
    cantidad: 10,
    cantidadF: -1,
    fechaVencimiento: "2027-01-01",
    fechaFisica: "2027-02-01",
    precio: 4.5
  };
  assert.throws(() => createAdjustedLot(lot, true), /entero válido/);
  assert.throws(() => createAdjustedLot({ ...lot, cantidadF: 5.5 }, true), /entero válido/);
  assert.throws(() => createAdjustedLot({ ...lot, cantidadF: 5, fechaFisica: "not-a-date" }, true), /fecha física/);
  assert.throws(() => createAdjustedLot({ ...lot, cantidadF: 5, fechaFisica: "2027-02-29" }, true), /fecha física/);
  const emptyQuantityLot = { ...lot };
  Object.defineProperty(emptyQuantityLot, "cantidadF", { value: "" });
  assert.throws(() => createAdjustedLot(emptyQuantityLot, true), /entero válido/);
});
