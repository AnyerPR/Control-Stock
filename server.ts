import express from "express";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SignedXml } from "xml-crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VAULT_DIR = path.join(__dirname, ".dgii-certs");
const VAULT_KEY_FILE = path.join(VAULT_DIR, ".vault-key");

// Almacén seguro en memoria del servidor por farmacia/tenant (nunca se expone la llave privada al cliente)
const certificateStore = new Map<string, any>();
// Registro en memoria de semillas activas para endpoint receptor DGII (/fe/autenticacion/api/semilla)
const activeSeeds = new Map<string, { valor: string; expiresAt: number }>();
// Registro de comprobantes e-CF y aprobaciones comerciales recibidas en endpoints receptores
const recepcionesStore = new Map<string, any[]>();

function ensureVaultKey(): Buffer {
  const envSecret = process.env.DGII_VAULT_SECRET;
  if (envSecret && envSecret.trim().length >= 16) {
    return crypto.createHash("sha256").update(envSecret.trim(), "utf8").digest();
  }
  if (!fs.existsSync(VAULT_DIR)) {
    fs.mkdirSync(VAULT_DIR, { recursive: true, mode: 0o700 });
  }
  if (fs.existsSync(VAULT_KEY_FILE)) {
    const hex = fs.readFileSync(VAULT_KEY_FILE, "utf8").trim();
    if (hex.length === 64) {
      return Buffer.from(hex, "hex");
    }
  }
  const newKey = crypto.randomBytes(32);
  fs.writeFileSync(VAULT_KEY_FILE, newKey.toString("hex"), { mode: 0o600 });
  return newKey;
}

function sanitizeTenantId(tenant: string): string {
  const clean = String(tenant || "principal").replace(/[^a-zA-Z0-9_-]/g, "_");
  return clean || "principal";
}

function saveEncryptedCertToVault(tenant: string, entry: any): void {
  try {
    if (!fs.existsSync(VAULT_DIR)) {
      fs.mkdirSync(VAULT_DIR, { recursive: true, mode: 0o700 });
    }
    const key = ensureVaultKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const plaintext = Buffer.from(JSON.stringify(entry), "utf8");
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = {
      v: 1,
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      data: encrypted.toString("base64")
    };
    const filePath = path.join(VAULT_DIR, `${sanitizeTenantId(tenant)}.enc.json`);
    fs.writeFileSync(filePath, JSON.stringify(payload), { mode: 0o600 });
  } catch (err) {
    console.warn("No se pudo persistir la bóveda cifrada .p12:", err);
  }
}

