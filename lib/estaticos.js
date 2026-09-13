'use strict';
/**
 * Archivos estáticos, robots.txt/sitemap.xml, la página SEO por unidad y los
 * medios subidos (con soporte de Range para video).
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { DIR_PUBLICO, DIR_SUBIDAS, MIMES, LIMITE_SUBIDA } = require('./config');
const { CABECERAS_SEGURIDAD, comprimirRespuesta, error } = require('./http');
const { obtenerDb } = require('./db');
const { texto, escapeHtml, slugificar } = require('./utilidades');
const { apartamentoVisiblePublico } = require('./modelos');

async function servirEstatico(req, res, ruta) {
  let rel = decodeURIComponent(ruta.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  if (!path.extname(rel)) rel += '.html';

  const destino = path.join(DIR_PUBLICO, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!destino.startsWith(DIR_PUBLICO)) return error(res, 403, 'Ruta no permitida');

  try {
    const st = await fsp.stat(destino);
    if (!st.isFile()) throw new Error('no-file');

    // ETag barato (tamaño + fecha de modificación): habilita 304 sin releer el
    // archivo en cada visita repetida. max-age corto porque no hay
    // cache-busting por hash de contenido: revalida rápido tras un deploy.
    const etag = `"${st.size.toString(16)}-${Math.trunc(st.mtimeMs).toString(16)}"`;
    const cabeceras = {
      ...CABECERAS_SEGURIDAD,
      'Content-Type': MIMES[path.extname(destino).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=300, must-revalidate',
      'ETag': etag,
      'Vary': 'Accept-Encoding',
    };

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, cabeceras);
      return res.end();
    }

    const buffer = await fsp.readFile(destino);
    const { cuerpo, codificacion } = await comprimirRespuesta(buffer, req);
    res.writeHead(200, {
      ...cabeceras,
      ...(codificacion ? { 'Content-Encoding': codificacion } : {}),
      'Content-Length': cuerpo.length,
    });
    if (req.method === 'HEAD') return res.end();
    res.end(cuerpo);
  } catch {
    res.writeHead(404, { ...CABECERAS_SEGURIDAD, 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404</h1><p>No encontrado. <a href="/">Ir al inicio</a></p>');
  }
}

/** Origen seguro para URLs que leen los buscadores detrás de un proxy HTTPS. */
function origenPublico(req) {
  const hostRecibido = String(req.headers.host || 'localhost').toLowerCase();
  const host = /^[a-z0-9.:-]+$/.test(hostRecibido) ? hostRecibido : 'localhost';
  const protoRecibido = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = protoRecibido === 'https' || protoRecibido === 'http'
    ? protoRecibido
    : 'http';
  return `${proto}://${host}`;
}

async function responderTexto(req, res, tipo, cuerpo) {
  const buffer = Buffer.from(cuerpo, 'utf8');
  const { cuerpo: cuerpoFinal, codificacion } = await comprimirRespuesta(buffer, req);
  res.writeHead(200, {
    ...CABECERAS_SEGURIDAD,
    'Content-Type': `${tipo}; charset=utf-8`,
    'Content-Length': cuerpoFinal.length,
    'Cache-Control': 'public, max-age=3600',
    'Vary': 'Accept-Encoding',
    ...(codificacion ? { 'Content-Encoding': codificacion } : {}),
  });
  if (req.method === 'HEAD') return res.end();
  return res.end(cuerpoFinal);
}

function servirRobots(req, res) {
  // Las áreas privadas llevan meta noindex. No se bloquean aquí para que los
  // buscadores puedan leer esa directiva; robots.txt no es una barrera de seguridad.
  const cuerpo = `User-agent: *\nAllow: /\n\nSitemap: ${origenPublico(req)}/sitemap.xml\n`;
  return responderTexto(req, res, 'text/plain', cuerpo);
}

function urlUnidad(origen, a) {
  return `${origen}/unidad/${a.id}-${slugificar(a.titulo || `apartaestudio ${a.numero}`)}`;
}

