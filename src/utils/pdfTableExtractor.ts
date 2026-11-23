/**
 * Extractor de Tablas de Inventario desde archivos PDF (100% cliente / compatible con modo offline y single-file).
 * Soporta flujos comprimidos FlateDecode, mapas de caracteres ToUnicode (CMap),
 * codificación WinAnsi/UTF-16BE, posicionamiento 2D (Tm, Td, TD, T*, cm, TJ, Tj),
 * encabezados divididos en dos líneas y filas con nombres de suministros multilínea.
 */

export interface PdfPositionedItem {
  page: number;
  x: number;
  y: number;
  width: number;
  text: string;
}

export interface PdfExtractionResult {
  matrix: string[][];
  pageCount: number;
}

// Mapa Windows-1252 para bytes 0x80 - 0x9F en fuentes PDF estándar (WinAnsiEncoding)
const WIN1252_EXT: Record<number, number> = {
  0x80: 0x20ac,
  0x82: 0x201a,
  0x83: 0x0192,
  0x84: 0x201e,
  0x85: 0x2026,
  0x86: 0x2020,
  0x87: 0x2021,
  0x88: 0x02c6,
  0x89: 0x2030,
  0x8a: 0x0160,
  0x8b: 0x2039,
  0x8c: 0x0152,
  0x8e: 0x017d,
  0x91: 0x2018,
  0x92: 0x2019,
  0x93: 0x201c,
  0x94: 0x201d,
  0x95: 0x2022,
  0x96: 0x2013,
  0x97: 0x2014,
  0x98: 0x02dc,
  0x99: 0x2122,
  0x9a: 0x0161,
  0x9b: 0x203a,
  0x9c: 0x0153,
  0x9e: 0x017e,
  0x9f: 0x0178
};

function bytesToLatin1(bytes: Uint8Array): string {
  let out = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length));
    out += String.fromCharCode.apply(null, Array.from(slice));
  }
  return out;
}

async function tryDecompressWithFormat(data: Uint8Array, format: "deflate" | "deflate-raw"): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === "undefined") return null;
  try {
    const ds = new DecompressionStream(format);
    const writer = ds.writable.getWriter();
    writer.write(data).catch(() => {});
    writer.close().catch(() => {});

    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    let totalLen = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        totalLen += value.length;
      }
    }
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of chunks) {
      result.set(c, offset);
      offset += c.length;
    }
    return result.length > 0 ? result : null;
  } catch {
    return null;
  }
}

async function decompressFlateStream(rawBytes: Uint8Array): Promise<Uint8Array | null> {
  // Trim leading/trailing CR/LF from stream slice
  let start = 0;
  let end = rawBytes.length;
  if (start < end && rawBytes[start] === 0x0d) start++;
  if (start < end && rawBytes[start] === 0x0a) start++;
  if (end > start && rawBytes[end - 1] === 0x0a) end--;
  if (end > start && rawBytes[end - 1] === 0x0d) end--;
  const trimmed = rawBytes.subarray(start, end);

  // 1. Standard zlib stream
  const res1 = await tryDecompressWithFormat(trimmed, "deflate");
  if (res1) return res1;

  // 2. Raw deflate without zlib header
  const res2 = await tryDecompressWithFormat(trimmed, "deflate-raw");
  if (res2) return res2;

  // 3. Skip 2-byte zlib header manually and use deflate-raw
  if (trimmed.length > 2) {
    const res3 = await tryDecompressWithFormat(trimmed.subarray(2), "deflate-raw");
    if (res3) return res3;
  }

  return null;
}

export interface CMapTable {
  map: Map<number, string>;
  byteLengths: Set<number>;
}

function parseToUnicodeCMap(cmapText: string): CMapTable {
  const map = new Map<number, string>();
  const byteLengths = new Set<number>();

  const hexToUnicodeString = (hex: string): string => {
    const clean = hex.replace(/[^0-9a-fA-F]/g, "");
    if (!clean) return "";
    if (clean.length <= 2) {
      return String.fromCharCode(parseInt(clean, 16));
    }
    let out = "";
    for (let i = 0; i < clean.length; i += 4) {
      const part = clean.slice(i, i + 4);
      const code = parseInt(part, 16);
      if (!isNaN(code)) out += String.fromCharCode(code);
    }
    return out;
  };

  // 1. beginbfchar ... endbfchar
  const bfcharRegex = /beginbfchar([\s\S]*?)endbfchar/g;
  let match: RegExpExecArray | null;
  while ((match = bfcharRegex.exec(cmapText)) !== null) {
    const block = match[1];
    const pairRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let pMatch: RegExpExecArray | null;
    while ((pMatch = pairRegex.exec(block)) !== null) {
      const srcHex = pMatch[1];
      const dstHex = pMatch[2];
      const srcCode = parseInt(srcHex, 16);
      const dstStr = hexToUnicodeString(dstHex);
      if (!isNaN(srcCode) && dstStr) {
        map.set(srcCode, dstStr);
        byteLengths.add(Math.max(1, Math.ceil(srcHex.length / 2)));
      }
    }
  }

  // 2. beginbfrange ... endbfrange
  const bfrangeRegex = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((match = bfrangeRegex.exec(cmapText)) !== null) {
    const block = match[1];
    // Form A: <start> <end> <dstStart>
    const rangeDirectRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let rMatch: RegExpExecArray | null;
    while ((rMatch = rangeDirectRegex.exec(block)) !== null) {
      const startHex = rMatch[1];
      const startCode = parseInt(startHex, 16);
      const endCode = parseInt(rMatch[2], 16);
      const dstBase = parseInt(rMatch[3], 16);
      if (!isNaN(startCode) && !isNaN(endCode) && !isNaN(dstBase) && endCode >= startCode && endCode - startCode <= 2048) {
        byteLengths.add(Math.max(1, Math.ceil(startHex.length / 2)));
        for (let c = startCode; c <= endCode; c++) {
          map.set(c, String.fromCharCode(dstBase + (c - startCode)));
        }
      }
    }

    // Form B: <start> <end> [<dst1> <dst2> ...]
    const rangeArrayRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([\s\S]*?)\]/g;
    while ((rMatch = rangeArrayRegex.exec(block)) !== null) {
      const startHex = rMatch[1];
      const startCode = parseInt(startHex, 16);
      const endCode = parseInt(rMatch[2], 16);
      const arrContent = rMatch[3];
      const targets = Array.from(arrContent.matchAll(/<([0-9a-fA-F]+)>/g)).map((m) => hexToUnicodeString(m[1]));
      if (!isNaN(startCode) && !isNaN(endCode) && endCode >= startCode) {
        byteLengths.add(Math.max(1, Math.ceil(startHex.length / 2)));
        for (let c = startCode; c <= endCode && c - startCode < targets.length; c++) {
          if (targets[c - startCode]) {
            map.set(c, targets[c - startCode]);
          }
        }
      }
    }
  }

  return { map, byteLengths };
}

