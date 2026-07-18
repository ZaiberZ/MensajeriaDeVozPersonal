# Voice Messaging Hub

Voice Messaging Hub es un proyecto de accesibilidad que permite leer y responder mensajes de WhatsApp mediante Alexa. También puede incorporar notificaciones de Airbnb recibidas por Gmail al mismo flujo de lectura.

El sistema usa Firebase Realtime Database como punto de intercambio entre la skill de Alexa y un Worker de Windows. El Worker administra un gateway local de Node.js que se conecta con WhatsApp Web y Gmail.

## Funcionalidades actuales

- Registro del usuario desde Alexa o desde la interfaz local.
- Lectura de mensajes pendientes agrupados por conversación.
- Navegación, repetición y marcado de conversaciones como leídas.
- Dictado y confirmación de respuestas antes de enviarlas.
- Envío de mensajes nuevos a contactos frecuentes.
- Consulta de mensajes recientes de contactos frecuentes.
- Sincronización de mensajes no leídos después de una desconexión.
- Persistencia de la sesión de WhatsApp Web.
- Selección y administración de contactos frecuentes.
- Lectura de notificaciones de Airbnb obtenidas desde Gmail.
- Estado operativo del Worker, WhatsApp, Gmail y Firebase.
- Registro de errores y reporte diario al teléfono de soporte configurado.

## Arquitectura

```text
Alexa
  |
  v
AWS Lambda (.NET 8)
  |
  v
Firebase Realtime Database
  |
  v
Worker Service (.NET 8)
  |
  v
Gateway local (Node.js + Express)
  |                     |
  v                     v
WhatsApp Web           Gmail / Airbnb
```

Alexa no se conecta directamente con WhatsApp. La skill lee y escribe datos en Firebase; el Worker sincroniza esos datos con el gateway local.

## Estructura del repositorio

```text
AlexaSkillWhatsApp/                 Skill de Alexa para AWS Lambda
Shared/                             Modelos, configuración y servicios compartidos
VoiceMessaging.Worker/              Servicio de Windows y procesos de sincronización
VoiceMessaging.Worker/WhatsAppGateway/
                                    API local, WhatsApp Web, Gmail e interfaces web
Installer/                          Instalador de Inno Setup
Skill_VoiceMessage.json             Modelo de interacción de Alexa en español
Mensajería de Voz Personal.slnx     Solución de .NET
build-installer.bat                 Publicación y compilación del instalador
```

## Requisitos de desarrollo

- Windows 10 u 11.
- .NET 8 SDK.
- Node.js 20 LTS o superior.
- Visual Studio 2022 o un editor compatible con .NET.
- AWS CLI y `Amazon.Lambda.Tools` para desplegar la skill.
- Inno Setup 6 para generar el instalador.
- Un proyecto de Firebase Realtime Database.
- Una cuenta de desarrollador de Amazon Alexa.
- Credenciales OAuth de Google si se habilitará la integración con Gmail.

Instala la herramienta de despliegue de Lambda si todavía no está disponible:

```powershell
dotnet tool install -g Amazon.Lambda.Tools
```

## Configuración

### Firebase y usuario

La URL de Firebase usada por los componentes compartidos se encuentra en `Shared/Settings/FirebaseSettings.cs`. El gateway usa además `VoiceMessaging.Worker/WhatsAppGateway/gateway-config.json`.

El usuario puede registrarse desde Alexa o desde la página local de autenticación de WhatsApp. El número telefónico identifica su rama de datos en Firebase.

### Skill de Alexa

1. Importa `Skill_VoiceMessage.json` en la consola de Alexa Developer.
2. Configura el endpoint con el ARN de la función Lambda.
3. Compila el modelo de interacción.
4. En Lambda, configura las variables de entorno requeridas por el usuario alternativo cuando corresponda: `VOICE_MESSAGING_PHONE`, `VOICE_MESSAGING_FULL_NAME` y `VOICE_MESSAGING_EMAIL`.

### Gmail y Airbnb

La integración de Airbnb procesa correos de Gmail. Para habilitarla:

1. Crea credenciales OAuth para una aplicación web en Google Cloud.
2. Registra `http://localhost:3000/gmail/callback` como URI de redirección.
3. Completa `VoiceMessaging.Worker/WhatsAppGateway/gmail-config.json`.
4. Inicia sesión desde la página de estado local.
5. Activa Airbnb desde esa misma página.

No publiques credenciales, tokens ni carpetas de autenticación en el repositorio.

## Ejecución local

Restaura y compila los proyectos .NET:

```powershell
dotnet restore "Mensajería de Voz Personal.slnx"
dotnet build "Mensajería de Voz Personal.slnx"
```

Instala las dependencias e inicia el gateway:

```powershell
cd VoiceMessaging.Worker\WhatsAppGateway
npm install
npm start
```

En otra terminal, inicia el Worker con la configuración de desarrollo:

```powershell
$env:DOTNET_ENVIRONMENT = "Development"
dotnet run --project VoiceMessaging.Worker\VoiceMessaging.Worker.csproj
```

El gateway escucha en `http://localhost:3000`. Las principales interfaces locales son:

- Estado general: `http://localhost:3000/app-status`
- Autenticación de WhatsApp y datos del usuario: `http://localhost:3000/whatsapp/qr`
- Contactos frecuentes: `http://localhost:3000/contacts`

La primera ejecución requiere escanear el código QR de WhatsApp. La sesión se conserva para los siguientes inicios.

## Despliegue de la skill

Desde la carpeta del proyecto Lambda:

```powershell
cd AlexaSkillWhatsApp
dotnet lambda deploy-function AlexaSkillWhatsApp
```

Después del despliegue, actualiza el endpoint de la skill si el ARN cambió.

## Publicación del Worker

```powershell
dotnet publish VoiceMessaging.Worker\VoiceMessaging.Worker.csproj `
  -c Release `
  -r win-x64 `
  --self-contained true
```

El proyecto del Worker incluye los archivos necesarios del gateway en su salida. `node_modules`, sesiones, cachés y datos locales se excluyen de la publicación.

## Instalador de Windows

El instalador se define en `Installer/VoiceMessagingInstaller.iss`. Instala el Worker como el servicio de Windows `VoiceMessagingWorker`, prepara las dependencias del gateway y abre la página de autenticación de WhatsApp al finalizar.

Para generar el instalador, revisa primero las rutas locales `OUTPUT_DIR` e `INNO_COMPILER` de `build-installer.bat` y luego ejecútalo:

```powershell
.\build-installer.bat
```

La instalación requiere privilegios de administrador y Node.js 20 LTS o superior. Los datos persistentes del gateway se guardan fuera de la carpeta de instalación para sobrevivir a reinstalaciones.

## Comprobaciones rápidas

```powershell
dotnet build "Mensajería de Voz Personal.slnx" --no-restore
node --check VoiceMessaging.Worker\WhatsAppGateway\app.js
node --check VoiceMessaging.Worker\WhatsAppGateway\whatsapp.js
Get-Content Skill_VoiceMessage.json | ConvertFrom-Json | Out-Null
```

## Enfoque del proyecto

El proyecto sigue siendo un MVP enfocado en accesibilidad y funcionamiento de extremo a extremo. Se favorecen cambios pequeños, código directo y reutilización de los componentes existentes antes de introducir capas o patrones adicionales.

## Licencia

Proyecto personal desarrollado con fines educativos y de apoyo a la accesibilidad mediante asistentes de voz. Consulta `LICENSE.txt` para conocer los términos aplicables.