function deleteEncryptedCertFromVault(tenant: string): void {
  try {
    const filePath = path.join(VAULT_DIR, `${sanitizeTenantId(tenant)}.enc.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {}
}

function loadEncryptedVaultOnStartup(): void {
  try {
    if (!fs.existsSync(VAULT_DIR)) return;
    const key = ensureVaultKey();
    const files = fs.readdirSync(VAULT_DIR);
    for (const file of files) {
      if (!file.endsWith(".enc.json")) continue;
      const tenant = file.replace(/\.enc\.json$/, "");
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(VAULT_DIR, file), "utf8"));
        const decipher = crypto.createDecipheriv(
          "aes-256-gcm",
          key,
          Buffer.from(raw.iv, "base64")
        );
        decipher.setAuthTag(Buffer.from(raw.tag, "base64"));
        const dec = Buffer.concat([
          decipher.update(Buffer.from(raw.data, "base64")),
          decipher.final()
        ]);
        const entry = JSON.parse(dec.toString("utf8"));
        if (entry?.privateKeyPem && entry?.info) {
          certificateStore.set(tenant, entry);
        }
      } catch {
        // Ignorar archivo corrupto o clave distinta
      }
    }
  } catch {}
}

function getOfficialUrls(ambiente = "TesteCF") {
  const safeEnv = ["TesteCF", "CerteCF", "eCF"].includes(ambiente) ? ambiente : "TesteCF";
  const base = `https://ecf.dgii.gov.do/${safeEnv}`;
  return {
    ambiente: safeEnv,
    semilla: `${base}/autenticacion/api/Autenticacion/Semilla`,
    validarSemilla: `${base}/autenticacion/api/Autenticacion/ValidarSemilla`,
    recepcionEcf: `${base}/recepcion/api/FacturasElectronicas`,
    recepcionResumenConsumo: `${base}/recepcionfc/api/Recepcion/ecf`,
    consultaResultado: `${base}/consultaresultado/api/Consultas/Estado`,
    consultaEstado: `${base}/consultaestado/api/Consultas/Estado`
  };
}

/**
 * Extrae llave privada y certificado X.509 de un archivo .p12/.pfx o PEM usando Node crypto / OpenSSL
 */
function parseP12OrPemCertificate(base64Data: string, password = "", fileName = "certificado.p12") {
  const buffer = Buffer.from(base64Data, "base64");
  const textContent = buffer.toString("utf8");

  // Caso 1: Archivo PEM directo con llave privada y certificado
  if (textContent.includes("-----BEGIN") && textContent.includes("CERTIFICATE-----")) {
    const x509 = new crypto.X509Certificate(buffer);
    const privKey = crypto.createPrivateKey({
      key: buffer,
      format: "pem",
      passphrase: password || undefined
    });
    return {
      privateKeyPem: privKey.export({ type: "pkcs8", format: "pem" }).toString(),
      certPem: x509.toString(),
      certBase64Der: x509.raw.toString("base64"),
      info: {
        configurado: true,
        nombreArchivo: fileName,
        titularSubject: x509.subject,
        emisorIssuer: x509.issuer,
        numeroSerie: x509.serialNumber,
        validoDesde: x509.validFrom,
        validoHasta: x509.validTo,
        algoritmoFirma: "RSA-SHA256 (XMLDSig C14N)",
        huellaSha256: x509.fingerprint256,
        cargadoEnServidor: true,
        updatedAt: Date.now()
      }
    };
  }

  // Caso 2: Archivo binario PKCS#12 (.p12 / .pfx) extraído mediante openssl en directorio temporal aislado
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dgii-p12-"));
  const p12Path = path.join(tmpDir, "cert.p12");
  try {
    fs.writeFileSync(p12Path, buffer, { mode: 0o600 });

    const certPemOut = execFileSync(
      "openssl",
      ["pkcs12", "-in", p12Path, "-clcerts", "-nokeys", "-passin", `pass:${password}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );

    const keyPemOut = execFileSync(
      "openssl",
      ["pkcs12", "-in", p12Path, "-nocerts", "-nodes", "-passin", `pass:${password}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );

    const certMatch = certPemOut.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
    const keyMatch = keyPemOut.match(/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA )?PRIVATE KEY-----/);

    if (!certMatch || !keyMatch) {
      throw new Error("No se encontró un par válido de certificado X.509 y llave privada dentro del archivo PKCS#12.");
    }

    const x509 = new crypto.X509Certificate(certMatch[0]);
    const privKey = crypto.createPrivateKey(keyMatch[0]);

    return {
      privateKeyPem: privKey.export({ type: "pkcs8", format: "pem" }).toString(),
      certPem: certMatch[0],
      certBase64Der: x509.raw.toString("base64"),
      info: {
        configurado: true,
        nombreArchivo: fileName,
        titularSubject: x509.subject,
        emisorIssuer: x509.issuer,
        numeroSerie: x509.serialNumber,
        validoDesde: x509.validFrom,
        validoHasta: x509.validTo,
        algoritmoFirma: "RSA-SHA256 (XMLDSig C14N)",
        huellaSha256: x509.fingerprint256,
        cargadoEnServidor: true,
        updatedAt: Date.now()
      }
    };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Firma un documento XML (e-CF, RFCE, Semilla DGII o ACECF) usando canonicalización real C14N (xml-crypto) + XMLDSig Enveloped RSA-SHA256
 */
function signXmlEnveloped(xmlString: string, certEntry: any) {
  const cleanXml = xmlString.replace(/<Signature[\s\S]*?<\/Signature>/g, "").trim();

  if (certEntry && certEntry.privateKeyPem) {
    const sig = new SignedXml({
      privateKey: certEntry.privateKeyPem,
      publicCert: certEntry.certPem,
      canonicalizationAlgorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
      signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
      getKeyInfoContent: () =>
        certEntry.certBase64Der
          ? `<X509Data><X509Certificate>${certEntry.certBase64Der}</X509Certificate></X509Data>`
          : null
    });

    sig.addReference({
      xpath: "/*",
      transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature"],
      digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
      uri: "",
      isEmptyUri: true
    });

    sig.computeSignature(cleanXml, {
      location: { reference: "/*", action: "append" }
    });

    const signedXml = sig.getSignedXml();
    const digestMatch = signedXml.match(/<DigestValue>([^<]+)<\/DigestValue>/);
    const sigValMatch = signedXml.match(/<SignatureValue>([^<]+)<\/SignatureValue>/);
    const digestBase64 = digestMatch?.[1] || "";
    const signatureBase64 = sigValMatch?.[1] || "";
    const codigoSeguridad = signatureBase64.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6);

    return {
      signedXml,
      digestBase64,
      signatureBase64,
      codigoSeguridad,
      firmadoConCertificadoReal: true
    };
  }

  // Fallback estructural transparente cuando aún no se ha cargado el archivo .p12
  const digestBase64 = crypto.createHash("sha256").update(cleanXml, "utf8").digest("base64");
  const signatureBase64 = crypto
    .createHash("sha256")
    .update(`LOCAL-UNSIGNED-DIGEST:${digestBase64}`, "utf8")
    .digest("base64");
  const codigoSeguridad = signatureBase64.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6);

  const signatureNode = `  <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
    <SignedInfo>
      <CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315" />
      <SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256" />
      <Reference URI="">
        <Transforms>
          <Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature" />
        </Transforms>
        <DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256" />
        <DigestValue>${digestBase64}</DigestValue>
      </Reference>
    </SignedInfo>
    <SignatureValue>${signatureBase64}</SignatureValue>
  </Signature>`;

  let signedXml = cleanXml;
  if (cleanXml.includes("</ECF>")) {
    signedXml = cleanXml.replace("</ECF>", `${signatureNode}\n</ECF>`);
  } else if (cleanXml.includes("</RFCE>")) {
    signedXml = cleanXml.replace("</RFCE>", `${signatureNode}\n</RFCE>`);
  } else if (cleanXml.includes("</SemillaModel>")) {
    signedXml = cleanXml.replace("</SemillaModel>", `${signatureNode}\n</SemillaModel>`);
  } else {
    signedXml = `${cleanXml}\n${signatureNode}`;
  }

  return {
    signedXml,
    digestBase64,
    signatureBase64,
    codigoSeguridad,
    firmadoConCertificadoReal: false
  };
}

/**
 * Obtiene Token oficial de la DGII solicitando Semilla -> Firmando con .p12 -> ValidarSemilla
 */
async function authenticateWithDGII(ambiente: string, certEntry: any) {
  const urls = getOfficialUrls(ambiente);
  const seedResp = await fetch(urls.semilla, {
    method: "GET",
    headers: { Accept: "application/xml, text/xml, */*" }
  });

  if (!seedResp.ok) {
    const errText = await seedResp.text();
    throw new Error(`DGII Semilla HTTP ${seedResp.status}: ${errText.slice(0, 240)}`);
  }

  const seedXml = await seedResp.text();
  const { signedXml: signedSeedXml } = signXmlEnveloped(seedXml, certEntry);

  const formData = new FormData();
  const blob = new Blob([signedSeedXml], { type: "text/xml" });
  formData.append("xml", blob, "semilla_firmada.xml");

  const tokenResp = await fetch(urls.validarSemilla, {
    method: "POST",
    body: formData
  });

  const tokenBodyText = await tokenResp.text();
  if (!tokenResp.ok) {
    throw new Error(`DGII ValidarSemilla HTTP ${tokenResp.status}: ${tokenBodyText.slice(0, 300)}`);
  }

  let parsed: Record<string, any> = {};
  try {
    parsed = JSON.parse(tokenBodyText);
  } catch {
    throw new Error(`Respuesta no JSON de ValidarSemilla DGII: ${tokenBodyText.slice(0, 240)}`);
  }

  const token = parsed.token || parsed.Token;
  if (!token) {
    throw new Error("La DGII no devolvió un token de sesión válido al validar la semilla firmada.");
  }

  return token;
}

function extractXmlTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m?.[1]?.trim() || "";
}

function appendRecepcionRecord(tenant: string, record: any) {
  const key = sanitizeTenantId(tenant);
  const current = recepcionesStore.get(key) || [];
  recepcionesStore.set(key, [record, ...current].slice(0, 100));
}

async function startServer() {
  loadEncryptedVaultOnStartup();

  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: "15mb" }));
  app.use(express.text({ type: ["application/xml", "text/xml", "text/plain"], limit: "15mb" }));

  // 1. Estado del certificado digital y conector DGII (multi-tenant)
  app.get("/api/dgii/status", (req, res) => {
    const tenant = sanitizeTenantId(String(req.query.tenant || "principal"));
    const certEntry = certificateStore.get(tenant);
    res.json({
      ok: true,
      tenant,
      servidorActivo: true,
      c14nXmlDsigActivo: true,
      bovedaCifradaActiva: true,
      certificadoCargado: Boolean(certEntry),
      certificadoInfo: certEntry ? certEntry.info : { configurado: false }
    });
  });

  // 2. Cargar y verificar Certificado Digital (.p12 / .pfx / .pem) en memoria + bóveda cifrada AES-256-GCM
  app.post("/api/dgii/certificate", (req, res) => {
    try {
      const { tenant = "principal", base64Data, password = "", fileName = "certificado.p12" } = req.body || {};
      const cleanTenant = sanitizeTenantId(String(tenant));
      if (!base64Data) {
        res.status(400).json({ ok: false, error: "No se recibió el contenido del certificado digital." });
        return;
      }

      const parsed = parseP12OrPemCertificate(base64Data, password, fileName);
      certificateStore.set(cleanTenant, parsed);
      saveEncryptedCertToVault(cleanTenant, parsed);

      res.json({
        ok: true,
        tenant: cleanTenant,
        certificadoInfo: parsed.info
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al procesar el archivo .p12/.pfx";
      res.status(400).json({
        ok: false,
        error: `No se pudo abrir el certificado digital (.p12/.pfx). Verifique la contraseña del certificado. Detalle: ${msg}`
      });
    }
  });

  // 3. Eliminar certificado de la memoria y de la bóveda cifrada del servidor
  app.delete("/api/dgii/certificate", (req, res) => {
    const tenant = sanitizeTenantId(String(req.query.tenant || "principal"));
    certificateStore.delete(tenant);
    deleteEncryptedCertFromVault(tenant);
    res.json({ ok: true, tenant });
  });

  // 4. Firmar XML e-CF (y RFCE si E32 < 250k) + transmisión opcional a Web Service oficial DGII
  app.post("/api/dgii/sign-ecf", async (req, res) => {
    try {
      const {
        tenant = "principal",
        xml,
        xmlRfce,
        ambiente = "TesteCF",
        enviarADGII = false,
        esResumenConsumo = false
      } = req.body || {};

      if (!xml || typeof xml !== "string") {
        res.status(400).json({ ok: false, error: "El cuerpo de la solicitud debe incluir el XML del e-CF." });
        return;
      }

      const cleanTenant = sanitizeTenantId(String(tenant));
      const certEntry = certificateStore.get(cleanTenant);
      const signResult = signXmlEnveloped(xml, certEntry);

      // Si es Factura de Consumo < RD$250,000, firmar también el documento resumido <RFCE> con el Código de Seguridad del <ECF>
      let signedRfceXml: string | undefined;
      if (esResumenConsumo && typeof xmlRfce === "string" && xmlRfce.includes("<RFCE>")) {
        const preparedRfce = xmlRfce.replace("__CODIGO_SEGURIDAD__", signResult.codigoSeguridad);
        const rfceSign = signXmlEnveloped(preparedRfce, certEntry);
        signedRfceXml = rfceSign.signedXml;
      }

      // Si no se solicitó envío a DGII, devolver XML firmado/preparado honestamente
      if (!enviarADGII) {
        res.json({
          ok: true,
          tenant: cleanTenant,
          ...signResult,
          signedRfceXml,
          enviadoADGII: false,
          estadoFiscal: signResult.firmadoConCertificadoReal ? "FIRMADO_XML" : "GENERADO_LOCAL"
        });
        return;
      }

      if (!certEntry || !certEntry.privateKeyPem) {
        res.json({
          ok: true,
          tenant: cleanTenant,
          ...signResult,
          signedRfceXml,
          enviadoADGII: false,
          estadoFiscal: "GENERADO_LOCAL",
          respuestaDGII:
            "Comprobante generado localmente. Para transmitir al Web Service oficial de la DGII debe cargar primero su certificado digital (.p12 / .pfx) vigente en Configuración Fiscal."
        });
        return;
      }

      // Conectar con el servicio web real de la DGII (sin simular respuestas)
      try {
        const token = await authenticateWithDGII(ambiente, certEntry);
        const urls = getOfficialUrls(ambiente);
        const useRfceEndpoint = Boolean(esResumenConsumo && signedRfceXml);
        const targetUrl = useRfceEndpoint ? urls.recepcionResumenConsumo : urls.recepcionEcf;
        const xmlPayloadToSend = useRfceEndpoint ? signedRfceXml! : signResult.signedXml;
        const fileNameToSend = useRfceEndpoint ? "rfce.xml" : "ecf.xml";

        const formData = new FormData();
        const xmlBlob = new Blob([xmlPayloadToSend], { type: "text/xml" });
        formData.append("xml", xmlBlob, fileNameToSend);

        const dgiiResp = await fetch(targetUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json, application/xml, text/xml"
          },
          body: formData
        });

        const rawResponse = await dgiiResp.text();
        let parsedResp: Record<string, any> | null = null;
        try {
          parsedResp = JSON.parse(rawResponse);
        } catch {}

        const trackId = parsedResp?.trackId || parsedResp?.TrackId || undefined;
        let estadoFiscal = "ENVIADO_DGII";
        const estadoTexto = String(parsedResp?.estado || parsedResp?.Estado || "").toLowerCase();
        if (estadoTexto.includes("aceptado condicional")) {
          estadoFiscal = "ACEPTADO_CONDICIONAL_DGII";
        } else if (estadoTexto.includes("aceptado")) {
          estadoFiscal = "ACEPTADO_DGII";
        } else if (estadoTexto.includes("rechazado")) {
          estadoFiscal = "RECHAZADO_DGII";
        } else if (trackId) {
          estadoFiscal = "EN_PROCESO_DGII";
        }

        res.json({
          ok: true,
          tenant: cleanTenant,
          ...signResult,
          signedRfceXml,
          enviadoADGII: dgiiResp.ok,
          trackId,
          estadoFiscal,
          respuestaDGII: rawResponse
        });
      } catch (wsErr) {
        const wsMsg = wsErr instanceof Error ? wsErr.message : String(wsErr);
        res.json({
          ok: true,
          tenant: cleanTenant,
          ...signResult,
          signedRfceXml,
          enviadoADGII: false,
          estadoFiscal: "FIRMADO_XML",
          respuestaDGII: `XML firmado digitalmente (C14N + RSA-SHA256) con su certificado .p12. Respuesta de conexión con DGII (${ambiente}): ${wsMsg}`
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error interno al firmar XML e-CF";
      res.status(500).json({ ok: false, error: msg });
    }
  });

  // 5. Consultar Estado de un TrackId directamente en la DGII
  app.post("/api/dgii/consulta-trackid", async (req, res) => {
    try {
      const { tenant = "principal", trackId, ambiente = "TesteCF" } = req.body || {};
      const cleanTenant = sanitizeTenantId(String(tenant));
      if (!trackId) {
        res.status(400).json({ ok: false, error: "Debe proporcionar un TrackId válido para consultar en la DGII." });
        return;
      }

      const certEntry = certificateStore.get(cleanTenant);
      if (!certEntry || !certEntry.privateKeyPem) {
        res.status(400).json({
          ok: false,
          error:
            "Para consultar el estado de un TrackId en los servidores de la DGII, primero debe cargar su certificado digital (.p12 / .pfx) para autenticar la semilla."
        });
        return;
      }

      const token = await authenticateWithDGII(ambiente, certEntry);
      const urls = getOfficialUrls(ambiente);
      const queryUrl = `${urls.consultaResultado}?TrackId=${encodeURIComponent(String(trackId).trim())}`;

      const dgiiResp = await fetch(queryUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json, application/xml"
        }
      });

      const bodyText = await dgiiResp.text();
      let parsed: Record<string, any> | null = null;
      try {
        parsed = JSON.parse(bodyText);
      } catch {}

      let estadoFiscal = "EN_PROCESO_DGII";
      const est = String(parsed?.estado || parsed?.Estado || "").toLowerCase();
      if (est.includes("aceptado condicional")) estadoFiscal = "ACEPTADO_CONDICIONAL_DGII";
      else if (est.includes("aceptado")) estadoFiscal = "ACEPTADO_DGII";
      else if (est.includes("rechazado")) estadoFiscal = "RECHAZADO_DGII";

      res.json({
        ok: dgiiResp.ok,
        statusHttp: dgiiResp.status,
        estadoFiscal,
        respuestaDGII: bodyText,
        parsed
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al consultar TrackId en DGII";
      res.status(502).json({ ok: false, error: msg });
    }
  });

  // ============================================================================
  // 6. ENDPOINTS RECEPTORES OFICIALES DGII (Para Certificación CerteCF / PSFE)
  // ============================================================================

  // 6a. Servicio de Semilla del Receptor (/fe/autenticacion/api/semilla)
  app.get("/fe/autenticacion/api/semilla", (_req, res) => {
    const valor = crypto.randomBytes(32).toString("base64");
    const nowIso = new Date().toISOString();
    activeSeeds.set(valor, { valor, expiresAt: Date.now() + 5 * 60 * 1000 });
    const seedXml = `<?xml version="1.0" encoding="utf-8"?>
<SemillaModel xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <valor>${valor}</valor>
  <fecha>${nowIso}</fecha>
</SemillaModel>`;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.send(seedXml);
  });

  // 6b. Validación de Certificado del Receptor (/fe/autenticacion/api/validacioncertificado)
  app.post("/fe/autenticacion/api/validacioncertificado", (req, res) => {
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
    const valor = extractXmlTag(rawBody, "valor");
    const hasSig = rawBody.includes("<SignatureValue>");

    if (!hasSig && !valor) {
      res.status(400).json({ ok: false, mensaje: "Se requiere XML SemillaModel firmado digitalmente." });
      return;
    }

    if (valor && activeSeeds.has(valor)) {
      const seedObj = activeSeeds.get(valor)!;
      activeSeeds.delete(valor);
      if (Date.now() > seedObj.expiresAt) {
        res.status(401).json({ ok: false, mensaje: "Semilla expirada." });
        return;
      }
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expira = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    res.json({
      token,
      expira,
      expedido: new Date().toISOString()
    });
  });

  // 6c. Recepción de e-CF de Proveedores / DGII (/fe/recepcion/api/ecf)
  app.post("/fe/recepcion/api/ecf", (req, res) => {
    const tenant = sanitizeTenantId(String(req.query.tenant || "principal"));
    const rawXml =
      typeof req.body === "string"
        ? req.body
        : String(req.body?.xml || req.body?.XML || JSON.stringify(req.body || ""));
    const rncEmisor = extractXmlTag(rawXml, "RNCEmisor") || "N/D";
    const encf = extractXmlTag(rawXml, "eNCF") || "N/D";
    const tipoEcf = extractXmlTag(rawXml, "TipoeCF") || "";
    const montoTotal = extractXmlTag(rawXml, "MontoTotal") || "";

    const record = {
      id: `rec-ecf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      tenant,
      tipo: "RECEPCION_ECF",
      rncEmisor,
      encf,
      tipoEcf,
      montoTotal,
      estadoRecepcion: rawXml.includes("<ECF>") ? "RECIBIDO_ARECF" : "RECIBIDO",
      recibidoEn: new Date().toISOString(),
      xmlPreview: rawXml.slice(0, 1200)
    };
    appendRecepcionRecord(tenant, record);

    res.status(200).json({
      codigo: 1,
      estado: "e-CF Recibido",
      rncEmisor,
      encf,
      fechaRecepcion: record.recibidoEn,
      mensajes: ["Acuse de recibo emitido por el sistema receptor."]
    });
  });

  // 6d. Recepción de Aprobación Comercial (/fe/aprobacioncomercial/api/ecf)
  app.post("/fe/aprobacioncomercial/api/ecf", (req, res) => {
    const tenant = sanitizeTenantId(String(req.query.tenant || "principal"));
    const rawXml =
      typeof req.body === "string"
        ? req.body
        : String(req.body?.xml || req.body?.XML || JSON.stringify(req.body || ""));
    const rncEmisor = extractXmlTag(rawXml, "RNCEmisor") || "N/D";
    const encf = extractXmlTag(rawXml, "eNCF") || "N/D";
    const estadoAprob = extractXmlTag(rawXml, "Estado") || "1";

    const record = {
      id: `rec-acecf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      tenant,
      tipo: "APROBACION_COMERCIAL",
      rncEmisor,
      encf,
      estadoRecepcion: estadoAprob === "2" ? "RECHAZO_COMERCIAL" : "APROBACION_COMERCIAL",
      recibidoEn: new Date().toISOString(),
      xmlPreview: rawXml.slice(0, 1200)
    };
    appendRecepcionRecord(tenant, record);

    res.status(200).json({
      codigo: 1,
      estado: record.estadoRecepcion,
      rncEmisor,
      encf,
      fechaRecepcion: record.recibidoEn
    });
  });

  // 6e. Consultar comprobantes recibidos en los endpoints receptores del tenant
  app.get("/api/dgii/recepciones", (req, res) => {
    const tenant = sanitizeTenantId(String(req.query.tenant || "principal"));
    res.json({
      ok: true,
      tenant,
      recepciones: recepcionesStore.get(tenant) || []
    });
  });

  // Integración Vite en desarrollo / archivos estáticos en producción
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*all", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