function decodePdfLiteralBytes(rawLiteral: string): number[] {
  const bytes: number[] = [];
  let i = 0;
  while (i < rawLiteral.length) {
    const ch = rawLiteral[i];
    if (ch === "\\") {
      i++;
      if (i >= rawLiteral.length) break;
      const esc = rawLiteral[i];
      if (esc >= "0" && esc <= "7") {
        let oct = esc;
        if (i + 1 < rawLiteral.length && rawLiteral[i + 1] >= "0" && rawLiteral[i + 1] <= "7") {
          oct += rawLiteral[++i];
          if (i + 1 < rawLiteral.length && rawLiteral[i + 1] >= "0" && rawLiteral[i + 1] <= "7") {
            oct += rawLiteral[++i];
          }
        }
        bytes.push(parseInt(oct, 8) & 0xff);
      } else if (esc === "n") {
        bytes.push(10);
      } else if (esc === "r") {
        bytes.push(13);
      } else if (esc === "t") {
        bytes.push(9);
      } else if (esc === "b") {
        bytes.push(8);
      } else if (esc === "f") {
        bytes.push(12);
      } else if (esc === "\r") {
        if (i + 1 < rawLiteral.length && rawLiteral[i + 1] === "\n") i++;
      } else if (esc === "\n") {
        // line continuation
      } else {
        bytes.push(esc.charCodeAt(0) & 0xff);
      }
      i++;
    } else {
      bytes.push(ch.charCodeAt(0) & 0xff);
      i++;
    }
  }
  return bytes;
}

function decodeBytesWithCMapOrWinAnsi(bytes: number[], cmap?: CMapTable | null): string {
  if (!bytes || bytes.length === 0) return "";

  // Check UTF-16BE BOM
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = "";
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    }
    return out;
  }

  // If CMap exists and matches codes
  if (cmap && cmap.map.size > 0) {
    const prefer2Byte = cmap.byteLengths.has(2) && !cmap.byteLengths.has(1) && bytes.length % 2 === 0;
    if (prefer2Byte) {
      let out = "";
      let hits = 0;
      for (let i = 0; i + 1 < bytes.length; i += 2) {
        const code = (bytes[i] << 8) | bytes[i + 1];
        const mapped = cmap.map.get(code);
        if (mapped !== undefined) {
          out += mapped;
          hits++;
        } else if (code >= 32 && code <= 255) {
          out += String.fromCharCode(code);
        }
      }
      if (hits > 0) return out;
    } else {
      let out = "";
      let hits = 0;
      let i = 0;
      while (i < bytes.length) {
        const b1 = bytes[i];
        if (cmap.byteLengths.has(1) && cmap.map.has(b1)) {
          out += cmap.map.get(b1)!;
          hits++;
          i++;
          continue;
        }
        if (cmap.byteLengths.has(2) && i + 1 < bytes.length) {
          const b2 = (b1 << 8) | bytes[i + 1];
          if (cmap.map.has(b2)) {
            out += cmap.map.get(b2)!;
            hits++;
            i += 2;
            continue;
          }
        }
        if (cmap.map.has(b1)) {
          out += cmap.map.get(b1)!;
          hits++;
        } else {
          const cp = WIN1252_EXT[b1] ?? b1;
          if (cp >= 32) out += String.fromCharCode(cp);
        }
        i++;
      }
      if (hits > 0) return out;
    }
  }

  // Heuristic: if even number of bytes and every even byte is 0x00 (UTF-16BE without BOM)
  if (bytes.length >= 4 && bytes.length % 2 === 0) {
    let zeroHighBytes = 0;
    const pairs = bytes.length / 2;
    for (let i = 0; i < bytes.length; i += 2) {
      if (bytes[i] === 0) zeroHighBytes++;
    }
    if (zeroHighBytes >= Math.ceil(pairs * 0.8)) {
      let out = "";
      for (let i = 0; i + 1 < bytes.length; i += 2) {
        const code = (bytes[i] << 8) | bytes[i + 1];
        const cp = WIN1252_EXT[code] ?? code;
        if (cp >= 32) out += String.fromCharCode(cp);
      }
      return out;
    }
  }

  // Standard WinAnsi / Latin-1 decoding
  let out = "";
  for (const b of bytes) {
    const cp = WIN1252_EXT[b] ?? b;
    if (cp >= 32 || cp === 9) {
      out += String.fromCharCode(cp);
    }
  }
  return out;
}

function decodeHexTokenBytes(hexContent: string): number[] {
  const clean = hexContent.replace(/\s+/g, "");
  const padded = clean.length % 2 === 1 ? clean + "0" : clean;
  const bytes: number[] = [];
  for (let i = 0; i < padded.length; i += 2) {
    const val = parseInt(padded.slice(i, i + 2), 16);
    if (!isNaN(val)) bytes.push(val);
  }
  return bytes;
}

type Mat2D = [number, number, number, number, number, number];

function multiplyMatrix(m1: Mat2D, m2: Mat2D): Mat2D {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5]
  ];
}

interface PdfObjectEntry {
  objNum: number;
  dictText: string;
  decompressedText: string | null;
}

/**
 * Tokenizador ligero de flujos de contenido PDF (soporta números, nombres /F1, cadenas (...), hex <...>, arreglos [...] y operadores)
 */
