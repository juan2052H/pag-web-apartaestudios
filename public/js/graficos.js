/* ==========================================================================
   Gráficos en SVG, sin librerías.
   Paleta categórica validada (slots 1–3); cada gráfico trae su vista de tabla
   porque algunos tonos quedan bajo 3:1 sobre la superficie clara.
   ========================================================================== */

const Graficos = (() => {
  const NS = 'http://www.w3.org/2000/svg';

  const svgEl = (tag, attrs = {}) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== null && v !== undefined) n.setAttribute(k, v);
    }
    return n;
  };

  const esc = (s) => String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const leerToken = (nombre, respaldo) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
    return v || respaldo;
  };

  /** Path de rectángulo con esquinas redondeadas solo en el extremo del dato. */
  function barraV(x, y, w, h, r) {
    if (h <= 0.5) return '';
    const rr = Math.max(0, Math.min(r, w / 2, h));
    return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} `
         + `L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
  }
  function barraH(x, y, w, h, r) {
    if (w <= 0.5) return '';
    const rr = Math.max(0, Math.min(r, h / 2, w));
    return `M${x},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} `
         + `L${x + w},${y + h - rr} Q${x + w},${y + h} ${x + w - rr},${y + h} L${x},${y + h} Z`;
  }

  /** Escala "bonita" para el eje de valores. */
  function escalaMaxima(max) {
    if (max <= 0) return { max: 1, pasos: [0, 1] };
    const mag = Math.pow(10, Math.floor(Math.log10(max)));
    const norm = max / mag;
    const techo = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    const pasos = [0, techo / 4, techo / 2, (techo * 3) / 4, techo];
    return { max: techo, pasos };
  }

  /* --- Contenedor con leyenda, tabla y tooltip ---------------------------- */

  /**
   * `estado` sobrevive a los redibujados, así que la vista de tabla elegida por
   * el usuario no se pierde cuando el gráfico se vuelve a dibujar.
   */
  function marco(nodo, { titulo, subtitulo, series, tabla, estado }) {
    nodo.innerHTML = '';
    nodo.classList.add('grafico');

    const cabeza = document.createElement('div');
    cabeza.className = 'grafico-cabeza';
    cabeza.innerHTML = `
      <div class="crece">
        <h3>${esc(titulo)}</h3>
        ${subtitulo ? `<p class="mini tenue" style="margin:2px 0 0">${esc(subtitulo)}</p>` : ''}
      </div>
      <button class="btn btn-sm btn-fantasma" type="button" data-tabla>Ver tabla</button>`;

    const leyenda = document.createElement('div');
    leyenda.className = 'leyenda';
    leyenda.innerHTML = series.map((s) =>
      `<span class="leyenda-item"><i style="background:${esc(s.color)}"></i>${esc(s.nombre)}</span>`).join('');

    const lienzo = document.createElement('div');
    lienzo.className = 'grafico-lienzo';

    const tip = document.createElement('div');
    tip.className = 'grafico-tip';
    tip.hidden = true;
    lienzo.append(tip);

    const marcoTabla = document.createElement('div');
    marcoTabla.className = 'tabla-marco';
    marcoTabla.innerHTML = tabla;

    nodo.append(cabeza, leyenda, lienzo, marcoTabla);

    const boton = cabeza.querySelector('[data-tabla]');
    const aplicar = () => {
      marcoTabla.hidden = !estado.verTabla;
      lienzo.hidden = estado.verTabla;
      leyenda.hidden = estado.verTabla;
      boton.textContent = estado.verTabla ? 'Ver gráfico' : 'Ver tabla';
    };
    boton.addEventListener('click', () => { estado.verTabla = !estado.verTabla; aplicar(); });
    aplicar();

    return { lienzo, tip };
  }

  function moverTip(tip, lienzo, x, y, html) {
    tip.innerHTML = html;
    tip.hidden = false;
    const ancho = tip.offsetWidth;
    const caja = lienzo.getBoundingClientRect();
    let izq = x - ancho / 2;
    izq = Math.max(4, Math.min(izq, caja.width - ancho - 4));
    tip.style.left = izq + 'px';
    tip.style.top = Math.max(4, y - tip.offsetHeight - 12) + 'px';
  }

  /* --- Barras verticales agrupadas ---------------------------------------- */

  /**
   * @param {object} cfg
   *   categorias: [{clave, etiqueta}]
   *   series:     [{nombre, color, valores:[]}]
   *   formato:    (v) => string
   */
  function barrasAgrupadas(nodo, cfg) {
    const estado = { verTabla: false };
    const dibujar = () => {
      const { categorias, series, formato = String, titulo, subtitulo, unidad = '' } = cfg;
      const filas = [
        ['Periodo', ...series.map((s) => s.nombre)],
        ...categorias.map((c, i) => [c.completo || c.etiqueta, ...series.map((s) => formato(s.valores[i] || 0))]),
      ];
      const tabla = `<table class="tabla"><thead><tr>${
        filas[0].map((h, i) => `<th${i ? ' class="num"' : ''}>${esc(h)}</th>`).join('')
      }</tr></thead><tbody>${
        filas.slice(1).map((f) => `<tr>${f.map((c, i) => `<td${i ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')
      }</tbody></table>`;

      const { lienzo, tip } = marco(nodo, { titulo, subtitulo, series, tabla, estado });

      const ancho = Math.max(320, lienzo.clientWidth || nodo.clientWidth || 640);
      const alto = 260;
      const pad = { t: 14, r: 14, b: 30, l: 62 };
      const pw = ancho - pad.l - pad.r;
      const ph = alto - pad.t - pad.b;

      const maxDato = Math.max(0, ...series.flatMap((s) => s.valores.map((v) => Number(v) || 0)));
      const { max, pasos } = escalaMaxima(maxDato);
      const y = (v) => pad.t + ph - (v / max) * ph;

      const svg = svgEl('svg', {
        width: '100%', height: alto, viewBox: `0 0 ${ancho} ${alto}`,
        role: 'img', 'aria-label': titulo,
      });

      const gris = leerToken('--linea', '#e1e0d9');
      const inkMudo = leerToken('--ink-3', '#898781');
      const base = leerToken('--linea-fuerte', '#c3c2b7');
      const superficie = leerToken('--superficie', '#fcfcfb');

      // Rejilla y eje de valores
      for (const p of pasos) {
        svg.append(svgEl('line', { x1: pad.l, x2: ancho - pad.r, y1: y(p), y2: y(p), stroke: p === 0 ? base : gris, 'stroke-width': 1 }));
        const t = svgEl('text', { x: pad.l - 9, y: y(p) + 4, 'text-anchor': 'end', fill: inkMudo, 'font-size': 10.5 });
        t.setAttribute('style', 'font-variant-numeric:tabular-nums');
        t.textContent = cfg.formatoEje ? cfg.formatoEje(p) : formato(p);
        svg.append(t);
      }

      const anchoCat = pw / Math.max(1, categorias.length);
      const anchoGrupo = Math.min(46, anchoCat * 0.66);
      const anchoBarra = Math.max(3, (anchoGrupo - 2 * (series.length - 1)) / series.length);

      // Banda de resalte, por detrás de las barras
      const resalte = svgEl('rect', {
        x: 0, y: pad.t, width: 0, height: ph,
        fill: leerToken('--superficie-2', '#f0efec'), style: 'opacity:0;transition:opacity .12s ease',
      });
      svg.insertBefore(resalte, svg.firstChild);

      // Las zonas de captura van al final, por encima de todo
      const capa = svgEl('g');

      categorias.forEach((c, i) => {
        const cx = pad.l + anchoCat * i + anchoCat / 2;
        const x0 = cx - anchoGrupo / 2;

        // Zona de captura para el hover (toda la columna)
        const zona = svgEl('rect', {
          x: pad.l + anchoCat * i, y: pad.t, width: anchoCat, height: ph,
          fill: 'transparent', style: 'cursor:crosshair',
        });
        zona.addEventListener('mouseenter', () => {
          resalte.setAttribute('x', pad.l + anchoCat * i);
          resalte.setAttribute('width', anchoCat);
          resalte.style.opacity = '1';
        });
        zona.addEventListener('mousemove', (ev) => {
          const caja = lienzo.getBoundingClientRect();
          moverTip(tip, lienzo, ev.clientX - caja.left, ev.clientY - caja.top,
            `<strong>${esc(c.completo || c.etiqueta)}</strong>` + series.map((s) =>
              `<span class="tip-fila"><i style="background:${esc(s.color)}"></i>${esc(s.nombre)}
               <b>${esc(formato(s.valores[i] || 0))}</b></span>`).join(''));
        });
        zona.addEventListener('mouseleave', () => { tip.hidden = true; resalte.style.opacity = '0'; });
        capa.append(zona);

        series.forEach((s, j) => {
          const v = Number(s.valores[i]) || 0;
          const h = ph - (y(v) - pad.t);
          const d = barraV(x0 + j * (anchoBarra + 2), y(v), anchoBarra, h, 4);
          if (d) svg.append(svgEl('path', { d, fill: s.color }));
        });

        const et = svgEl('text', {
          x: cx, y: alto - 10, 'text-anchor': 'middle',
          fill: inkMudo, 'font-size': 10.5,
        });
        et.textContent = c.etiqueta;
        // Oculta etiquetas alternas si no caben
        if (anchoCat < 34 && i % 2) et.textContent = '';
        svg.append(et);
      });

      // Una sola etiqueta directa: la serie principal en el último periodo.
      // Etiquetar ambas series las hace chocar cuando los valores se parecen;
      // el resto de los valores los dan el eje, el hover y la vista de tabla.
      const ult = categorias.length - 1;
      const jDestacada = series.length - 1;
      const vDestacada = ult >= 0 ? Number(series[jDestacada].valores[ult]) || 0 : 0;
      if (vDestacada) {
        const cx = pad.l + anchoCat * ult + anchoCat / 2
          - anchoGrupo / 2 + jDestacada * (anchoBarra + 2) + anchoBarra / 2;
        const t = svgEl('text', {
          x: Math.min(cx, ancho - pad.r - 2), y: Math.max(pad.t + 9, y(vDestacada) - 7),
          'text-anchor': 'middle', 'font-size': 10.5, 'font-weight': 650,
          fill: leerToken('--ink-2', '#52514e'), stroke: superficie, 'stroke-width': 3,
          'paint-order': 'stroke',
        });
        t.textContent = cfg.formatoEje ? cfg.formatoEje(vDestacada) : formato(vDestacada);
        svg.append(t);
      }

      svg.append(capa);
      lienzo.append(svg);
    };

    dibujar();
    observarAncho(nodo, dibujar, estado);
  }

  /* --- Barras horizontales apiladas --------------------------------------- */

  /**
   * filas:  [{etiqueta, valores:[n,n,n], extra}]
   * series: [{nombre, color}]
   */
  function barrasApiladas(nodo, cfg) {
    const estado = { verTabla: false };
    const dibujar = () => {
      const { filas, series, titulo, subtitulo, formatoExtra } = cfg;

      const tabla = `<table class="tabla"><thead><tr><th>Edificio</th>${
        series.map((s) => `<th class="num">${esc(s.nombre)}</th>`).join('')
      }<th class="num">Total</th></tr></thead><tbody>${
        filas.map((f) => `<tr><td>${esc(f.etiqueta)}</td>${
          f.valores.map((v) => `<td class="num">${esc(v)}</td>`).join('')
        }<td class="num">${esc(f.valores.reduce((a, b) => a + b, 0))}</td></tr>`).join('')
      }</tbody></table>`;

      const { lienzo, tip } = marco(nodo, { titulo, subtitulo, series, tabla, estado });

      if (!filas.length) {
        lienzo.innerHTML = '<div class="vacio" style="border:none;padding:36px">Sin edificios registrados.</div>';
        return;
      }

      const ancho = Math.max(320, lienzo.clientWidth || nodo.clientWidth || 640);
      const altoFila = 34;
      const alto = filas.length * altoFila + 16;
      const anchoEtiqueta = Math.min(170, Math.max(96, ancho * 0.26));
      const pad = { l: anchoEtiqueta, r: 78 };
      const pw = Math.max(40, ancho - pad.l - pad.r);
      const maxTotal = Math.max(1, ...filas.map((f) => f.valores.reduce((a, b) => a + b, 0)));

      const svg = svgEl('svg', {
        width: '100%', height: alto, viewBox: `0 0 ${ancho} ${alto}`,
        role: 'img', 'aria-label': titulo,
      });
      const inkMudo = leerToken('--ink-3', '#898781');
      const ink2 = leerToken('--ink-2', '#52514e');

      filas.forEach((f, i) => {
        const y = 8 + i * altoFila;
        const hb = 18;

        const et = svgEl('text', { x: 0, y: y + hb / 2 + 4, fill: ink2, 'font-size': 11.5, 'font-weight': 560 });
        et.textContent = f.etiqueta.length > 22 ? f.etiqueta.slice(0, 21) + '…' : f.etiqueta;
        svg.append(et);

        const total = f.valores.reduce((a, b) => a + b, 0);
        let x = pad.l;
        const ultimoConValor = f.valores.reduce((acc, v, j) => (v > 0 ? j : acc), -1);

        f.valores.forEach((v, j) => {
          if (v <= 0) return;
          const w = (v / maxTotal) * pw;
          const hueco = j === ultimoConValor ? 0 : 2; // separación de 2px con la superficie
          const d = barraH(x, y, Math.max(1, w - hueco), hb, j === ultimoConValor ? 4 : 0);
          const p = svgEl('path', { d, fill: series[j].color, style: 'cursor:pointer' });
          p.addEventListener('mousemove', (ev) => {
            const caja = lienzo.getBoundingClientRect();
            moverTip(tip, lienzo, ev.clientX - caja.left, ev.clientY - caja.top,
              `<strong>${esc(f.etiqueta)}</strong>
               <span class="tip-fila"><i style="background:${esc(series[j].color)}"></i>${esc(series[j].nombre)} <b>${v}</b></span>
               <span class="tip-fila" style="color:var(--ink-3)">de ${total} unidades</span>`);
          });
          p.addEventListener('mouseleave', () => { tip.hidden = true; });
          svg.append(p);
          x += w;
        });

        const val = svgEl('text', {
          x: ancho - 2, y: y + hb / 2 + 4, 'text-anchor': 'end',
          fill: ink2, 'font-size': 11, 'font-weight': 620,
        });
        val.setAttribute('style', 'font-variant-numeric:tabular-nums');
        val.textContent = formatoExtra ? formatoExtra(f) : String(total);
        svg.append(val);

        if (f.sub) {
          const s = svgEl('text', { x: 0, y: y + hb + 13, fill: inkMudo, 'font-size': 10 });
          s.textContent = f.sub;
          svg.append(s);
        }
      });

      lienzo.append(svg);
    };

    dibujar();
    observarAncho(nodo, dibujar, estado);
  }

  /* --- Redibujado ---------------------------------------------------------- */

  const observados = new WeakMap();
  function observarAncho(nodo, dibujar, estado) {
    if (observados.has(nodo)) return;
    let ultimo = nodo.clientWidth;
    let t;
    const ro = new ResizeObserver(() => {
      // Con la tabla a la vista no hay gráfico que redimensionar, y redibujar
      // ahí devolvería al usuario a la vista de gráfico sin pedirlo.
      if (estado && estado.verTabla) return;
      if (Math.abs(nodo.clientWidth - ultimo) < 24) return;
      ultimo = nodo.clientWidth;
      clearTimeout(t);
      t = setTimeout(dibujar, 120);
    });
    ro.observe(nodo);
    observados.set(nodo, ro);
    document.addEventListener('tema-cambiado', () => setTimeout(dibujar, 30));
  }

  const colores = () => ({
    s1: leerToken('--serie-1', '#2a78d6'),
    s2: leerToken('--serie-2', '#eb6834'),
    s3: leerToken('--serie-3', '#1baf7a'),
  });

  return { barrasAgrupadas, barrasApiladas, colores };
})();
