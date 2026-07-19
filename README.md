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
Skill_VoiceMessage_Es-MX.json             Modelo de interacción de Alexa en español
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

## Después de clonar

Cada clon debe usar servicios y credenciales propios. La creación y configuración detallada de Firebase, Gmail, AWS Lambda y Alexa Developer Console está en [FIREBASE_AUTH_SETUP.md](FIREBASE_AUTH_SETUP.md).

Después de clonar, crea el archivo privado de configuración:

```powershell
Copy-Item .env.example .env.local
notepad .env.local
```

Completa las cuatro variables de Firebase. Las tres variables de Gmail son opcionales. `.env.local` está excluido por `.gitignore`; nunca lo agregues con `git add -f`.

Prepara las dependencias:

```powershell
dotnet restore "Mensajería de Voz Personal.slnx"
cd VoiceMessaging.Worker\WhatsAppGateway
npm install
cd ..\..
```

Inicia el Worker:

```powershell
$env:DOTNET_ENVIRONMENT = "Development"
dotnet run --project VoiceMessaging.Worker\VoiceMessaging.Worker.csproj
```

Para una prueba completa:

1. Publica primero las reglas y verifica la cuenta técnica de Firebase.
2. Ejecuta el Worker desde la raíz con `dotnet run --project VoiceMessaging.Worker\VoiceMessaging.Worker.csproj`.
3. Abre `http://localhost:3000/whatsapp/qr`, registra los datos del usuario y escanea el QR.
4. Revisa `http://localhost:3000/app-status` y confirma que Worker, WhatsApp y Firebase responden.
5. Si habilitaste Gmail, inicia OAuth desde la página de estado y prueba una sincronización.
6. Despliega y configura Lambda y la skill siguiendo [FIREBASE_AUTH_SETUP.md](FIREBASE_AUTH_SETUP.md#4-configurar-aws-lambda).
7. Ejecuta `ConfigurarTelefonoIntent` con el mismo teléfono registrado en el Worker.
8. Confirma el teléfono y prueba lectura, navegación y respuesta de mensajes.

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

Para generar el instalador, completa primero `.env.local`, revisa las rutas locales `OUTPUT_DIR` e `INNO_COMPILER` de `build-installer.bat` y luego ejecútalo:

```powershell
.\build-installer.bat
```

`build-installer.bat` detiene la compilación si `.env.local` no existe. Inno Setup incorpora ese archivo dentro del instalador y lo instala automáticamente como `C:\ProgramData\VoiceMessaging\environment.env`, protegido para `SYSTEM` y administradores. El usuario final no tiene que volver a capturar las variables en cada instalación o reinstalación.

El instalador generado contiene las credenciales del clon que lo compiló. Trátalo como un artefacto privado: no lo publiques en GitHub Releases ni lo compartas con personas que no deban usar esa instancia de Firebase y Gmail.

La instalación requiere privilegios de administrador y Node.js 20 LTS o superior. Los datos persistentes del gateway se guardan fuera de la carpeta de instalación para sobrevivir a reinstalaciones.

## Comprobaciones rápidas

```powershell
dotnet build "Mensajería de Voz Personal.slnx" --no-restore
node --check VoiceMessaging.Worker\WhatsAppGateway\app.js
node --check VoiceMessaging.Worker\WhatsAppGateway\whatsapp.js
Get-Content Skill_VoiceMessage_Es-MX.json | ConvertFrom-Json | Out-Null
```

## Enfoque del proyecto

El proyecto sigue siendo un MVP enfocado en accesibilidad y funcionamiento de extremo a extremo. Se favorecen cambios pequeños, código directo y reutilización de los componentes existentes antes de introducir capas o patrones adicionales.

## Contacto y pruebas

Si te interesa instalar el proyecto para probarlo, evaluar su uso con un familiar con discapacidad visual o colaborar en su desarrollo, puedes contactarme mediante [LinkedIn](https://www.linkedin.com/in/luis-adrian-mr), [mi perfil de GitHub](https://github.com/ZaiberZ) o [abrir una consulta en el repositorio](https://github.com/ZaiberZ/MensajeriaDeVozPersonal/issues/new).

Las consultas de GitHub son públicas. No incluyas teléfonos, correos personales, credenciales, tokens, datos médicos ni información privada de la persona que utilizará el sistema. Describe únicamente el escenario general y podremos acordar por separado el canal apropiado para continuar.

Este es un desarrollo personal orientado a accesibilidad y actualmente se ofrece para pruebas y colaboración; no constituye un servicio oficial de soporte, salud o emergencias.

## Licencia

Proyecto personal desarrollado con fines educativos y de apoyo a la accesibilidad mediante asistentes de voz. Consulta `LICENSE.txt` para conocer los términos aplicables.
