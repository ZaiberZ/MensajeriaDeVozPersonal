# Voice Messaging Hub (MVP)

## Descripción

Voice Messaging Hub es un proyecto personal cuyo objetivo es permitir que una persona con discapacidad visual pueda leer y responder mensajes de WhatsApp completamente mediante comandos de voz utilizando Alexa.

El proyecto funciona como un intermediario entre Alexa y WhatsApp. Alexa nunca se comunica directamente con WhatsApp; toda la comunicación se realiza a través de Firebase Realtime Database y un Worker Service.

Actualmente el proyecto se encuentra en fase **MVP (Minimum Viable Product)**, por lo que se prioriza la simplicidad, la rapidez de desarrollo y un flujo completamente funcional antes que una arquitectura compleja.

---

# Arquitectura

```text
Usuario
    │
    ▼
Alexa
    │
AWS Lambda (.NET 8)
    │
Firebase Realtime Database
    │
Worker Service (.NET 8)
    │
WhatsApp Gateway (Node.js + whatsapp-web.js)
    │
WhatsApp
```

---

# Objetivos del proyecto

* Leer mensajes de WhatsApp utilizando Alexa.
* Responder mensajes completamente por voz.
* Mantener una conversación natural mediante comandos de voz.
* Facilitar el uso de WhatsApp a personas con discapacidad visual.

---

# Estado actual

Actualmente el MVP permite:

* Apertura de la Skill de Alexa.
* Lectura de mensajes pendientes desde Firebase.
* Agrupación de mensajes por conversación.
* Navegación entre conversaciones.
* Repetir la conversación actual.
* Responder mensajes mediante voz.
* Confirmar el envío de respuestas.
* Guardar respuestas en Firebase.
* Envío automático de respuestas mediante el Worker.
* Recepción automática de mensajes desde WhatsApp.
* Persistencia de la sesión de WhatsApp.
* Comunicación entre Worker y WhatsApp mediante una API local.

---

# Tecnologías utilizadas

## Backend

* .NET 8
* Worker Service
* AWS Lambda
* Alexa Skills Kit
* Firebase Realtime Database
* HttpClient
* System.Text.Json

## WhatsApp

* Node.js
* Express
* whatsapp-web.js
* Puppeteer
* QRCode

## Instalación

* Inno Setup 6

---

# Filosofía del proyecto

Este proyecto está desarrollado siguiendo una filosofía **MVP**.

Se prioriza:

* Código sencillo.
* Pocas clases.
* Reutilización del código existente.
* Fácil mantenimiento.
* Desarrollo incremental.
* Funcionalidad antes que perfección.

Por el momento se evita implementar arquitecturas complejas como:

* Clean Architecture
* CQRS
* DDD
* MediatR
* Microservicios
* Patrones innecesarios

La idea es contar primero con un sistema completamente funcional y posteriormente refactorizar donde realmente sea necesario.

---

# Estructura de la solución

```text
AlexaSkillWhatsApp.sln

├── AlexaSkillWhatsApp
│   AWS Lambda
│
├── VoiceMessaging.Worker
│   Worker Service
│
├── AlexaSkillWhatsApp.Shared
│   Modelos y servicios compartidos
│
└── WhatsAppGateway
    Node.js + Express + whatsapp-web.js
```

---

# Requisitos de desarrollo

Antes de compilar el proyecto es necesario instalar:

## Software requerido

* Visual Studio 2022 (con soporte para .NET 8)
* .NET 8 SDK
* Node.js 20 LTS o superior
* Inno Setup 6
* Git

---

# Dependencias de Node.js

Dentro del proyecto **WhatsAppGateway** instalar:

* express
* whatsapp-web.js
* qrcode
* cors
* nodemon

Instalación:

```bash
npm install
```

---

# Compilar el proyecto

## Worker

```bash
dotnet publish -c Release -r win-x64 --self-contained true
```

## WhatsApp Gateway

```bash
npm install
npm run dev
```

---

# Instalación

El proyecto utiliza **Inno Setup 6** para generar el instalador.

El instalador:

* Copia el Worker.
* Copia el WhatsApp Gateway.
* Registra el Worker como Servicio de Windows.
* Configura el inicio automático del servicio.

---

# Próximas funcionalidades

* Múltiples cuentas de WhatsApp.
* Mensajes de voz.
* Conversión de audio a texto.
* Lectura de notas de voz.
* Integración con Airbnb.
* Sincronización avanzada.
* Notificaciones de nuevos mensajes.
* Empaquetado del WhatsApp Gateway como ejecutable.

---

# Licencia

Proyecto personal desarrollado con fines educativos y de apoyo a la accesibilidad mediante asistentes de voz.
