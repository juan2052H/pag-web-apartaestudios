# Apartaestudios

Sitio web para publicar apartaestudios en arriendo —con video, mapa y datos del
encargado— más un panel administrativo para llevar contratos, pagos y analítica,
y un portal privado para cada inquilino.

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
| Página de accesos | http://localhost:3000/acceso |
| Panel administrativo | http://localhost:3000/admin |
| Portal del inquilino | http://localhost:3000/inquilino |
| Propietario inicial | `admin` |
| Contraseña inicial | generada al azar en el primer arranque — se imprime **una sola vez** en la consola del servidor. **Guárdala y cámbiala en Ajustes → Seguridad** |

Para usar otro puerto: `PORT=8080 node server.js`.

La primera vez se crea `datos/db.json` con dos edificios, cinco unidades, dos
contratos y su historial de pagos, para que puedas ver todo funcionando de una vez.

---

## Recuperar contraseña por correo (opcional)

Tanto el login del panel como el del portal del inquilino tienen un enlace
"¿Olvidaste tu contraseña?": piden un código de 6 dígitos (vence en 15
minutos) y permiten poner una clave nueva sin depender de otro administrador.
Para que el código realmente llegue por correo, copia `.env.example` a `.env`
y completa:

```
RESEND_API_KEY=re_xxxxxxxx
RESEND_FROM=no-reply@tudominio.com
```

Usa la API de [Resend](https://resend.com) (necesitas verificar un dominio
propio ahí para poder enviar a cualquier destinatario, no solo a tu propio
correo de prueba). **Sin `.env` configurado, el código simplemente se
imprime en la consola del servidor** — la función sigue funcionando en modo
degradado, útil para desarrollo local. Cada administrador necesita su propio
correo (Administradores → editar, o Ajustes → Seguridad para el propio); los
inquilinos ya usan el correo de su contrato.

---

## Pruebas

```bash
npm test
```

Usa el test runner que trae Node incluido (`node:test`), así que no hace falta
instalar nada. Cada archivo de `test/` arranca una instancia real de
`server.js` en un puerto propio y con los datos en una carpeta temporal —
nunca toca `datos/db.json`. Cubre login y bloqueo por intentos fallidos,
permisos por edificio, CRUD con sus borrados en cascada, el rechazo de
archivos con el tipo falsificado, y el catálogo público (incluida la
visibilidad de `/unidad/<id>` y el sitemap).

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
- **Formulario de solicitud**: pide consentimiento para el tratamiento de datos
  y lo que se envía aparece en el panel como una solicitud nueva. El interesado
  puede indicar fecha y franja horaria; una franja activa no se duplica por otra
  solicitud.
- **Política de privacidad** en `/privacidad`, enlazada desde el formulario y el
  pie de página. Antes de producción, completa sus datos de responsable y marco
  legal con asesoría local.
- **Tema claro y oscuro**, y enlaces profundos: `/#apto-<id>` abre esa ficha.

## Qué hace el panel administrativo

| Sección | Para qué sirve |
|---|---|
| **Resumen** | Ocupación, ingreso mensual, recaudo del mes, cartera vencida, solicitudes nuevas, mensajes pendientes y contratos próximos a vencer. Gráfico de ingresos esperados vs. recaudados (12 meses) y ocupación por edificio. |
| **Unidades** | Crear y editar apartaestudios, **subir el video y las fotos**, cambiar la disponibilidad desde la propia tarjeta. |
| **Edificios** | Datos del edificio, zonas comunes, foto y **ficha del encargado**. La ubicación se fija haciendo clic en un mapa. |
| **Contratos** | Quién arrienda qué, desde cuándo y por cuánto. Marca solo la unidad como arrendada. Historial de pagos por contrato y resumen imprimible para guardar como PDF. |
| **Pagos** | Registro mes a mes, con método y referencia. Filtros por periodo y contrato. Exportación a CSV. |
| **Cartera** | Meses sin pago completo por inquilino, saldo acumulado y botón de WhatsApp para cobrar. |
| **Mensajes** | Envía avisos privados a un inquilino o a todos los inquilinos activos de un edificio: recordatorios de pago, convivencia/ruido, mantenimiento e información general. Incluye plantillas, prioridad, confirmación de lectura y seguimiento de tickets de mantenimiento (abierta → en proceso → resuelta). |
| **Solicitudes** | Interesados que llegaron por el sitio, con estado (nueva → contactada → visita → cerrada). |
| **Agenda de visitas** | Agenda los horarios solicitados, ordenados por fecha, y enlaza a su gestión comercial. |
| **Multimedia** | Todos los videos y fotos subidos, cuánto ocupan y en qué unidad se usan. |
| **Administradores** | Solo el propietario: crea cuentas de administrador de edificio, les asigna uno o más edificios, pausa accesos, restablece claves y elimina cuentas. |
| **Actividad** | Solo el propietario: bitácora de cambios, envíos y solicitudes. Nunca guarda claves ni textos de mensajes. |
| **Ajustes** | El propietario cambia nombre del sitio, contacto y moneda. Cada administrador puede cambiar únicamente su propio usuario y contraseña. |

