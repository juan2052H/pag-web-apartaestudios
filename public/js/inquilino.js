/* ===========================================================================
   Portal privado del inquilino
   ========================================================================== */

(() => {
  const { $, $$, esc, dinero, numero, mesTexto, fechaTexto, iniciales, nota, modal } = App;
  const CLAVE_TOKEN = 'apartaestudios.inquilino.token';
  let datos = null;

  const token = {
    get: () => { try { return localStorage.getItem(CLAVE_TOKEN); } catch { return null; } },
    set: (v) => { try { v ? localStorage.setItem(CLAVE_TOKEN, v) : localStorage.removeItem(CLAVE_TOKEN); } catch {} },
  };

  async function apiInquilino(ruta, opciones = {}) {
    const cab = Object.assign({}, opciones.headers || {});
    const t = token.get();
    if (t) cab.Authorization = 'Bearer ' + t;
    let cuerpo = opciones.body;
    if (cuerpo !== undefined && !(cuerpo instanceof Blob) && typeof cuerpo === 'object') {
      cab['Content-Type'] = 'application/json';
      cuerpo = JSON.stringify(cuerpo);
    }
    const r = await fetch(ruta, { ...opciones, headers: cab, body: cuerpo });
    let respuesta = null;
    try { respuesta = await r.json(); } catch {}
    if (!r.ok) {
      const e = new Error(respuesta?.error || `Error ${r.status}`);
      e.status = r.status;
      throw e;
    }
    return respuesta;
  }

  async function arrancar() {
    App.iniciarTema($('#i-tema'));
    if (token.get()) {
      try {
        await apiInquilino('/api/inquilino/sesion');
        return entrar();
      } catch { token.set(null); }
    }
    mostrarAcceso();
  }

  function mostrarAcceso() {
    $('#i-arranque').hidden = true;
    $('#portal-inq').hidden = true;
    $('#acceso-inq').hidden = false;
    setTimeout(() => $('#i-documento').focus(), 80);
  }

  async function entrar() {
    try {
      await recargar();
      $('#i-arranque').hidden = true;
      $('#acceso-inq').hidden = true;
      $('#portal-inq').hidden = false;
    } catch (e) {
      token.set(null);
      mostrarAcceso();
      nota(e.message, 'error');
    }
  }

  async function recargar() {
    datos = await apiInquilino('/api/inquilino/panel');
    pintar();
  }

  function pintar() {
    const c = datos.contrato;
    const a = datos.apartamento;
    const e = datos.edificio;
    const p = datos.pagoActual;
    const enc = e.encargado || {};
    const pendiente = Number(p.pendiente || 0);
    const cubierto = p.canon ? Math.min(100, Math.round((Number(p.pagado || 0) / p.canon) * 100)) : 0;
    const sinLeer = datos.mensajes.filter((m) => m.tipo === 'administracion' && !m.leidoInquilino).length;
    const globo = $('#i-globo');

    $('#i-nombre-sitio').textContent = e.nombre || 'Mi apartaestudio';
    $('#i-saludo').textContent = `Hola, ${(c.inquilino?.nombre || 'inquilino').split(' ')[0]}`;
    $('#i-subtitulo').textContent = `${a.titulo || 'Tu apartaestudio'} · ${e.nombre || ''}`;
    globo.hidden = !sinLeer;
    globo.textContent = sinLeer;

    $('#i-resumen').innerHTML = `
      <article class="tarjeta resumen-hogar">
        <span class="sobrelinea">TU UNIDAD</span>
        <h3>${esc(a.titulo || 'Apartaestudio ' + a.numero)}</h3>
        <div class="direccion-inq">⌖ <span>${esc([e.direccion, e.ciudad].filter(Boolean).join(' · '))}</span></div>
        ${a.descripcion ? `<p class="tenue mini" style="margin:16px 0 0">${esc(a.descripcion)}</p>` : ''}
        <div class="datos-hogar">
          ${a.numero ? `<span class="dato-hogar">Unidad ${esc(a.numero)}</span>` : ''}
          ${a.area ? `<span class="dato-hogar">${esc(numero(a.area))} m²</span>` : ''}
          ${a.habitaciones ? `<span class="dato-hogar">${esc(numero(a.habitaciones))} alcoba${a.habitaciones === 1 ? '' : 's'}</span>` : ''}
          ${a.banos ? `<span class="dato-hogar">${esc(numero(a.banos))} baño${a.banos === 1 ? '' : 's'}</span>` : ''}
          ${a.piso ? `<span class="dato-hogar">Piso ${esc(numero(a.piso))}</span>` : ''}
        </div>
      </article>
      <article class="tarjeta estado-pago">
        <div class="etiqueta-inq">PAGO DE ${esc(mesTexto(p.periodo).toUpperCase())}</div>
        <div class="monto-inq" style="color:${pendiente ? 'var(--critico-ink)' : 'var(--bien-ink)'}">${esc(pendiente ? dinero(pendiente) : 'Al día')}</div>
        <div class="mini tenue">${pendiente ? 'Pendiente por pagar' : 'Pago completo registrado'}</div>
        <div class="barra-mini"><i style="width:${cubierto}%;background:${pendiente ? 'var(--serie-1)' : 'var(--bien)'}"></i></div>
        <div class="mini tenue">Pagado: ${esc(dinero(p.pagado))} de ${esc(dinero(p.canon))}</div>
      </article>
      <article class="tarjeta estado-pago">
        <div class="etiqueta-inq">PRÓXIMO PAGO</div>
        <div class="monto-inq">Día ${esc(numero(c.diaPago))}</div>
        <div class="mini tenue">Canon mensual: ${esc(dinero(c.canon))}</div>
        ${datos.cartera.saldo ? `<div class="aviso aviso-ojo" style="margin-top:13px">Saldo histórico pendiente: ${esc(dinero(datos.cartera.saldo))}</div>` : '<div class="mini tenue" style="margin-top:20px">Tu historial no registra saldo pendiente.</div>'}
      </article>
      <article class="tarjeta contacto-inq">
        <span class="sobrelinea">ADMINISTRACIÓN DEL EDIFICIO</span>
        <div class="fila" style="margin-top:8px">
          <div class="avatar-inq">${esc(iniciales(enc.nombre || 'AD'))}</div>
          <div class="crece"><strong>${esc(enc.nombre || 'Administración')}</strong>
            <div class="mini tenue">${esc(enc.cargo || e.nombre || 'Encargado del edificio')}${enc.horario ? ' · ' + esc(enc.horario) : ''}</div>
            <div class="acciones-contacto">
              ${enc.telefono ? `<a class="btn btn-sm" href="tel:${esc(enc.telefono.replace(/\s/g, ''))}">Llamar</a>` : ''}
              ${enc.email ? `<a class="btn btn-sm" href="mailto:${esc(enc.email)}">Correo</a>` : ''}
              ${enc.whatsapp ? `<a class="btn btn-sm btn-primario" target="_blank" rel="noopener" href="https://wa.me/${esc(enc.whatsapp)}">WhatsApp</a>` : ''}
            </div>
          </div>
        </div>
      </article>`;

    const pagos = datos.pagos || [];
    $('#i-pagos').innerHTML = `
      <div class="tarjeta pago-principal">
        <div><span class="sobrelinea">${esc(mesTexto(p.periodo).toUpperCase())}</span>
          <div class="pago-monto">${esc(dinero(p.canon))}</div><div class="mini tenue">Canon mensual · vence el día ${esc(numero(c.diaPago))}</div></div>
        <div>${pendiente ? `<span class="chip chip-vencido">Pendiente ${esc(dinero(pendiente))}</span>` : '<span class="chip chip-disponible">Pago al día</span>'}
          <p class="mini tenue" style="margin:8px 0 0;max-width:310px">Si ya realizaste un pago, envía el comprobante a administración para que sea registrado.</p></div>
      </div>
      ${pagos.length ? `<div class="tabla-marco"><table class="tabla"><thead><tr><th>Periodo</th><th>Fecha registrada</th><th>Método</th><th class="num">Monto</th><th class="acciones"></th></tr></thead>
        <tbody>${pagos.map((x) => `<tr><td style="font-weight:600">${esc(mesTexto(x.periodo))}</td><td class="tenue">${esc(fechaTexto(x.fecha))}</td><td class="tenue">${esc(x.metodo)}${x.referencia ? ' · ' + esc(x.referencia) : ''}</td><td class="num">${esc(dinero(x.monto))}</td><td class="acciones"><button class="btn btn-sm" type="button" data-recibo="${esc(x.id)}">Comprobante</button></td></tr>`).join('')}</tbody></table></div>`
        : '<div class="vacio"><h3>Aún no hay pagos registrados</h3><p>Los pagos que confirme administración aparecerán aquí.</p></div>'}`;

    $('#i-mensajes').innerHTML = datos.mensajes.length ? `<ul class="lista-inq">${datos.mensajes.map((m) => {
      const administracion = m.tipo === 'administracion';
      const noLeido = administracion && !m.leidoInquilino;
      return `<li class="mensaje-inq ${noLeido ? 'sin-leer' : ''}">
        <div class="tipo-inq">${administracion ? 'ADM' : 'TÚ'}</div>
        <div class="crece"><div class="fila-wrap" style="gap:7px"><strong>${esc(m.asunto || 'Sin asunto')}</strong>
          ${m.prioridad === 'alta' ? '<span class="chip chip-vencido">Atención pronta</span>' : ''}
          ${m.tipo === 'inquilino' && m.categoria === 'mantenimiento' ? `<span class="chip ${(m.estadoGestion || 'abierta') === 'resuelta' ? 'chip-disponible' : (m.estadoGestion || 'abierta') === 'en_proceso' ? 'chip-reservado' : 'chip-vencido'}">Mantenimiento · ${esc(({ abierta: 'Abierta', en_proceso: 'En proceso', resuelta: 'Resuelta' }[m.estadoGestion || 'abierta']))}</span>` : ''}
          ${noLeido ? '<span class="chip chip-reservado">Nuevo</span>' : ''}</div>
          <div class="mini tenue" style="margin-top:3px">${administracion ? 'Administración' : 'Tu mensaje'} · ${esc(fechaTexto(m.creado))}</div>
          <p class="texto">${esc(m.cuerpo)}</p>
          ${(m.adjuntos || []).length ? `<div class="fila-wrap" style="gap:7px;margin-top:9px">${m.adjuntos.map((a, i) => `<button class="btn btn-sm" type="button" data-adjunto="${esc(a.id)}">Ver foto ${i + 1}</button>`).join('')}</div>` : ''}
          ${noLeido ? `<div class="pie-mensaje"><button class="btn btn-sm" type="button" data-leer="${esc(m.id)}">Marcar como leído</button></div>` : ''}
        </div>
      </li>`;
    }).join('')}</ul>` : '<div class="vacio"><h3>No hay mensajes todavía</h3><p>Las comunicaciones privadas de administración aparecerán aquí.</p></div>';

    $$('#i-mensajes [data-leer]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await apiInquilino(`/api/inquilino/mensajes/${b.dataset.leer}/leido`, { method: 'PUT' });
        await recargar();
      } catch (err) { nota(err.message, 'error'); b.disabled = false; }
    }));
    $$('#i-mensajes [data-adjunto]').forEach((b) => b.addEventListener('click', () => abrirAdjunto(b.dataset.adjunto)));
    $$('#i-pagos [data-recibo]').forEach((b) => b.addEventListener('click', () => abrirReciboPago(b.dataset.recibo)));
  }

  async function abrirAdjunto(idMedio) {
    try {
      const r = await fetch('/api/media/' + encodeURIComponent(idMedio), {
        headers: { Authorization: 'Bearer ' + token.get() },
      });
      if (!r.ok) throw new Error('No fue posible abrir la imagen.');
      const url = URL.createObjectURL(await r.blob());
      const m = modal({
        titulo: 'Foto adjunta', tamano: 'lg',
        cuerpo: `<img src="${url}" alt="Foto adjunta a la solicitud" style="display:block;max-width:100%;max-height:68vh;margin:auto;border-radius:10px">`,
        pie: '<button class="btn" type="button" data-cerrar>Cerrar</button>',
        alCerrar: () => URL.revokeObjectURL(url),
      });
      m.caja.querySelector('[data-cerrar]').addEventListener('click', m.cerrar);
    } catch (e) { nota(e.message, 'error'); }
  }

  async function subirAdjunto(archivo) {
    const cabeceras = {
      Authorization: 'Bearer ' + token.get(),
      'Content-Type': archivo.type,
      'X-Nombre': btoa(unescape(encodeURIComponent(archivo.name))),
    };
    const r = await fetch('/api/inquilino/adjuntos', { method: 'POST', headers: cabeceras, body: archivo });
    let respuesta = null;
    try { respuesta = await r.json(); } catch {}
    if (!r.ok) throw new Error(respuesta?.error || 'No fue posible subir una imagen.');
    return respuesta;
  }

  function abrirReciboPago(pagoId) {
    const pago = (datos.pagos || []).find((x) => x.id === pagoId);
    if (!pago) return;
    const c = datos.contrato;
    const a = datos.apartamento;
    const e = datos.edificio;
    const contenido = `
      <div class="recibo-pago">
        <span class="sobrelinea">COMPROBANTE DE PAGO</span>
        <h2>${esc(e.nombre || 'Apartaestudios')}</h2>
        <p class="tenue">Pago registrado para ${esc(a.titulo || 'unidad ' + a.numero)}</p>
        <div class="recibo-datos">
          <div><span>Inquilino</span><strong>${esc(c.inquilino?.nombre || '—')}</strong></div>
          <div><span>Unidad</span><strong>${esc(a.numero || '—')}</strong></div>
          <div><span>Periodo</span><strong>${esc(mesTexto(pago.periodo))}</strong></div>
          <div><span>Fecha de registro</span><strong>${esc(fechaTexto(pago.fecha))}</strong></div>
          <div><span>Método</span><strong>${esc(pago.metodo || '—')}</strong></div>
          <div><span>Referencia</span><strong>${esc(pago.referencia || 'No registrada')}</strong></div>
        </div>
        <div class="recibo-total"><span>Monto recibido</span><strong>${esc(dinero(pago.monto))}</strong></div>
        ${pago.notas ? `<p class="mini tenue" style="margin:15px 0 0">Notas: ${esc(pago.notas)}</p>` : ''}
      </div>`;
    const m = modal({
      titulo: 'Comprobante de pago', tamano: 'sm', cuerpo: contenido,
      pie: '<button class="btn" type="button" data-cerrar>Cerrar</button><button class="btn btn-primario" type="button" data-imprimir>Imprimir / Guardar PDF</button>',
    });
    m.caja.querySelector('[data-cerrar]').addEventListener('click', m.cerrar);
    m.caja.querySelector('[data-imprimir]').addEventListener('click', () => imprimirRecibo(contenido));
  }

  function imprimirRecibo(contenido) {
    const ventana = window.open('', '_blank', 'noopener,noreferrer,width=700,height=760');
    if (!ventana) return nota('El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes e inténtalo de nuevo.', 'error');
    ventana.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Comprobante de pago</title><style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#111;margin:0;padding:40px}.recibo-pago{max-width:620px;margin:auto;border:1px solid #ddd;border-radius:14px;padding:28px}.sobrelinea{font-size:11px;color:#1c5cab;font-weight:700;letter-spacing:.1em}.recibo-pago h2{margin:7px 0 3px}.tenue{color:#555}.recibo-datos{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:24px 0}.recibo-datos div{border-bottom:1px solid #e5e5e5;padding-bottom:9px}.recibo-datos span{display:block;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.06em}.recibo-datos strong{display:block;margin-top:3px}.recibo-total{display:flex;justify-content:space-between;align-items:center;padding:16px;border-radius:10px;background:#eef6ff}.recibo-total strong{font-size:22px}@media print{body{padding:0}.recibo-pago{border:0}}</style></head><body>${contenido}<script>window.onload=()=>window.print()<\/script></body></html>`);
    ventana.document.close();
  }

  $('#form-acceso-inq').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const boton = form.querySelector('button[type=submit]');
    const aviso = $('#i-aviso');
    aviso.innerHTML = '';
    boton.disabled = true;
    boton.textContent = 'Verificando…';
    try {
      const r = await apiInquilino('/api/inquilino/login', { method: 'POST', body: Object.fromEntries(new FormData(form).entries()) });
      token.set(r.token);
      await entrar();
    } catch (e) {
      aviso.innerHTML = `<div class="aviso aviso-error">${esc(e.message)}</div>`;
      form.clave.value = '';
      form.clave.focus();
    } finally {
      boton.disabled = false;
      boton.textContent = 'Entrar al portal';
    }
  });

  $('#i-olvide').addEventListener('click', (ev) => { ev.preventDefault(); abrirRecuperacionInquilino(); });

  function abrirRecuperacionInquilino() {
    const m = modal({
      titulo: 'Recuperar acceso',
      cuerpo: `
        <p class="tenue mini">Escribe tu documento. Si tu contrato tiene un correo registrado, te enviamos un código para restablecer la contraseña.</p>
        <form id="f-recuperar-inq-pedir">
          <div class="campo"><label for="reci-documento">Documento</label>
            <input id="reci-documento" name="documento" required autocomplete="username"></div>
          <div id="reci-aviso"></div>
          <button class="btn btn-primario btn-bloque" type="submit">Enviar código</button>
        </form>`,
    });
    m.caja.querySelector('#f-recuperar-inq-pedir').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const documento = ev.target.documento.value.trim();
      const btn = ev.target.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Enviando…';
      try {
        const d = await apiInquilino('/api/inquilino/recuperar', { method: 'POST', body: { documento } });
        pasoConfirmarRecuperacionInquilino(m, documento, d.mensaje);
      } catch (e) {
        m.caja.querySelector('#reci-aviso').innerHTML = `<div class="aviso aviso-error">${esc(e.message)}</div>`;
        btn.disabled = false; btn.textContent = 'Enviar código';
      }
    });
  }

  function pasoConfirmarRecuperacionInquilino(m, documento, mensaje) {
    const cuerpo = m.caja.querySelector('.modal-cuerpo');
    cuerpo.innerHTML = `
      <div class="aviso aviso-bien">${esc(mensaje)}</div>
      <form id="f-recuperar-inq-confirmar" style="margin-top:14px">
        <div class="campo"><label for="reci-codigo">Código de 6 dígitos</label>
          <input id="reci-codigo" name="codigo" required inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>
        <div class="campo"><label for="reci-nueva">Nueva contraseña</label>
          <input id="reci-nueva" name="nueva" type="password" required minlength="8" autocomplete="new-password"></div>
        <div id="reci-aviso2"></div>
        <button class="btn btn-primario btn-bloque" type="submit">Restablecer contraseña</button>
      </form>`;
    cuerpo.querySelector('#f-recuperar-inq-confirmar').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = Object.fromEntries(new FormData(ev.target).entries());
      const btn = ev.target.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Restableciendo…';
      try {
        await apiInquilino('/api/inquilino/recuperar-confirmar', { method: 'POST', body: { documento, ...fd } });
        nota('Contraseña restablecida. Ya puedes entrar con la nueva.', 'bien');
        m.cerrar();
      } catch (e) {
        cuerpo.querySelector('#reci-aviso2').innerHTML = `<div class="aviso aviso-error">${esc(e.message)}</div>`;
        btn.disabled = false; btn.textContent = 'Restablecer contraseña';
      }
    });
  }

  $('#i-salir').addEventListener('click', async () => {
    try { await apiInquilino('/api/inquilino/logout', { method: 'POST' }); } catch {}
    token.set(null);
    location.reload();
  });

  $('#form-mensaje-inq').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const boton = form.querySelector('button[type=submit]');
    const aviso = $('#im-aviso');
    if (!form.reportValidity()) return;
    boton.disabled = true;
    aviso.innerHTML = '';
    try {
      const d = Object.fromEntries(new FormData(form).entries());
      const archivos = [...($('#im-adjuntos').files || [])];
      if (archivos.length > 5) throw new Error('Puedes adjuntar hasta 5 imágenes.');
      if (archivos.length && d.categoria !== 'mantenimiento') {
        throw new Error('Selecciona la categoría Mantenimiento para adjuntar fotos.');
      }
      if (archivos.some((a) => !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(a.type))) {
        throw new Error('Adjunta únicamente imágenes PNG, JPG, WEBP o GIF.');
      }
      if (archivos.some((a) => a.size > 10 * 1024 * 1024)) throw new Error('Cada imagen debe pesar máximo 10 MB.');
      const adjuntos = [];
      for (let i = 0; i < archivos.length; i++) {
        boton.textContent = `Subiendo foto ${i + 1} de ${archivos.length}…`;
        const subido = await subirAdjunto(archivos[i]);
        adjuntos.push(subido.id);
      }
      boton.textContent = 'Enviando mensaje…';
      await apiInquilino('/api/inquilino/mensajes', { method: 'POST', body: { ...d, adjuntos, prioridad: d.prioridad ? 'alta' : 'normal' } });
      form.reset();
      await recargar();
      nota('Tu mensaje fue enviado a administración.', 'bien');
    } catch (e) {
      aviso.innerHTML = `<div class="aviso aviso-error">${esc(e.message)}</div>`;
    } finally { boton.disabled = false; boton.textContent = 'Enviar mensaje'; }
  });

  arrancar();
})();