function parseContentStreamItems(
  streamText: string,
  pageIndex: number,
  fontCMaps: Map<string, CMapTable>,
  fallbackCMap: CMapTable | null,
  formXObjects?: Map<string, string>
): PdfPositionedItem[] {
  const items: PdfPositionedItem[] = [];
  let ctm: Mat2D = [1, 0, 0, 1, 0, 0];
  const stateStack: Array<{ ctm: Mat2D; fontName: string; fontSize: number }> = [];

  let tm: Mat2D = [1, 0, 0, 1, 0, 0];
  let tlm: Mat2D = [1, 0, 0, 1, 0, 0];
  let leading = 12;
  let fontName = "";
  let fontSize = 10;

  const getActiveCMap = (): CMapTable | null => {
    if (fontName && fontCMaps.has(fontName)) {
      return fontCMaps.get(fontName)!;
    }
    return fallbackCMap;
  };

  const emitTextAtCurrentPos = (text: string, xOffsetPt: number = 0) => {
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (!cleaned) return;
    const effectiveTm: Mat2D = [tm[0], tm[1], tm[2], tm[3], tm[4] + xOffsetPt, tm[5]];
    const finalMat = multiplyMatrix(effectiveTm, ctm);
    const x = finalMat[4];
    const y = finalMat[5];
    const scaleX = Math.max(1, Math.hypot(finalMat[0], finalMat[1]));
    const estWidth = cleaned.length * Math.abs(fontSize || 10) * 0.5 * (scaleX > 5 ? 1 : scaleX);
    items.push({
      page: pageIndex,
      x,
      y,
      width: Math.max(4, estWidth),
      text: cleaned
    });
  };

  // Tokenize PDF content stream
  const tokens: Array<{ type: "num" | "name" | "str" | "hex" | "arr" | "op"; val: any }> = [];
  let i = 0;
  const len = streamText.length;

  const readLiteralString = (): string => {
    i++; // skip '('
    let depth = 1;
    let out = "";
    while (i < len && depth > 0) {
      const ch = streamText[i];
      if (ch === "\\") {
        out += ch;
        i++;
        if (i < len) {
          out += streamText[i];
          i++;
        }
      } else if (ch === "(") {
        depth++;
        out += ch;
        i++;
      } else if (ch === ")") {
        depth--;
        if (depth > 0) out += ch;
        i++;
      } else {
        out += ch;
        i++;
      }
    }
    return out;
  };

  const readHexString = (): string => {
    i++; // skip '<'
    let out = "";
    while (i < len && streamText[i] !== ">") {
      out += streamText[i];
      i++;
    }
    if (i < len && streamText[i] === ">") i++;
    return out;
  };

  while (i < len) {
    const ch = streamText[i];
    // Skip whitespace
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === "\f" || ch === "\0") {
      i++;
      continue;
    }
    // Skip comments
    if (ch === "%") {
      while (i < len && streamText[i] !== "\n" && streamText[i] !== "\r") i++;
      continue;
    }
    // Dictionary << or >>
    if (ch === "<" && i + 1 < len && streamText[i + 1] === "<") {
      i += 2;
      continue;
    }
    if (ch === ">" && i + 1 < len && streamText[i + 1] === ">") {
      i += 2;
      continue;
    }
    // Literal string
    if (ch === "(") {
      tokens.push({ type: "str", val: readLiteralString() });
      continue;
    }
    // Hex string
    if (ch === "<") {
      tokens.push({ type: "hex", val: readHexString() });
      continue;
    }
    // Array [...]
    if (ch === "[") {
      i++;
      const arrElements: Array<{ type: "str" | "hex" | "num"; val: any }> = [];
      while (i < len && streamText[i] !== "]") {
        const c2 = streamText[i];
        if (c2 === " " || c2 === "\t" || c2 === "\r" || c2 === "\n") {
          i++;
        } else if (c2 === "(") {
          arrElements.push({ type: "str", val: readLiteralString() });
        } else if (c2 === "<") {
          if (i + 1 < len && streamText[i + 1] === "<") {
            i += 2;
          } else {
            arrElements.push({ type: "hex", val: readHexString() });
          }
        } else if ((c2 >= "0" && c2 <= "9") || c2 === "-" || c2 === "+" || c2 === ".") {
          let numStr = "";
          while (
            i < len &&
            ((streamText[i] >= "0" && streamText[i] <= "9") ||
              streamText[i] === "-" ||
              streamText[i] === "+" ||
              streamText[i] === ".")
          ) {
            numStr += streamText[i++];
          }
          const numVal = parseFloat(numStr);
          if (!isNaN(numVal)) arrElements.push({ type: "num", val: numVal });
        } else {
          i++;
        }
      }
      if (i < len && streamText[i] === "]") i++;
      tokens.push({ type: "arr", val: arrElements });
      continue;
    }
    // Name /F1
    if (ch === "/") {
      i++;
      let nameStr = "";
      while (
        i < len &&
        !/[\s\(\)<>\\[\\]{}\/%]/.test(streamText[i])
      ) {
        nameStr += streamText[i++];
      }
      tokens.push({ type: "name", val: nameStr });
      continue;
    }
    // Number
    if ((ch >= "0" && ch <= "9") || ch === "-" || ch === "+" || ch === ".") {
      let numStr = "";
      while (
        i < len &&
        ((streamText[i] >= "0" && streamText[i] <= "9") ||
          streamText[i] === "-" ||
          streamText[i] === "+" ||
          streamText[i] === ".")
      ) {
        numStr += streamText[i++];
      }
      const n = parseFloat(numStr);
      if (!isNaN(n)) {
        tokens.push({ type: "num", val: n });
      } else {
        tokens.push({ type: "op", val: numStr });
      }
      continue;
    }
    // Operator word
    let opStr = "";
    while (
      i < len &&
      !/[\s\(\)<>\\[\\]{}\/%]/.test(streamText[i])
    ) {
      opStr += streamText[i++];
    }
    if (opStr) {
      // Skip inline image binary data BI ... ID ... EI
      if (opStr === "BI") {
        const eiIdx = streamText.indexOf("EI", i);
        if (eiIdx !== -1) {
          i = eiIdx + 2;
          continue;
        }
      }
      tokens.push({ type: "op", val: opStr });
    } else {
      i++;
    }
  }

  // Execute token stream
  const args: Array<{ type: string; val: any }> = [];
  for (const tok of tokens) {
    if (tok.type !== "op") {
      args.push(tok);
      if (args.length > 32) args.shift();
      continue;
    }

    const op = tok.val;
    if (op === "q") {
      stateStack.push({ ctm: [...ctm] as Mat2D, fontName, fontSize });
    } else if (op === "Q") {
      const popped = stateStack.pop();
      if (popped) {
        ctm = popped.ctm;
        fontName = popped.fontName;
        fontSize = popped.fontSize;
      }
    } else if (op === "cm" && args.length >= 6) {
      const mArgs = args.slice(-6).map((a) => Number(a.val) || 0) as Mat2D;
      ctm = multiplyMatrix(mArgs, ctm);
    } else if (op === "BT") {
      tm = [1, 0, 0, 1, 0, 0];
      tlm = [1, 0, 0, 1, 0, 0];
    } else if (op === "Tf" && args.length >= 2) {
      const sizeTok = args[args.length - 1];
      const nameTok = args[args.length - 2];
      if (nameTok.type === "name") fontName = String(nameTok.val);
      if (sizeTok.type === "num" && Number(sizeTok.val) > 0) fontSize = Number(sizeTok.val);
    } else if (op === "TL" && args.length >= 1) {
      leading = Number(args[args.length - 1].val) || leading;
    } else if (op === "Tm" && args.length >= 6) {
      const mArgs = args.slice(-6).map((a) => Number(a.val) || 0) as Mat2D;
      tm = [...mArgs] as Mat2D;
      tlm = [...mArgs] as Mat2D;
    } else if ((op === "Td" || op === "TD") && args.length >= 2) {
      const ty = Number(args[args.length - 1].val) || 0;
      const tx = Number(args[args.length - 2].val) || 0;
      if (op === "TD") leading = -ty;
      tlm = multiplyMatrix([1, 0, 0, 1, tx, ty], tlm);
      tm = [...tlm] as Mat2D;
    } else if (op === "T*") {
      tlm = multiplyMatrix([1, 0, 0, 1, 0, -leading], tlm);
      tm = [...tlm] as Mat2D;
    } else if ((op === "Tj" || op === "'" || op === '"') && args.length >= 1) {
      if (op === "'" || op === '"') {
        tlm = multiplyMatrix([1, 0, 0, 1, 0, -leading], tlm);
        tm = [...tlm] as Mat2D;
      }
      const strTok = args[args.length - 1];
      const cmap = getActiveCMap();
      let decoded = "";
      if (strTok.type === "str") {
        decoded = decodeBytesWithCMapOrWinAnsi(decodePdfLiteralBytes(strTok.val), cmap);
      } else if (strTok.type === "hex") {
        decoded = decodeBytesWithCMapOrWinAnsi(decodeHexTokenBytes(strTok.val), cmap);
      }
      if (decoded) {
        emitTextAtCurrentPos(decoded, 0);
        const advanceX = decoded.length * (fontSize || 10) * 0.5;
        tm = multiplyMatrix([1, 0, 0, 1, advanceX, 0], tm);
      }
    } else if (op === "TJ" && args.length >= 1) {
      const arrTok = args[args.length - 1];
      if (arrTok.type === "arr" && Array.isArray(arrTok.val)) {
        const cmap = getActiveCMap();
        let currentBuffer = "";
        let bufferStartOffsetPt = 0;
        let runningOffsetPt = 0;
        const effFontSize = Math.abs(fontSize) || 10;

        for (const el of arrTok.val) {
          if (el.type === "str" || el.type === "hex") {
            const bytes =
              el.type === "str" ? decodePdfLiteralBytes(el.val) : decodeHexTokenBytes(el.val);
            const txt = decodeBytesWithCMapOrWinAnsi(bytes, cmap);
            if (!currentBuffer) {
              bufferStartOffsetPt = runningOffsetPt;
            }
            currentBuffer += txt;
            runningOffsetPt += txt.length * effFontSize * 0.5;
          } else if (el.type === "num") {
            const kern = Number(el.val) || 0;
            // In PDF TJ, negative numbers shift position to the RIGHT
            const shiftRightPt = (-kern / 1000) * effFontSize;
            if (kern <= -650) {
              // Large horizontal gap between table columns inside a single TJ array
              if (currentBuffer.trim()) {
                emitTextAtCurrentPos(currentBuffer, bufferStartOffsetPt);
              }
              currentBuffer = "";
              runningOffsetPt += shiftRightPt;
              bufferStartOffsetPt = runningOffsetPt;
            } else if (kern <= -120) {
              if (currentBuffer && !currentBuffer.endsWith(" ")) {
                currentBuffer += " ";
              }
              runningOffsetPt += Math.max(shiftRightPt, effFontSize * 0.2);
            } else {
              runningOffsetPt += shiftRightPt;
            }
          }
        }
        if (currentBuffer.trim()) {
          emitTextAtCurrentPos(currentBuffer, bufferStartOffsetPt);
        }
        tm = multiplyMatrix([1, 0, 0, 1, runningOffsetPt, 0], tm);
      }
    } else if (op === "Do" && args.length >= 1 && formXObjects) {
      const nameTok = args[args.length - 1];
      if (nameTok.type === "name" && formXObjects.has(String(nameTok.val))) {
        const subStream = formXObjects.get(String(nameTok.val))!;
        const subItems = parseContentStreamItems(subStream, pageIndex, fontCMaps, fallbackCMap);
        for (const si of subItems) {
          items.push(si);
        }
      }
    }

    args.length = 0;
  }

  return items;
}

