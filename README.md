# Apartaestudios

Sitio web para publicar apartaestudios en arriendo —con video, mapa y datos del
encargado— más un panel administrativo para llevar contratos, pagos y analítica.

No usa ninguna dependencia externa: solo Node.js y el navegador.

---

## Cómo arrancarlo

**Windows:** doble clic en `iniciar.bat`.

**Cualquier sistema:**

```bash
node server.js
```

| | |
|---|---|
| Sitio público | http://localhost:3000/ |
| Panel administrativo | http://localhost:3000/admin |
| Usuario inicial | `admin` |
| Contraseña inicial | `admin123` — **cámbiala en Ajustes → Seguridad** |

Para usar otro puerto: `PORT=8080 node server.js`.

La primera vez se crea `datos/db.json` con dos edificios, cinco unidades, dos
contratos y su historial de pagos, para que puedas ver todo funcionando de una vez.

---

## Qué hace el sitio público

- **Catálogo de unidades** con el video de cada apartaestudio. La tarjeta carga
  solo los metadatos del video; al abrir la ficha se reproduce completo con
  controles. El servidor responde peticiones `Range`, así que el video se puede
  adelantar sin descargarlo entero.
- **Filtros** por texto, edificio, estado, precio máximo y orden.
- **Mapa** (OpenStreetMap) con un marcador por edificio que muestra cuántas
  unidades están libres. Al elegir un edificio en la lista, el mapa vuela hasta
  él y el catálogo se filtra por ese edificio.
- **Ficha de la unidad**: video, fotos adicionales, área, alcobas, baños, piso,
  desglose de canon + administración + depósito, características, zonas comunes,
  mini mapa con enlace a "cómo llegar" y la tarjeta del **encargado del edificio**
  con teléfono, correo, horario y botón directo de WhatsApp.
- **Formulario de solicitud**: lo que se envía aparece en el panel como una
  solicitud nueva, con contador en el menú lateral.
- **Tema claro y oscuro**, y enlaces profundos: `/#apto-<id>` abre esa ficha.

## Qué hace el panel administrativo

| Sección | Para qué sirve |
|---|---|
| **Resumen** | Ocupación, ingreso mensual, recaudo del mes, cartera vencida, solicitudes nuevas. Gráfico de ingresos esperados vs. recaudados (12 meses) y ocupación por edificio. |
| **Unidades** | Crear y editar apartaestudios, **subir el video y las fotos**, cambiar la disponibilidad desde la propia tarjeta. |
| **Edificios** | Datos del edificio, zonas comunes, foto y **ficha del encargado**. La ubicación se fija haciendo clic en un mapa. |
| **Contratos** | Quién arrienda qué, desde cuándo y por cuánto. Marca solo la unidad como arrendada. Historial de pagos por contrato. |
| **Pagos** | Registro mes a mes, con método y referencia. Filtros por periodo y contrato. Exportación a CSV. |
| **Cartera** | Meses sin pago completo por inquilino, saldo acumulado y botón de WhatsApp para cobrar. |
| **Solicitudes** | Interesados que llegaron por el sitio, con estado (nueva → contactada → visita → cerrada). |
| **Multimedia** | Todos los videos y fotos subidos, cuánto ocupan y en qué unidad se usan. |
| **Ajustes** | Nombre del sitio, contacto, moneda, cambio de usuario y contraseña, exportaciones. |

### Estados de una unidad

`Disponible` · `Arrendado` · `Reservado` · `Mantenimiento`

Las unidades en mantenimiento no se muestran en el sitio público (salvo que las
marques como destacadas). Crear un contrato activo pasa la unidad a *Arrendado*
automáticamente; finalizarlo o cancelarlo la devuelve a *Disponible*.

### Cómo se calcula la analítica

- **Ocupación** = unidades arrendadas ÷ total de unidades.
- **Ingreso mensual** = suma del canon de los contratos vigentes en el mes.
- **Recaudado** = suma de los pagos cuyo *periodo* es ese mes (no la fecha en que
  se recibieron), para que un pago atrasado se impute al mes que corresponde.
- **Cartera** = por cada contrato vigente, mes a mes desde su inicio hasta el mes
  en curso, lo que falte para completar el canon. Un pago parcial deja saldo.

---

## Dónde quedan los datos

```
datos/
  db.json        ← edificios, unidades, contratos, pagos, solicitudes, config
  subidas/       ← los videos y las fotos, con su id como nombre
```

**Para respaldar, copia la carpeta `datos/` completa.** Para empezar de cero,
bórrala y vuelve a arrancar el servidor: se recrea con los datos de ejemplo.

La contraseña se guarda derivada con `scrypt` más una sal aleatoria; nunca en
texto plano. Las sesiones viven en memoria y duran 8 horas, así que reiniciar el
servidor cierra las sesiones abiertas.

---

## Estructura

```
server.js              API + archivos estáticos + streaming de video (Node puro)
public/
  index.html           sitio público
  admin.html           panel administrativo
  css/base.css         tokens de color, tema claro/oscuro, botones, formularios
  css/publico.css      estilos del sitio
  css/admin.css        estilos del panel
  js/comun.js          utilidades compartidas: API, modales, formatos, tema
  js/publico.js        catálogo, mapa, ficha y solicitudes
  js/admin.js          todas las vistas del panel
  js/graficos.js       gráficos en SVG, sin librerías
```

### Notas técnicas

- **Subida de video sin `multipart`.** El archivo viaja como cuerpo crudo del
  `POST /api/media` y el servidor lo escribe en disco a medida que llega, con el
  nombre original en la cabecera `x-nombre` (en base64, para admitir tildes).
  Límite: 600 MB por archivo.
- **Los gráficos** están dibujados a mano en SVG con una paleta verificada para
  daltonismo; cada uno trae su equivalente en tabla porque algunos tonos no
  alcanzan 3:1 de contraste sobre el fondo claro.
- **Leaflet y OpenStreetMap** se cargan desde CDN. Sin internet el sitio funciona
  igual, pero en lugar del mapa aparece un aviso y las direcciones en texto.

### Antes de publicarlo en internet

Esto está pensado para correr en una red local o detrás de un proxy. Si lo vas a
exponer públicamente, pon un proxy con HTTPS delante (Caddy o Nginx), cambia la
contraseña y considera limitar el número de intentos de acceso.
