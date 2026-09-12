/* ===========================================================================
   Portal privado del inquilino
   ========================================================================== */

(() => {
  const { $, $$, esc, dinero, numero, mesTexto, fechaTexto, iniciales, nota } = App;
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
      ${pagos.length ? `<div class="tabla-marco"><table class="tabla"><thead><tr><th>Periodo</th><th>Fecha registrada</th><th>Método</th><th class="num">Monto</th></tr></thead>
        <tbody>${pagos.map((x) => `<tr><td style="font-weight:600">${esc(mesTexto(x.periodo))}</td><td class="tenue">${esc(fechaTexto(x.fecha))}</td><td class="tenue">${esc(x.metodo)}${x.referencia ? ' · ' + esc(x.referencia) : ''}</td><td class="num">${esc(dinero(x.monto))}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="vacio"><h3>Aún no hay pagos registrados</h3><p>Los pagos que confirme administración aparecerán aquí.</p></div>'}`;

    $('#i-mensajes').innerHTML = datos.mensajes.length ? `<ul class="lista-inq">${datos.mensajes.map((m) => {
      const administracion = m.tipo === 'administracion';
      const noLeido = administracion && !m.leidoInquilino;
      return `<li class="mensaje-inq ${noLeido ? 'sin-leer' : ''}">
        <div class="tipo-inq">${administracion ? 'ADM' : 'TÚ'}</div>
        <div class="crece"><div class="fila-wrap" style="gap:7px"><strong>${esc(m.asunto || 'Sin asunto')}</strong>
          ${m.prioridad === 'alta' ? '<span class="chip chip-vencido">Atención pronta</span>' : ''}
          ${noLeido ? '<span class="chip chip-reservado">Nuevo</span>' : ''}</div>
          <div class="mini tenue" style="margin-top:3px">${administracion ? 'Administración' : 'Tu mensaje'} · ${esc(fechaTexto(m.creado))}</div>
          <p class="texto">${esc(m.cuerpo)}</p>
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
      await apiInquilino('/api/inquilino/mensajes', { method: 'POST', body: { ...d, prioridad: d.prioridad ? 'alta' : 'normal' } });
      form.reset();
      await recargar();
      nota('Tu mensaje fue enviado a administración.', 'bien');
    } catch (e) {
      aviso.innerHTML = `<div class="aviso aviso-error">${esc(e.message)}</div>`;
    } finally { boton.disabled = false; }
  });

  arrancar();
})();