/**
 * Extrae una matriz de filas y columnas (string[][]) desde un archivo PDF
 * para ser procesada bajo los mismos criterios de encabezados que Excel.
 */
export async function extractTableMatrixFromPdf(
  arrayBuffer: ArrayBuffer,
  classifyHeaderFn: (raw: any) => string | null
): Promise<PdfExtractionResult> {
  const bytes = new Uint8Array(arrayBuffer);
  const rawPdfStr = bytesToLatin1(bytes);

  // 1. Parsear todos los objetos indirectos (N G obj ... endobj)
  const objects = new Map<number, PdfObjectEntry>();
  const objRegex = /(\d+)\s+\d+\s+obj\b/g;
  let match: RegExpExecArray | null;

  while ((match = objRegex.exec(rawPdfStr)) !== null) {
    const objNum = parseInt(match[1], 10);
    const bodyStart = match.index + match[0].length;
    const endObjIdx = rawPdfStr.indexOf("endobj", bodyStart);
    if (endObjIdx === -1) continue;

    const objBody = rawPdfStr.slice(bodyStart, endObjIdx);
    const streamKwIdx = objBody.indexOf("stream");
    const endStreamKwIdx = objBody.lastIndexOf("endstream");

    if (streamKwIdx !== -1 && endStreamKwIdx !== -1 && endStreamKwIdx > streamKwIdx) {
      const dictText = objBody.slice(0, streamKwIdx);
      const absStreamStart = bodyStart + streamKwIdx + 6;
      const absStreamEnd = bodyStart + endStreamKwIdx;
      const rawStreamSlice = bytes.subarray(absStreamStart, absStreamEnd);

      const isFlate = /\/Filter\s*(\[\s*)?\/FlateDecode/.test(dictText) || /\/Fl\b/.test(dictText);
      let decompressedText: string | null = null;

      if (isFlate) {
        const decompressed = await decompressFlateStream(rawStreamSlice);
        if (decompressed) {
          decompressedText = bytesToLatin1(decompressed);
        }
      } else if (!/\/Filter\s*\/(DCTDecode|JPXDecode|CCITTFaxDecode|JBIG2Decode)/.test(dictText)) {
        decompressedText = bytesToLatin1(rawStreamSlice);
      }

      objects.set(objNum, { objNum, dictText, decompressedText });
    } else {
      objects.set(objNum, { objNum, dictText: objBody, decompressedText: null });
    }
  }

  // 2. Identificar todos los flujos ToUnicode CMap y vincularlos a sus objetos de fuente
  const cmapByObjNum = new Map<number, CMapTable>();
  const globalCombinedMap = new Map<number, string>();
  const globalByteLengths = new Set<number>();

  for (const [objNum, entry] of objects.entries()) {
    if (
      entry.decompressedText &&
      (entry.decompressedText.includes("beginbfchar") || entry.decompressedText.includes("beginbfrange"))
    ) {
      const parsed = parseToUnicodeCMap(entry.decompressedText);
      if (parsed.map.size > 0) {
        cmapByObjNum.set(objNum, parsed);
        for (const [k, v] of parsed.map.entries()) {
          if (!globalCombinedMap.has(k)) globalCombinedMap.set(k, v);
        }
        for (const bl of parsed.byteLengths) globalByteLengths.add(bl);
      }
    }
  }

  // Vincular Font Object -> CMapTable
  const fontObjToCMap = new Map<number, CMapTable>();
  for (const [objNum, entry] of objects.entries()) {
    const toUniMatch = entry.dictText.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);
    if (toUniMatch) {
      const cmapObjId = parseInt(toUniMatch[1], 10);
      const cmap = cmapByObjNum.get(cmapObjId);
      if (cmap) {
        fontObjToCMap.set(objNum, cmap);
      }
    }
  }

  // Vincular nombres de recursos de fuentes (/F1, /TT0, /C2_0...) -> CMapTable
  const fontNameCMaps = new Map<string, CMapTable>();
  for (const entry of objects.values()) {
    const fontNameRefs = entry.dictText.matchAll(/\/([A-Za-z0-9_.+-]+)\s+(\d+)\s+\d+\s+R/g);
    for (const ref of fontNameRefs) {
      const resName = ref[1];
      const targetObj = parseInt(ref[2], 10);
      if (fontObjToCMap.has(targetObj)) {
        fontNameCMaps.set(resName, fontObjToCMap.get(targetObj)!);
      }
    }
  }

  const fallbackCMap: CMapTable | null =
    globalCombinedMap.size > 0 ? { map: globalCombinedMap, byteLengths: globalByteLengths } : null;

  // Mapear Form XObjects (/Subtype /Form) por si alguna tabla está dentro de un XObject
  const formXObjects = new Map<string, string>();
  for (const entry of objects.values()) {
    const xobjRefs = entry.dictText.matchAll(/\/([A-Za-z0-9_.+-]+)\s+(\d+)\s+\d+\s+R/g);
    for (const ref of xobjRefs) {
      const name = ref[1];
      const targetId = parseInt(ref[2], 10);
      const targetObj = objects.get(targetId);
      if (targetObj && /\/Subtype\s*\/Form\b/.test(targetObj.dictText) && targetObj.decompressedText) {
        formXObjects.set(name, targetObj.decompressedText);
      }
    }
  }

  // 3. Encontrar objetos de página (/Type /Page) y sus flujos /Contents
  const pageContentStreams: string[][] = [];
  for (const entry of objects.values()) {
    if (/\/Type\s*\/Page\b(?!s)/.test(entry.dictText)) {
      const streamList: string[] = [];
      // Case A: /Contents [ 5 0 R 6 0 R ]
      const arrMatch = entry.dictText.match(/\/Contents\s*\[([\s\S]*?)\]/);
      if (arrMatch) {
        const refs = arrMatch[1].matchAll(/(\d+)\s+\d+\s+R/g);
        for (const r of refs) {
          const cObj = objects.get(parseInt(r[1], 10));
          if (cObj?.decompressedText) streamList.push(cObj.decompressedText);
        }
      } else {
        // Case B: /Contents 5 0 R
        const singleMatch = entry.dictText.match(/\/Contents\s+(\d+)\s+\d+\s+R/);
        if (singleMatch) {
          const cObj = objects.get(parseInt(singleMatch[1], 10));
          if (cObj) {
            if (cObj.decompressedText) {
              streamList.push(cObj.decompressedText);
            } else {
              // /Contents points to an indirect array object
              const indirectRefs = cObj.dictText.matchAll(/(\d+)\s+\d+\s+R/g);
              for (const r of indirectRefs) {
                const subObj = objects.get(parseInt(r[1], 10));
                if (subObj?.decompressedText) streamList.push(subObj.decompressedText);
              }
            }
          }
        }
      }
      if (streamList.length > 0) {
        pageContentStreams.push(streamList);
      }
    }
  }

  // Fallback: si el PDF usa Object Streams (/Type /ObjStm) o no expuso /Type /Page explícito,
  // escanear todos los flujos que contengan bloques de texto BT ... ET
  if (pageContentStreams.length === 0) {
    const fallbackStreams: string[] = [];
    for (const entry of objects.values()) {
      if (
        entry.decompressedText &&
        /\bBT\b/.test(entry.decompressedText) &&
        /\b(Tj|TJ)\b/.test(entry.decompressedText) &&
        !entry.decompressedText.includes("beginbfchar")
      ) {
        fallbackStreams.push(entry.decompressedText);
      }
    }
    if (fallbackStreams.length > 0) {
      pageContentStreams.push(fallbackStreams);
    }
  }

  // 4. Extraer todos los elementos de texto posicionados (x, y, text) página por página
  const allPageRows: Array<Array<{ x: number; width: number; text: string }>> = [];

  for (let pIdx = 0; pIdx < pageContentStreams.length; pIdx++) {
    const combinedPageStream = pageContentStreams[pIdx].join("\n");
    const pageItems = parseContentStreamItems(
      combinedPageStream,
      pIdx,
      fontNameCMaps,
      fallbackCMap,
      formXObjects
    );
    if (pageItems.length === 0) continue;

    // Agrupar elementos por coordenada Y en renglones visuales (tolerancia de 4pt)
    const yClusters: Array<{ y: number; items: PdfPositionedItem[] }> = [];
    for (const item of pageItems) {
      if (!item.text) continue;
      let targetCluster = yClusters.find((c) => Math.abs(c.y - item.y) <= 4.2);
      if (!targetCluster) {
        targetCluster = { y: item.y, items: [] };
        yClusters.push(targetCluster);
      } else {
        // Actualizar promedio de Y del renglón
        targetCluster.y =
          (targetCluster.y * targetCluster.items.length + item.y) / (targetCluster.items.length + 1);
      }
      targetCluster.items.push(item);
    }

    // Determinar dirección vertical: en PDF estándar Y decrece de arriba hacia abajo.
    // Si la fila de encabezados está en Y mayor que las filas de datos, ordenar Y descendente.
    yClusters.sort((a, b) => b.y - a.y);

    // Verificar si el sistema de coordenadas de la página está invertido (Y creciente hacia abajo)
    let topHeaderY: number | null = null;
    for (const cl of yClusters) {
      let headerHits = 0;
      for (const it of cl.items) {
        if (classifyHeaderFn(it.text)) headerHits++;
      }
      if (headerHits >= 2) {
        topHeaderY = cl.y;
        break;
      }
    }
    if (topHeaderY !== null && yClusters.length > 3) {
      const medianY = yClusters[Math.floor(yClusters.length / 2)].y;
      if (topHeaderY < medianY) {
        // El encabezado tiene Y menor (sistema top-down invertido por cm)
        yClusters.sort((a, b) => a.y - b.y);
      }
    }

    // Dentro de cada renglón, ordenar por X de izquierda a derecha y unir fragmentos de la misma celda
    const pageVisualRows: Array<{ y: number; cells: Array<{ x: number; width: number; text: string }> }> = [];

    for (const cl of yClusters) {
      const sorted = [...cl.items].sort((a, b) => a.x - b.x);
      const mergedCells: Array<{ x: number; width: number; text: string }> = [];

      for (const it of sorted) {
        if (mergedCells.length === 0) {
          mergedCells.push({ x: it.x, width: it.width, text: it.text });
        } else {
          const prev = mergedCells[mergedCells.length - 1];
          const gap = it.x - (prev.x + prev.width);
          // Si están muy cerca horizontalmente (< 7pt), son parte de la misma frase/celda
          if (gap < 7) {
            const needsSpace =
              gap > 1.2 && !prev.text.endsWith(" ") && !it.text.startsWith(" ");
            prev.text = `${prev.text}${needsSpace ? " " : ""}${it.text}`;
            prev.width = Math.max(prev.width, it.x + it.width - prev.x);
          } else {
            mergedCells.push({ x: it.x, width: it.width, text: it.text });
          }
        }
      }

      if (mergedCells.length > 0) {
        pageVisualRows.push({ y: cl.y, cells: mergedCells });
      }
    }

    // Detectar si el encabezado de la tabla está dividido en 2 líneas consecutivas
    // (Ej: línea 1 tiene "U. de", "N° de", "Fecha", "Costo" y línea 2 tiene "Emisión", "lote", "Vto", "Unit.")
    for (let r = 0; r < pageVisualRows.length - 1; r++) {
      const rowA = pageVisualRows[r];
      const rowB = pageVisualRows[r + 1];
      if (Math.abs(rowA.y - rowB.y) <= 18) {
        const countCats = (cells: Array<{ text: string }>) => {
          const cats = new Set<string>();
          cells.forEach((c) => {
            const cat = classifyHeaderFn(c.text);
            if (cat) cats.add(cat);
          });
          return cats.size;
        };

        // Simular combinación vertical por cercanía en X
        const combinedCells = rowA.cells.map((c) => ({ ...c }));
        for (const cellB of rowB.cells) {
          const matchA = combinedCells.find((cA) => Math.abs(cA.x - cellB.x) <= 32);
          if (matchA) {
            matchA.text = `${matchA.text} ${cellB.text}`.trim();
          } else {
            combinedCells.push({ ...cellB });
          }
        }
        combinedCells.sort((a, b) => a.x - b.x);

        const catsA = countCats(rowA.cells);
        const catsCombined = countCats(combinedCells);
        if (catsCombined >= 3 && catsCombined > catsA) {
          pageVisualRows[r] = { y: rowA.y, cells: combinedCells };
          pageVisualRows.splice(r + 1, 1);
          break;
        }
      }
    }

    for (const vr of pageVisualRows) {
      allPageRows.push(vr.cells);
    }
  }

  if (allPageRows.length === 0) {
    return { matrix: [], pageCount: pageContentStreams.length };
  }

  // 5. Si alguna fila de encabezado tiene varios títulos concatenados en una sola celda, separarlos
  const HEADER_SPLIT_REGEX =
    /\b(C[óo]digo|Suministros?|Nombres?|Productos?|Art[íi]culos?|U\.?\s*de\s*Emisi[óo]n|Unidad\s*de\s*Emisi[óo]n|Descripci[óo]n|N[°ºo.]*\s*de\s*lote|Lote\s*del\s*producto|Lote|Fecha\s*de\s*vencimiento|Fecha\s*Vto\.?|Vencimiento|Fecha|Cantidad|Cant\.?|Costo\s*Unit(?:ario|\.)?|Precio\s*Unit(?:ario|\.)?|Precio|Costo)\b/gi;

  // Buscar la mejor fila de encabezados en allPageRows
  let bestHeaderRowIdx = -1;
  let bestHeaderScore = -1;
  let detectedHeaderAnchors: Array<{ title: string; category: string | null; x: number; width: number }> = [];

  for (let r = 0; r < Math.min(allPageRows.length, 45); r++) {
    const rawCells = allPageRows[r];
    const expandedCells: Array<{ title: string; category: string | null; x: number; width: number }> = [];

    for (const cell of rawCells) {
      const directCat = classifyHeaderFn(cell.text);
      const matches = Array.from(cell.text.matchAll(HEADER_SPLIT_REGEX));
      if (matches.length >= 2) {
        // Varias columnas de encabezado vinieron en un solo bloque de texto
        matches.forEach((m, idx) => {
          const title = m[0].trim();
          const cat = classifyHeaderFn(title);
          const subX = cell.x + idx * 70;
          expandedCells.push({ title, category: cat, x: subX, width: 65 });
        });
      } else {
        expandedCells.push({
          title: cell.text.trim(),
          category: directCat,
          x: cell.x,
          width: cell.width
        });
      }
    }

    const cats = new Set<string>();
    let score = 0;
    for (const ec of expandedCells) {
      if (ec.category) {
        cats.add(ec.category);
        score += ec.category === "name" || ec.category === "description" || ec.category === "lot" || ec.category === "qty" ? 2 : 1;
      }
    }

    if (cats.size >= 2 && score > bestHeaderScore) {
      bestHeaderScore = score;
      bestHeaderRowIdx = r;
      detectedHeaderAnchors = expandedCells;
    }
  }

  // Si no se encontró fila de encabezados con >= 2 columnas pero hay filas de datos con fecha y cantidad,
  // crear un encabezado estándar para que CargaMasiva las procese
  if (bestHeaderRowIdx === -1) {
    const standardHeader = ["Suministro", "U. de Emisión", "N° de lote", "Fecha Vto", "Cantidad", "Costo Unit."];
    const parsedFallbackRows: string[][] = [standardHeader];
    for (const rowCells of allPageRows) {
      const joined = rowCells.map((c) => c.text).join("  ").trim();
      const parsed = tryParseUnstructuredSupplyRow(joined, rowCells.map((c) => c.text));
      if (parsed) {
        parsedFallbackRows.push(parsed);
      }
    }
    if (parsedFallbackRows.length > 1) {
      return { matrix: parsedFallbackRows, pageCount: Math.max(1, pageContentStreams.length) };
    }
    return {
      matrix: allPageRows.map((r) => r.map((c) => c.text)),
      pageCount: Math.max(1, pageContentStreams.length)
    };
  }

  // 6. Construir matriz alineada a las columnas del encabezado detectado
  const numCols = detectedHeaderAnchors.length;
  const headerTitles = detectedHeaderAnchors.map((a) => a.title);
  const matrix: string[][] = [headerTitles];

  // Identificar índices de categoría en el encabezado para desempate y fusión multilínea
  let nameIdx = -1;
  let descIdx = -1;
  let unitIdx = -1;
  let lotIdx = -1;
  let dateIdx = -1;
  let qtyIdx = -1;
  let priceIdx = -1;

  detectedHeaderAnchors.forEach((a, idx) => {
    if (a.category === "name" && nameIdx === -1) nameIdx = idx;
    else if (a.category === "description" && descIdx === -1) descIdx = idx;
    else if (a.category === "unit" && unitIdx === -1) unitIdx = idx;
    else if (a.category === "lot" && lotIdx === -1) lotIdx = idx;
    else if (a.category === "date" && dateIdx === -1) dateIdx = idx;
    else if (a.category === "qty" && qtyIdx === -1) qtyIdx = idx;
    else if (a.category === "price" && priceIdx === -1) priceIdx = idx;
  });

  const primaryNameCol = nameIdx !== -1 ? nameIdx : descIdx;
  const primaryDescCol = nameIdx !== -1 ? (unitIdx !== -1 ? unitIdx : descIdx) : unitIdx;

  // Límites horizontales entre columnas vecinas (punto medio entre X de columna i y columna i+1)
  const colBoundaries: number[] = [];
  for (let c = 0; c < numCols - 1; c++) {
    const leftAnchor = detectedHeaderAnchors[c];
    const rightAnchor = detectedHeaderAnchors[c + 1];
    colBoundaries.push((leftAnchor.x + rightAnchor.x) / 2);
  }

  const findColumnByX = (x: number): number => {
    for (let c = 0; c < colBoundaries.length; c++) {
      if (x < colBoundaries[c]) return c;
    }
    return numCols - 1;
  };

  let pendingPrefixName = "";

  for (let r = bestHeaderRowIdx + 1; r < allPageRows.length; r++) {
    const rowCells = allPageRows[r];
    if (!rowCells || rowCells.length === 0) continue;

    // Ignorar encabezados repetidos en páginas siguientes o pies de página ("Página 1 de 2")
    const fullLineText = rowCells.map((c) => c.text).join(" ").trim();
    if (/^p[áa]gina\s+\d+(\s+de\s+\d+)?$/i.test(fullLineText)) continue;

    let repeatedHeaderHits = 0;
    for (const c of rowCells) {
      if (classifyHeaderFn(c.text)) repeatedHeaderHits++;
    }
    if (repeatedHeaderHits >= 3) continue;

    // Si toda la fila vino en 1 o 2 bloques largos de texto pero el encabezado tiene >= 4 columnas,
    // intentar extraer por patrón estructurado
    if (rowCells.length <= 2 && numCols >= 4) {
      const structured = tryParseUnstructuredSupplyRow(
        fullLineText,
        rowCells.map((c) => c.text)
      );
      if (structured) {
        const alignedRow = new Array(numCols).fill("");
        if (primaryNameCol !== -1) {
          alignedRow[primaryNameCol] = pendingPrefixName
            ? `${pendingPrefixName} ${structured[0]}`.trim()
            : structured[0];
          pendingPrefixName = "";
        }
        if (primaryDescCol !== -1) alignedRow[primaryDescCol] = structured[1];
        if (lotIdx !== -1) alignedRow[lotIdx] = structured[2];
        if (dateIdx !== -1) alignedRow[dateIdx] = structured[3];
        if (qtyIdx !== -1) alignedRow[qtyIdx] = structured[4];
        if (priceIdx !== -1) alignedRow[priceIdx] = structured[5];
        matrix.push(alignedRow);
        continue;
      }
    }

    // Asignar cada celda de la fila a su columna según coordenada X
    const rowOut = new Array(numCols).fill("");
    for (const cell of rowCells) {
      const cIdx = findColumnByX(cell.x);
      rowOut[cIdx] = rowOut[cIdx] ? `${rowOut[cIdx]} ${cell.text}`.trim() : cell.text.trim();
    }

    // Verificar si una celda contiene múltiples campos pegados (ej. Lote + Fecha Vto, o Cantidad + Costo)
    if (dateIdx !== -1 && !rowOut[dateIdx]) {
      const dateRegex =
        /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}|(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*[\s\/\-]+\d{2,4})\b/i;
      for (let c = 0; c < numCols; c++) {
        if (c === dateIdx || !rowOut[c]) continue;
        const m = rowOut[c].match(dateRegex);
        if (m) {
          rowOut[dateIdx] = m[1];
          rowOut[c] = rowOut[c].replace(m[0], " ").replace(/\s+/g, " ").trim();
          break;
        }
      }
    }

    const hasLot = lotIdx !== -1 && rowOut[lotIdx] !== "";
    const hasDate = dateIdx !== -1 && rowOut[dateIdx] !== "";
    const hasQty = qtyIdx !== -1 && rowOut[qtyIdx] !== "";
    const hasName = primaryNameCol !== -1 && rowOut[primaryNameCol] !== "";
    const hasDesc = primaryDescCol !== -1 && rowOut[primaryDescCol] !== "";

    // Manejo de filas con nombres o descripciones multilínea en PDF:
    // Caso 1: Renglón que solo tiene texto en Nombre y/o Descripción (sin lote, ni fecha, ni cantidad)
    if (!hasLot && !hasDate && !hasQty && (hasName || hasDesc)) {
      // Si la fila anterior en matrix ya es una fila de datos válida, o si la siguiente fila no tiene nombre:
      const nextRowCells = r + 1 < allPageRows.length ? allPageRows[r + 1] : null;
      let nextRowHasLotOrDate = false;
      let nextRowMissingName = false;
      if (nextRowCells && primaryNameCol !== -1) {
        const nextSim = new Array(numCols).fill("");
        for (const nc of nextRowCells) {
          const idx = findColumnByX(nc.x);
          nextSim[idx] = nextSim[idx] ? `${nextSim[idx]} ${nc.text}`.trim() : nc.text.trim();
        }
        nextRowHasLotOrDate =
          (lotIdx !== -1 && nextSim[lotIdx] !== "") || (dateIdx !== -1 && nextSim[dateIdx] !== "");
        nextRowMissingName = !nextSim[primaryNameCol];
      }

      if (nextRowHasLotOrDate && nextRowMissingName && hasName) {
        pendingPrefixName = pendingPrefixName
          ? `${pendingPrefixName} ${rowOut[primaryNameCol]}`.trim()
          : rowOut[primaryNameCol];
        continue;
      } else if (matrix.length > 1) {
        const prevRow = matrix[matrix.length - 1];
        if (hasName && primaryNameCol !== -1) {
          prevRow[primaryNameCol] = `${prevRow[primaryNameCol]} ${rowOut[primaryNameCol]}`.trim();
        }
        if (hasDesc && primaryDescCol !== -1) {
          prevRow[primaryDescCol] = `${prevRow[primaryDescCol]} ${rowOut[primaryDescCol]}`.trim();
        }
        continue;
      }
    }

    if (pendingPrefixName && primaryNameCol !== -1) {
      rowOut[primaryNameCol] = `${pendingPrefixName} ${rowOut[primaryNameCol] || ""}`.trim();
      pendingPrefixName = "";
    }

    matrix.push(rowOut);
  }

  return {
    matrix,
    pageCount: Math.max(1, pageContentStreams.length)
  };
}