function servirSitemap(req, res) {
  const db = obtenerDb();
  const origen = origenPublico(req);
  const urlsUnidades = db.apartamentos.filter(apartamentoVisiblePublico).map((a) => {
    const fecha = texto(a.actualizado || a.creado, 10).slice(0, 10);
    const lastmod = fecha ? `<lastmod>${fecha}</lastmod>` : '';
    return `  <url><loc>${urlUnidad(origen, a)}</loc>${lastmod}<changefreq>weekly</changefreq><priority>0.8</priority></url>`;
  }).join('\n');
  const cuerpo = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${origen}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n  <url><loc>${origen}/privacidad</loc><changefreq>yearly</changefreq><priority>0.3</priority></url>\n${urlsUnidades}\n</urlset>\n`;
  return responderTexto(req, res, 'application/xml', cuerpo);
}

/**
 * Sirve el mismo shell SPA de la home con las etiquetas <head> reescritas
 * para una unidad concreta (title/description/OG/Twitter/canonical +
 * JSON-LD RealEstateListing), para que cada apartaestudio disponible tenga
 * una URL propia indexable. El resto de la página (todo el catálogo,
 * incluida la lógica para pintar el detalle) lo sigue resolviendo
 * público.js — aquí no se duplica ese render, solo se preparan los metadatos
 * que un crawler o una vista previa de redes leen sin ejecutar JS.
 */
async function servirPaginaUnidad(req, res, idUnidad) {
  const db = obtenerDb();
  const pagina404 = () => {
    res.writeHead(404, { ...CABECERAS_SEGURIDAD, 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404</h1><p>No encontrado. <a href="/">Ir al inicio</a></p>');
  };

  const a = db.apartamentos.find((x) => x.id === idUnidad);
  if (!a || !apartamentoVisiblePublico(a)) return pagina404();

  let html;
  try { html = await fsp.readFile(path.join(DIR_PUBLICO, 'index.html'), 'utf8'); }
  catch { return pagina404(); }

  const ed = db.edificios.find((e) => e.id === a.edificioId) || null;
  const origen = origenPublico(req);
  const canonical = urlUnidad(origen, a);

  const tituloTexto = `${a.titulo || 'Apartaestudio ' + a.numero}${ed ? ' · ' + ed.nombre : ''} · ${db.config.nombreSitio}`;
  let precioTexto = '';
  try {
    precioTexto = new Intl.NumberFormat(db.config.localeMoneda || 'es-CO', {
      style: 'currency', currency: db.config.moneda || 'COP', maximumFractionDigits: 0,
    }).format(a.precio || 0);
  } catch { /* Intl sin datos de la moneda configurada: se omite el precio del texto. */ }
  const descTexto = `Apartaestudio ${[
    a.area ? `${a.area} m²` : '',
    `${a.habitaciones} ${a.habitaciones === 1 ? 'alcoba' : 'alcobas'}`,
    ed ? `en ${ed.nombre}${ed.ciudad ? ', ' + ed.ciudad : ''}` : '',
    precioTexto ? `desde ${precioTexto}/mes` : '',
  ].filter(Boolean).join(', ')}. Video real y contacto directo con el encargado.`;

  const ogImagen = a.portadaId ? `${origen}/api/media/${a.portadaId}` : '';
  const tituloEsc = escapeHtml(tituloTexto);
  const descEsc = escapeHtml(descTexto);

  html = html
    .replace(/<title>[^<]*<\/title>/, `<title>${tituloEsc}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${descEsc}">`)
    .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${tituloEsc}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${descEsc}">`)
    .replace(/<meta name="twitter:card" content="[^"]*">/, `<meta name="twitter:card" content="${ogImagen ? 'summary_large_image' : 'summary'}">`)
    .replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${tituloEsc}">`)
    .replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${descEsc}">`)
    .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${escapeHtml(canonical)}">`);

  if (ogImagen) {
    const imagenEsc = escapeHtml(ogImagen);
    html = html.replace('<link rel="icon"',
      `<meta property="og:image" content="${imagenEsc}">\n<meta name="twitter:image" content="${imagenEsc}">\n<link rel="icon"`);
  }

  const listado = {
    '@context': 'https://schema.org',
    '@type': 'RealEstateListing',
    name: a.titulo || `Apartaestudio ${a.numero}`,
    description: descTexto,
    url: canonical,
    ...(ogImagen ? { image: ogImagen } : {}),
    ...(ed ? { address: {
      '@type': 'PostalAddress',
      addressCountry: 'CO',
      ...(ed.direccion ? { streetAddress: ed.direccion } : {}),
      ...(ed.ciudad ? { addressLocality: ed.ciudad } : {}),
    } } : {}),
    ...(ed?.lat && ed?.lng ? { geo: { '@type': 'GeoCoordinates', latitude: ed.lat, longitude: ed.lng } } : {}),
    offers: {
      '@type': 'Offer',
      price: a.precio || 0,
      priceCurrency: db.config.moneda || 'COP',
      availability: a.estado === 'disponible' ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    },
  };
  // < evita que un valor con "</script>" cierre el bloque antes de tiempo.
  const jsonLd = JSON.stringify(listado).replace(/</g, '\\u003c');
  html = html.replace('<link rel="icon"', `<script type="application/ld+json">${jsonLd}</script>\n<link rel="icon"`);

  const buffer = Buffer.from(html, 'utf8');
  const { cuerpo, codificacion } = await comprimirRespuesta(buffer, req);
  res.writeHead(200, {
    ...CABECERAS_SEGURIDAD,
    'Content-Type': 'text/html; charset=utf-8',
    // Corto: el precio/disponibilidad puede cambiar desde el panel sin ningún
    // mecanismo de invalidación de caché.
    'Cache-Control': 'public, max-age=60, must-revalidate',
    'Vary': 'Accept-Encoding',
    ...(codificacion ? { 'Content-Encoding': codificacion } : {}),
    'Content-Length': cuerpo.length,
  });
  if (req.method === 'HEAD') return res.end();
  res.end(cuerpo);
}

