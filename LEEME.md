# Guardaclaves — instalación

Guardaclaves es un gestor de contraseñas parecido al BlackBerry Password Keeper:

- Contraseña maestra y **desbloqueo con huella o Face ID**.
- Cifrado AES-256. Las contraseñas solo se guardan **en tu teléfono**; la app no tiene servidor.
- Generador de contraseñas, buscador y favoritas.
- Se bloquea sola, borra del portapapeles lo copiado y, si lo activas, lo borra todo tras 10 intentos fallidos.
- **Respaldo cifrado y automático en Google Drive** (gratis, con Apps Script) o en un archivo.

Para que funcione la huella, la app tiene que estar publicada en una dirección **https**. Lo más sencillo y gratis es GitHub Pages. Este paso se hace una sola vez.

---

## 1. Publicar la app (GitHub Pages, gratis)

1. Crea una cuenta en <https://github.com> si no tienes.
2. Arriba a la derecha toca **+ › New repository**.
   - Nombre: `guardaclaves`
   - Visibilidad: **Public**. Lo que queda público es solo el programa; tus contraseñas nunca se suben ahí.
   - Toca **Create repository**.
3. En el repositorio, toca **uploading an existing file** y arrastra **todos** los archivos de esta carpeta (`index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest` y los tres `icon-…png`). Toca **Commit changes**.
4. Ve a **Settings › Pages**. En *Branch* elige `main` y la carpeta `/ (root)`, y toca **Save**.
5. Espera uno o dos minutos. Tu app quedará en:
   `https://TU-USUARIO.github.io/guardaclaves/`

## 2. Instalarla en el teléfono

1. Abre esa dirección en **Chrome** (Android) o **Safari** (iPhone).
2. Añádela a la pantalla de inicio:
   - Android: menú ⋮ › **Instalar app** (o *Añadir a pantalla de inicio*).
   - iPhone: botón Compartir › **Añadir a pantalla de inicio**.
3. Ábrela desde el ícono, crea tu contraseña maestra y acepta **Activar huella**.

> La huella queda registrada solo en ese teléfono. En un teléfono nuevo, restauras el respaldo y la activas otra vez.
> Necesitas Android con Chrome actualizado, o un iPhone con iOS 18 o superior. Si el teléfono no lo permite, la app lo avisa y sigues entrando con la contraseña maestra.

## 3. Respaldo automático en Google Drive (gratis, sin Google Cloud)

Usa **Google Apps Script**, que es gratis. Se configura una sola vez, en unos 5 minutos, y conviene hacerlo desde la computadora.

1. En la app abre **Ajustes › Respaldo automático en Drive (gratis)** y copia tu **clave de enlace**.
2. Entra en <https://script.google.com> con tu Gmail y toca **Nuevo proyecto**. Ponle de nombre `Guardaclaves respaldos`.
3. Borra lo que trae el editor y pega todo el contenido del archivo `apps-script/Codigo.gs` de este repositorio.
4. En la línea `const CLAVE = 'PEGA_AQUI_TU_CLAVE_DE_ENLACE';` reemplaza el texto por tu clave, sin quitar las comillas. Guarda (ícono del disquete).
5. Arriba, elige la función **autorizar** y toca **Ejecutar**. Google pedirá permiso: **Revisar permisos** › tu cuenta › **Configuración avanzada** › **Ir a Guardaclaves respaldos** › **Permitir**. Es tu propio script.
6. Toca **Implementar › Nueva implementación** › el engranaje › **Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
   - Toca **Implementar** y copia la **URL de la aplicación web** (termina en `/exec`).
7. En la app, pega la URL en **Ajustes** y toca **Guardar y probar**. Debe decir *¡Conectado!*

Desde ese momento:
- **Cada vez que agregas o cambias una contraseña, se respalda sola** en tu Drive, en la carpeta *Guardaclaves - respaldos*.
- Además, si pasa más de un día sin respaldo, se hace uno al abrir la app.
- Se guarda **una copia por día** y se conservan las últimas 30.
- Los archivos van **cifrados**: ni Google ni el script pueden leer tus contraseñas.
- La app no puede trabajar cerrada (ninguna app web puede), pero como las contraseñas solo cambian con la app abierta, nunca queda nada sin respaldar.
- Si no hay internet, lo intenta otra vez después; mientras tanto ves el aviso amarillo.

**Sin configurar nada:** el botón **Respaldar en Google Drive** abre el menú de compartir del teléfono, eliges **Drive** y lo guardas a mano.

## 4. Restaurar en otro teléfono

1. Instala la app como en el paso 2.
2. En la primera pantalla, abre **Opcional: respaldo automático**, pega la URL del script, un espacio y tu clave de enlace, y toca **Restaurar desde Google Drive**. Sin respaldo automático, toca **Restaurar desde un archivo** y elige el archivo en Drive.
3. Escribe la contraseña maestra que tenías cuando hiciste ese respaldo.
4. Ve a **Ajustes › Activar huella**.

## Importante

- **Si olvidas la contraseña maestra, no hay forma de recuperar los datos.** Ni con la huella se puede volver a ponerla; anótala en un lugar seguro.
- Si cambias la contraseña maestra, haz un respaldo nuevo. Los respaldos viejos se siguen abriendo con la contraseña anterior.
- Si borras los datos del navegador o desinstalas la app, se borra lo que hay en el teléfono. Por eso conviene respaldar.
- Guarda tu **clave de enlace** junto con la contraseña maestra: la necesitas para restaurar desde Drive en otro teléfono.

## Si la huella da error

Si al activarla sale *"An unknown error occurred while talking to the credential manager"*, revisa esto:
1. **Chrome** y **Servicios de Google Play** actualizados, desde Play Store.
2. Una **cuenta de Google** iniciada en el teléfono.
3. Ajustes del teléfono › *Contraseñas y cuentas* (o *Google › Autocompletar*): el **Gestor de contraseñas de Google** activado como servicio preferido.
4. La **huella configurada** en el bloqueo de pantalla.
5. La app abierta e instalada desde **Chrome**, no desde el navegador de Honor.

## Actualizar la app

Sube los archivos nuevos al repositorio y cambia el número de versión en la primera línea de `sw.js` (por ejemplo `guardaclaves-v1.2.0` › `v1.2.1`). Tus contraseñas no se pierden al actualizar.
