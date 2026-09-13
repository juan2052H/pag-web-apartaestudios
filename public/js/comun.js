/* ==========================================================================
   Utilidades compartidas por el sitio público y el panel de administración.
   ========================================================================== */

const App = (() => {
  let moneda = 'COP';
  let locale = 'es-CO';

  /* --- Formato ----------------------------------------------------------- */

  const configurarMoneda = (m, l) => { moneda = m || moneda; locale = l || locale; };

  const dinero = (v, compacto = false) => {
    const n = Number(v) || 0;
    const abreviar = compacto && Math.abs(n) >= 1000000;
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency', currency: moneda,
        // En modo compacto un decimal evita que 1.550.000 se lea como "$2 M".
        maximumFractionDigits: abreviar ? 1 : 0,
        notation: abreviar ? 'compact' : 'standard',
      }).format(n);
    } catch {
      return '$' + n.toLocaleString('es-CO', { maximumFractionDigits: 0 });
    }
  };

  const numero = (v, dec = 0) =>
    (Number(v) || 0).toLocaleString(locale, { minimumFractionDigits: dec, maximumFractionDigits: dec });

  const porcentaje = (v, dec = 0) => numero((Number(v) || 0) * 100, dec) + '%';

  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  /** "2026-09" -> "sep 2026"  ·  corto: "sep" */
  const mesTexto = (p, corto = false) => {
    if (!p) return '—';
    const [a, m] = String(p).split('-').map(Number);
    const nm = MESES[(m || 1) - 1] || '';
    return corto ? nm : `${nm} ${a}`;
  };

  /** "2026-09-15" -> "15 sep 2026" */
  const fechaTexto = (f) => {
    if (!f) return '—';
    const s = String(f).slice(0, 10).split('-').map(Number);
    if (s.length < 3 || !s[0]) return String(f);
    return `${s[2]} ${MESES[(s[1] || 1) - 1]} ${s[0]}`;
  };

  const hoyISO = () => new Date().toISOString().slice(0, 10);
  const mesISO = () => new Date().toISOString().slice(0, 7);

  const duracion = (seg) => {
    if (!seg || !isFinite(seg)) return '';
    const m = Math.floor(seg / 60);
    const s = Math.floor(seg % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const pesoArchivo = (b) => {
    if (!b) return '—';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0, n = b;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
  };

  /* --- HTML seguro -------------------------------------------------------- */

  const esc = (s) => String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const attr = (s) => esc(s);

  /** Etiqueta de plantilla que escapa todas las interpolaciones. */
  const html = (cadenas, ...vals) =>
    cadenas.reduce((acc, c, i) => acc + c + (i < vals.length ? (vals[i] && vals[i].__crudo ? vals[i].v : esc(vals[i])) : ''), '');

  const crudo = (v) => ({ __crudo: true, v: v === null || v === undefined ? '' : String(v) });

  const iniciales = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((x) => x[0] || '').join('').toUpperCase() || '?';

  /* --- DOM ---------------------------------------------------------------- */

  const $ = (sel, raiz = document) => raiz.querySelector(sel);
  const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));

  const el = (tag, props = {}, hijos = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : v);
    }
    for (const h of [].concat(hijos)) if (h) n.append(h);
    return n;
  };

  /* --- Notificaciones ----------------------------------------------------- */

  function nota(mensaje, tipo = '') {
    let cont = document.getElementById('notificaciones');
    if (!cont) {
      cont = el('div', { id: 'notificaciones' });
      document.body.append(cont);
    }
    const n = el('div', { class: 'nota' + (tipo ? ' nota-' + tipo : ''), text: mensaje });
    cont.append(n);
    setTimeout(() => {
      n.style.transition = 'opacity .25s ease, transform .25s ease';
      n.style.opacity = '0';
      n.style.transform = 'translateY(6px)';
      setTimeout(() => n.remove(), 260);
    }, tipo === 'error' ? 5200 : 3000);
  }

  /* --- API ---------------------------------------------------------------- */

  const CLAVE_TOKEN = 'apartaestudios.token';
  const token = {
    get: () => { try { return localStorage.getItem(CLAVE_TOKEN); } catch { return null; } },
    set: (t) => { try { t ? localStorage.setItem(CLAVE_TOKEN, t) : localStorage.removeItem(CLAVE_TOKEN); } catch {} },
  };

  async function api(ruta, opciones = {}) {
    const cab = Object.assign({}, opciones.headers || {});
    const t = token.get();
    if (t) cab.Authorization = 'Bearer ' + t;
    let cuerpo = opciones.body;
    if (cuerpo !== undefined && !(cuerpo instanceof Blob) && typeof cuerpo === 'object') {
      cab['Content-Type'] = 'application/json';
      cuerpo = JSON.stringify(cuerpo);
    }
    const r = await fetch(ruta, { ...opciones, headers: cab, body: cuerpo });
    let datos = null;
    try { datos = await r.json(); } catch {}
    if (!r.ok) {
      const e = new Error((datos && datos.error) || `Error ${r.status}`);
      e.status = r.status;
      throw e;
    }
    return datos;
  }

  /** Sube un archivo enviando el binario como cuerpo crudo (sin multipart). */
  function subirArchivo(archivo, alProgreso) {
    return new Promise((resolve, rechazar) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/media');
      const t = token.get();
      if (t) xhr.setRequestHeader('Authorization', 'Bearer ' + t);
      xhr.setRequestHeader('Content-Type', archivo.type || 'application/octet-stream');
      // El nombre viaja en base64 para soportar tildes y espacios en la cabecera.
      xhr.setRequestHeader('x-nombre', btoa(unescape(encodeURIComponent(archivo.name || 'archivo'))));
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && alProgreso) alProgreso(e.loaded / e.total);
      };
      xhr.onload = () => {
        let d = null;
        try { d = JSON.parse(xhr.responseText); } catch {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(d);
        else rechazar(new Error((d && d.error) || `Error ${xhr.status} al subir`));
      };
      xhr.onerror = () => rechazar(new Error('Se perdió la conexión durante la subida'));
      xhr.send(archivo);
    });
  }

  const urlMedia = (mid) => (mid ? `/api/media/${mid}` : '');

  /**
   * Marcado compartido de "encargado" (avatar + nombre + contacto) usado por
   * el sitio público en la tarjeta de edificio y en el detalle de unidad.
   * `accionesHtml` deja cada vista poner sus propios botones (WhatsApp con
   * mensaje distinto, "Ver unidades" vs "Solicitar visita", etc.).
   */
  const tarjetaEncargado = (enc, accionesHtml = '') => `
    ${enc.fotoId
      ? `<img class="avatar" src="${urlMedia(enc.fotoId)}" alt="Foto de ${esc(enc.nombre)}">`
      : `<div class="avatar">${esc(iniciales(enc.nombre))}</div>`}
    <div class="datos">
      <div class="rol">${esc(enc.cargo || 'Encargado')}</div>
      <div class="nombre">${esc(enc.nombre)}</div>
      ${enc.telefono ? `<div class="linea"><span aria-hidden="true">☏</span> <a href="tel:${esc(enc.telefono.replace(/\s/g, ''))}">${esc(enc.telefono)}</a></div>` : ''}
      ${enc.email ? `<div class="linea"><span aria-hidden="true">✉</span> <a href="mailto:${esc(enc.email)}">${esc(enc.email)}</a></div>` : ''}
      ${enc.horario ? `<div class="linea"><span aria-hidden="true">◷</span> <span>${esc(enc.horario)}</span></div>` : ''}
      ${accionesHtml}
    </div>`;

  /* --- Modales ------------------------------------------------------------ */

  const pila = [];

  function modal({ titulo = '', cuerpo = '', pie = '', tamano = 'md', alAbrir, alCerrar }) {
    const fondo = el('div', { class: 'modal-fondo' });
    const caja = el('div', { class: `modal modal-${tamano}`, role: 'dialog', 'aria-modal': 'true' });
    caja.innerHTML = `
      <div class="modal-cabeza">
        <h3>${esc(titulo)}</h3>
        <button class="cerrar" type="button" aria-label="Cerrar">&times;</button>
      </div>
      <div class="modal-cuerpo">${cuerpo}</div>
      ${pie ? `<div class="modal-pie">${pie}</div>` : ''}`;
    fondo.append(caja);

    // Mientras haya algún modal abierto, el resto de la página queda inerte
    // (ni foco ni lectura por teclado/lector de pantalla la alcanzan) para que
    // el diálogo se comporte como uno modal de verdad.
    const actualizarInerte = () => {
      const fondos = new Set($$('.modal-fondo'));
      for (const hijo of document.body.children) {
        if (fondos.has(hijo)) hijo.removeAttribute('inert');
        else if (pila.length) hijo.setAttribute('inert', '');
        else hijo.removeAttribute('inert');
      }
    };
    const focosDe = () => [...caja.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter((n) => n.offsetParent !== null);

    const cerrar = () => {
      if (alCerrar) alCerrar();
      fondo.remove();
      const i = pila.indexOf(cerrar);
      if (i >= 0) pila.splice(i, 1);
      if (!pila.length) document.body.style.overflow = '';
      document.removeEventListener('keydown', porTecla);
      actualizarInerte();
    };
    const porTecla = (e) => {
      if (pila[pila.length - 1] !== cerrar) return;
      if (e.key === 'Escape') return cerrar();
      if (e.key === 'Tab') {
        const focos = focosDe();
        if (!focos.length) return;
        const primero = focos[0];
        const ultimo = focos[focos.length - 1];
        if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
        else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
      }
    };

    caja.querySelector('.cerrar').addEventListener('click', cerrar);
    fondo.addEventListener('mousedown', (e) => { if (e.target === fondo) cerrar(); });
    document.addEventListener('keydown', porTecla);

    document.body.append(fondo);
    document.body.style.overflow = 'hidden';
    pila.push(cerrar);
    actualizarInerte();

    if (alAbrir) alAbrir(caja, cerrar);
    // Se enfoca un campo si lo hay; si no, el diálogo mismo. Nunca un botón del
    // final, porque el navegador desplazaría el contenido para alcanzarlo.
    caja.tabIndex = -1;
    const foco = caja.querySelector('input:not([type=hidden]), select, textarea');
    setTimeout(() => (foco || caja).focus({ preventScroll: true }), 60);
    return { caja, cerrar, fondo };
  }

  function confirmar(mensaje, { titulo = 'Confirmar', textoOk = 'Sí, continuar', peligro = true } = {}) {
    return new Promise((resolve) => {
      let resuelto = false;
      const m = modal({
        titulo, tamano: 'sm',
        cuerpo: `<p style="margin:0;color:var(--ink-2)">${esc(mensaje)}</p>`,
        pie: `<button class="btn" data-no type="button">Cancelar</button>
              <button class="btn ${peligro ? 'btn-peligro' : 'btn-primario'}" data-si type="button">${esc(textoOk)}</button>`,
        alCerrar: () => { if (!resuelto) { resuelto = true; resolve(false); } },
      });
      m.caja.querySelector('[data-no]').addEventListener('click', () => m.cerrar());
      m.caja.querySelector('[data-si]').addEventListener('click', () => { resuelto = true; resolve(true); m.cerrar(); });
    });
  }

  /* --- Tema --------------------------------------------------------------- */

  const CLAVE_TEMA = 'apartaestudios.tema';

  function aplicarTema(t) {
    if (t === 'claro' || t === 'oscuro') document.documentElement.setAttribute('data-tema', t);
    else document.documentElement.removeAttribute('data-tema');
    try { t ? localStorage.setItem(CLAVE_TEMA, t) : localStorage.removeItem(CLAVE_TEMA); } catch {}
  }

  function temaGuardado() {
    try { return localStorage.getItem(CLAVE_TEMA) || ''; } catch { return ''; }
  }

  function iniciarTema(boton) {
    aplicarTema(temaGuardado());
    const pintar = () => {
      const t = document.documentElement.getAttribute('data-tema');
      const oscuro = t === 'oscuro' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches);
      if (boton) {
        boton.textContent = oscuro ? '☀' : '☾';
        boton.title = oscuro ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
        boton.setAttribute('aria-label', boton.title);
      }
      document.dispatchEvent(new CustomEvent('tema-cambiado', { detail: { oscuro } }));
    };
    if (boton) {
      boton.addEventListener('click', () => {
        const t = document.documentElement.getAttribute('data-tema');
        const oscuro = t === 'oscuro' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches);
        aplicarTema(oscuro ? 'claro' : 'oscuro');
        pintar();
      });
    }
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', pintar);
    pintar();
  }

  /* --- Varios ------------------------------------------------------------- */

  const rebote = (fn, ms = 220) => {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };

  const ESTADOS = {
    disponible: 'Disponible',
    arrendado: 'Arrendado',
    reservado: 'Reservado',
    mantenimiento: 'En mantenimiento',
  };

  const descargarCSV = (nombre, filas) => {
    const escaparCelda = (c) => {
      const s = String(c === null || c === undefined ? '' : c);
      return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const txt = '﻿' + filas.map((f) => f.map(escaparCelda).join(';')).join('\r\n');
    const a = el('a', {
      href: URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' })),
      download: nombre,
    });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };

  return {
    configurarMoneda, dinero, numero, porcentaje, mesTexto, fechaTexto, hoyISO, mesISO,
    duracion, pesoArchivo, esc, attr, html, crudo, iniciales,
    $, $$, el, nota, api, subirArchivo, urlMedia, token, tarjetaEncargado,
    modal, confirmar, iniciarTema, aplicarTema, rebote, ESTADOS, descargarCSV, MESES,
  };
})();

// El CSS de Leaflet se precarga (rel="preload") para no bloquear el render
// inicial; aquí se activa como hoja de estilos real en cuanto este script
// corre (sin onload= inline, que rompería script-src de la CSP).
(() => {
  const link = document.getElementById('css-leaflet');
  if (link) link.rel = 'stylesheet';
})();