### Roles administrativos

- **Propietario principal:** es la cuenta inicial y tiene visibilidad y control total
  sobre todos los edificios, la configuración pública y las cuentas de acceso.
- **Administrador de edificio:** solo ve y gestiona los edificios que el
  propietario le asignó, con sus unidades, contratos, pagos, cartera, mensajes,
  solicitudes y multimedia relacionada. No puede alterar la configuración global,
  crear/eliminar edificios ni administrar otros usuarios.

El propietario crea estas cuentas desde **Administradores → Nuevo administrador**
y define una contraseña inicial segura para cada persona. Las contraseñas se
guardan derivadas, nunca en texto plano.

## Portal del inquilino

Cada contrato activo puede tener un acceso individual. Desde **Contratos → Activar
portal**, la administración define una clave para el inquilino; este entra con su
documento y esa clave en `/inquilino`.

El portal muestra únicamente los datos de su propia unidad, contrato, estado del
pago actual, historial de pagos, datos del encargado y mensajes privados. El
inquilino también puede escribir a administración, adjuntar hasta cinco fotos
privadas a un reporte de mantenimiento y marcar los avisos como leídos.
Las claves se guardan derivadas con `scrypt`; no se guardan ni se devuelven en texto
plano.

Cada pago registrado tiene un **comprobante imprimible** desde el portal. El
inquilino puede guardarlo como PDF desde el cuadro de impresión de su navegador.

### Avisos y vencimientos

Desde **Mensajes** puedes elegir un inquilino individual o un edificio completo. El
sistema crea una copia privada del aviso para cada contrato activo del edificio, sin
exponer los datos de otros residentes. El resumen también lista los contratos que
finalizan en los próximos 60 días y permite avisar al inquilino desde allí.

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
  db.json        ← edificios, unidades, contratos, pagos, solicitudes, mensajes, config
  subidas/       ← los videos y las fotos, con su id como nombre
```

**Para respaldar, copia la carpeta `datos/` completa.** Para empezar de cero,
bórrala y vuelve a arrancar el servidor: se recrea con los datos de ejemplo.

La contraseña se guarda derivada con `scrypt` más una sal aleatoria; nunca en
texto plano. Las sesiones viven en memoria y duran 8 horas, así que reiniciar el
servidor cierra las sesiones abiertas. Los accesos de administrador e inquilino
se bloquean temporalmente después de cinco intentos fallidos consecutivos por
usuario y dirección de red.

---

## Estructura

```
server.js              Bootstrap: crea el servidor HTTP y arranca la carga de datos
lib/                    API, permisos, modelos, sesiones y archivos estáticos (Node puro)
test/                   Pruebas de integración (node:test) contra el servidor real
public/
  index.html           sitio público
  admin.html           panel administrativo
  inquilino.html       portal privado del inquilino
  css/base.css         tokens de color, tema claro/oscuro, botones, formularios
  css/publico.css      estilos del sitio
  css/admin.css        estilos del panel
  css/inquilino.css    estilos del portal del inquilino
  js/comun.js          utilidades compartidas: API, modales, formatos, tema
  js/publico.js        catálogo, mapa, ficha y solicitudes
  js/admin.js          todas las vistas del panel
  js/inquilino.js      acceso, pagos y mensajería del inquilino
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
contraseña inicial y usa una base de datos y almacenamiento persistente. Ya hay
un bloqueo temporal de intentos, pero no sustituye HTTPS ni un servicio de
protección contra ataques en producción.

### Demo rápida en Render

El archivo `render.yaml` permite crear un **Web Service** desde el repositorio con
el plan Free, `npm install` y `npm start`. Sirve para una demostración, pero Render
elimina el contenido local de `datos/` al reiniciar o suspender el servicio. Para
uso real, migra la base y los archivos subidos a almacenamiento persistente antes
de publicar datos de inquilinos.

### Acceso público e indexación

La página pública `/acceso` dirige al portal del inquilino y a administración sin
omitir sus credenciales. Las rutas privadas (`/admin`, `/inquilino` y `/acceso`)
usan `noindex` y no se incluyen en el sitemap. Al publicar el proyecto, visita
`https://tu-dominio/robots.txt` y envía `https://tu-dominio/sitemap.xml` a Google
Search Console. El sitemap se construye automáticamente con el dominio desde el
que se solicite.