/** Sirve un archivo subido, con soporte de Range (necesario para video). */
async function servirMedia(req, res, mediaId) {
  const db = obtenerDb();
  const m = db.media.find((x) => x.id === mediaId);
  if (!m) return error(res, 404, 'Archivo no encontrado');
  const archivo = path.join(DIR_SUBIDAS, m.archivo);
  if (!archivo.startsWith(DIR_SUBIDAS)) return error(res, 403, 'Ruta no permitida');

  let st;
  try { st = await fsp.stat(archivo); }
  catch { return error(res, 404, 'Archivo no disponible en disco'); }

  const rango = req.headers.range;
  const cabeceras = {
    ...CABECERAS_SEGURIDAD,
    'Content-Type': m.mime || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': m.privado ? 'private, no-store' : 'public, max-age=31536000, immutable',
  };

  if (rango) {
    const mm = /bytes=(\d*)-(\d*)/.exec(rango);
    let inicio = mm && mm[1] ? parseInt(mm[1], 10) : 0;
    let fin = mm && mm[2] ? parseInt(mm[2], 10) : st.size - 1;
    if (Number.isNaN(inicio) || inicio >= st.size || inicio > fin) {
      res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
      return res.end();
    }
    fin = Math.min(fin, st.size - 1);
    res.writeHead(206, {
      ...cabeceras,
      'Content-Range': `bytes ${inicio}-${fin}/${st.size}`,
      'Content-Length': fin - inicio + 1,
    });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(archivo, { start: inicio, end: fin }).pipe(res);
  }

  res.writeHead(200, { ...cabeceras, 'Content-Length': st.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(archivo).pipe(res);
}

/**
 * Recibe el cuerpo crudo y lo escribe a `destino`. Si se pasa `validarFirma`,
 * comprueba los primeros bytes reales del archivo contra el mime declarado
 * (magic bytes) antes de aceptarlo: un Content-Type falsificado ya no basta
 * para colar un tipo de archivo distinto (ver firmaCoincide en utilidades).
 */
function recibirArchivo(req, res, destino, opciones = {}) {
  const {
    limite = LIMITE_SUBIDA,
    mensajeLimite = 'El archivo supera el límite permitido',
    validarFirma = null,
  } = opciones;
  return new Promise((resolve, reject) => {
    let total = 0;
    let cabeza = validarFirma ? Buffer.alloc(0) : null;
    let firmaOk = !validarFirma;
    const out = fs.createWriteStream(destino);
    const abortar = (err) => {
      req.destroy();
      out.destroy();
      fs.unlink(destino, () => {});
      reject(err);
    };
    req.on('data', (c) => {
      total += c.length;
      if (total > limite) return abortar(new Error(mensajeLimite));
      if (!firmaOk) {
        cabeza = Buffer.concat([cabeza, c]);
        if (cabeza.length >= 16) {
          firmaOk = true;
          if (!validarFirma(cabeza)) return abortar(new Error('El archivo no corresponde al tipo declarado.'));
        }
      }
    });
    req.pipe(out);
    out.on('finish', () => {
      if (!firmaOk) return abortar(new Error('El archivo no corresponde al tipo declarado.'));
      resolve(total);
    });
    out.on('error', reject);
    req.on('error', (e) => { out.destroy(); reject(e); });
  });
}

module.exports = {
  servirEstatico, origenPublico, servirRobots, urlUnidad, servirSitemap,
  servirPaginaUnidad, servirMedia, recibirArchivo,
};