/**
 * Analizador auxiliar de respaldo para renglones de PDF donde toda la fila viene en una sola cadena.
 * Retorna [Suministro, U. de Emisión/Descripción, Lote, Fecha Vto, Cantidad, Costo Unit.] o null.
 */
function tryParseUnstructuredSupplyRow(
  lineText: string,
  rawCells: string[]
): [string, string, string, string, string, string] | null {
  const clean = lineText.replace(/\s+/g, " ").trim();
  if (!clean || clean.length < 8) return null;

  // Si ya viene separada en 5 o 6 celdas claras
  if (rawCells.length >= 5) {
    const c = rawCells.map((x) => x.trim());
    // Verificar si alguna celda parece fecha
    const dateCellIdx = c.findIndex((val) =>
      /^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}|\d{1,2}[\/\-]\d{4}|(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*[\s\/\-]+\d{2,4})$/i.test(
        val
      )
    );
    if (dateCellIdx >= 2) {
      const expDate = c[dateCellIdx];
      const lot = c[dateCellIdx - 1];
      const name = c[0];
      const desc = dateCellIdx >= 3 ? c.slice(1, dateCellIdx - 1).join(" ") : "";
      const qty = c[dateCellIdx + 1] || "";
      const price = c[dateCellIdx + 2] || "0";
      if (name && lot && qty) {
        return [name, desc, lot, expDate, qty, price];
      }
    }
  }

  // Buscar fecha de vencimiento dentro de la línea
  const dateMatch = clean.match(
    /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}|(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*[\s\/\-]+\d{2,4})\b/i
  );
  if (!dateMatch || dateMatch.index === undefined) return null;

  const expDate = dateMatch[1];
  const beforeDate = clean.slice(0, dateMatch.index).trim();
  const afterDate = clean.slice(dateMatch.index + expDate.length).trim();

  // Después de la fecha suelen venir: Cantidad y (opcionalmente) Costo Unitario
  const afterTokens = afterDate
    .replace(/RD\$|\$/gi, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (afterTokens.length === 0) return null;

  const qtyCandidate = afterTokens[0];
  if (!/^\d+([.,]\d+)?$/.test(qtyCandidate)) return null;
  const priceCandidate =
    afterTokens.length >= 2 && /^\d+([.,]\d+)?$/.test(afterTokens[1]) ? afterTokens[1] : "0";

  // Antes de la fecha: el último token es el N° de Lote, y antes va el Suministro (+ U. de Emisión opcional)
  const beforeTokens = beforeDate.split(/\s+/).filter(Boolean);
  if (beforeTokens.length < 2) return null;

  const lot = beforeTokens[beforeTokens.length - 1];
  const restBefore = beforeTokens.slice(0, -1);

  // Detectar si el último término antes del lote es una Unidad de Emisión conocida
  const unitTokens = new Set([
    "unidad",
    "unidades",
    "und",
    "caja",
    "cajas",
    "frasco",
    "frascos",
    "ampolla",
    "ampollas",
    "tableta",
    "tabletas",
    "capsula",
    "capsulas",
    "sobre",
    "sobres",
    "rollo",
    "galon",
    "litro",
    "paquete",
    "tubo",
    "vial",
    "blister",
    "funda",
    "kit"
  ]);

  let desc = "";
  let nameTokens = restBefore;
  if (restBefore.length >= 2) {
    const lastWordNorm = restBefore[restBefore.length - 1]
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (unitTokens.has(lastWordNorm)) {
      desc = restBefore[restBefore.length - 1];
      nameTokens = restBefore.slice(0, -1);
    }
  }

  const name = nameTokens.join(" ").trim();
  if (!name || !lot) return null;

  return [name, desc, lot, expDate, qtyCandidate, priceCandidate];
}
