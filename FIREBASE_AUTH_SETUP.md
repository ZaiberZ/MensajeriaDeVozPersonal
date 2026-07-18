# Configuración de servicios y entorno local

Esta guía describe todo lo que debe crear y configurar una persona que clone Voice Messaging Hub: Firebase, Gmail, AWS Lambda, Alexa Developer Console, el archivo local de variables y su instalador privado.

El proyecto autentica sus solicitudes REST con ID tokens temporales de Firebase Authentication. No uses un Database Secret ni guardes manualmente un ID token: el código obtiene y renueva los tokens automáticamente.

## 1. Recursos necesarios

Cada instalación debe tener recursos propios:

- Un proyecto de Firebase con Realtime Database y Authentication.
- Una cuenta técnica de Firebase Authentication.
- Una función AWS Lambda para `AlexaSkillWhatsApp`.
- Una Custom Skill en Alexa Developer Console.
- Un proyecto de Google Cloud y un cliente OAuth, únicamente si se usará Gmail/Airbnb.
- Windows 10 u 11, .NET 8 SDK y Node.js 20 LTS o superior para desarrollo local.
- Inno Setup 6 si se generará el instalador.

No reutilices las credenciales, la base de datos ni las cuentas del proyecto original.

## 2. Configurar Firebase

### Crear el proyecto y Realtime Database

