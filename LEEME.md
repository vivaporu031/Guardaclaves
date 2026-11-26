# Guardaclaves — instalación

Guardaclaves es un gestor de contraseñas parecido al BlackBerry Password Keeper:

- Contraseña maestra y **desbloqueo con huella o Face ID**.
- Cifrado AES-256. Las contraseñas solo se guardan **en tu teléfono**; la app no tiene servidor.
- Generador de contraseñas, buscador y favoritas.
- Se bloquea sola, borra del portapapeles lo copiado y, si lo activas, lo borra todo tras 10 intentos fallidos.
- **Respaldo cifrado en Google Drive** (sin configurar nada) o en un archivo.

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

## 3. Respaldo en Google Drive (gratis, sin Google Cloud)

No tienes que configurar nada. Solo necesitas la app **Google Drive** instalada en el teléfono.

- **Respaldar:** en **Ajustes**, toca **Respaldar en Google Drive**. Se abre el menú de compartir del teléfono: elige **Drive**, después la carpeta, y toca **Guardar**.
- **Cuándo respaldar:** cuando hay cambios sin respaldar, la lista muestra un aviso amarillo. Tócalo y se abre el mismo menú.
- El archivo va **cifrado**: aunque alguien entre a tu Drive, no puede leerlo sin tu contraseña maestra.
- En la PC, el botón descarga el archivo; súbelo a <https://drive.google.com>.

*(Opcional y no necesario: si algún día quieres que el respaldo se guarde en Drive sin pasar por el menú de compartir, se puede conectar con un "ID de cliente" de Google Cloud. No hace falta ni tiene costo dejarlo sin configurar.)*

## 4. Restaurar en otro teléfono

1. Instala la app como en el paso 2.
2. En la primera pantalla, toca **Restaurar desde Google Drive** y busca el archivo `Guardaclaves-respaldo` en tu Drive (o **Restaurar desde un archivo** si lo tienes en el teléfono).
3. Escribe la contraseña maestra que tenías cuando hiciste ese respaldo.
4. Ve a **Ajustes › Activar huella**.

## Importante

- **Si olvidas la contraseña maestra, no hay forma de recuperar los datos.** Ni con la huella se puede volver a ponerla; anótala en un lugar seguro.
- Si cambias la contraseña maestra, haz un respaldo nuevo. Los respaldos viejos se siguen abriendo con la contraseña anterior.
- Si borras los datos del navegador o desinstalas la app, se borra lo que hay en el teléfono. Por eso conviene respaldar.

## Actualizar la app

Sube los archivos nuevos al repositorio y cambia el número de versión en la primera línea de `sw.js` (por ejemplo `guardaclaves-v1.1.0` › `v1.1.1`). Tus contraseñas no se pierden al actualizar.
