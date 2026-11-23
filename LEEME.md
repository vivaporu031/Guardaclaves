# Guardaclaves — instalación

Guardaclaves es un gestor de contraseñas parecido al BlackBerry Password Keeper:

- Contraseña maestra y **desbloqueo con huella o Face ID**.
- Cifrado AES-256. Las contraseñas solo se guardan **en tu teléfono**; la app no tiene servidor.
- Generador de contraseñas, buscador y favoritas.
- Se bloquea sola, borra del portapapeles lo copiado y, si lo activas, lo borra todo tras 10 intentos fallidos.
- **Respaldo cifrado en Google Drive** o en un archivo.

Para que funcionen la huella y Google Drive, la app tiene que estar publicada en una dirección **https**. Lo más sencillo y gratis es GitHub Pages. Este paso se hace una sola vez.

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

## 3. Conectar Google Drive (una sola vez, unos 10 minutos)

Google exige que cada app tenga su propio "ID de cliente". Es gratis.

1. Entra en <https://console.cloud.google.com> con tu cuenta de Gmail.
2. Arriba, en el selector de proyectos: **Proyecto nuevo** › nombre `Guardaclaves` › **Crear**.
3. Menú › **APIs y servicios › Biblioteca** › busca **Google Drive API** › **Habilitar**.
4. Menú › **APIs y servicios › Pantalla de consentimiento de OAuth** (en la versión nueva se llama *Google Auth Platform*):
   - Tipo de usuario: **Externo**. Nombre de la app: `Guardaclaves`. Pon tu correo donde lo pida.
   - En **Usuarios de prueba** (o *Público › Test users*) añade **tu Gmail**.
5. Menú › **Credenciales** (o *Clientes*) › **Crear credenciales › ID de cliente de OAuth**:
   - Tipo de aplicación: **Aplicación web**.
   - En **Orígenes de JavaScript autorizados** añade: `https://TU-USUARIO.github.io`
     (sin `/guardaclaves` y sin barra al final).
   - Toca **Crear** y copia el **ID de cliente**, que termina en `.apps.googleusercontent.com`.
6. En Guardaclaves: **Ajustes › Configurar conexión con Google**, pega el ID y toca **Guardar ID**.
7. Toca **Respaldar en Google Drive**. La primera vez Google muestra el aviso *"Google no verificó esta app"*: toca **Continuar**. Es tu propia app.

Qué hace la app con tu Drive:
- Solo puede ver los archivos que ella misma crea (permiso `drive.file`). No ve el resto de tu Drive.
- Guarda un único archivo, `Guardaclaves-respaldo.json`, **cifrado**: sin tu contraseña maestra no se puede abrir.
- Drive conserva automáticamente las versiones anteriores de ese archivo (clic derecho › *Administrar versiones*).
- Cuando hay cambios sin respaldar, la lista muestra un aviso amarillo; tócalo para respaldar.

**Sin configurar nada:** en Ajustes, **Enviar respaldo** abre el menú de compartir del teléfono, y ahí puedes elegir **Drive** para guardarlo manualmente.

## 4. Restaurar en otro teléfono

1. Instala la app como en el paso 2.
2. En la primera pantalla, toca **Restaurar desde Google Drive** (pega antes el ID de cliente en el campo de abajo) o **Restaurar desde un archivo**.
3. Escribe la contraseña maestra que tenías cuando hiciste ese respaldo.
4. Ve a **Ajustes › Activar huella**.

## Importante

- **Si olvidas la contraseña maestra, no hay forma de recuperar los datos.** Ni con la huella se puede volver a ponerla; anótala en un lugar seguro.
- Si cambias la contraseña maestra, haz un respaldo nuevo. Los respaldos viejos se siguen abriendo con la contraseña anterior.
- Si borras los datos del navegador o desinstalas la app, se borra lo que hay en el teléfono. Por eso conviene respaldar.

## Actualizar la app

Sube los archivos nuevos al repositorio y cambia el número de versión en la primera línea de `sw.js` (`guardaclaves-v1.0.0` › `v1.0.1`). Tus contraseñas no se pierden al actualizar.
