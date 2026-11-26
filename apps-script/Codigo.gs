/**
 * Guardaclaves — receptor de respaldos en Google Drive (Google Apps Script).
 * Gratis, sin Google Cloud. Guarda una copia por día en la carpeta CARPETA
 * y conserva las últimas CONSERVAR copias. Los respaldos llegan YA CIFRADOS:
 * ni este script ni Google pueden leer tus contraseñas.
 *
 * 1. Pega aquí la "clave de enlace" que muestra la app en Ajustes.
 * 2. Implementar › Nueva implementación › Aplicación web
 *    Ejecutar como: Yo · Quién tiene acceso: Cualquier usuario
 * 3. Copia la URL que termina en /exec y pégala en la app.
 */
const CLAVE = 'PEGA_AQUI_TU_CLAVE_DE_ENLACE';
const CARPETA = 'Guardaclaves - respaldos';
const CONSERVAR = 30;

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (!CLAVE || CLAVE.indexOf('PEGA_AQUI') === 0 || body.clave !== CLAVE) return salida_({ ok: false, error: 'clave' });
    const carpeta = carpeta_();

    if (body.accion === 'guardar') {
      const datos = String(body.respaldo || '');
      const r = JSON.parse(datos);
      if (r.app !== 'guardaclaves' || !r.vault) return salida_({ ok: false, error: 'respaldo no válido' });
      if (datos.length > 20 * 1024 * 1024) return salida_({ ok: false, error: 'respaldo demasiado grande' });
      const hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      const nombre = 'Guardaclaves-respaldo-' + hoy + '.json';
      const lock = LockService.getScriptLock(); lock.waitLock(20000);
      try {
        const it = carpeta.getFilesByName(nombre);
        if (it.hasNext()) it.next().setContent(datos);
        else carpeta.createFile(nombre, datos, 'application/json');
        limpiar_(carpeta);
      } finally { lock.releaseLock(); }
      return salida_({ ok: true, archivo: nombre });
    }

    if (body.accion === 'ultimo') {
      const archivos = lista_(carpeta);
      if (!archivos.length) return salida_({ ok: true, respaldo: null });
      return salida_({ ok: true, archivo: archivos[0].getName(), respaldo: archivos[0].getBlob().getDataAsString() });
    }

    return salida_({ ok: false, error: 'acción desconocida' });
  } catch (err) {
    return salida_({ ok: false, error: String(err && err.message || err) });
  }
}

function doGet() {
  return ContentService.createTextOutput('Guardaclaves: el receptor de respaldos está activo.');
}

function carpeta_() {
  const it = DriveApp.getFoldersByName(CARPETA);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CARPETA);
}

function lista_(carpeta) {
  const out = [], it = carpeta.getFiles();
  while (it.hasNext()) { const f = it.next(); if (/^Guardaclaves-respaldo-.*\.json$/.test(f.getName())) out.push(f); }
  out.sort(function (a, b) { return b.getName() < a.getName() ? -1 : b.getName() > a.getName() ? 1 : 0; });
  return out;
}

function limpiar_(carpeta) {
  lista_(carpeta).slice(CONSERVAR).forEach(function (f) { f.setTrashed(true); });
}

function salida_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Ejecuta esta función una vez desde el editor para autorizar el acceso a Drive. */
function autorizar() {
  carpeta_();
  Logger.log('Listo. Carpeta: ' + CARPETA);
}
