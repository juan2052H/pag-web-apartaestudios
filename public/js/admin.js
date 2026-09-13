/* ==========================================================================
   Panel administrativo
   ========================================================================== */

(() => {
  const {
    $, $$, esc, el, dinero, numero, porcentaje, mesTexto, fechaTexto, hoyISO, mesISO,
    api, urlMedia, nota, modal, confirmar, iniciales, ESTADOS, pesoArchivo, subirArchivo,
    descargarCSV,
  } = App;

  /** Estado en memoria del panel. */
  let E = {
    config: {}, edificios: [], apartamentos: [], contratos: [],
    pagos: [], solicitudes: [], mensajes: [], media: [], analitica: null,
    sesion: null, administradores: [], auditoria: [],
  };
  let vistaActual = 'resumen';

  const edificio = (idv) => E.edificios.find((x) => x.id === idv);
  const apartamento = (idv) => E.apartamentos.find((x) => x.id === idv);
  const contrato = (idv) => E.contratos.find((x) => x.id === idv);
  const contratoActivoDeApartamento = (apartamentoId) => E.contratos.find((x) =>
    x.apartamentoId === apartamentoId && x.estado === 'activo');
  const medio = (idv) => E.media.find((x) => x.id === idv);
  const esPrincipal = () => E.sesion?.rol === 'principal';

  const nombreUnidad = (a) => {
    if (!a) return '— unidad eliminada —';
    const ed = edificio(a.edificioId);
    return `${ed ? ed.nombre + ' · ' : ''}${a.numero}`;
  };

  /* =========================================================== Autenticación */

  async function arrancar() {
    App.iniciarTema($('#btn-tema'));
    if (App.token.get()) {
      try {
        await api('/api/auth/sesion');
        return entrar();
      } catch { App.token.set(null); }
    }
    mostrarAcceso();
  }

  function mostrarAcceso() {
    $('#arranque').hidden = true;
    $('#panel').hidden = true;
    $('#acceso').hidden = false;
    setTimeout(() => $('#a-clave').focus(), 80);
  }

  $('#form-acceso').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const btn = form.querySelector('button[type=submit]');
    const aviso = $('#a-aviso');
    aviso.innerHTML = '';
    btn.disabled = true;
    btn.textContent = 'Verificando…';
    try {
      const d = await api('/api/auth/login', {
        method: 'POST',
        body: Object.fromEntries(new FormData(form).entries()),
      });
      App.token.set(d.token);
      await entrar();
      if (d.claveInicial) {
        nota('Estás usando la contraseña inicial. Cámbiala en Ajustes.', 'error');
      }
    } catch (e) {
      aviso.innerHTML = `<div class="aviso aviso-error">${esc(e.message)}</div>`;
      form.clave.value = '';
      form.clave.focus();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  });

  $('#btn-salir').addEventListener('click', async () => {
    if (!(await confirmar('¿Cerrar la sesión del panel?', { titulo: 'Salir', textoOk: 'Cerrar sesión', peligro: false }))) return;
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    App.token.set(null);
    location.reload();
  });

  async function entrar() {
    $('#acceso').hidden = true;
    $('#arranque').hidden = false;
    await recargar();
    $('#arranque').hidden = true;
    $('#panel').hidden = false;
    irA(location.hash.slice(1) || 'resumen');
  }

  /* ================================================================== Datos */

  async function recargar() {
    try {
      E = await api('/api/admin');
      App.configurarMoneda(E.config.moneda, E.config.localeMoneda);
      $('#lat-nombre').textContent = E.config.nombreSitio || 'Apartaestudios';
      const perfil = E.sesion || {};
      const etiquetaRol = esPrincipal() ? 'Propietario principal' : 'Administrador de edificio';
      const rol = $('#sesion-rol');
      rol.hidden = false;
      rol.textContent = `${etiquetaRol} · ${perfil.nombre || perfil.usuario || ''}`;
      $$('[data-solo-principal]').forEach((n) => { n.hidden = !esPrincipal(); });
      const nuevas = E.solicitudes.filter((s) => s.estado === 'nueva').length;
      const g = $('#globo-solicitudes');
      g.hidden = !nuevas;
      g.textContent = nuevas;
      const sinLeer = E.mensajes.filter((x) => x.tipo === 'inquilino' && !x.leidoAdmin).length;
      const gm = $('#globo-mensajes');
      gm.hidden = !sinLeer;
      gm.textContent = sinLeer;
    } catch (e) {
      if (e.status === 401) { App.token.set(null); return mostrarAcceso(); }
      nota(e.message, 'error');
    }
  }

  /** Envuelve una operación de escritura: recarga y repinta al terminar. */
  async function operar(fn, mensaje) {
    try {
      const r = await fn();
      await recargar();
      pintar(vistaActual);
      if (mensaje) nota(mensaje, 'bien');
      return r;
    } catch (e) {
      if (e.status === 401) { App.token.set(null); mostrarAcceso(); return; }
      nota(e.message, 'error');
      throw e;
    }
  }

  const guardar = (col, cuerpo, idv) =>
    api(`/api/${col}${idv ? '/' + idv : ''}`, { method: idv ? 'PUT' : 'POST', body: cuerpo });

  /* =============================================================== Navegación */

  const VISTAS = {
    resumen:     { titulo: 'Resumen', sub: 'Cómo va el negocio este mes' },
    unidades:    { titulo: 'Unidades', sub: 'Apartaestudios, videos y disponibilidad' },
    edificios:   { titulo: 'Edificios', sub: 'Ubicación, zonas comunes y encargados' },
    contratos:   { titulo: 'Contratos', sub: 'Quién arrienda qué y por cuánto' },
    pagos:       { titulo: 'Pagos', sub: 'Recaudo mes a mes' },
    cartera:     { titulo: 'Cartera', sub: 'Saldos pendientes por inquilino' },
    mensajes:    { titulo: 'Mensajes', sub: 'Comunicación privada con inquilinos' },
    solicitudes: { titulo: 'Solicitudes', sub: 'Interesados que llegaron por el sitio' },
    agenda:      { titulo: 'Agenda de visitas', sub: 'Horarios solicitados y seguimiento comercial' },
    medios:      { titulo: 'Multimedia', sub: 'Videos y fotos subidos' },
    administradores: { titulo: 'Administradores', sub: 'Accesos y edificios asignados' },
    actividad:   { titulo: 'Actividad', sub: 'Bitácora reciente de acciones administrativas' },
    ajustes:     { titulo: 'Ajustes', sub: 'Datos del sitio y seguridad' },
  };

  function irA(v) {
    if (!VISTAS[v]) v = 'resumen';
    if ((v === 'administradores' || v === 'actividad') && !esPrincipal()) v = 'resumen';
    vistaActual = v;
    history.replaceState(null, '', '#' + v);
    $$('.nav-item[data-vista]').forEach((b) => b.classList.toggle('activo', b.dataset.vista === v));
    $$('.vista').forEach((s) => s.classList.toggle('activa', s.id === 'v-' + v));
    $('#titulo-vista').textContent = VISTAS[v].titulo;
    $('#sub-vista').textContent = VISTAS[v].sub;
    $('#panel').classList.remove('menu-abierto');
    pintar(v);
    window.scrollTo({ top: 0 });
  }

  $$('.nav-item[data-vista]').forEach((b) => b.addEventListener('click', () => irA(b.dataset.vista)));
  $('#btn-menu').addEventListener('click', () => $('#panel').classList.toggle('menu-abierto'));

  function pintar(v) {
    $('#acciones-vista').innerHTML = '';
    ({
      resumen: verResumen, unidades: verUnidades, edificios: verEdificios,
      contratos: verContratos, pagos: verPagos, cartera: verCartera,
      mensajes: verMensajes, solicitudes: verSolicitudes, agenda: verAgenda, medios: verMedios,
      administradores: verAdministradores, actividad: verActividad, ajustes: verAjustes,
    })[v]();
  }

  function accion(texto, alPulsar, clase = 'btn-primario') {
    const b = el('button', { class: `btn ${clase}`, type: 'button', text: texto, onclick: alPulsar });
    $('#acciones-vista').append(b);
    return b;
  }

  /* ================================================================= Resumen */

  function verResumen() {
    const a = E.analitica;
    if (!a) return;
    const k = a.kpis;
    const cumplimiento = k.ingresoMensual ? k.recaudadoMes / k.ingresoMensual : 0;

    accion('Registrar pago', () => formPago(), 'btn-primario');
    accion('Nueva unidad', () => formApartamento(), '');

    const kpi = (clave, valor, nota_, extra = '') =>
      `<div class="kpi"><div class="k">${esc(clave)}</div><div class="v">${esc(valor)}</div>
       ${nota_ ? `<div class="n">${nota_}</div>` : ''}${extra}</div>`;

    $('#v-resumen').innerHTML = `
      <div class="kpis">
        <div class="kpi destaca">
          <div class="k">Ocupación</div>
          <div class="v">${esc(porcentaje(k.ocupacion, 0))}</div>
          <div class="n">${esc(numero(k.arrendados))} de ${esc(numero(k.unidades))} unidades arrendadas</div>
          <div class="barra-mini"><i style="width:${Math.round(k.ocupacion * 100)}%"></i></div>
        </div>
        ${kpi('Ingreso mensual', dinero(k.ingresoMensual), `${esc(numero(k.contratosActivos))} contratos activos`)}
        ${kpi('Recaudado en ' + mesTexto(a.mes), dinero(k.recaudadoMes),
          k.pendienteMes > 0
            ? `<span class="delta-mal">Faltan ${esc(dinero(k.pendienteMes))}</span>`
            : '<span class="delta-bien">✓ Mes completo</span>',
          `<div class="barra-mini"><i style="width:${Math.min(100, Math.round(cumplimiento * 100))}%;background:${
            cumplimiento >= 0.999 ? 'var(--bien)' : 'var(--serie-1)'}"></i></div>`)}
        ${kpi('Cartera vencida', dinero(k.carteraTotal),
          a.cartera.length
            ? `<span class="delta-mal">${esc(numero(a.cartera.length))} inquilino${a.cartera.length === 1 ? '' : 's'} en mora</span>`
            : '<span class="delta-bien">✓ Nadie en mora</span>')}
        ${kpi('Disponibles', numero(k.disponibles),
          `${esc(numero(k.otros))} en reserva o mantenimiento`)}
        ${kpi('Solicitudes nuevas', numero(k.solicitudesNuevas),
          k.solicitudesNuevas ? '<span class="delta-mal">Pendientes de contactar</span>' : 'Todo atendido')}
        ${kpi('Mensajes sin leer', numero(k.mensajesSinLeer || 0),
          k.mensajesSinLeer ? '<span class="delta-mal">Requieren respuesta</span>' : 'Bandeja al día')}
        ${kpi('Mantenimientos', numero(k.mantenimientosPendientes || 0),
          k.mantenimientosPendientes ? '<span class="delta-mal">Solicitudes por gestionar</span>' : 'Sin solicitudes abiertas')}
        ${kpi('Contratos por vencer', numero(k.contratosPorVencer || 0),
          k.contratosPorVencer ? '<span class="delta-mal">Vencen en los próximos 30 días</span>' : 'Sin vencimientos próximos')}
      </div>

      <div class="rejilla-graficos">
        <div id="g-ingresos"></div>
        <div id="g-ocupacion"></div>
      </div>

      <div class="dos-col">
        <div class="bloque-panel">
          <header>
            <div class="crece"><h3>Cartera pendiente</h3></div>
            <button class="btn btn-sm" type="button" data-ir="cartera">Ver todo</button>
          </header>
          ${a.cartera.length ? `<div class="tabla-marco"><table class="tabla">
            <thead><tr><th>Inquilino</th><th>Unidad</th><th class="num">Meses</th><th class="num">Saldo</th></tr></thead>
            <tbody>${a.cartera.slice(0, 6).map((c) => `<tr>
              <td>${esc(c.inquilino)}</td>
              <td class="tenue">${esc(c.unidad)}</td>
              <td class="num">${esc(c.mesesVencidos)}</td>
              <td class="num" style="color:var(--critico-ink);font-weight:620">${esc(dinero(c.saldo))}</td>
            </tr>`).join('')}</tbody></table></div>`
            : '<div class="cuerpo"><div class="aviso aviso-bien">Todos los contratos están al día. 🎉</div></div>'}
        </div>

        <div class="bloque-panel">
          <header>
            <div class="crece"><h3>Últimas solicitudes</h3></div>
            <button class="btn btn-sm" type="button" data-ir="solicitudes">Ver todo</button>
          </header>
          ${E.solicitudes.length ? `<ul class="lista-simple">${E.solicitudes.slice(0, 5).map((s) => `
            <li>
              <div class="crece">
                <div style="font-weight:600">${esc(s.nombre)}</div>
                <div class="mini tenue">${esc([s.telefono, s.email].filter(Boolean).join(' · '))}</div>
                <div class="mini tenue">${esc(s.apartamentoId ? nombreUnidad(apartamento(s.apartamentoId)) : 'Sin unidad específica')}</div>
              </div>
              <div style="text-align:right">
                <span class="chip ${s.estado === 'nueva' ? 'chip-reservado' : 'chip-mantenimiento'}">${esc(s.estado)}</span>
                <div class="mini tenue" style="margin-top:4px">${esc(fechaTexto(s.creado))}</div>
              </div>
            </li>`).join('')}</ul>`
            : '<div class="cuerpo"><p class="tenue" style="margin:0">Todavía no llegan solicitudes desde el sitio público.</p></div>'}
        </div>
      </div>

      <div class="bloque-panel">
        <header>
          <div class="crece"><h3>Vencimientos de contrato</h3>
            <p class="mini tenue" style="margin:2px 0 0">Contratos activos que terminan durante los próximos 60 días.</p></div>
          <button class="btn btn-sm" type="button" data-ir="contratos">Gestionar contratos</button>
        </header>
        ${a.vencimientos?.length ? `<div class="tabla-marco"><table class="tabla">
          <thead><tr><th>Inquilino</th><th>Unidad</th><th>Finaliza</th><th class="num">Faltan</th><th class="acciones"></th></tr></thead>
          <tbody>${a.vencimientos.map((x) => `<tr>
            <td style="font-weight:600">${esc(x.inquilino)}</td>
            <td class="tenue">${esc(x.unidad)}</td>
            <td>${esc(fechaTexto(x.fin))}</td>
            <td class="num"><span class="chip ${x.dias <= 30 ? 'chip-vencido' : 'chip-reservado'}">${esc(numero(x.dias))} días</span></td>
            <td class="acciones"><button class="btn btn-sm btn-primario" type="button" data-mensaje-ct="${esc(x.contratoId)}">Avisar</button></td>
          </tr>`).join('')}</tbody></table></div>`
          : '<div class="cuerpo"><p class="tenue" style="margin:0">No hay contratos próximos a vencer.</p></div>'}
      </div>`;

    $$('#v-resumen [data-ir]').forEach((b) => b.addEventListener('click', () => irA(b.dataset.ir)));
    $$('#v-resumen [data-mensaje-ct]').forEach((b) => b.addEventListener('click', () => formMensaje(b.dataset.mensajeCt)));

    const c = Graficos.colores();
    Graficos.barrasAgrupadas($('#g-ingresos'), {
      titulo: 'Ingresos por mes',
      subtitulo: 'Canon esperado frente a lo efectivamente recaudado, últimos 12 meses',
      categorias: a.serie.map((s) => ({
        clave: s.periodo, etiqueta: mesTexto(s.periodo, true), completo: mesTexto(s.periodo),
      })),
      series: [
        { nombre: 'Esperado', color: c.s1, valores: a.serie.map((s) => s.esperado) },
        { nombre: 'Recaudado', color: c.s2, valores: a.serie.map((s) => s.recaudado) },
      ],
      formato: (v) => dinero(v),
      formatoEje: (v) => dinero(v, true),
    });

    Graficos.barrasApiladas($('#g-ocupacion'), {
      titulo: 'Ocupación por edificio',
      subtitulo: 'Unidades según su estado actual',
      series: [
        { nombre: 'Arrendadas', color: c.s1 },
        { nombre: 'Disponibles', color: c.s2 },
        { nombre: 'Otras', color: c.s3 },
      ],
      filas: a.porEdificio.map((e) => ({
        etiqueta: e.nombre,
        valores: [e.arrendado, e.disponible, e.otro],
        sub: `${dinero(e.ingreso, true)} / mes`,
      })),
      formatoExtra: (f) => {
        const t = f.valores.reduce((x, y) => x + y, 0);
        return t ? Math.round((f.valores[0] / t) * 100) + '%' : '—';
      },
    });
  }

  /* ================================================================ Unidades */

  const fu = { texto: '', edificio: '', estado: '' };

  function verUnidades() {
    accion('Nueva unidad', () => formApartamento());

    const lista = E.apartamentos.filter((a) => {
      if (fu.edificio && a.edificioId !== fu.edificio) return false;
      if (fu.estado && a.estado !== fu.estado) return false;
      if (fu.texto) {
        const t = fu.texto.toLowerCase();
        if (!`${a.numero} ${a.titulo} ${nombreUnidad(a)}`.toLowerCase().includes(t)) return false;
      }
      return true;
    });

    $('#v-unidades').innerHTML = `
      <div class="herramientas">
        <div class="campo ancho"><label for="u-buscar">Buscar</label>
          <input id="u-buscar" type="search" placeholder="Número o título" value="${esc(fu.texto)}"></div>
        <div class="campo"><label for="u-ed">Edificio</label><select id="u-ed">
          <option value="">Todos</option>
          ${E.edificios.map((e) => `<option value="${esc(e.id)}" ${fu.edificio === e.id ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}
        </select></div>
        <div class="campo"><label for="u-estado">Estado</label><select id="u-estado">
          <option value="">Todos</option>
          ${Object.entries(ESTADOS).map(([k, v]) => `<option value="${k}" ${fu.estado === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
        </select></div>
        <div class="tenue mini" style="margin-left:auto;padding-bottom:10px">${lista.length} de ${E.apartamentos.length}</div>
      </div>
      ${lista.length ? `<div class="rejilla-admin">${lista.map(tarjetaUnidad).join('')}</div>`
        : `<div class="vacio"><h3>Sin unidades que mostrar</h3>
             <p>${E.apartamentos.length ? 'Ajusta los filtros.' : 'Crea la primera unidad con el botón "Nueva unidad".'}</p></div>`}`;

    const buscar = $('#u-buscar');
    buscar.addEventListener('input', App.rebote(() => {
      fu.texto = buscar.value;
      const pos = buscar.selectionStart;
      verUnidades();
      const n = $('#u-buscar');
      n.focus();
      n.setSelectionRange(pos, pos);
    }, 250));
    $('#u-ed').addEventListener('change', (e) => { fu.edificio = e.target.value; verUnidades(); });
    $('#u-estado').addEventListener('change', (e) => { fu.estado = e.target.value; verUnidades(); });

    $$('#v-unidades [data-editar]').forEach((b) =>
      b.addEventListener('click', () => formApartamento(apartamento(b.dataset.editar))));
    $$('#v-unidades [data-borrar]').forEach((b) =>
      b.addEventListener('click', async () => {
        const a = apartamento(b.dataset.borrar);
        if (!(await confirmar(`Se eliminará la unidad ${a.numero} junto con sus contratos y pagos. Esta acción no se puede deshacer.`,
          { titulo: 'Eliminar unidad', textoOk: 'Eliminar' }))) return;
        await operar(() => api('/api/apartamentos/' + a.id, { method: 'DELETE' }), 'Unidad eliminada');
      }));
    $$('#v-unidades [data-estado]').forEach((s) =>
      s.addEventListener('change', async () => {
        await operar(() => guardar('apartamentos', { estado: s.value }, s.dataset.estado), 'Estado actualizado');
      }));
  }

  function tarjetaUnidad(a) {
    const contratoActivo = contratoActivoDeApartamento(a.id);
    const inquilino = contratoActivo?.inquilino?.nombre || '';
    const media = a.videoId
      ? `<video src="${urlMedia(a.videoId)}#t=0.6" preload="metadata" muted ${a.portadaId ? `poster="${urlMedia(a.portadaId)}"` : ''}></video>`
      : a.portadaId ? `<img src="${urlMedia(a.portadaId)}" alt="">`
      : `<div class="vacio-media"><span>🎬</span><span>Sin video</span></div>`;
    return `<article class="u-tarjeta">
      <div class="mini-media">${media}<span class="chip chip-${esc(a.estado)}">${esc(ESTADOS[a.estado])}</span></div>
      <div class="cuerpo">
        <span class="ed">${esc(edificio(a.edificioId)?.nombre || 'Sin edificio')}</span>
        <span class="titulo">${esc(a.titulo || 'Apartaestudio ' + a.numero)}</span>
        <div class="fila-wrap mini tenue">
          <span>N.º ${esc(a.numero)}</span>${a.area ? `<span>· ${esc(numero(a.area))} m²</span>` : ''}
          ${a.videoId ? '<span>· 🎬 con video</span>' : ''}
        </div>
        ${a.estado === 'arrendado' ? `<div class="mini" style="margin-top:8px"><span class="tenue">Inquilino:</span> <strong>${esc(inquilino || 'Sin contrato activo registrado')}</strong></div>` : ''}
        <div style="font-weight:660;font-size:1.05rem;margin-top:auto">${esc(dinero(a.precio))}<span class="tenue mini"> /mes</span></div>
        <select class="control" data-estado="${esc(a.id)}" style="font-size:.82rem;padding:6px 9px">
          ${Object.entries(ESTADOS).map(([k, v]) => `<option value="${k}" ${a.estado === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
        </select>
      </div>
      <div class="pie-t">
        <button class="btn btn-sm" type="button" data-editar="${esc(a.id)}">Editar</button>
        <button class="btn btn-sm btn-peligro" type="button" data-borrar="${esc(a.id)}">Eliminar</button>
      </div>
    </article>`;
  }

  /* ---------------------------------------------- Formulario de apartamento */

  function formApartamento(a = null) {
    const esNuevo = !a;
    a = a || {
      edificioId: E.edificios[0]?.id || '', numero: '', titulo: '', precio: 0, administracion: 0,
      deposito: 0, area: 0, habitaciones: 1, banos: 1, piso: 0, amoblado: false,
      estado: 'disponible', descripcion: '', caracteristicas: [], videoId: null,
      portadaId: null, fotos: [], destacado: false,
    };

    if (!E.edificios.length) {
      nota('Primero crea al menos un edificio.', 'error');
      return irA('edificios');
    }

    const cuerpo = `
      <div class="pestanas">
        <button class="pestana activa" data-hoja="datos" type="button">Datos</button>
        <button class="pestana" data-hoja="video" type="button">Video y fotos</button>
        <button class="pestana" data-hoja="detalle" type="button">Descripción</button>
      </div>

      <form id="f-apto">
        <div class="hoja activa" data-hoja="datos">
          <div class="rejilla-campos">
            <div class="campo"><label for="x-ed">Edificio *</label><select id="x-ed" name="edificioId" required>
              ${E.edificios.map((e) => `<option value="${esc(e.id)}" ${a.edificioId === e.id ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}
            </select></div>
            <div class="campo"><label for="x-num">Número / identificador *</label>
              <input id="x-num" name="numero" required value="${esc(a.numero)}" placeholder="301"></div>
            <div class="campo"><label for="x-estado">Estado</label><select id="x-estado" name="estado">
              ${Object.entries(ESTADOS).map(([k, v]) => `<option value="${k}" ${a.estado === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}
            </select></div>
          </div>

          <div class="campo" style="margin-top:14px"><label for="x-titulo">Título público</label>
            <input id="x-titulo" name="titulo" value="${esc(a.titulo)}" placeholder="Apartaestudio 301 · Balcón con vista"></div>

          <div class="rejilla-campos" style="margin-top:14px">
            <div class="campo"><label for="x-precio">Canon mensual *</label>
              <input id="x-precio" name="precio" type="number" min="0" step="1000" required value="${esc(a.precio)}"></div>
            <div class="campo"><label for="x-admin">Administración</label>
              <input id="x-admin" name="administracion" type="number" min="0" step="1000" value="${esc(a.administracion)}"></div>
            <div class="campo"><label for="x-dep">Depósito</label>
              <input id="x-dep" name="deposito" type="number" min="0" step="1000" value="${esc(a.deposito)}"></div>
          </div>

          <div class="rejilla-campos" style="margin-top:14px">
            <div class="campo"><label for="x-area">Área (m²)</label>
              <input id="x-area" name="area" type="number" min="0" step="0.5" value="${esc(a.area)}"></div>
            <div class="campo"><label for="x-hab">Alcobas</label>
              <input id="x-hab" name="habitaciones" type="number" min="0" step="1" value="${esc(a.habitaciones)}"></div>
            <div class="campo"><label for="x-ban">Baños</label>
              <input id="x-ban" name="banos" type="number" min="0" step="1" value="${esc(a.banos)}"></div>
            <div class="campo"><label for="x-piso">Piso</label>
              <input id="x-piso" name="piso" type="number" step="1" value="${esc(a.piso)}"></div>
          </div>

          <div class="fila-wrap" style="margin-top:16px">
            <label class="check"><input type="checkbox" name="amoblado" ${a.amoblado ? 'checked' : ''}> Amoblado</label>
            <label class="check"><input type="checkbox" name="destacado" ${a.destacado ? 'checked' : ''}> Destacar en el sitio</label>
          </div>
        </div>

        <div class="hoja" data-hoja="video">
          <label class="etiqueta">Video del apartaestudio</label>
          <div id="campo-video" style="margin:8px 0 20px"></div>
          <label class="etiqueta">Imagen de portada (se muestra antes de reproducir)</label>
          <div id="campo-portada" style="margin:8px 0 20px"></div>
          <label class="etiqueta">Fotos adicionales</label>
          <div id="campo-fotos" style="margin-top:8px"></div>
        </div>

        <div class="hoja" data-hoja="detalle">
          <div class="campo"><label for="x-desc">Descripción</label>
            <textarea id="x-desc" name="descripcion" rows="6" placeholder="Cuenta cómo es el apartaestudio, qué incluye y qué hay alrededor.">${esc(a.descripcion)}</textarea></div>
          <div class="campo" style="margin-top:14px"><label for="x-carac">Características (una por línea)</label>
            <textarea id="x-carac" name="caracteristicas" rows="6"
              placeholder="Cocina integral&#10;Closet&#10;Internet fibra">${esc((a.caracteristicas || []).join('\n'))}</textarea>
            <span class="ayuda">Se muestran como etiquetas en la ficha pública.</span></div>
        </div>
      </form>`;

    const m = modal({
      titulo: esNuevo ? 'Nueva unidad' : `Editar ${a.numero}`,
      tamano: 'md',
      cuerpo,
      pie: `<button class="btn" data-cancelar type="button">Cancelar</button>
            <button class="btn btn-primario" data-ok type="button">${esNuevo ? 'Crear unidad' : 'Guardar cambios'}</button>`,
    });

    pestanas(m.caja);

    const borrador = { videoId: a.videoId, portadaId: a.portadaId, fotos: [...(a.fotos || [])] };
    campoMedio(m.caja.querySelector('#campo-video'), {
      tipo: 'video', valor: borrador.videoId, alCambiar: (v) => { borrador.videoId = v; },
    });
    campoMedio(m.caja.querySelector('#campo-portada'), {
      tipo: 'imagen', valor: borrador.portadaId, alCambiar: (v) => { borrador.portadaId = v; },
    });
    campoMedios(m.caja.querySelector('#campo-fotos'), {
      valores: borrador.fotos, alCambiar: (v) => { borrador.fotos = v; },
    });

    m.caja.querySelector('[data-cancelar]').addEventListener('click', m.cerrar);
    m.caja.querySelector('[data-ok]').addEventListener('click', async (ev) => {
      const form = m.caja.querySelector('#f-apto');
      if (!form.reportValidity()) return;
      const d = Object.fromEntries(new FormData(form).entries());
      const cuerpoDatos = {
        ...d,
        amoblado: form.amoblado.checked,
        destacado: form.destacado.checked,
        caracteristicas: String(d.caracteristicas || '').split('\n').map((s) => s.trim()).filter(Boolean),
        ...borrador,
      };
      ev.target.disabled = true;
      try {
        await operar(() => guardar('apartamentos', cuerpoDatos, esNuevo ? null : a.id),
          esNuevo ? 'Unidad creada' : 'Cambios guardados');
        m.cerrar();
      } catch { ev.target.disabled = false; }
    });
  }

  function pestanas(raiz) {
    raiz.querySelectorAll('.pestana').forEach((p) => p.addEventListener('click', () => {
      raiz.querySelectorAll('.pestana').forEach((x) => x.classList.toggle('activa', x === p));
      raiz.querySelectorAll('.hoja').forEach((h) => h.classList.toggle('activa', h.dataset.hoja === p.dataset.hoja));
    }));
  }

  /* ------------------------------------------------- Campos de video y fotos */

  /** Campo de un solo archivo (video o imagen). */
  function campoMedio(nodo, { tipo, valor, alCambiar }) {
    let actual = valor || null;

    const pintarCampo = () => {
      nodo.innerHTML = '';
      if (actual && medio(actual)) {
        const m = medio(actual);
        const prev = el('div', { class: 'previsualizacion' });
        prev.innerHTML = `
          ${tipo === 'video'
            ? `<video src="${urlMedia(m.id)}#t=0.6" preload="metadata" muted></video>`
            : `<img src="${urlMedia(m.id)}" alt="">`}
          <div class="crece">
            <div style="font-weight:600" class="truncar">${esc(m.nombre)}</div>
            <div class="mini tenue">${esc(pesoArchivo(m.tamano))} · ${esc(m.mime)}</div>
          </div>
          <button class="btn btn-sm" type="button" data-cambiar>Cambiar</button>
          <button class="btn btn-sm btn-peligro" type="button" data-quitar>Quitar</button>`;
        nodo.append(prev);
        prev.querySelector('[data-quitar]').addEventListener('click', () => {
          actual = null; alCambiar(null); pintarCampo();
        });
        prev.querySelector('[data-cambiar]').addEventListener('click', () => {
          actual = null; pintarCampo();
        });
        return;
      }

      const zona = el('div', { class: 'soltar' });
      zona.innerHTML = `<strong>Arrastra ${tipo === 'video' ? 'un video' : 'una imagen'} aquí</strong>
        o haz clic para elegir un archivo${tipo === 'video' ? ' (MP4 o WebM, hasta 600 MB)' : ''}`;
      const entrada = el('input', {
        type: 'file', accept: tipo === 'video' ? 'video/*' : 'image/*', style: 'display:none',
      });
      const barra = el('div', { class: 'progreso', hidden: true });
      barra.innerHTML = '<i></i>';

      const usarArchivo = async (archivo) => {
        if (!archivo) return;
        if (tipo === 'video' && !archivo.type.startsWith('video/')) return nota('Ese archivo no es un video.', 'error');
        if (tipo === 'imagen' && !archivo.type.startsWith('image/')) return nota('Ese archivo no es una imagen.', 'error');
        barra.hidden = false;
        zona.innerHTML = `<strong>Subiendo ${esc(archivo.name)}…</strong><span class="mini">${esc(pesoArchivo(archivo.size))}</span>`;
        try {
          const r = await subirArchivo(archivo, (p) => {
            barra.firstChild.style.width = Math.round(p * 100) + '%';
          });
          E.media.unshift({ ...r });
          actual = r.id;
          alCambiar(r.id);
          nota('Archivo subido', 'bien');
          pintarCampo();
        } catch (e) {
          nota(e.message, 'error');
          pintarCampo();
        }
      };

      zona.addEventListener('click', () => entrada.click());
      entrada.addEventListener('change', () => usarArchivo(entrada.files[0]));
      ['dragenter', 'dragover'].forEach((ev) => zona.addEventListener(ev, (e) => {
        e.preventDefault(); zona.classList.add('encima');
      }));
      ['dragleave', 'drop'].forEach((ev) => zona.addEventListener(ev, (e) => {
        e.preventDefault(); zona.classList.remove('encima');
      }));
      zona.addEventListener('drop', (e) => usarArchivo(e.dataTransfer.files[0]));

      const biblioteca = el('button', {
        class: 'btn btn-sm', type: 'button', style: 'margin-top:8px',
        text: 'O elegir de la biblioteca',
        onclick: () => elegirDeBiblioteca(tipo, (mid) => { actual = mid; alCambiar(mid); pintarCampo(); }),
      });

      nodo.append(zona, barra, entrada, biblioteca);
    };

    pintarCampo();
  }

  /** Campo de varias imágenes. */
  function campoMedios(nodo, { valores, alCambiar }) {
    let lista = [...valores];
    const pintarCampo = () => {
      nodo.innerHTML = '';
      const rej = el('div', { class: 'fila-wrap' });
      lista.forEach((fid) => {
        const m = medio(fid);
        const caja = el('div', { style: 'position:relative' });
        caja.innerHTML = `<img src="${urlMedia(fid)}" alt="" style="width:92px;height:68px;object-fit:cover;border-radius:8px;border:1px solid var(--linea)">
          <button type="button" class="cerrar" style="position:absolute;top:-7px;right:-7px;width:22px;height:22px;font-size:14px" title="${esc(m ? m.nombre : '')}">&times;</button>`;
        caja.querySelector('button').addEventListener('click', () => {
          lista = lista.filter((x) => x !== fid); alCambiar(lista); pintarCampo();
        });
        rej.append(caja);
      });
      const agregar = el('button', {
        class: 'btn btn-sm', type: 'button', text: '+ Agregar foto',
        onclick: () => elegirDeBiblioteca('imagen', (mid) => {
          if (!lista.includes(mid)) { lista.push(mid); alCambiar(lista); pintarCampo(); }
        }, true),
      });
      rej.append(agregar);
      nodo.append(rej);
    };
    pintarCampo();
  }

  /** Modal para escoger un archivo ya subido (o subir uno nuevo). */
  function elegirDeBiblioteca(tipo, alElegir, permitirSubir = true) {
    const disponibles = E.media.filter((m) => m.tipo === tipo);
    const m = modal({
      titulo: `Elegir ${tipo === 'video' ? 'video' : 'imagen'}`,
      tamano: 'md',
      cuerpo: `
        ${permitirSubir ? '<div id="lib-subir" style="margin-bottom:18px"></div>' : ''}
        ${disponibles.length
          ? `<div class="rejilla-medios">${disponibles.map((x) => `
              <div class="medio elegible" data-id="${esc(x.id)}">
                <div class="vista-previa">
                  ${x.tipo === 'video'
                    ? `<video src="${urlMedia(x.id)}#t=0.6" preload="metadata" muted></video>`
                    : `<img src="${urlMedia(x.id)}" alt="">`}
                </div>
                <div class="info"><span class="nom">${esc(x.nombre)}</span><span>${esc(pesoArchivo(x.tamano))}</span></div>
              </div>`).join('')}</div>`
          : '<div class="vacio">Todavía no hay archivos de este tipo en la biblioteca.</div>'}`,
    });

    if (permitirSubir) {
      campoMedio(m.caja.querySelector('#lib-subir'), {
        tipo, valor: null, alCambiar: (v) => { if (v) { alElegir(v); m.cerrar(); } },
      });
    }
    m.caja.querySelectorAll('.medio.elegible').forEach((n) =>
      n.addEventListener('click', () => { alElegir(n.dataset.id); m.cerrar(); }));
  }

  /* =============================================================== Edificios */

  function verEdificios() {
    if (esPrincipal()) accion('Nuevo edificio', () => formEdificio());

    $('#v-edificios').innerHTML = E.edificios.length
      ? `<div class="rejilla-ed">${E.edificios.map((e) => {
          const us = E.apartamentos.filter((a) => a.edificioId === e.id);
          const disp = us.filter((a) => a.estado === 'disponible').length;
          const enc = e.encargado || {};
          return `<article class="tarjeta ed-tarjeta">
            <div class="top">
              ${e.fotoId ? `<img class="foto" src="${urlMedia(e.fotoId)}" alt="">` : ''}
              <div class="crece">
                <h3>${esc(e.nombre)}</h3>
                <div class="tenue mini" style="margin-top:3px">${esc(e.direccion)}${e.ciudad ? ' · ' + esc(e.ciudad) : ''}</div>
                <div class="fila-wrap mini tenue" style="margin-top:8px">
                  <span>${us.length} unidades</span><span>· ${disp} disponibles</span>
                  ${e.lat && e.lng ? '<span>· 📍 ubicado</span>' : '<span style="color:var(--aviso-ink)">· sin coordenadas</span>'}
                </div>
              </div>
            </div>
            ${enc.nombre ? `<div class="encargado">
              ${enc.fotoId ? `<img class="avatar" src="${urlMedia(enc.fotoId)}" alt="">` : `<div class="avatar">${esc(iniciales(enc.nombre))}</div>`}
              <div class="datos">
                <div class="rol">${esc(enc.cargo || 'Encargado')}</div>
                <div class="nombre">${esc(enc.nombre)}</div>
                ${enc.telefono ? `<div class="linea">☏ ${esc(enc.telefono)}</div>` : ''}
                ${enc.email ? `<div class="linea">✉ ${esc(enc.email)}</div>` : ''}
              </div>
            </div>` : '<div class="aviso aviso-ojo">Este edificio todavía no tiene encargado registrado.</div>'}
            <div class="fila" style="gap:8px">
              <button class="btn btn-sm crece" type="button" data-editar="${esc(e.id)}">Editar</button>
              <button class="btn btn-sm crece" type="button" data-unidades="${esc(e.id)}">Ver unidades</button>
              ${esPrincipal() ? `<button class="btn btn-sm btn-peligro" type="button" data-borrar="${esc(e.id)}">Eliminar</button>` : ''}
            </div>
          </article>`;
        }).join('')}</div>`
      : `<div class="vacio"><h3>Aún no hay edificios</h3>
           <p>Registra el primero para poder crear unidades y publicarlas.</p></div>`;

    $$('#v-edificios [data-editar]').forEach((b) =>
      b.addEventListener('click', () => formEdificio(edificio(b.dataset.editar))));
    $$('#v-edificios [data-unidades]').forEach((b) =>
      b.addEventListener('click', () => { fu.edificio = b.dataset.unidades; irA('unidades'); }));
    $$('#v-edificios [data-borrar]').forEach((b) =>
      b.addEventListener('click', async () => {
        const e = edificio(b.dataset.borrar);
        const n = E.apartamentos.filter((a) => a.edificioId === e.id).length;
        if (!(await confirmar(
          `Se eliminará "${e.nombre}"${n ? ` junto con sus ${n} unidades, contratos y pagos` : ''}. No se puede deshacer.`,
          { titulo: 'Eliminar edificio', textoOk: 'Eliminar' }))) return;
        await operar(() => api('/api/edificios/' + e.id, { method: 'DELETE' }), 'Edificio eliminado');
      }));
  }

  function formEdificio(e = null) {
    const esNuevo = !e;
    e = e || {
      nombre: '', direccion: '', ciudad: '', lat: null, lng: null, descripcion: '',
      amenidades: [], fotoId: null,
      encargado: { nombre: '', cargo: 'Encargado del edificio', telefono: '', whatsapp: '', email: '', horario: '', fotoId: null },
    };
    const enc = e.encargado || {};

    const m = modal({
      titulo: esNuevo ? 'Nuevo edificio' : `Editar ${e.nombre}`,
      tamano: 'md',
      cuerpo: `
        <div class="pestanas">
          <button class="pestana activa" data-hoja="d" type="button">Edificio</button>
          <button class="pestana" data-hoja="u" type="button">Ubicación</button>
          <button class="pestana" data-hoja="e" type="button">Encargado</button>
        </div>
        <form id="f-ed">
          <div class="hoja activa" data-hoja="d">
            <div class="campo"><label for="e-nombre">Nombre *</label>
              <input id="e-nombre" name="nombre" required value="${esc(e.nombre)}" placeholder="Edificio Aurora"></div>
            <div class="campo" style="margin-top:14px"><label for="e-desc">Descripción</label>
              <textarea id="e-desc" name="descripcion" rows="4">${esc(e.descripcion)}</textarea></div>
            <div class="campo" style="margin-top:14px"><label for="e-amen">Zonas comunes (una por línea)</label>
              <textarea id="e-amen" name="amenidades" rows="4" placeholder="Ascensor&#10;Portería 24/7&#10;Gimnasio">${esc((e.amenidades || []).join('\n'))}</textarea></div>
            <label class="etiqueta" style="display:block;margin-top:16px">Foto del edificio</label>
            <div id="e-foto" style="margin-top:8px"></div>
          </div>

          <div class="hoja" data-hoja="u">
            <div class="rejilla-campos">
              <div class="campo" style="flex:2"><label for="e-dir">Dirección</label>
                <input id="e-dir" name="direccion" value="${esc(e.direccion)}" placeholder="Calle 44 #79-21"></div>
              <div class="campo"><label for="e-ciudad">Ciudad / barrio</label>
                <input id="e-ciudad" name="ciudad" value="${esc(e.ciudad)}" placeholder="Medellín"></div>
            </div>
            <div class="rejilla-campos" style="margin-top:14px">
              <div class="campo"><label for="e-lat">Latitud</label>
                <input id="e-lat" name="lat" type="number" step="any" value="${e.lat ?? ''}" placeholder="6.2447"></div>
              <div class="campo"><label for="e-lng">Longitud</label>
                <input id="e-lng" name="lng" type="number" step="any" value="${e.lng ?? ''}" placeholder="-75.5916"></div>
            </div>
            <p class="ayuda tenue mini" style="margin:10px 0">Haz clic en el mapa para fijar la ubicación exacta del edificio.</p>
            <div class="mapa-selector" id="e-mapa"></div>
          </div>

          <div class="hoja" data-hoja="e">
            <div class="rejilla-campos">
              <div class="campo"><label for="en-nombre">Nombre</label>
                <input id="en-nombre" name="en_nombre" value="${esc(enc.nombre)}" placeholder="Marcela Ospina"></div>
              <div class="campo"><label for="en-cargo">Cargo</label>
                <input id="en-cargo" name="en_cargo" value="${esc(enc.cargo)}" placeholder="Administradora"></div>
            </div>
            <div class="rejilla-campos" style="margin-top:14px">
              <div class="campo"><label for="en-tel">Teléfono</label>
                <input id="en-tel" name="en_telefono" value="${esc(enc.telefono)}" placeholder="+57 301 222 3344"></div>
              <div class="campo"><label for="en-wa">WhatsApp (solo dígitos, con indicativo)</label>
                <input id="en-wa" name="en_whatsapp" value="${esc(enc.whatsapp)}" placeholder="573012223344"></div>
            </div>
            <div class="campo" style="margin-top:14px"><label for="en-mail">Correo</label>
              <input id="en-mail" name="en_email" type="email" value="${esc(enc.email)}"></div>
            <div class="campo" style="margin-top:14px"><label for="en-hor">Horario de atención</label>
              <input id="en-hor" name="en_horario" value="${esc(enc.horario)}" placeholder="Lun a Vie 8:00 a.m. – 6:00 p.m."></div>
            <label class="etiqueta" style="display:block;margin-top:16px">Foto del encargado</label>
            <div id="en-foto" style="margin-top:8px"></div>
          </div>
        </form>`,
      pie: `<button class="btn" data-cancelar type="button">Cancelar</button>
            <button class="btn btn-primario" data-ok type="button">${esNuevo ? 'Crear edificio' : 'Guardar cambios'}</button>`,
    });

    pestanas(m.caja);

    const borrador = { fotoId: e.fotoId, encFotoId: enc.fotoId };
    campoMedio(m.caja.querySelector('#e-foto'), { tipo: 'imagen', valor: e.fotoId, alCambiar: (v) => { borrador.fotoId = v; } });
    campoMedio(m.caja.querySelector('#en-foto'), { tipo: 'imagen', valor: enc.fotoId, alCambiar: (v) => { borrador.encFotoId = v; } });

    // Mapa para fijar coordenadas
    let mapaSel = null, marcaSel = null;
    const inLat = m.caja.querySelector('#e-lat');
    const inLng = m.caja.querySelector('#e-lng');
    const prepararMapa = () => {
      const nodo = m.caja.querySelector('#e-mapa');
      if (!window.L) { nodo.innerHTML = '<div class="mapa-caida">Sin conexión: escribe las coordenadas a mano.</div>'; return; }
      if (mapaSel) { mapaSel.invalidateSize(); return; }
      const centro = e.lat && e.lng ? [e.lat, e.lng] : [4.65, -74.06];
      mapaSel = L.map(nodo).setView(centro, e.lat ? 16 : 11);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(mapaSel);
      const icono = L.divIcon({ className: '', html: '<div class="marcador"><span>◈</span></div>', iconSize: [32, 32], iconAnchor: [16, 30] });
      if (e.lat && e.lng) marcaSel = L.marker([e.lat, e.lng], { icon: icono }).addTo(mapaSel);
      mapaSel.on('click', (ev) => {
        const { lat, lng } = ev.latlng;
        inLat.value = lat.toFixed(6);
        inLng.value = lng.toFixed(6);
        if (marcaSel) marcaSel.setLatLng(ev.latlng);
        else marcaSel = L.marker(ev.latlng, { icon: icono }).addTo(mapaSel);
      });
      setTimeout(() => mapaSel.invalidateSize(), 120);
    };
    m.caja.querySelector('[data-hoja="u"].pestana').addEventListener('click', () => setTimeout(prepararMapa, 60));

    m.caja.querySelector('[data-cancelar]').addEventListener('click', m.cerrar);
    m.caja.querySelector('[data-ok]').addEventListener('click', async (ev) => {
      const form = m.caja.querySelector('#f-ed');
      if (!form.reportValidity()) return;
      const d = Object.fromEntries(new FormData(form).entries());
      const cuerpo = {
        nombre: d.nombre, direccion: d.direccion, ciudad: d.ciudad,
        lat: d.lat === '' ? null : Number(d.lat),
        lng: d.lng === '' ? null : Number(d.lng),
        descripcion: d.descripcion,
        amenidades: String(d.amenidades || '').split('\n').map((s) => s.trim()).filter(Boolean),
        fotoId: borrador.fotoId,
        encargado: {
          nombre: d.en_nombre, cargo: d.en_cargo, telefono: d.en_telefono,
          whatsapp: d.en_whatsapp, email: d.en_email, horario: d.en_horario,
          fotoId: borrador.encFotoId,
        },
      };
      ev.target.disabled = true;
      try {
        await operar(() => guardar('edificios', cuerpo, esNuevo ? null : e.id),
          esNuevo ? 'Edificio creado' : 'Cambios guardados');
        m.cerrar();
      } catch { ev.target.disabled = false; }
    });
  }

  /* =============================================================== Contratos */

  function verContratos() {
    accion('Nuevo contrato', () => formContrato());

    const orden = [...E.contratos].sort((a, b) => {
      const pesoEstado = (c) => (c.estado === 'activo' ? 0 : 1);
      return pesoEstado(a) - pesoEstado(b) || String(b.inicio).localeCompare(String(a.inicio));
    });
    const cartera = new Map((E.analitica?.cartera || []).map((c) => [c.contratoId, c]));

    $('#v-contratos').innerHTML = orden.length ? `
      <div class="bloque-panel">
        <div class="tabla-marco"><table class="tabla">
          <thead><tr>
            <th>Inquilino</th><th>Unidad</th><th class="num">Canon</th>
            <th>Desde</th><th>Estado</th><th>Al día</th><th class="acciones">Acciones</th>
          </tr></thead>
          <tbody>${orden.map((c) => {
            const deuda = cartera.get(c.id);
            return `<tr>
              <td>
                <div style="font-weight:600">${esc(c.inquilino?.nombre || '—')}</div>
                <div class="mini tenue">${esc([c.inquilino?.documento, c.inquilino?.telefono].filter(Boolean).join(' · '))}</div>
              </td>
              <td class="tenue">${esc(nombreUnidad(apartamento(c.apartamentoId)))}</td>
              <td class="num">${esc(dinero(c.canon))}</td>
              <td class="tenue">${esc(fechaTexto(c.inicio))}</td>
              <td><span class="chip ${c.estado === 'activo' ? 'chip-disponible' : 'chip-mantenimiento'}">${esc(c.estado)}</span></td>
              <td>${deuda
                ? `<span class="chip chip-vencido">${deuda.mesesVencidos} mes${deuda.mesesVencidos === 1 ? '' : 'es'} · ${esc(dinero(deuda.saldo))}</span>`
                : '<span class="chip chip-disponible">Al día</span>'}</td>
              <td class="acciones">
                <button class="btn btn-sm btn-primario" type="button" data-pago="${esc(c.id)}">Pago</button>
                <button class="btn btn-sm" type="button" data-hist="${esc(c.id)}">Historial</button>
                <button class="btn btn-sm" type="button" data-mensaje="${esc(c.id)}">Mensaje</button>
                <button class="btn btn-sm" type="button" data-imprimir-contrato="${esc(c.id)}">Imprimir</button>
                <button class="btn btn-sm" type="button" data-portal="${esc(c.id)}">${c.portal?.activo ? 'Portal' : 'Activar portal'}</button>
                <button class="btn btn-sm" type="button" data-editar="${esc(c.id)}">Editar</button>
                <button class="btn btn-sm btn-peligro" type="button" data-borrar="${esc(c.id)}">✕</button>
              </td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>`
      : `<div class="vacio"><h3>Sin contratos registrados</h3>
           <p>Cuando arriendes una unidad, créale un contrato para llevar el control de pagos.</p></div>`;

    $$('#v-contratos [data-pago]').forEach((b) => b.addEventListener('click', () => formPago(null, b.dataset.pago)));
    $$('#v-contratos [data-hist]').forEach((b) => b.addEventListener('click', () => verHistorial(b.dataset.hist)));
    $$('#v-contratos [data-mensaje]').forEach((b) => b.addEventListener('click', () => formMensaje(b.dataset.mensaje)));
    $$('#v-contratos [data-imprimir-contrato]').forEach((b) => b.addEventListener('click', () => imprimirContrato(b.dataset.imprimirContrato)));
    $$('#v-contratos [data-portal]').forEach((b) => b.addEventListener('click', () => formPortalInquilino(b.dataset.portal)));
    $$('#v-contratos [data-editar]').forEach((b) => b.addEventListener('click', () => formContrato(contrato(b.dataset.editar))));
    $$('#v-contratos [data-borrar]').forEach((b) => b.addEventListener('click', async () => {
      const c = contrato(b.dataset.borrar);
      if (!(await confirmar(`Se eliminará el contrato de ${c.inquilino?.nombre || 'este inquilino'} y sus pagos registrados.`,
        { titulo: 'Eliminar contrato', textoOk: 'Eliminar' }))) return;
      await operar(() => api('/api/contratos/' + c.id, { method: 'DELETE' }), 'Contrato eliminado');
    }));
  }

  function imprimirContrato(contratoId) {
    const c = contrato(contratoId);
    const a = c && apartamento(c.apartamentoId);
    const e = a && edificio(a.edificioId);
    if (!c || !a || !e) return nota('No se encontró la información completa del contrato.', 'error');
    const contenido = `<main class="documento-contrato">
      <span class="sobrelinea">RESUMEN IMPRIMIBLE DE ARRENDAMIENTO</span>
      <h1>${esc(e.nombre || 'Apartaestudios')}</h1>
      <p class="tenue">${esc([e.direccion, e.ciudad].filter(Boolean).join(' · '))}</p>
      <div class="documento-datos">
        <div><span>Inquilino</span><strong>${esc(c.inquilino?.nombre || '—')}</strong></div>
        <div><span>Documento</span><strong>${esc(c.inquilino?.documento || '—')}</strong></div>
        <div><span>Unidad</span><strong>${esc(a.numero || '—')} · ${esc(a.titulo || '')}</strong></div>
        <div><span>Vigencia</span><strong>${esc(fechaTexto(c.inicio))}${c.fin ? ' a ' + esc(fechaTexto(c.fin)) : ' · Sin fecha final'}</strong></div>
        <div><span>Canon mensual</span><strong>${esc(dinero(c.canon))}</strong></div>
        <div><span>Día de pago</span><strong>${esc(numero(c.diaPago))} de cada mes</strong></div>
        <div><span>Depósito</span><strong>${esc(c.deposito ? dinero(c.deposito) : 'No registrado')}</strong></div>
        <div><span>Estado</span><strong>${esc(c.estado || '—')}</strong></div>
      </div>
      ${c.notas ? `<section><h2>Notas</h2><p>${esc(c.notas)}</p></section>` : ''}
      <p class="nota-legal">Este resumen es informativo y no reemplaza el contrato firmado ni sus anexos.</p>
    </main>`;
    const ventana = window.open('', '_blank', 'noopener,noreferrer,width=760,height=780');
    if (!ventana) return nota('El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes e inténtalo de nuevo.', 'error');
    ventana.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Resumen de contrato</title><style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#17241f;padding:42px;margin:0}.documento-contrato{max-width:700px;margin:auto;border:1px solid #ddd;border-radius:14px;padding:30px}.sobrelinea{font-size:11px;color:#93442e;font-weight:700;letter-spacing:.11em}.documento-contrato h1{margin:7px 0 3px}.tenue{color:#59635e}.documento-datos{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:26px 0}.documento-datos div{border-bottom:1px solid #e6e4de;padding-bottom:9px}.documento-datos span{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#59635e}.documento-datos strong{display:block;margin-top:4px}.documento-contrato h2{font-size:16px}.nota-legal{margin-top:30px;font-size:12px;color:#59635e}@media print{body{padding:0}.documento-contrato{border:0}}</style></head><body>${contenido}<script>window.onload=()=>window.print()<\/script></body></html>`);
    ventana.document.close();
  }

  function formContrato(c = null) {
    const esNuevo = !c;
    c = c || {
      apartamentoId: '', inquilino: { nombre: '', documento: '', telefono: '', email: '' },
      inicio: hoyISO(), fin: '', canon: 0, deposito: 0, diaPago: 5, estado: 'activo', notas: '',
    };
    const inq = c.inquilino || {};
    const elegibles = E.apartamentos.filter((a) => a.estado !== 'arrendado' || a.id === c.apartamentoId);

    if (!elegibles.length) {
      nota('No hay unidades libres para asociar a un contrato.', 'error');
      return;
    }

    const m = modal({
      titulo: esNuevo ? 'Nuevo contrato' : 'Editar contrato',
      tamano: 'md',
      cuerpo: `<form id="f-ct">
        <div class="rejilla-campos">
          <div class="campo" style="flex:2"><label for="ct-apto">Unidad *</label><select id="ct-apto" name="apartamentoId" required>
            <option value="">Selecciona…</option>
            ${elegibles.map((a) => `<option value="${esc(a.id)}" data-precio="${a.precio}" data-dep="${a.deposito}"
              ${c.apartamentoId === a.id ? 'selected' : ''}>${esc(nombreUnidad(a))} — ${esc(dinero(a.precio))}</option>`).join('')}
          </select></div>
          <div class="campo"><label for="ct-estado">Estado</label><select id="ct-estado" name="estado">
            <option value="activo" ${c.estado === 'activo' ? 'selected' : ''}>Activo</option>
            <option value="finalizado" ${c.estado === 'finalizado' ? 'selected' : ''}>Finalizado</option>
            <option value="cancelado" ${c.estado === 'cancelado' ? 'selected' : ''}>Cancelado</option>
          </select></div>
        </div>

        <h4 style="margin:20px 0 10px;font-size:.76rem;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-3)">Inquilino</h4>
        <div class="rejilla-campos">
          <div class="campo"><label for="ct-nom">Nombre completo *</label>
            <input id="ct-nom" name="nombre" required value="${esc(inq.nombre)}"></div>
          <div class="campo"><label for="ct-doc">Documento</label>
            <input id="ct-doc" name="documento" value="${esc(inq.documento)}"></div>
        </div>
        <div class="rejilla-campos" style="margin-top:14px">
          <div class="campo"><label for="ct-tel">Teléfono</label>
            <input id="ct-tel" name="telefono" value="${esc(inq.telefono)}"></div>
          <div class="campo"><label for="ct-mail">Correo</label>
            <input id="ct-mail" name="email" type="email" value="${esc(inq.email)}"></div>
        </div>

        <h4 style="margin:20px 0 10px;font-size:.76rem;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-3)">Condiciones</h4>
        <div class="rejilla-campos">
          <div class="campo"><label for="ct-canon">Canon mensual *</label>
            <input id="ct-canon" name="canon" type="number" min="0" step="1000" required value="${esc(c.canon)}"></div>
          <div class="campo"><label for="ct-dep">Depósito</label>
            <input id="ct-dep" name="deposito" type="number" min="0" step="1000" value="${esc(c.deposito)}"></div>
          <div class="campo"><label for="ct-dia">Día de pago</label>
            <input id="ct-dia" name="diaPago" type="number" min="1" max="31" value="${esc(c.diaPago)}"></div>
        </div>
        <div class="rejilla-campos" style="margin-top:14px">
          <div class="campo"><label for="ct-ini">Inicio *</label>
            <input id="ct-ini" name="inicio" type="date" required value="${esc(c.inicio)}"></div>
          <div class="campo"><label for="ct-fin">Fin (opcional)</label>
            <input id="ct-fin" name="fin" type="date" value="${esc(c.fin)}"></div>
        </div>
        <div class="campo" style="margin-top:14px"><label for="ct-notas">Notas internas</label>
          <textarea id="ct-notas" name="notas" rows="3">${esc(c.notas)}</textarea></div>
        <div class="aviso" style="margin-top:16px">
          Al guardar un contrato activo, la unidad pasa automáticamente a <strong>Arrendado</strong>.
        </div>
      </form>`,
      pie: `<button class="btn" data-cancelar type="button">Cancelar</button>
            <button class="btn btn-primario" data-ok type="button">${esNuevo ? 'Crear contrato' : 'Guardar'}</button>`,
    });

    // Autocompleta canon y depósito al elegir unidad
    const selApto = m.caja.querySelector('#ct-apto');
    selApto.addEventListener('change', () => {
      const op = selApto.selectedOptions[0];
      if (!op || !op.dataset.precio) return;
      const canon = m.caja.querySelector('#ct-canon');
      const dep = m.caja.querySelector('#ct-dep');
      if (!Number(canon.value)) canon.value = op.dataset.precio;
      if (!Number(dep.value)) dep.value = op.dataset.dep || op.dataset.precio;
    });

    m.caja.querySelector('[data-cancelar]').addEventListener('click', m.cerrar);
    m.caja.querySelector('[data-ok]').addEventListener('click', async (ev) => {
      const form = m.caja.querySelector('#f-ct');
      if (!form.reportValidity()) return;
      const d = Object.fromEntries(new FormData(form).entries());
      const cuerpo = {
        apartamentoId: d.apartamentoId, estado: d.estado,
        inquilino: { nombre: d.nombre, documento: d.documento, telefono: d.telefono, email: d.email },
        canon: d.canon, deposito: d.deposito, diaPago: d.diaPago,
        inicio: d.inicio, fin: d.fin, notas: d.notas,
      };
      ev.target.disabled = true;
      try {
        await operar(() => guardar('contratos', cuerpo, esNuevo ? null : c.id),
          esNuevo ? 'Contrato creado' : 'Contrato actualizado');
        m.cerrar();
      } catch { ev.target.disabled = false; }
    });
  }

  function verHistorial(ctId) {
    const c = contrato(ctId);
    if (!c) return;
    const pagos = E.pagos.filter((p) => p.contratoId === ctId)
      .sort((a, b) => String(b.periodo).localeCompare(String(a.periodo)));
    const deuda = (E.analitica?.cartera || []).find((x) => x.contratoId === ctId);
    const total = pagos.reduce((s, p) => s + Number(p.monto || 0), 0);

    modal({
      titulo: `Historial · ${c.inquilino?.nombre || 'Contrato'}`,
      tamano: 'md',
      cuerpo: `
        <div class="kpis" style="margin-bottom:18px">
          <div class="kpi"><div class="k">Unidad</div><div class="v" style="font-size:1.05rem">${esc(nombreUnidad(apartamento(c.apartamentoId)))}</div></div>
          <div class="kpi"><div class="k">Total recaudado</div><div class="v" style="font-size:1.3rem">${esc(dinero(total))}</div>
            <div class="n">${pagos.length} pago${pagos.length === 1 ? '' : 's'}</div></div>
          <div class="kpi"><div class="k">Saldo pendiente</div>
            <div class="v" style="font-size:1.3rem;color:${deuda ? 'var(--critico-ink)' : 'var(--bien-ink)'}">${esc(dinero(deuda ? deuda.saldo : 0))}</div>
            ${deuda ? `<div class="n"><div class="meses-chips">${deuda.meses.map((x) => `<span class="mes-chip">${esc(mesTexto(x))}</span>`).join('')}</div></div>` : '<div class="n">Al día</div>'}</div>
        </div>
        ${pagos.length ? `<div class="tabla-marco"><table class="tabla">
          <thead><tr><th>Periodo</th><th>Fecha</th><th>Método</th><th class="num">Monto</th></tr></thead>
          <tbody>${pagos.map((p) => `<tr>
            <td style="font-weight:600">${esc(mesTexto(p.periodo))}</td>
            <td class="tenue">${esc(fechaTexto(p.fecha))}</td>
            <td class="tenue">${esc(p.metodo)}${p.referencia ? ` · ${esc(p.referencia)}` : ''}</td>
            <td class="num">${esc(dinero(p.monto))}</td>
          </tr>`).join('')}</tbody></table></div>`
          : '<div class="vacio">Sin pagos registrados todavía.</div>'}`,
      pie: `<button class="btn btn-primario" data-nuevo type="button">Registrar pago</button>`,
      alAbrir: (caja, cerrar) => {
        caja.querySelector('[data-nuevo]').addEventListener('click', () => { cerrar(); formPago(null, ctId); });
      },
    });
  }

  /* ================================================== Portal del inquilino */

  function formPortalInquilino(ctId) {
    const c = contrato(ctId);
    if (!c) return;
    if (!c.inquilino?.documento) {
      nota('Registra el documento del inquilino antes de activar su portal.', 'error');
      return;
    }
    const activo = !!c.portal?.activo;
    const m = modal({
      titulo: 'Acceso del inquilino',
      tamano: 'sm',
      cuerpo: `<div class="aviso" style="margin-bottom:16px">
          El acceso se identifica con el documento de <strong>${esc(c.inquilino?.nombre)}</strong>. La clave se guarda protegida y no se puede consultar después.
        </div>
        <form id="f-portal-inq">
          <label class="check"><input id="pi-activo" type="checkbox" ${activo ? 'checked' : ''}>
            Permitir acceso al portal del inquilino</label>
          <div class="campo" style="margin-top:14px">
            <label for="pi-clave">${activo ? 'Nueva clave (solo si deseas cambiarla)' : 'Clave de acceso *'}</label>
            <input id="pi-clave" name="clave" type="password" minlength="6" autocomplete="new-password"
              placeholder="Mínimo 6 caracteres">
            <span class="ayuda">El inquilino entra desde <strong>/inquilino</strong> con su documento y esta clave.</span>
          </div>
        </form>`,
      pie: `<button class="btn" type="button" data-cancelar>Cancelar</button>
            <button class="btn btn-primario" type="button" data-guardar>${activo ? 'Guardar acceso' : 'Activar portal'}</button>`,
    });
    m.caja.querySelector('[data-cancelar]').addEventListener('click', m.cerrar);
    m.caja.querySelector('[data-guardar]').addEventListener('click', async (ev) => {
      const permitir = m.caja.querySelector('#pi-activo').checked;
      const clave = m.caja.querySelector('#pi-clave').value;
      if (permitir && !activo && clave.length < 6) {
        nota('Define una clave de al menos 6 caracteres.', 'error');
        return;
      }
      if (permitir && activo && !clave) { m.cerrar(); return; }
      ev.target.disabled = true;
      try {
        await operar(() => api(`/api/contratos/${c.id}/portal`, {
          method: 'POST', body: permitir ? { activo: true, clave } : { activo: false },
        }), permitir ? 'Acceso del portal guardado' : 'Acceso del portal desactivado');
        m.cerrar();
      } catch { ev.target.disabled = false; }
    });
  }

  /* ================================================================ Mensajes */

  const plantillasMensajes = {
    pago: {
      asunto: 'Recordatorio de pago', categoria: 'pago', prioridad: 'alta',
      cuerpo: 'Te recordamos que el pago mensual de tu apartaestudio está próximo a vencer. Por favor confirma cuando realices la transferencia o comunícate con administración si necesitas apoyo.',
    },
    convivencia: {
      asunto: 'Aviso de convivencia', categoria: 'convivencia', prioridad: 'alta',
      cuerpo: 'Hemos recibido una observación relacionada con ruido o convivencia. Te pedimos revisar las normas del edificio y evitar situaciones que afecten el descanso de los vecinos. Si deseas dar tu versión, responde por este medio.',
    },
    general: {
      asunto: 'Información de administración', categoria: 'general', prioridad: 'normal',
      cuerpo: 'Tenemos información importante para ti sobre el edificio y tu apartaestudio.',
    },
    edificio: {
      asunto: 'Aviso importante del edificio', categoria: 'mantenimiento', prioridad: 'normal',
      cuerpo: 'Te informamos una novedad programada en el edificio. Agradecemos tomar las precauciones necesarias. Si tienes alguna inquietud, responde a este mensaje.',
    },
  };

  function verMensajes() {
    accion('Nuevo mensaje', () => formMensaje());
    const mensajes = [...E.mensajes].sort((a, b) => String(b.creado).localeCompare(String(a.creado)));
    const sinLeer = mensajes.filter((x) => x.tipo === 'inquilino' && !x.leidoAdmin).length;

    $('#v-mensajes').innerHTML = mensajes.length ? `
      <div class="aviso" style="margin-bottom:18px">
        Los mensajes llegan al portal privado del inquilino. ${sinLeer ? `<strong>${sinLeer} requieren revisión.</strong>` : 'No tienes mensajes nuevos.'}
      </div>
      <div class="bloque-panel"><ul class="lista-simple lista-mensajes">
        ${mensajes.map((x) => {
          const c = contrato(x.contratoId);
          const esInquilino = x.tipo === 'inquilino';
          const noLeido = esInquilino ? !x.leidoAdmin : !x.leidoInquilino;
          const esMantenimiento = esInquilino && x.categoria === 'mantenimiento';
          const estadoGestion = x.estadoGestion || 'abierta';
          const textoGestion = { abierta: 'Abierta', en_proceso: 'En proceso', resuelta: 'Resuelta' }[estadoGestion] || 'Abierta';
          return `<li class="mensaje ${noLeido ? 'sin-leer' : ''}">
            <div class="mensaje-tipo">${esInquilino ? 'INQ' : 'ADM'}</div>
            <div class="crece">
              <div class="fila-wrap" style="gap:7px">
                <strong>${esc(x.asunto || 'Sin asunto')}</strong>
                ${x.prioridad === 'alta' ? '<span class="chip chip-vencido">Prioridad alta</span>' : ''}
                ${esMantenimiento ? `<span class="chip ${estadoGestion === 'resuelta' ? 'chip-disponible' : estadoGestion === 'en_proceso' ? 'chip-reservado' : 'chip-vencido'}">Mantenimiento · ${esc(textoGestion)}</span>` : ''}
                ${noLeido ? '<span class="chip chip-reservado">Sin leer</span>' : ''}
              </div>
              <div class="mini tenue" style="margin-top:3px">
                ${esInquilino ? 'De' : 'Para'} ${esc(c?.inquilino?.nombre || 'Contrato eliminado')} · ${esc(c ? nombreUnidad(apartamento(c.apartamentoId)) : '—')} · ${esc(fechaTexto(x.creado))}
              </div>
              <p class="mensaje-cuerpo">${esc(x.cuerpo)}</p>
              ${(x.adjuntos || []).length ? `<div class="fila-wrap" style="gap:7px;margin-top:9px">${x.adjuntos.map((idMedio, i) => `<button class="btn btn-sm" type="button" data-adjunto-admin="${esc(idMedio)}">Ver evidencia ${i + 1}</button>`).join('')}</div>` : ''}
            </div>
            <div class="pila mensaje-acciones">
              ${esMantenimiento ? `<select class="control mini" data-gestion="${esc(x.id)}" style="width:auto;padding:5px 8px">
                <option value="abierta" ${estadoGestion === 'abierta' ? 'selected' : ''}>Abierta</option>
                <option value="en_proceso" ${estadoGestion === 'en_proceso' ? 'selected' : ''}>En proceso</option>
                <option value="resuelta" ${estadoGestion === 'resuelta' ? 'selected' : ''}>Resuelta</option>
              </select>` : ''}
              ${esInquilino && noLeido ? `<button class="btn btn-sm" type="button" data-leer="${esc(x.id)}">Marcar leído</button>` : ''}
              ${c ? `<button class="btn btn-sm btn-primario" type="button" data-responder="${esc(c.id)}">Responder</button>` : ''}
              <button class="btn btn-sm btn-peligro" type="button" data-borrar-mensaje="${esc(x.id)}" aria-label="Eliminar mensaje">×</button>
            </div>
          </li>`;
        }).join('')}
      </ul></div>`
      : `<div class="vacio"><h3>Sin mensajes todavía</h3>
           <p>Envía un mensaje desde aquí para que el inquilino lo vea en su portal privado.</p></div>`;

    $$('#v-mensajes [data-responder]').forEach((b) => b.addEventListener('click', () => formMensaje(b.dataset.responder)));
    $$('#v-mensajes [data-leer]').forEach((b) => b.addEventListener('click', async () => {
      await operar(() => api(`/api/mensajes/${b.dataset.leer}/leido`, { method: 'PUT' }), 'Mensaje marcado como leído');
    }));
    $$('#v-mensajes [data-gestion]').forEach((s) => s.addEventListener('change', async () => {
      await operar(() => api(`/api/mensajes/${s.dataset.gestion}/gestion`, {
        method: 'PUT', body: { estadoGestion: s.value },
      }), 'Estado de mantenimiento actualizado');
    }));
    $$('#v-mensajes [data-adjunto-admin]').forEach((b) => b.addEventListener('click', () => abrirAdjuntoPrivado(b.dataset.adjuntoAdmin)));
    $$('#v-mensajes [data-borrar-mensaje]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmar('¿Eliminar este mensaje del historial?', { titulo: 'Eliminar mensaje', textoOk: 'Eliminar' }))) return;
      await operar(() => api('/api/mensajes/' + b.dataset.borrarMensaje, { method: 'DELETE' }), 'Mensaje eliminado');
    }));
  }

  async function abrirAdjuntoPrivado(idMedio) {
    try {
      const r = await fetch('/api/media/' + encodeURIComponent(idMedio), {
        headers: { Authorization: 'Bearer ' + App.token.get() },
      });
      if (!r.ok) throw new Error('No fue posible abrir la evidencia.');
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const m = modal({
        titulo: 'Evidencia de mantenimiento', tamano: 'lg',
        cuerpo: `<img src="${url}" alt="Evidencia adjunta por el inquilino" style="display:block;max-width:100%;max-height:68vh;margin:auto;border-radius:10px">`,
        pie: '<button class="btn" type="button" data-cerrar>Cerrar</button>',
        alCerrar: () => URL.revokeObjectURL(url),
      });
      m.caja.querySelector('[data-cerrar]').addEventListener('click', m.cerrar);
    } catch (e) { nota(e.message, 'error'); }
  }

  function formMensaje(contratoPrevio = '') {
    const contratos = E.contratos.filter((c) => c.estado === 'activo');
    if (!contratos.length) {
      nota('Necesitas un contrato activo para enviar un mensaje.', 'error');
      return;
    }
    const m = modal({
      titulo: 'Mensaje a inquilinos',
      tamano: 'md',
      cuerpo: `<div class="plantillas-mensaje" aria-label="Plantillas rápidas">
          <span class="mini tenue">Usar plantilla:</span>
          <button type="button" class="btn btn-sm" data-plantilla="pago">Recordatorio de pago</button>
          <button type="button" class="btn btn-sm" data-plantilla="convivencia">Convivencia / ruido</button>
          <button type="button" class="btn btn-sm" data-plantilla="general">Información general</button>
          <button type="button" class="btn btn-sm" data-plantilla="edificio">Novedad del edificio</button>
        </div>
        <form id="f-mensaje" style="margin-top:16px">
          <div class="campo"><label for="m-destinatario">Destinatario *</label><select id="m-destinatario" name="destinatario" required>
            <option value="">Selecciona…</option>
            <optgroup label="Inquilino individual">
              ${contratos.map((c) => `<option value="contrato:${esc(c.id)}" ${c.id === contratoPrevio ? 'selected' : ''}>${esc(c.inquilino?.nombre || '—')} · ${esc(nombreUnidad(apartamento(c.apartamentoId)))}</option>`).join('')}
            </optgroup>
            <optgroup label="Aviso para todo un edificio">
              ${E.edificios.map((e) => {
                const cantidad = contratos.filter((c) => apartamento(c.apartamentoId)?.edificioId === e.id).length;
                return cantidad ? `<option value="edificio:${esc(e.id)}">${esc(e.nombre)} · ${cantidad} inquilino${cantidad === 1 ? '' : 's'}</option>` : '';
              }).join('')}
            </optgroup>
          </select></div>
          <p class="mini tenue" style="margin:6px 0 0">Los avisos por edificio se entregan de forma privada a cada inquilino activo.</p>
          <div class="rejilla-campos" style="margin-top:14px">
            <div class="campo"><label for="m-asunto">Asunto *</label><input id="m-asunto" name="asunto" required maxlength="160" placeholder="Ej. Recordatorio de pago"></div>
            <div class="campo"><label for="m-categoria">Categoría</label><select id="m-categoria" name="categoria">
              <option value="general">General</option><option value="pago">Pago</option><option value="convivencia">Convivencia</option><option value="mantenimiento">Mantenimiento</option>
            </select></div>
            <label class="check" style="align-self:end"><input id="m-prioridad" name="prioridad" type="checkbox"> Prioridad alta</label>
          </div>
          <div class="campo" style="margin-top:14px"><label for="m-cuerpo">Mensaje *</label>
            <textarea id="m-cuerpo" name="cuerpo" required maxlength="1500" rows="7" placeholder="Escribe un mensaje claro y respetuoso."></textarea></div>
        </form>`,
      pie: `<button class="btn" type="button" data-cancelar>Cancelar</button>
            <button class="btn btn-primario" type="button" data-enviar>Enviar al portal</button>`,
    });
    m.caja.querySelector('[data-cancelar]').addEventListener('click', m.cerrar);
    m.caja.querySelectorAll('[data-plantilla]').forEach((b) => b.addEventListener('click', () => {
      const p = plantillasMensajes[b.dataset.plantilla];
      m.caja.querySelector('#m-asunto').value = p.asunto;
      m.caja.querySelector('#m-categoria').value = p.categoria;
      m.caja.querySelector('#m-prioridad').checked = p.prioridad === 'alta';
      m.caja.querySelector('#m-cuerpo').value = p.cuerpo;
    }));
    m.caja.querySelector('[data-enviar]').addEventListener('click', async (ev) => {
      const form = m.caja.querySelector('#f-mensaje');
      if (!form.reportValidity()) return;
      const d = Object.fromEntries(new FormData(form).entries());
      const [tipoDestinatario, idDestinatario] = String(d.destinatario || '').split(':');
      if (!idDestinatario) return;
      ev.target.disabled = true;
      try {
        const r = await operar(() => api('/api/mensajes', {
          method: 'POST', body: {
            asunto: d.asunto, cuerpo: d.cuerpo, categoria: d.categoria,
            prioridad: d.prioridad ? 'alta' : 'normal',
            ...(tipoDestinatario === 'edificio' ? { edificioId: idDestinatario } : { contratoId: idDestinatario }),
          },
        }));
        nota(r.enviados > 1 ? `Aviso enviado a ${r.enviados} inquilinos` : 'Mensaje enviado al portal del inquilino', 'bien');
        m.cerrar();
      } catch { ev.target.disabled = false; }
    });
  }

  /* =================================================================== Pagos */

  const fp = { periodo: '', contrato: '' };

  function verPagos() {
    accion('Registrar pago', () => formPago());
    accion('Exportar CSV', () => exportarPagos(), '');

    const lista = E.pagos
      .filter((p) => (!fp.periodo || p.periodo === fp.periodo) && (!fp.contrato || p.contratoId === fp.contrato))
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    const total = lista.reduce((s, p) => s + Number(p.monto || 0), 0);
    const periodos = [...new Set(E.pagos.map((p) => p.periodo))].sort().reverse();

    $('#v-pagos').innerHTML = `
      <div class="herramientas">
        <div class="campo"><label for="p-periodo">Periodo</label><select id="p-periodo">
          <option value="">Todos</option>
          ${periodos.map((x) => `<option value="${esc(x)}" ${fp.periodo === x ? 'selected' : ''}>${esc(mesTexto(x))}</option>`).join('')}
        </select></div>
        <div class="campo ancho"><label for="p-contrato">Contrato</label><select id="p-contrato">
          <option value="">Todos</option>
          ${E.contratos.map((c) => `<option value="${esc(c.id)}" ${fp.contrato === c.id ? 'selected' : ''}>
            ${esc(c.inquilino?.nombre || '—')} · ${esc(nombreUnidad(apartamento(c.apartamentoId)))}</option>`).join('')}
        </select></div>
        <div style="margin-left:auto;padding-bottom:6px;text-align:right">
          <div class="mini tenue">${lista.length} pago${lista.length === 1 ? '' : 's'}</div>
          <div style="font-weight:680;font-size:1.2rem">${esc(dinero(total))}</div>
        </div>
      </div>

      ${lista.length ? `<div class="bloque-panel"><div class="tabla-marco"><table class="tabla">
        <thead><tr><th>Periodo</th><th>Inquilino</th><th>Unidad</th><th>Fecha</th><th>Método</th>
          <th class="num">Monto</th><th class="acciones"></th></tr></thead>
        <tbody>${lista.map((p) => {
          const c = contrato(p.contratoId);
          return `<tr>
            <td style="font-weight:600">${esc(mesTexto(p.periodo))}</td>
            <td>${esc(c?.inquilino?.nombre || '— contrato eliminado —')}</td>
            <td class="tenue">${esc(c ? nombreUnidad(apartamento(c.apartamentoId)) : '—')}</td>
            <td class="tenue">${esc(fechaTexto(p.fecha))}</td>
            <td class="tenue">${esc(p.metodo)}${p.referencia ? `<div class="mini">${esc(p.referencia)}</div>` : ''}</td>
            <td class="num" style="font-weight:620">${esc(dinero(p.monto))}</td>
            <td class="acciones">
              <button class="btn btn-sm" type="button" data-editar="${esc(p.id)}">Editar</button>
              <button class="btn btn-sm btn-peligro" type="button" data-borrar="${esc(p.id)}">✕</button>
            </td>
          </tr>`;
        }).join('')}</tbody></table></div></div>`
        : `<div class="vacio"><h3>Sin pagos en este filtro</h3><p>Registra el primer pago con el botón de arriba.</p></div>`}`;

    $('#p-periodo').addEventListener('change', (e) => { fp.periodo = e.target.value; verPagos(); });
    $('#p-contrato').addEventListener('change', (e) => { fp.contrato = e.target.value; verPagos(); });
    $$('#v-pagos [data-editar]').forEach((b) =>
      b.addEventListener('click', () => formPago(E.pagos.find((p) => p.id === b.dataset.editar))));
    $$('#v-pagos [data-borrar]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmar('¿Eliminar este pago del registro?', { titulo: 'Eliminar pago', textoOk: 'Eliminar' }))) return;
      await operar(() => api('/api/pagos/' + b.dataset.borrar, { method: 'DELETE' }), 'Pago eliminado');
    }));
  }

  function formPago(p = null, contratoPrevio = '') {
    const esNuevo = !p;
    p = p || {
      contratoId: contratoPrevio, periodo: mesISO(), monto: 0,
      fecha: hoyISO(), metodo: 'transferencia', referencia: '', notas: '',
    };
    const activos = E.contratos.filter((c) => c.estado === 'activo' || c.id === p.contratoId);

    if (!activos.length) {
      nota('Primero crea un contrato para poder registrar pagos.', 'error');
      return irA('contratos');
    }

    const m = modal({
      titulo: esNuevo ? 'Registrar pago' : 'Editar pago',
      tamano: 'sm',
      cuerpo: `<form id="f-pg" class="pila" style="gap:14px">
        <div class="campo"><label for="pg-ct">Contrato *</label><select id="pg-ct" name="contratoId" required>
          <option value="">Selecciona…</option>
          ${activos.map((c) => `<option value="${esc(c.id)}" data-canon="${c.canon}" ${p.contratoId === c.id ? 'selected' : ''}>
            ${esc(c.inquilino?.nombre || '—')} · ${esc(nombreUnidad(apartamento(c.apartamentoId)))}</option>`).join('')}
        </select></div>
        <div class="rejilla-campos">
          <div class="campo"><label for="pg-per">Periodo *</label>
            <input id="pg-per" name="periodo" type="month" required value="${esc(p.periodo)}"></div>
          <div class="campo"><label for="pg-fec">Fecha de pago</label>
            <input id="pg-fec" name="fecha" type="date" value="${esc(p.fecha)}"></div>
        </div>
        <div class="campo"><label for="pg-monto">Monto *</label>
          <input id="pg-monto" name="monto" type="number" min="0" step="1000" required value="${esc(p.monto)}">
          <span class="ayuda" id="pg-hint"></span></div>
        <div class="rejilla-campos">
          <div class="campo"><label for="pg-met">Método</label><select id="pg-met" name="metodo">
            ${['transferencia', 'efectivo', 'consignación', 'PSE', 'tarjeta', 'otro']
              .map((x) => `<option ${p.metodo === x ? 'selected' : ''}>${x}</option>`).join('')}
          </select></div>
          <div class="campo"><label for="pg-ref">Referencia</label>
            <input id="pg-ref" name="referencia" value="${esc(p.referencia)}" placeholder="N.º de comprobante"></div>
        </div>
        <div class="campo"><label for="pg-not">Notas</label>
          <input id="pg-not" name="notas" value="${esc(p.notas)}" placeholder="Pago parcial, abono, etc."></div>
      </form>`,
      pie: `<button class="btn" data-cancelar type="button">Cancelar</button>
            <button class="btn btn-primario" data-ok type="button">${esNuevo ? 'Registrar' : 'Guardar'}</button>`,
    });

    const sel = m.caja.querySelector('#pg-ct');
    const monto = m.caja.querySelector('#pg-monto');
    const hint = m.caja.querySelector('#pg-hint');

    const sugerir = () => {
      const op = sel.selectedOptions[0];
      const canon = Number(op?.dataset.canon || 0);
      if (!canon) { hint.textContent = ''; return; }
      hint.textContent = `Canon del contrato: ${dinero(canon)}`;
      if (esNuevo && (!Number(monto.value) || Number(monto.value) === 0)) monto.value = canon;
    };
    sel.addEventListener('change', sugerir);
    sugerir();

    m.caja.querySelector('[data-cancelar]').addEventListener('click', m.cerrar);
    m.caja.querySelector('[data-ok]').addEventListener('click', async (ev) => {
      const form = m.caja.querySelector('#f-pg');
      if (!form.reportValidity()) return;
      const d = Object.fromEntries(new FormData(form).entries());
      ev.target.disabled = true;
      try {
        await operar(() => guardar('pagos', d, esNuevo ? null : p.id),
          esNuevo ? 'Pago registrado' : 'Pago actualizado');
        m.cerrar();
      } catch { ev.target.disabled = false; }
    });
  }

  function exportarPagos() {
    const filas = [['Periodo', 'Fecha', 'Inquilino', 'Unidad', 'Monto', 'Método', 'Referencia', 'Notas']];
    for (const p of [...E.pagos].sort((a, b) => String(a.periodo).localeCompare(String(b.periodo)))) {
      const c = contrato(p.contratoId);
      filas.push([
        p.periodo, p.fecha, c?.inquilino?.nombre || '',
        c ? nombreUnidad(apartamento(c.apartamentoId)) : '',
        p.monto, p.metodo, p.referencia, p.notas,
      ]);
    }
    descargarCSV(`pagos-${mesISO()}.csv`, filas);
    nota('CSV descargado', 'bien');
  }

  /* ================================================================= Cartera */

  function verCartera() {
    const c = E.analitica?.cartera || [];
    accion('Registrar pago', () => formPago());

    $('#v-cartera').innerHTML = c.length ? `
      <div class="kpis">
        <div class="kpi"><div class="k">Total pendiente</div>
          <div class="v" style="color:var(--critico-ink)">${esc(dinero(c.reduce((s, x) => s + x.saldo, 0)))}</div>
          <div class="n">${c.length} inquilino${c.length === 1 ? '' : 's'} con saldo</div></div>
        <div class="kpi"><div class="k">Mes más atrasado</div>
          <div class="v" style="font-size:1.3rem">${esc(Math.max(...c.map((x) => x.mesesVencidos)))} meses</div>
          <div class="n">del inquilino con mayor mora</div></div>
      </div>
      <div class="bloque-panel">
        <header><div class="crece"><h3>Detalle de cartera</h3>
          <p class="mini tenue" style="margin:2px 0 0">Meses del contrato sin pago completo, hasta el mes en curso.</p></div></header>
        <div class="tabla-marco"><table class="tabla">
          <thead><tr><th>Inquilino</th><th>Unidad</th><th>Meses pendientes</th>
            <th class="num">Canon</th><th class="num">Saldo</th><th class="acciones"></th></tr></thead>
          <tbody>${c.map((x) => `<tr>
            <td><div style="font-weight:600">${esc(x.inquilino)}</div>
              ${x.telefono ? `<div class="mini tenue">${esc(x.telefono)}</div>` : ''}</td>
            <td class="tenue">${esc(x.unidad)}</td>
            <td><div class="meses-chips">${x.meses.map((mm) => `<span class="mes-chip">${esc(mesTexto(mm))}</span>`).join('')}</div></td>
            <td class="num">${esc(dinero(x.canon))}</td>
            <td class="num" style="color:var(--critico-ink);font-weight:660">${esc(dinero(x.saldo))}</td>
            <td class="acciones">
              ${x.telefono ? `<a class="btn btn-sm" target="_blank" rel="noopener"
                href="https://wa.me/${esc(x.telefono.replace(/\D/g, ''))}?text=${encodeURIComponent(
                  `Hola ${x.inquilino}, te escribimos por el arriendo de ${x.unidad}. Tienes un saldo pendiente de ${dinero(x.saldo)}.`)}">WhatsApp</a>` : ''}
              <button class="btn btn-sm btn-primario" type="button" data-pago="${esc(x.contratoId)}">Registrar pago</button>
            </td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>`
      : `<div class="vacio"><h3>Cartera al día 🎉</h3>
           <p>Ningún contrato activo tiene meses pendientes de pago.</p></div>`;

    $$('#v-cartera [data-pago]').forEach((b) =>
      b.addEventListener('click', () => formPago(null, b.dataset.pago)));
  }

  /* ============================================================= Solicitudes */

  const ESTADOS_SOL = ['nueva', 'contactada', 'visita', 'cerrada', 'descartada'];

  function verSolicitudes() {
    const s = E.solicitudes;
    $('#v-solicitudes').innerHTML = s.length ? `
      <div class="bloque-panel">
        <ul class="lista-simple">${s.map((x) => `
          <li>
            <div class="crece">
              <div class="fila-wrap" style="gap:8px">
                <strong>${esc(x.nombre)}</strong>
                <span class="chip ${x.estado === 'nueva' ? 'chip-reservado' : x.estado === 'cerrada' ? 'chip-disponible' : 'chip-mantenimiento'}">${esc(x.estado)}</span>
                <span class="mini tenue">${esc(fechaTexto(x.creado))}</span>
              </div>
              <div class="mini tenue" style="margin-top:3px">
                ${x.telefono ? `<a href="tel:${esc(x.telefono.replace(/\s/g, ''))}">${esc(x.telefono)}</a>` : ''}
                ${x.telefono && x.email ? ' · ' : ''}
                ${x.email ? `<a href="mailto:${esc(x.email)}">${esc(x.email)}</a>` : ''}
              </div>
              <div class="mini tenue">Interés: ${esc(x.apartamentoId ? nombreUnidad(apartamento(x.apartamentoId)) : 'sin unidad específica')}</div>
              ${x.fechaVisita ? `<div class="mini" style="margin-top:5px;color:var(--acento-ink);font-weight:600">Visita preferida: ${esc(fechaTexto(x.fechaVisita))}${x.horaVisita ? ' · ' + esc(x.horaVisita) : ''}</div>` : ''}
              ${x.mensaje ? `<p class="mini" style="margin:8px 0 0;padding:9px 12px;background:var(--superficie-2);border-radius:8px">${esc(x.mensaje)}</p>` : ''}
            </div>
            <div class="pila" style="gap:6px;align-items:flex-end">
              <select class="control" data-sol="${esc(x.id)}" style="font-size:.82rem;padding:6px 9px;width:auto">
                ${ESTADOS_SOL.map((e) => `<option value="${e}" ${x.estado === e ? 'selected' : ''}>${e}</option>`).join('')}
              </select>
              <div class="fila" style="gap:6px">
                ${x.telefono ? `<a class="btn btn-sm" target="_blank" rel="noopener"
                  href="https://wa.me/${esc(x.telefono.replace(/\D/g, ''))}">WhatsApp</a>` : ''}
                <button class="btn btn-sm btn-peligro" type="button" data-borrar="${esc(x.id)}">✕</button>
              </div>
            </div>
          </li>`).join('')}</ul>
      </div>`
      : `<div class="vacio"><h3>Sin solicitudes todavía</h3>
           <p>Las solicitudes del formulario público aparecerán aquí.</p></div>`;

    $$('#v-solicitudes [data-sol]').forEach((sel) => sel.addEventListener('change', async () => {
      await operar(() => api('/api/solicitudes/' + sel.dataset.sol, { method: 'PUT', body: { estado: sel.value } }), 'Estado actualizado');
    }));
    $$('#v-solicitudes [data-borrar]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmar('¿Eliminar esta solicitud?', { titulo: 'Eliminar', textoOk: 'Eliminar' }))) return;
      await operar(() => api('/api/solicitudes/' + b.dataset.borrar, { method: 'DELETE' }), 'Solicitud eliminada');
    }));
  }

  /* ========================================================= Agenda visitas */

  function verAgenda() {
    const pendientes = E.solicitudes
      .filter((x) => x.fechaVisita && x.horaVisita && !['cerrada', 'descartada'].includes(x.estado))
      .sort((a, b) => `${a.fechaVisita} ${a.horaVisita}`.localeCompare(`${b.fechaVisita} ${b.horaVisita}`));
    const sinHorario = E.solicitudes.filter((x) => !x.fechaVisita || !x.horaVisita)
      .filter((x) => !['cerrada', 'descartada'].includes(x.estado));

    $('#v-agenda').innerHTML = `
      <div class="aviso" style="margin-bottom:18px">Cada franja se reserva al recibir la solicitud para evitar cruces. Confirma con la persona interesada antes de marcar la visita como realizada.</div>
      ${pendientes.length ? `<div class="pila" style="gap:12px">${pendientes.map((x) => `
        <article class="bloque-panel"><div class="cuerpo fila-wrap" style="align-items:center;gap:16px">
          <div class="crece"><div class="sobrelinea">${esc(fechaTexto(x.fechaVisita))} · ${esc(x.horaVisita)}</div>
            <h3 style="margin:3px 0">${esc(x.nombre)}</h3>
            <div class="mini tenue">${esc(x.apartamentoId ? nombreUnidad(apartamento(x.apartamentoId)) : 'Interés sin unidad específica')}</div>
            <div class="mini tenue" style="margin-top:6px">${esc([x.telefono, x.email].filter(Boolean).join(' · '))}</div></div>
          <div class="pila" style="gap:7px;align-items:flex-end"><span class="chip ${x.estado === 'visita' ? 'chip-reservado' : 'chip-mantenimiento'}">${esc(x.estado)}</span>
            <button class="btn btn-sm btn-primario" type="button" data-ir-solicitud="${esc(x.id)}">Gestionar solicitud</button></div>
        </div></article>`).join('')}</div>`
        : '<div class="vacio"><h3>No hay visitas agendadas</h3><p>Las solicitudes con fecha y franja horaria aparecerán aquí.</p></div>'}
      ${sinHorario.length ? `<p class="mini tenue" style="margin-top:18px">También tienes ${sinHorario.length} solicitud${sinHorario.length === 1 ? '' : 'es'} pendiente${sinHorario.length === 1 ? '' : 's'} sin horario definido.</p>` : ''}`;
    $$('#v-agenda [data-ir-solicitud]').forEach((b) => b.addEventListener('click', () => irA('solicitudes')));
  }

  /* ============================================================== Multimedia */

  function verMedios() {
    const usos = (mid) => {
      const u = [];
      for (const a of E.apartamentos) {
        if (a.videoId === mid) u.push(`Video de ${a.numero}`);
        if (a.portadaId === mid) u.push(`Portada de ${a.numero}`);
        if ((a.fotos || []).includes(mid)) u.push(`Foto de ${a.numero}`);
      }
      for (const e of E.edificios) {
        if (e.fotoId === mid) u.push(`Foto de ${e.nombre}`);
        if (e.encargado?.fotoId === mid) u.push(`Encargado de ${e.nombre}`);
      }
      return u;
    };

    const pesoTotal = E.media.reduce((s, m) => s + (m.tamano || 0), 0);

    $('#v-medios').innerHTML = `
      <div class="bloque-panel"><div class="cuerpo">
        <div id="subir-libre"></div>
        <div class="fila-wrap mini tenue" style="margin-top:12px">
          <span>${E.media.length} archivo${E.media.length === 1 ? '' : 's'}</span>
          <span>· ${esc(pesoArchivo(pesoTotal))} ocupados</span>
          <span>· ${E.media.filter((m) => m.tipo === 'video').length} videos</span>
        </div>
      </div></div>
      ${E.media.length ? `<div class="rejilla-medios">${E.media.map((m) => {
        const u = usos(m.id);
        return `<div class="medio">
          <div class="vista-previa">
            ${m.tipo === 'video'
              ? `<video src="${urlMedia(m.id)}#t=0.6" preload="metadata" muted></video>`
              : `<img src="${urlMedia(m.id)}" alt="" loading="lazy">`}
            <span class="etq">${m.tipo === 'video' ? 'VIDEO' : 'FOTO'}</span>
          </div>
          <div class="info">
            <span class="nom" title="${esc(m.nombre)}">${esc(m.nombre)}</span>
            <span>${esc(pesoArchivo(m.tamano))} · ${esc(fechaTexto(m.creado))}</span>
            <span style="color:${u.length ? 'var(--bien-ink)' : 'var(--ink-3)'}">${u.length ? esc(u.join(', ')) : 'Sin usar'}</span>
          </div>
          <div class="acciones">
            <a class="btn btn-sm" href="${urlMedia(m.id)}" target="_blank" rel="noopener">Abrir</a>
            <button class="btn btn-sm btn-peligro" type="button" data-borrar="${esc(m.id)}" data-usos="${u.length}">Eliminar</button>
          </div>
        </div>`;
      }).join('')}</div>`
        : '<div class="vacio"><h3>Biblioteca vacía</h3><p>Sube videos o fotos aquí, o directamente desde cada unidad.</p></div>'}`;

    campoMedio($('#subir-libre'), {
      tipo: 'video', valor: null,
      alCambiar: async () => { await recargar(); verMedios(); },
    });

    $$('#v-medios [data-borrar]').forEach((b) => b.addEventListener('click', async () => {
      const n = Number(b.dataset.usos);
      const msg = n
        ? `Este archivo se está usando en ${n} lugar${n === 1 ? '' : 'es'}. Al eliminarlo, esas referencias quedarán vacías.`
        : '¿Eliminar este archivo de forma permanente?';
      if (!(await confirmar(msg, { titulo: 'Eliminar archivo', textoOk: 'Eliminar' }))) return;
      await operar(() => api('/api/media/' + b.dataset.borrar, { method: 'DELETE' }), 'Archivo eliminado');
    }));
  }

  /* ========================================================= Administradores */

  function verAdministradores() {
    if (!esPrincipal()) return irA('resumen');
    accion('Nuevo administrador', () => formAdministrador());
    const administradores = E.administradores || [];
    const nombreEdificios = (ids) => (ids || []).map((idEdificio) => edificio(idEdificio)?.nombre).filter(Boolean);

    $('#v-administradores').innerHTML = `
      <div class="bloque-panel" style="margin-bottom:18px"><div class="cuerpo">
        <strong>Control de accesos</strong>
        <p class="mini tenue" style="margin:5px 0 0">El propietario principal ve todos los edificios. Cada administrador de edificio solo puede consultar y gestionar las unidades, contratos, pagos, mensajes y solicitudes de los edificios asignados.</p>
      </div></div>
      ${administradores.length ? `<div class="bloque-panel"><ul class="lista-simple">${administradores.map((a) => {
        const esDueno = a.rol === 'principal';
        const asignados = nombreEdificios(a.edificioIds);
        return `<li>
          <div class="crece">
            <div class="fila-wrap" style="gap:8px"><strong>${esc(a.nombre || a.usuario)}</strong>
              <span class="chip ${esDueno ? 'chip-arrendado' : a.activo ? 'chip-disponible' : 'chip-mantenimiento'}">${esc(esDueno ? 'Propietario principal' : a.activo ? 'Administrador de edificio' : 'Acceso pausado')}</span>
            </div>
            <div class="mini tenue" style="margin-top:4px">Usuario: ${esc(a.usuario)}</div>
            <div class="mini" style="margin-top:5px">${esDueno ? 'Acceso total a todos los edificios.' : `Edificios: <strong>${esc(asignados.join(' · ') || 'Sin asignación')}</strong>`}</div>
          </div>
          ${esDueno ? '<span class="mini tenue">Se administra desde Ajustes → Seguridad.</span>' : `<div class="fila" style="gap:6px">
            <button class="btn btn-sm" type="button" data-editar-admin="${esc(a.id)}">Editar</button>
            <button class="btn btn-sm btn-peligro" type="button" data-borrar-admin="${esc(a.id)}">Eliminar</button>
          </div>`}
        </li>`;
      }).join('')}</ul></div>` : '<div class="vacio"><h3>Sin administradores registrados</h3></div>'}`;

    $$('#v-administradores [data-editar-admin]').forEach((b) =>
      b.addEventListener('click', () => formAdministrador((E.administradores || []).find((a) => a.id === b.dataset.editarAdmin))));
    $$('#v-administradores [data-borrar-admin]').forEach((b) => b.addEventListener('click', async () => {
      const a = (E.administradores || []).find((x) => x.id === b.dataset.borrarAdmin);
      if (!a || !(await confirmar(`Se eliminará el acceso de ${a.nombre || a.usuario}. Esta persona ya no podrá entrar al panel.`,
        { titulo: 'Eliminar administrador', textoOk: 'Eliminar' }))) return;
      await operar(() => api('/api/administradores/' + a.id, { method: 'DELETE' }), 'Administrador eliminado');
    }));
  }

  function formAdministrador(a = null) {
    if (!esPrincipal()) return;
    const esNuevo = !a;
    a = a || { nombre: '', usuario: '', edificioIds: [], activo: true };
    if (!E.edificios.length) {
      nota('Crea un edificio antes de asignar un administrador.', 'error');
      return irA('edificios');
    }
    const asignados = new Set(a.edificioIds || []);
    const m = modal({
      titulo: esNuevo ? 'Nuevo administrador de edificio' : `Editar acceso · ${a.nombre || a.usuario}`,
      tamano: 'md',
      cuerpo: `<form id="f-administrador" class="pila" style="gap:14px">
        <div class="rejilla-campos">
          <div class="campo"><label for="ad-nombre">Nombre completo *</label>
            <input id="ad-nombre" name="nombre" required maxlength="120" value="${esc(a.nombre || '')}" autocomplete="name"></div>
          <div class="campo"><label for="ad-usuario">Usuario *</label>
            <input id="ad-usuario" name="usuario" required pattern="[A-Za-z0-9._-]{3,40}" maxlength="40" value="${esc(a.usuario || '')}" autocomplete="username">
            <span class="ayuda">Mínimo 3 caracteres; sin espacios.</span></div>
        </div>
        <div class="campo"><label for="ad-clave">${esNuevo ? 'Contraseña inicial *' : 'Nueva contraseña (opcional)'}</label>
          <input id="ad-clave" name="clave" type="password" ${esNuevo ? 'required minlength="6"' : 'minlength="6"'} autocomplete="new-password">
          <span class="ayuda">${esNuevo ? 'Mínimo 6 caracteres. Comunícala de forma segura.' : 'Déjala vacía para conservar la actual.'}</span></div>
        <fieldset class="campo" style="border:0;padding:0;margin:0"><legend style="font-size:.84rem;font-weight:620;margin-bottom:8px">Edificios asignados *</legend>
          <div class="pila" style="gap:8px">${E.edificios.map((e) => `<label class="check"><input type="checkbox" name="edificioIds" value="${esc(e.id)}" ${asignados.has(e.id) ? 'checked' : ''}> ${esc(e.nombre)} <span class="mini tenue">· ${esc(e.ciudad || e.direccion || '')}</span></label>`).join('')}</div>
        </fieldset>
        ${esNuevo ? '' : `<label class="check"><input type="checkbox" name="activo" ${a.activo !== false ? 'checked' : ''}> Permitir iniciar sesión</label>`}
      </form>`,
      pie: `<button class="btn" type="button" data-cancelar>Cancelar</button>
            <button class="btn btn-primario" type="button" data-guardar>${esNuevo ? 'Crear acceso' : 'Guardar cambios'}</button>`,
    });
    m.caja.querySelector('[data-cancelar]').addEventListener('click', m.cerrar);
    m.caja.querySelector('[data-guardar]').addEventListener('click', async (ev) => {
      const form = m.caja.querySelector('#f-administrador');
      if (!form.reportValidity()) return;
      const d = Object.fromEntries(new FormData(form).entries());
      d.edificioIds = new FormData(form).getAll('edificioIds');
      d.activo = esNuevo || form.querySelector('[name=activo]').checked;
      if (!d.edificioIds.length) { nota('Selecciona al menos un edificio.', 'error'); return; }
      ev.target.disabled = true;
      try {
        await operar(() => api(`/api/administradores${esNuevo ? '' : '/' + a.id}`, {
          method: esNuevo ? 'POST' : 'PUT', body: d,
        }), esNuevo ? 'Administrador creado' : 'Administrador actualizado');
        m.cerrar();
      } catch { ev.target.disabled = false; }
    });
  }

  /* ================================================================= Actividad */

  function verActividad() {
    if (!esPrincipal()) return irA('resumen');
    const eventos = E.auditoria || [];
    $('#v-actividad').innerHTML = eventos.length ? `
      <div class="bloque-panel"><header><div class="crece"><h3>Bitácora de operaciones</h3>
        <p class="mini tenue" style="margin:2px 0 0">Se conservan hasta 500 acciones. No se registran contraseñas ni el contenido de mensajes.</p></div></header>
        <ul class="lista-simple">${eventos.map((x) => {
          const edificioNombre = x.edificioId ? edificio(x.edificioId)?.nombre : '';
          return `<li><div class="crece"><strong>${esc(x.accion)}</strong>
            ${x.detalle ? `<div class="mini tenue" style="margin-top:4px">${esc(x.detalle)}</div>` : ''}
            <div class="mini tenue" style="margin-top:5px">${esc(x.actor || 'Sistema')} · ${esc(fechaTexto(x.creado))}${edificioNombre ? ' · ' + esc(edificioNombre) : ''}</div>
          </div><span class="chip ${x.rol === 'principal' ? 'chip-arrendado' : x.rol === 'edificio' ? 'chip-reservado' : 'chip-mantenimiento'}">${esc(x.rol === 'principal' ? 'Propietario' : x.rol === 'edificio' ? 'Administrador' : 'Sistema')}</span></li>`;
        }).join('')}</ul></div>`
      : '<div class="vacio"><h3>Aún no hay actividad registrada</h3><p>Las acciones administrativas y solicitudes nuevas aparecerán aquí.</p></div>';
  }

  /* ================================================================= Ajustes */

  function verAjustes() {
    const c = E.config;
    $('#v-ajustes').innerHTML = `
      <div class="dos-col">
        ${esPrincipal() ? `
        <div class="bloque-panel">
          <header><div class="crece"><h3>Datos del sitio</h3>
            <p class="mini tenue" style="margin:2px 0 0">Aparecen en el encabezado, el pie y la sección de contacto.</p></div></header>
          <div class="cuerpo">
            <form id="f-cfg" class="pila" style="gap:14px">
              <div class="campo"><label for="cf-nom">Nombre del sitio</label>
                <input id="cf-nom" name="nombreSitio" value="${esc(c.nombreSitio)}"></div>
              <div class="campo"><label for="cf-lema">Lema</label>
                <textarea id="cf-lema" name="lema" rows="2">${esc(c.lema)}</textarea></div>
              <div class="rejilla-campos">
                <div class="campo"><label for="cf-tel">Teléfono</label>
                  <input id="cf-tel" name="telefono" value="${esc(c.telefono)}"></div>
                <div class="campo"><label for="cf-wa">WhatsApp (dígitos)</label>
                  <input id="cf-wa" name="whatsapp" value="${esc(c.whatsapp)}"></div>
              </div>
              <div class="campo"><label for="cf-mail">Correo</label>
                <input id="cf-mail" name="email" type="email" value="${esc(c.email)}"></div>
              <div class="rejilla-campos">
                <div class="campo"><label for="cf-mon">Moneda (ISO)</label>
                  <input id="cf-mon" name="moneda" value="${esc(c.moneda)}" placeholder="COP"></div>
                <div class="campo"><label for="cf-loc">Formato regional</label>
                  <input id="cf-loc" name="localeMoneda" value="${esc(c.localeMoneda)}" placeholder="es-CO"></div>
              </div>
              <button class="btn btn-primario" type="submit">Guardar datos</button>
            </form>
          </div>
        </div>` : `<div class="bloque-panel">
          <header><div class="crece"><h3>Datos del sitio</h3>
            <p class="mini tenue" style="margin:2px 0 0">Solo el propietario principal puede cambiar la información pública y la configuración global.</p></div></header>
          <div class="cuerpo"><div class="aviso aviso-ojo">Tu acceso está limitado a los edificios que te fueron asignados.</div></div>
        </div>`}

        <div class="pila" style="gap:20px">
          <div class="bloque-panel" style="margin:0">
            <header><div class="crece"><h3>Seguridad</h3>
              <p class="mini tenue" style="margin:2px 0 0">Credenciales de acceso al panel.</p></div></header>
            <div class="cuerpo">
              ${E.sesion?.claveInicial ? '<div class="aviso aviso-ojo" style="margin-bottom:14px">Sigues usando la contraseña inicial <strong>admin123</strong>. Cámbiala ahora.</div>' : ''}
              <form id="f-clave" class="pila" style="gap:14px">
                <div class="campo"><label for="cl-user">Usuario</label>
                  <input id="cl-user" name="usuario" value="${esc(E.sesion?.usuario || '')}" autocomplete="username"></div>
                <div class="campo"><label for="cl-act">Contraseña actual</label>
                  <input id="cl-act" name="actual" type="password" required autocomplete="current-password"></div>
                <div class="campo"><label for="cl-nue">Nueva contraseña</label>
                  <input id="cl-nue" name="nueva" type="password" required minlength="6" autocomplete="new-password">
                  <span class="ayuda">Mínimo 6 caracteres.</span></div>
                <div id="cl-aviso"></div>
                <button class="btn btn-primario" type="submit">Actualizar credenciales</button>
              </form>
            </div>
          </div>

          <div class="bloque-panel" style="margin:0">
            <header><div class="crece"><h3>Datos y respaldo</h3></div></header>
            <div class="cuerpo pila" style="gap:12px">
              <p class="tenue mini" style="margin:0">
                Todo se guarda en <code>datos/db.json</code> y los archivos en <code>datos/subidas/</code>.
                Copia esa carpeta para tener un respaldo completo.
              </p>
              <div class="fila-wrap">
                <button class="btn" type="button" id="exp-contratos">Exportar contratos (CSV)</button>
                <button class="btn" type="button" id="exp-unidades">Exportar unidades (CSV)</button>
              </div>
            </div>
          </div>
        </div>
      </div>`;

    const formConfig = $('#f-cfg');
    if (formConfig) formConfig.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const d = Object.fromEntries(new FormData(ev.target).entries());
      await operar(() => api('/api/config', { method: 'PUT', body: d }), 'Datos del sitio guardados');
    });

    $('#f-clave').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const aviso = $('#cl-aviso');
      const d = Object.fromEntries(new FormData(ev.target).entries());
      try {
        await api('/api/auth/clave', { method: 'POST', body: d });
        aviso.innerHTML = '<div class="aviso aviso-bien">Credenciales actualizadas.</div>';
        ev.target.actual.value = '';
        ev.target.nueva.value = '';
        await recargar();
        nota('Contraseña actualizada', 'bien');
      } catch (e) {
        aviso.innerHTML = `<div class="aviso aviso-error">${esc(e.message)}</div>`;
      }
    });

    $('#exp-contratos').addEventListener('click', () => {
      const filas = [['Unidad', 'Inquilino', 'Documento', 'Teléfono', 'Correo', 'Canon', 'Depósito', 'Inicio', 'Fin', 'Estado']];
      for (const c2 of E.contratos) {
        filas.push([
          nombreUnidad(apartamento(c2.apartamentoId)), c2.inquilino?.nombre, c2.inquilino?.documento,
          c2.inquilino?.telefono, c2.inquilino?.email, c2.canon, c2.deposito, c2.inicio, c2.fin, c2.estado,
        ]);
      }
      descargarCSV('contratos.csv', filas);
    });

    $('#exp-unidades').addEventListener('click', () => {
      const filas = [['Edificio', 'Número', 'Título', 'Estado', 'Canon', 'Administración', 'Área', 'Alcobas', 'Baños', 'Con video']];
      for (const a of E.apartamentos) {
        filas.push([
          edificio(a.edificioId)?.nombre || '', a.numero, a.titulo, ESTADOS[a.estado],
          a.precio, a.administracion, a.area, a.habitaciones, a.banos, a.videoId ? 'sí' : 'no',
        ]);
      }
      descargarCSV('unidades.csv', filas);
    });
  }

  /* ================================================================ Arranque */

  window.addEventListener('hashchange', () => {
    const v = location.hash.slice(1);
    if (VISTAS[v] && v !== vistaActual) irA(v);
  });

  arrancar();
})();
