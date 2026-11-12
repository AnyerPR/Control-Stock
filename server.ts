import express from "express";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Almacén seguro en memoria del servidor por farmacia/tenant (nunca se expone la llave privada al cliente)
const certificateStore = new Map();

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
function parseP12OrPemCertificate(base64Data, password = "", fileName = "certificado.p12") {
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
        algoritmoFirma: "RSA-SHA256 (XMLDSig)",
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
        algoritmoFirma: "RSA-SHA256 (XMLDSig)",
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
 * Firma un documento XML (e-CF o Semilla DGII) siguiendo el estándar XMLDSig Enveloped RSA-SHA256
 */
function signXmlEnveloped(xmlString, certEntry) {
  const cleanXml = xmlString.replace(/<Signature[\s\S]*?<\/Signature>/g, "").trim();
  const digestBase64 = crypto.createHash("sha256").update(cleanXml, "utf8").digest("base64");

  const signedInfoXml = `<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></CanonicalizationMethod><SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"></SignatureMethod><Reference URI=""><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform></Transforms><DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></DigestMethod><DigestValue>${digestBase64}</DigestValue></Reference></SignedInfo>`;

  let signatureBase64 = "";
  let firmadoReal = false;

  if (certEntry && certEntry.privateKeyPem) {
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(signedInfoXml, "utf8");
    signer.end();
    signatureBase64 = signer.sign(certEntry.privateKeyPem, "base64");
    firmadoReal = true;
  } else {
    signatureBase64 = crypto
      .createHash("sha256")
      .update(`LOCAL-UNSIGNED-DIGEST:${digestBase64}`, "utf8")
      .digest("base64");
  }

  const codigoSeguridad = signatureBase64.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6);

  const keyInfoBlock =
    certEntry && certEntry.certBase64Der
      ? `\n    <KeyInfo>\n      <X509Data>\n        <X509Certificate>${certEntry.certBase64Der}</X509Certificate>\n      </X509Data>\n    </KeyInfo>`
      : "";

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
    <SignatureValue>${signatureBase64}</SignatureValue>${keyInfoBlock}
  </Signature>`;

  let signedXml = cleanXml;
  if (cleanXml.includes("</ECF>")) {
    signedXml = cleanXml.replace("</ECF>", `${signatureNode}\n</ECF>`);
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
    firmadoConCertificadoReal: firmadoReal
  };
}

/**
 * Obtiene Token oficial de la DGII solicitando Semilla -> Firmando con .p12 -> ValidarSemilla
 */
async function authenticateWithDGII(ambiente, certEntry) {
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

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: "15mb" }));

  // 1. Estado del certificado digital y conector DGII
  app.get("/api/dgii/status", (req, res) => {
    const tenant = String(req.query.tenant || "principal");
    const certEntry = certificateStore.get(tenant);
    res.json({
      ok: true,
      servidorActivo: true,
      certificadoCargado: Boolean(certEntry),
      certificadoInfo: certEntry ? certEntry.info : { configurado: false }
    });
  });

  // 2. Cargar y verificar Certificado Digital (.p12 / .pfx / .pem) en memoria segura del servidor
  app.post("/api/dgii/certificate", (req, res) => {
    try {
      const { tenant = "principal", base64Data, password = "", fileName = "certificado.p12" } = req.body || {};
      if (!base64Data) {
        res.status(400).json({ ok: false, error: "No se recibió el contenido del certificado digital." });
        return;
      }

      const parsed = parseP12OrPemCertificate(base64Data, password, fileName);
      certificateStore.set(String(tenant), parsed);

      res.json({
        ok: true,
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

  // 3. Eliminar certificado de la memoria del servidor
  app.delete("/api/dgii/certificate", (req, res) => {
    const tenant = String(req.query.tenant || "principal");
    certificateStore.delete(tenant);
    res.json({ ok: true });
  });

  // 4. Firmar XML e-CF (y opcionalmente transmitir al Web Service oficial de la DGII)
  app.post("/api/dgii/sign-ecf", async (req, res) => {
    try {
      const {
        tenant = "principal",
        xml,
        ambiente = "TesteCF",
        enviarADGII = false,
        esResumenConsumo = false
      } = req.body || {};

      if (!xml || typeof xml !== "string") {
        res.status(400).json({ ok: false, error: "El cuerpo de la solicitud debe incluir el XML del e-CF." });
        return;
      }

      const certEntry = certificateStore.get(String(tenant));
      const signResult = signXmlEnveloped(xml, certEntry);

      // Si no se solicitó envío a DGII o no hay certificado cargado, devolver XML firmado/preparado honestamente
      if (!enviarADGII) {
        res.json({
          ok: true,
          ...signResult,
          enviadoADGII: false,
          estadoFiscal: signResult.firmadoConCertificadoReal ? "FIRMADO_XML" : "GENERADO_LOCAL"
        });
        return;
      }

      if (!certEntry || !certEntry.privateKeyPem) {
        res.json({
          ok: true,
          ...signResult,
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
        const targetUrl = esResumenConsumo ? urls.recepcionResumenConsumo : urls.recepcionEcf;

        const formData = new FormData();
        const xmlBlob = new Blob([signResult.signedXml], { type: "text/xml" });
        formData.append("xml", xmlBlob, "ecf.xml");

        const dgiiResp = await fetch(targetUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json, application/xml, text/xml"
          },
          body: formData
        });

        const rawResponse = await dgiiResp.text();
        let parsedResp = null;
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
          ...signResult,
          enviadoADGII: dgiiResp.ok,
          trackId,
          estadoFiscal,
          respuestaDGII: rawResponse
        });
      } catch (wsErr) {
        const wsMsg = wsErr instanceof Error ? wsErr.message : String(wsErr);
        res.json({
          ok: true,
          ...signResult,
          enviadoADGII: false,
          estadoFiscal: "FIRMADO_XML",
          respuestaDGII: `XML firmado digitalmente con su certificado .p12. Respuesta de conexión con DGII (${ambiente}): ${wsMsg}`
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
      if (!trackId) {
        res.status(400).json({ ok: false, error: "Debe proporcionar un TrackId válido para consultar en la DGII." });
        return;
      }

      const certEntry = certificateStore.get(String(tenant));
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
      let parsed = null;
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