1. Abre [Firebase Console](https://console.firebase.google.com/) y crea un proyecto.
2. Dentro del proyecto, entra a **Compilación > Realtime Database**.
3. Pulsa **Crear base de datos**.
4. Selecciona una región adecuada y crea la base.
5. Copia la URL mostrada por Firebase. Se guardará como `VOICE_MESSAGING_FIREBASE_URL`.

### Crear la cuenta técnica

1. Entra a **Compilación > Authentication**.
2. Pulsa **Comenzar** si Authentication aún no está habilitado.
3. Abre **Método de acceso**.
4. Selecciona **Correo electrónico/contraseña**, habilita la primera opción y guarda.
5. Abre **Usuarios > Agregar usuario**.
6. Crea una cuenta exclusiva para Voice Messaging con una contraseña larga y única.
7. Copia su **UID**.

El correo y la contraseña se guardarán como `VOICE_MESSAGING_FIREBASE_EMAIL` y `VOICE_MESSAGING_FIREBASE_PASSWORD`. No uses tu contraseña personal de Google.

### Obtener la Web API Key

1. Abre **Configuración del proyecto** mediante el icono de engrane.
2. En **General**, localiza **Clave de API web**.
3. Si no aparece, registra una aplicación web dentro del proyecto y toma `apiKey` de su configuración.
4. Guarda el valor como `VOICE_MESSAGING_FIREBASE_API_KEY`.

La Web API Key identifica el proyecto, pero no autoriza por sí sola el acceso. La contraseña y los tokens sí son sensibles.

### Publicar las reglas

1. Regresa a **Compilación > Realtime Database > Reglas**.
2. Sustituye `REEMPLAZA_CON_UID` por el UID exacto de la cuenta técnica.
3. Publica:

```json
{
  "rules": {
    ".read": "auth != null && auth.uid === 'REEMPLAZA_CON_UID'",
    ".write": "auth != null && auth.uid === 'REEMPLAZA_CON_UID'"
  }
}
```

Estas reglas conservan la estructura actual basada en teléfonos y restringen toda la base a una identidad concreta. No uses solo `auth != null`, porque cualquier cuenta autenticada del proyecto tendría acceso.

## 3. Configurar Google Cloud y Gmail

Esta sección es opcional. Se necesita únicamente para convertir correos de Airbnb recibidos en Gmail en mensajes pendientes.

### Habilitar Gmail API

1. Abre [Google Cloud Console](https://console.cloud.google.com/).
2. Crea un proyecto o selecciona uno propio.
3. Entra a **APIs y servicios > Biblioteca**.
4. Busca **Gmail API** y pulsa **Habilitar**.

### Configurar la pantalla de consentimiento

1. Entra a **APIs y servicios > Pantalla de consentimiento de OAuth**.
2. Configura el nombre de la aplicación y un correo de soporte.
3. Si la aplicación queda en modo de pruebas, agrega como usuario de prueba la cuenta de Gmail que recibirá los correos de Airbnb.
4. Agrega el alcance de solo lectura `https://www.googleapis.com/auth/gmail.readonly`.

### Crear el cliente OAuth

1. Entra a **APIs y servicios > Credenciales**.
2. Pulsa **Crear credenciales > ID de cliente de OAuth**.
3. Selecciona **Aplicación web**.
4. Agrega `http://localhost:3000/gmail/callback` en **URI de redireccionamiento autorizados**.
5. Crea el cliente y conserva su Client ID y Client Secret.

Estos valores corresponden a `VOICE_MESSAGING_GMAIL_CLIENT_ID`, `VOICE_MESSAGING_GMAIL_CLIENT_SECRET` y `VOICE_MESSAGING_GMAIL_REDIRECT_URI`.

Si un Client Secret estuvo versionado anteriormente, revócalo o restablécelo antes de hacer público el repositorio. Borrarlo del checkout actual no lo elimina del historial de Git.

## 4. Configurar AWS Lambda

### Preparar y desplegar la función

1. Instala y configura AWS CLI con una cuenta que pueda crear o actualizar funciones Lambda.
2. Instala la herramienta de .NET si aún no existe:

```powershell
dotnet tool install -g Amazon.Lambda.Tools
```

3. Desde la raíz del repositorio despliega la función:

```powershell
cd AlexaSkillWhatsApp
dotnet lambda deploy-function AlexaSkillWhatsApp
cd ..
```

4. Conserva el ARN de la función y verifica que use el runtime/configuración generados para .NET 8.

### Registrar variables en Lambda

1. Abre la función en AWS Lambda.
2. Entra a **Configuration > Environment variables > Edit**.
3. Agrega:

```text
VOICE_MESSAGING_FIREBASE_URL
VOICE_MESSAGING_FIREBASE_API_KEY
VOICE_MESSAGING_FIREBASE_EMAIL
VOICE_MESSAGING_FIREBASE_PASSWORD
```

4. Guarda los cambios.

Las variables opcionales `VOICE_MESSAGING_PHONE`, `VOICE_MESSAGING_FULL_NAME` y `VOICE_MESSAGING_EMAIL` definen un usuario alternativo; no sustituyen el registro normal mediante `ConfigurarTelefonoIntent`.

AWS permite cifrar las variables con KMS. Si lo habilitas, concede `kms:Decrypt` solamente al rol de ejecución de la función.

## 5. Configurar Alexa Developer Console

### Crear la skill e importar el modelo

1. Abre [Alexa Developer Console](https://developer.amazon.com/alexa/console/ask) y pulsa **Create Skill**.
2. Asigna un nombre, selecciona el idioma español que usarás y el modelo **Custom**.
3. Crea la skill con recursos de backend propios cuando la consola solicite el método de alojamiento.
4. En **Interaction Model > JSON Editor**, importa el contenido de `Skill_VoiceMessage.json`.
5. Guarda y pulsa **Build Model**.
6. Revisa en **Invocation** el nombre con el que abrirás la skill.

### Conectar Lambda

1. En AWS Lambda, agrega el trigger **Alexa Skills Kit**.
2. Copia el **Skill ID** mostrado en Alexa Developer Console y úsalo para restringir el trigger.
3. En Alexa Developer Console abre **Endpoint**.
4. Selecciona **AWS Lambda ARN** y pega el ARN de la función en la región correspondiente.
5. Guarda el endpoint.

### Asociar el teléfono del usuario

1. Abre la skill desde la pestaña **Test** o desde un dispositivo Alexa vinculado a la cuenta de prueba.
2. Invoca una frase asociada a `ConfigurarTelefonoIntent`.
3. Proporciona y confirma el mismo teléfono registrado en el Worker.

Este paso guarda la relación entre el usuario de Alexa y `usuarios/{telefono}`. Sin esa asociación la skill no sabe qué mensajes leer; si se indica otro número, consultará una rama distinta de Firebase.

## 6. Configurar el proyecto después de clonarlo

### Crear el archivo privado

Desde la raíz del repositorio:

```powershell
Copy-Item .env.example .env.local
notepad .env.local
```

Completa las variables obligatorias:

```dotenv
VOICE_MESSAGING_FIREBASE_URL=https://TU_PROYECTO-default-rtdb.firebaseio.com
VOICE_MESSAGING_FIREBASE_API_KEY=TU_WEB_API_KEY
VOICE_MESSAGING_FIREBASE_EMAIL=cuenta-tecnica@ejemplo.com
VOICE_MESSAGING_FIREBASE_PASSWORD=CONTRASEÑA_UNICA
```

Si usarás Gmail/Airbnb, completa también:

```dotenv
VOICE_MESSAGING_GMAIL_CLIENT_ID=TU_CLIENT_ID
VOICE_MESSAGING_GMAIL_CLIENT_SECRET=TU_CLIENT_SECRET
VOICE_MESSAGING_GMAIL_REDIRECT_URI=http://localhost:3000/gmail/callback
```

Comprueba que Git ignora el archivo:

```powershell
git check-ignore .env.local
git status --short
```

Nunca agregues `.env.local` mediante `git add -f`.

### Instalar dependencias

```powershell
dotnet restore "Mensajería de Voz Personal.slnx"
cd VoiceMessaging.Worker\WhatsAppGateway
npm install
cd ..\..
```

### Ejecutar localmente

El Worker carga `.env.local` desde la raíz y transmite las variables al gateway que inicia como proceso Node.js:

```powershell
$env:DOTNET_ENVIRONMENT = "Development"
dotnet run --project VoiceMessaging.Worker\VoiceMessaging.Worker.csproj
```

También puedes iniciar el gateway por separado desde `VoiceMessaging.Worker\WhatsAppGateway` con `npm start`; buscará el mismo `.env.local`.

En la primera ejecución:

1. Abre `http://localhost:3000/whatsapp/qr`.
2. Registra el teléfono y los datos del usuario.
3. Escanea el QR de WhatsApp.
4. Abre `http://localhost:3000/app-status` y verifica Worker, WhatsApp y Firebase.
5. Si configuraste Gmail, inicia OAuth desde la página de estado y ejecuta una sincronización.

## 7. Ejecutar pruebas funcionales

1. Envía un mensaje de WhatsApp al número conectado y verifica que el Worker lo registre en `usuarios/{telefono}/mensajes_pendientes`.
2. Abre la skill y ejecuta `ConfigurarTelefonoIntent` con ese mismo teléfono.
3. Solicita la lectura de mensajes y confirma que Alexa narre el mensaje guardado.
4. Dicta y confirma una respuesta; verifica Firebase y la entrega por WhatsApp.
5. Prueba contactos frecuentes, repetición y navegación entre conversaciones.
6. Si habilitaste Gmail, sincroniza un correo de Airbnb y comprueba que aparezca como mensaje de solo lectura.
7. Realiza una solicitud REST a Firebase sin token y confirma que las reglas la rechacen.

## 8. Generar un instalador propio

El instalador no solicita variables. `build-installer.bat` incorpora el `.env.local` del clon y detiene la compilación si el archivo no existe.

1. Prueba primero el Worker y el gateway localmente.
2. Revisa `OUTPUT_DIR` e `INNO_COMPILER` en `build-installer.bat`.
3. Ejecuta:

```powershell
.\build-installer.bat
```

Durante la instalación, la configuración se copia como:

```text
C:\ProgramData\VoiceMessaging\environment.env
```

El archivo queda restringido a `SYSTEM` y administradores. Las reinstalaciones vuelven a aplicar la misma configuración sin pedir datos.

El instalador contiene las credenciales del clon que lo compiló. No lo publiques como release ni lo distribuyas abiertamente. Para rotar credenciales, actualiza `.env.local` y genera un instalador nuevo.

## Referencias oficiales

- [Firebase Auth REST API](https://firebase.google.com/docs/reference/rest/auth)
- [Autenticar solicitudes REST de Realtime Database](https://firebase.google.com/docs/database/rest/auth)
- [Reglas de seguridad de Realtime Database](https://firebase.google.com/docs/database/security)
- [Gmail API](https://developers.google.com/workspace/gmail/api/quickstart/nodejs)
- [Crear una Custom Skill](https://developer.amazon.com/en-US/docs/alexa/custom-skills/steps-to-build-a-custom-skill.html)
