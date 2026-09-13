/* ==========================================================================
   Sitio público: catálogo, mapa y solicitudes.
   ========================================================================== */

(() => {
  const { $, $$, esc, el, dinero, numero, api, urlMedia, nota, modal, iniciales, ESTADOS } = App;

  let datos = { config: {}, edificios: [], apartamentos: [] };
  let mapa = null;
  let marcadores = new Map();
  let edificioActivo = null;

  const edificioDe = (apt) => datos.edificios.find((e) => e.id === apt.edificioId) || null;

  /* ---------------------------------------------------------------- Arranque */

  async function iniciar() {
    App.iniciarTema($('#btn-tema'));
    try {
      datos = await api('/api/publico');
    } catch (e) {
      $('#rejilla-aptos').innerHTML =
        `<div class="vacio"><h3>No pudimos cargar el catálogo</h3><p>${esc(e.message)}</p></div>`;
      return;
    }
    App.configurarMoneda(datos.config.moneda, datos.config.localeMoneda);
    pintarIdentidad();
    pintarHero();
    prepararFiltros();
    pintarRejilla();
    pintarEdificios();
    pintarContacto();
    iniciarMapa();
    conectarFormulario();

    // Enlace profundo: /#apto-<id>
    const h = location.hash;
    if (h.startsWith('#apto-')) {
      const a = datos.apartamentos.find((x) => x.id === h.slice(6));
      if (a) setTimeout(() => abrirDetalle(a), 200);
    }
  }

  function pintarIdentidad() {
    const c = datos.config;
    if (c.nombreSitio) {
      $('#marca-nombre').textContent = c.nombreSitio;
      $('#pie-nombre').textContent = `© ${new Date().getFullYear()} ${c.nombreSitio}`;
      document.title = `${c.nombreSitio} · Apartaestudios en arriendo`;
    }
    if (c.lema) $('#lema-hero').textContent = c.lema;
    $('#pie-contacto').textContent = [c.telefono, c.email].filter(Boolean).join('  ·  ');
  }

  function pintarHero() {
    const disp = datos.apartamentos.filter((a) => a.estado === 'disponible');
    const precios = disp.map((a) => a.precio).filter((p) => p > 0);
    const conVideo = datos.apartamentos.filter((a) => a.videoId).length;
    $('#pildora-texto').textContent = disp.length
      ? `${disp.length} ${disp.length === 1 ? 'unidad disponible' : 'unidades disponibles'} ahora`
      : 'Sin unidades disponibles por ahora';

    const stats = [
      { v: numero(disp.length), k: 'Disponibles' },
      { v: numero(datos.edificios.length), k: datos.edificios.length === 1 ? 'Edificio' : 'Edificios' },
      precios.length ? { v: dinero(Math.min(...precios)), k: 'Desde' } : null,
      conVideo
        ? { v: numero(conVideo), k: 'Con video' }
        : { v: numero(datos.apartamentos.length), k: 'Unidades en total' },
    ].filter(Boolean);

    $('#hero-stats').innerHTML = stats
      .map((s) => `<div class="st"><strong>${esc(s.v)}</strong><span>${esc(s.k)}</span></div>`)
      .join('');
  }

  /* ----------------------------------------------------------------- Filtros */

  const filtros = { texto: '', edificio: '', estado: 'disponible', precio: '', orden: 'recientes' };

  function prepararFiltros() {
    $('#f-edificio').innerHTML =
      '<option value="">Todos los edificios</option>' +
      datos.edificios.map((e) => `<option value="${esc(e.id)}">${esc(e.nombre)}</option>`).join('');

    const precios = datos.apartamentos.map((a) => a.precio).filter((p) => p > 0).sort((a, b) => a - b);
    if (precios.length) {
      const max = precios[precios.length - 1];
      const paso = Math.max(100000, Math.ceil(max / 5 / 100000) * 100000);
      const cortes = [];
      for (let v = paso; v < max + paso; v += paso) cortes.push(v);
      $('#f-precio').innerHTML =
        '<option value="">Sin límite</option>' +
        cortes.map((v) => `<option value="${v}">Hasta ${esc(dinero(v, true))}</option>`).join('');
    }

    const conectar = (sel, campo, inmediato) => {
      const n = $(sel);
      const aplicar = () => { filtros[campo] = n.value; pintarRejilla(); };
      n.addEventListener('change', aplicar);
      if (inmediato) n.addEventListener('input', App.rebote(aplicar, 200));
    };
    conectar('#f-texto', 'texto', true);
    conectar('#f-edificio', 'edificio');
    conectar('#f-estado', 'estado');
    conectar('#f-precio', 'precio');
    conectar('#f-orden', 'orden');
  }

  function filtrar() {
    const t = filtros.texto.trim().toLowerCase();
    let out = datos.apartamentos.filter((a) => {
      if (filtros.estado && a.estado !== filtros.estado) return false;
      if (filtros.edificio && a.edificioId !== filtros.edificio) return false;
      if (filtros.precio && a.precio > Number(filtros.precio)) return false;
      if (t) {
        const ed = edificioDe(a);
        const bolsa = [a.numero, a.titulo, a.descripcion, ed?.nombre, ed?.direccion, ed?.ciudad, (a.caracteristicas || []).join(' ')]
          .join(' ').toLowerCase();
        if (!bolsa.includes(t)) return false;
      }
      return true;
    });

    const ord = {
      'precio-asc': (a, b) => a.precio - b.precio,
      'precio-desc': (a, b) => b.precio - a.precio,
      'area-desc': (a, b) => b.area - a.area,
      recientes: (a, b) => String(b.creado || '').localeCompare(String(a.creado || '')),
    }[filtros.orden];
    out.sort(ord);
    // Los destacados disponibles suben primero
    out.sort((a, b) => (b.destacado && b.estado === 'disponible' ? 1 : 0) - (a.destacado && a.estado === 'disponible' ? 1 : 0));
    return out;
  }

  /* -------------------------------------------------------- Rejilla de aptos */

  function pintarRejilla() {
    const lista = filtrar();
    const cont = $('#rejilla-aptos');
    $('#f-resultado').textContent = `${lista.length} ${lista.length === 1 ? 'resultado' : 'resultados'}`;

    if (!lista.length) {
      cont.className = '';
      cont.innerHTML = `<div class="vacio">
        <h3>Nada coincide con esa búsqueda</h3>
        <p>Prueba ampliando el estado a "Todos" o quitando el límite de precio.</p>
      </div>`;
      return;
    }

    cont.className = 'rejilla';
    cont.innerHTML = lista.map(tarjetaApto).join('');

    $$('.apto-media', cont).forEach((n) => {
      const apt = lista.find((a) => a.id === n.dataset.id);
      n.addEventListener('click', () => abrirDetalle(apt));
      const v = n.querySelector('video');
      if (v) {
        v.addEventListener('loadedmetadata', () => {
          const d = n.querySelector('.dur');
          if (d && v.duration) d.textContent = App.duracion(v.duration);
        });
      }
    });
    $$('[data-abrir]', cont).forEach((n) => {
      n.addEventListener('click', () => abrirDetalle(lista.find((a) => a.id === n.dataset.abrir)));
    });
  }

  function tarjetaApto(a) {
    const ed = edificioDe(a);
    const media = a.videoId
      ? `<video src="${urlMedia(a.videoId)}#t=0.6" preload="metadata" muted playsinline
                ${a.portadaId ? `poster="${urlMedia(a.portadaId)}"` : ''}></video>
         <div class="play"><i>▶</i></div><span class="dur"></span>`
      : a.portadaId
        ? `<img src="${urlMedia(a.portadaId)}" alt="Foto de ${esc(a.titulo || a.numero)}" loading="lazy">
           <div class="play"><i>▦</i></div>`
        : `<div class="sin-video"><span style="font-size:22px">🎬</span><span>Video en preparación</span></div>`;

    const specs = [
      a.area ? `<span>◱ ${numero(a.area)} m²</span>` : '',
      `<span>⌂ ${numero(a.habitaciones)} ${a.habitaciones === 1 ? 'alcoba' : 'alcobas'}</span>`,
      `<span>⚲ ${numero(a.banos)} ${a.banos === 1 ? 'baño' : 'baños'}</span>`,
      a.amoblado ? '<span>✦ Amoblado</span>' : '',
    ].filter(Boolean).join('');

    return `
    <article class="apto">
      <div class="apto-media" data-id="${esc(a.id)}" role="button" tabindex="0"
           aria-label="Ver detalle de ${esc(a.titulo || 'la unidad ' + a.numero)}">
        ${media}
        <div class="cinta">
          <span class="chip chip-${esc(a.estado)}">${esc(ESTADOS[a.estado] || a.estado)}</span>
          ${a.destacado && a.estado === 'disponible' ? '<span class="chip sin-punto">★ Destacado</span>' : ''}
        </div>
      </div>
      <div class="apto-cuerpo">
        <span class="edificio">${esc(ed ? ed.nombre : 'Sin edificio')}${ed?.ciudad ? ' · ' + esc(ed.ciudad) : ''}</span>
        <h3>${esc(a.titulo || `Apartaestudio ${a.numero}`)}</h3>
        <div class="apto-precio">
          <span class="valor">${esc(dinero(a.precio))}</span>
          <span class="mes">/ mes</span>
          ${a.administracion ? `<span class="mes">+ ${esc(dinero(a.administracion))} admin.</span>` : ''}
        </div>
        <div class="apto-specs">${specs}</div>
        <button class="btn btn-sm btn-bloque" data-abrir="${esc(a.id)}" type="button" style="margin-top:4px">
          Ver video y detalles
        </button>
      </div>
    </article>`;
  }

  /* --------------------------------------------------------- Detalle (modal) */

  function abrirDetalle(a) {
    if (!a) return;
    const ed = edificioDe(a);
    const enc = ed?.encargado || {};
    const total = (a.precio || 0) + (a.administracion || 0);

    const specs = [
      a.area ? { k: 'Área', v: numero(a.area) + ' m²' } : null,
      { k: 'Alcobas', v: numero(a.habitaciones) },
      { k: 'Baños', v: numero(a.banos) },
      a.piso ? { k: 'Piso', v: numero(a.piso) } : null,
      { k: 'Amoblado', v: a.amoblado ? 'Sí' : 'No' },
    ].filter(Boolean);

    const cuerpo = `
      <div class="detalle">
        <div>
          <div class="detalle-video">
            ${a.videoId
              ? `<video src="${urlMedia(a.videoId)}" controls preload="metadata" playsinline
                        ${a.portadaId ? `poster="${urlMedia(a.portadaId)}"` : ''}></video>`
              : `<div class="sin-video" style="position:static;height:100%">
                   <span style="font-size:26px">🎬</span>
                   <span>Este apartaestudio todavía no tiene video publicado</span>
                 </div>`}
          </div>
          ${(a.fotos || []).length ? `<div class="galeria">${a.fotos.map((f) =>
            `<img src="${urlMedia(f)}" alt="Foto adicional" data-foto="${esc(f)}" loading="lazy">`).join('')}</div>` : ''}

          <div class="specs-rejilla">
            ${specs.map((s) => `<div class="spec"><div class="k">${esc(s.k)}</div><div class="v">${esc(s.v)}</div></div>`).join('')}
          </div>

          ${a.descripcion ? `<div class="bloque"><h4>Sobre la unidad</h4><p class="tenue">${esc(a.descripcion)}</p></div>` : ''}

          ${(a.caracteristicas || []).length ? `<div class="bloque"><h4>Incluye</h4>
            <div class="etiquetas">${a.caracteristicas.map((c) => `<span class="etiqueta">${esc(c)}</span>`).join('')}</div>
          </div>` : ''}

          ${(ed?.amenidades || []).length ? `<div class="bloque"><h4>Zonas comunes del edificio</h4>
            <div class="etiquetas">${ed.amenidades.map((c) => `<span class="etiqueta">${esc(c)}</span>`).join('')}</div>
          </div>` : ''}
        </div>

        <aside>
          <div class="precio-caja">
            <div class="fila" style="margin-bottom:10px">
              <span class="chip chip-${esc(a.estado)}">${esc(ESTADOS[a.estado] || a.estado)}</span>
            </div>
            <div class="grande">${esc(dinero(a.precio))}</div>
            <div class="sub">canon mensual</div>
            <div class="desglose">
              <div><span class="tenue">Canon</span><span class="tab-num">${esc(dinero(a.precio))}</span></div>
              <div><span class="tenue">Administración</span><span class="tab-num">${esc(a.administracion ? dinero(a.administracion) : 'Incluida')}</span></div>
              ${a.deposito ? `<div><span class="tenue">Depósito</span><span class="tab-num">${esc(dinero(a.deposito))}</span></div>` : ''}
              <div class="tot"><span>Mensual total</span><span class="tab-num">${esc(dinero(total))}</span></div>
            </div>
          </div>

          ${ed ? `
          <div class="bloque">
            <h4>Edificio</h4>
            <div style="font-weight:620">${esc(ed.nombre)}</div>
            <div class="tenue mini" style="margin-top:2px">${esc(ed.direccion)}${ed.ciudad ? ' · ' + esc(ed.ciudad) : ''}</div>
            ${ed.lat && ed.lng ? `<div class="mini-mapa" id="mini-mapa" style="margin-top:12px"></div>
              <a class="btn btn-sm btn-bloque" style="margin-top:8px"
                 href="https://www.google.com/maps/dir/?api=1&destination=${ed.lat},${ed.lng}"
                 target="_blank" rel="noopener">Cómo llegar ↗</a>` : ''}
          </div>` : ''}

          ${enc.nombre ? `
          <div class="bloque">
            <h4>Encargado del edificio</h4>
            <div class="encargado">
              ${enc.fotoId
                ? `<img class="avatar" src="${urlMedia(enc.fotoId)}" alt="">`
                : `<div class="avatar">${esc(iniciales(enc.nombre))}</div>`}
              <div class="datos">
                <div class="rol">${esc(enc.cargo || 'Encargado')}</div>
                <div class="nombre">${esc(enc.nombre)}</div>
                ${enc.telefono ? `<div class="linea">☏ <a href="tel:${esc(enc.telefono.replace(/\s/g, ''))}">${esc(enc.telefono)}</a></div>` : ''}
                ${enc.email ? `<div class="linea">✉ <a href="mailto:${esc(enc.email)}">${esc(enc.email)}</a></div>` : ''}
                ${enc.horario ? `<div class="linea">◷ <span>${esc(enc.horario)}</span></div>` : ''}
                <div class="acciones">
                  ${enc.whatsapp ? `<a class="btn btn-sm btn-primario" target="_blank" rel="noopener"
                     href="https://wa.me/${esc(enc.whatsapp)}?text=${encodeURIComponent(
                       `Hola ${enc.nombre}, me interesa el apartaestudio ${a.numero} de ${ed?.nombre || ''}.`)}">WhatsApp</a>` : ''}
                  <button class="btn btn-sm" type="button" data-interes>Solicitar visita</button>
                </div>
              </div>
            </div>
          </div>` : `<div class="bloque"><button class="btn btn-primario btn-bloque" type="button" data-interes>Solicitar visita</button></div>`}
        </aside>
      </div>`;

    const m = modal({
      titulo: a.titulo || `Apartaestudio ${a.numero}`,
      tamano: 'lg',
      cuerpo,
      alCerrar: () => { if (location.hash) history.replaceState(null, '', location.pathname); },
    });

    history.replaceState(null, '', '#apto-' + a.id);

    // Mini mapa del edificio
    if (ed?.lat && ed?.lng && window.L) {
      setTimeout(() => {
        const n = m.caja.querySelector('#mini-mapa');
        if (!n) return;
        const mm = L.map(n, { zoomControl: false, scrollWheelZoom: false, attributionControl: false })
          .setView([ed.lat, ed.lng], 15);
        capaBase().addTo(mm);
        L.marker([ed.lat, ed.lng], { icon: iconoMarcador() }).addTo(mm);
        setTimeout(() => mm.invalidateSize(), 80);
      }, 60);
    }

    // Galería: cambiar el video por la foto elegida
    m.caja.querySelectorAll('[data-foto]').forEach((img) => {
      img.addEventListener('click', () => {
        const marco = m.caja.querySelector('.detalle-video');
        marco.innerHTML = `<img src="${urlMedia(img.dataset.foto)}" alt="" style="width:100%;height:100%;object-fit:contain">`;
      });
    });

    m.caja.querySelectorAll('[data-interes]').forEach((b) =>
      b.addEventListener('click', () => { m.cerrar(); irAContacto(a.id); }));
  }

  function irAContacto(aptoId) {
    const sel = $('#c-apto');
    if (sel && aptoId) sel.value = aptoId;
    $('#contacto').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => $('#c-nombre').focus(), 500);
  }

  /* -------------------------------------------------------------------- Mapa */

  const capaBase = () =>
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    });

  const iconoMarcador = (texto = '◈') =>
    L.divIcon({
      className: '',
      html: `<div class="marcador"><span>${esc(texto)}</span></div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 30],
      popupAnchor: [0, -28],
    });

  function iniciarMapa() {
    pintarListaEdificios();
    const nodo = $('#mapa');
    const conCoords = datos.edificios.filter((e) => e.lat && e.lng);

    if (!window.L) {
      nodo.innerHTML = `<div class="mapa-caida">
        <div><strong>El mapa no cargó.</strong><br>Requiere conexión a internet para las imágenes del mapa.<br>
        Las direcciones siguen disponibles en la lista.</div></div>`;
      return;
    }
    if (!conCoords.length) {
      nodo.innerHTML = `<div class="mapa-caida">
        <div><strong>Sin coordenadas registradas.</strong><br>
        Agrégalas desde el panel de administración para ver los edificios en el mapa.</div></div>`;
      return;
    }

    nodo.innerHTML = '';
    mapa = L.map(nodo, { scrollWheelZoom: false });
    capaBase().addTo(mapa);

    for (const e of conCoords) {
      const unidades = datos.apartamentos.filter((a) => a.edificioId === e.id);
      const disp = unidades.filter((a) => a.estado === 'disponible').length;
      const mk = L.marker([e.lat, e.lng], { icon: iconoMarcador(String(disp || '·')) })
        .addTo(mapa)
        .bindPopup(`<strong>${esc(e.nombre)}</strong>${esc(e.direccion)}<br>
          <span style="color:#52514e">${disp} disponible${disp === 1 ? '' : 's'} de ${unidades.length}</span>`);
      mk.on('click', () => resaltarEdificio(e.id, false));
      marcadores.set(e.id, mk);
    }

    mapa.fitBounds(L.latLngBounds(conCoords.map((e) => [e.lat, e.lng])).pad(0.3));
    if (conCoords.length === 1) mapa.setZoom(15);
    setTimeout(() => mapa.invalidateSize(), 120);
  }

  function pintarListaEdificios() {
    $('#lista-edificios').innerHTML = datos.edificios.map((e) => {
      const us = datos.apartamentos.filter((a) => a.edificioId === e.id);
      const disp = us.filter((a) => a.estado === 'disponible');
      const desde = disp.length ? Math.min(...disp.map((a) => a.precio).filter(Boolean)) : null;
      return `<button class="ed-item" data-ed="${esc(e.id)}" type="button">
        <h3>${esc(e.nombre)}</h3>
        <div class="dir">${esc(e.direccion)}${e.ciudad ? ' · ' + esc(e.ciudad) : ''}</div>
        <div class="meta">
          <span>${disp.length} de ${us.length} disponible${disp.length === 1 ? '' : 's'}</span>
          ${desde ? `<span>desde ${esc(dinero(desde, true))}</span>` : ''}
          ${e.encargado?.nombre ? `<span>${esc(e.encargado.nombre)}</span>` : ''}
        </div>
      </button>`;
    }).join('') || '<div class="vacio">Aún no hay edificios registrados.</div>';

    $$('#lista-edificios .ed-item').forEach((b) =>
      b.addEventListener('click', () => resaltarEdificio(b.dataset.ed, true)));
  }

  function resaltarEdificio(edId, moverMapa) {
    edificioActivo = edificioActivo === edId && moverMapa ? null : edId;
    $$('#lista-edificios .ed-item').forEach((b) =>
      b.classList.toggle('activo', b.dataset.ed === edificioActivo));

    const e = datos.edificios.find((x) => x.id === edId);
    if (moverMapa && mapa && e?.lat && e?.lng) {
      mapa.flyTo([e.lat, e.lng], 16, { duration: 0.7 });
      marcadores.get(edId)?.openPopup();
    }
    // Filtra la rejilla por ese edificio
    $('#f-edificio').value = edificioActivo || '';
    filtros.edificio = edificioActivo || '';
    pintarRejilla();
  }

  /* --------------------------------------------------------------- Edificios */

  function pintarEdificios() {
    $('#rejilla-edificios').innerHTML = datos.edificios.map((e) => {
      const enc = e.encargado || {};
      const us = datos.apartamentos.filter((a) => a.edificioId === e.id);
      const disp = us.filter((a) => a.estado === 'disponible').length;
      return `<article class="tarjeta ed-tarjeta">
        <div class="top">
          ${e.fotoId ? `<img class="foto" src="${urlMedia(e.fotoId)}" alt="" loading="lazy">` : ''}
          <div class="crece">
            <h3>${esc(e.nombre)}</h3>
            <div class="tenue mini" style="margin-top:3px">${esc(e.direccion)}${e.ciudad ? ' · ' + esc(e.ciudad) : ''}</div>
          </div>
          <span class="chip ${disp ? 'chip-disponible' : 'chip-mantenimiento'}">${disp} libre${disp === 1 ? '' : 's'}</span>
        </div>
        ${e.descripcion ? `<p class="tenue" style="font-size:.9rem">${esc(e.descripcion)}</p>` : ''}
        ${(e.amenidades || []).length
          ? `<div class="etiquetas">${e.amenidades.map((a) => `<span class="etiqueta">${esc(a)}</span>`).join('')}</div>` : ''}
        ${enc.nombre ? `
        <div class="encargado">
          ${enc.fotoId ? `<img class="avatar" src="${urlMedia(enc.fotoId)}" alt="">`
                       : `<div class="avatar">${esc(iniciales(enc.nombre))}</div>`}
          <div class="datos">
            <div class="rol">${esc(enc.cargo || 'Encargado')}</div>
            <div class="nombre">${esc(enc.nombre)}</div>
            ${enc.telefono ? `<div class="linea">☏ <a href="tel:${esc(enc.telefono.replace(/\s/g, ''))}">${esc(enc.telefono)}</a></div>` : ''}
            ${enc.email ? `<div class="linea">✉ <a href="mailto:${esc(enc.email)}">${esc(enc.email)}</a></div>` : ''}
            ${enc.horario ? `<div class="linea">◷ <span>${esc(enc.horario)}</span></div>` : ''}
            ${enc.whatsapp ? `<div class="acciones">
              <a class="btn btn-sm btn-primario" target="_blank" rel="noopener"
                 href="https://wa.me/${esc(enc.whatsapp)}">Escribir por WhatsApp</a>
              <button class="btn btn-sm" type="button" data-ver-ed="${esc(e.id)}">Ver unidades</button>
            </div>` : ''}
          </div>
        </div>` : ''}
      </article>`;
    }).join('') || '<div class="vacio">Aún no hay edificios registrados.</div>';

    $$('[data-ver-ed]').forEach((b) => b.addEventListener('click', () => {
      $('#f-edificio').value = b.dataset.verEd;
      filtros.edificio = b.dataset.verEd;
      filtros.estado = 'disponible';
      $('#f-estado').value = 'disponible';
      pintarRejilla();
      $('#disponibles').scrollIntoView({ behavior: 'smooth' });
    }));
  }

  /* ---------------------------------------------------------------- Contacto */

  function pintarContacto() {
    const c = datos.config;
    const filas = [
      c.telefono ? { i: '☏', t: c.telefono, h: 'tel:' + c.telefono.replace(/\s/g, '') } : null,
      c.email ? { i: '✉', t: c.email, h: 'mailto:' + c.email } : null,
      c.whatsapp ? { i: '◉', t: 'WhatsApp ' + c.telefono, h: 'https://wa.me/' + c.whatsapp } : null,
    ].filter(Boolean);

    $('#contacto-directo').innerHTML = filas.map((f) =>
      `<a class="btn" style="justify-content:flex-start" href="${esc(f.h)}" target="_blank" rel="noopener">
         <span style="width:18px">${f.i}</span> ${esc(f.t)}</a>`).join('');

    const disponibles = datos.apartamentos.filter((a) => a.estado === 'disponible');
    $('#c-apto').innerHTML =
      '<option value="">Cualquiera / aún no decido</option>' +
      disponibles.map((a) => {
        const ed = edificioDe(a);
        return `<option value="${esc(a.id)}">${esc(ed ? ed.nombre + ' · ' : '')}${esc(a.numero)} — ${esc(dinero(a.precio))}</option>`;
      }).join('');
  }

  function conectarFormulario() {
    const form = $('#form-contacto');
    const fechaVisita = $('#c-fecha-visita');
    if (fechaVisita) fechaVisita.min = new Date().toISOString().slice(0, 10);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const aviso = $('#c-aviso');
      const fd = Object.fromEntries(new FormData(form).entries());
      if (!fd.nombre?.trim() || !(fd.telefono?.trim() || fd.email?.trim())) {
        aviso.innerHTML = '<div class="aviso aviso-error">Escribe tu nombre y al menos un teléfono o correo.</div>';
        return;
      }
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      btn.textContent = 'Enviando…';
      try {
        await api('/api/solicitudes', { method: 'POST', body: fd });
        form.reset();
        aviso.innerHTML = '<div class="aviso aviso-bien">¡Listo! Recibimos tu solicitud. Te contactamos muy pronto.</div>';
        nota('Solicitud enviada', 'bien');
      } catch (e) {
        aviso.innerHTML = `<div class="aviso aviso-error">${esc(e.message)}</div>`;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Enviar solicitud';
      }
    });
  }

  document.addEventListener('DOMContentLoaded', iniciar);
})();
