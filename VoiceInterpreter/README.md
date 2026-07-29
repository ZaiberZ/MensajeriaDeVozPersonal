# VoiceInterpreter

VoiceInterpreter es un MVP de accesibilidad para mantener conversaciones presenciales entre una persona que habla español y otra que habla inglés.

La interacción final está pensada para funcionar principalmente mediante voz. La ventana WPF actual contiene controles temporales para desarrollo, diagnóstico y configuración inicial.

## Funcionalidad actual

- Síntesis local en español e inglés con las voces instaladas en Windows.
- Reconocimiento local mediante Vosk.
- Captura del micrófono con NAudio.
- Control por comandos de voz en español.
- Reconocimiento libre alternado entre español e inglés.
- Traducción local con Argos Translate.
- Descarga inicial de los modelos Vosk.
- Configuración automática de Python, Argos Translate y sus modelos.
- Cancelación y liberación controlada del micrófono y los procesos externos.

Después de completar la configuración inicial, el reconocimiento, la traducción y la síntesis funcionan localmente.

## Requisitos

- Windows 10 u 11.
- .NET 8.
- Micrófono y bocinas configurados en Windows.
- Una voz de Windows en español.
- Una voz de Windows en inglés.
- WinGet para la configuración automática.
- Conexión a Internet durante la descarga inicial de dependencias y modelos.

Python y Argos Translate no tienen que instalarse manualmente si WinGet está disponible.

## Configuración inicial

1. Ejecuta `VoiceInterpreter`.
2. Instala las voces de Windows desde los botones de soporte si aparecen.
3. Descarga los modelos Vosk de español e inglés desde la aplicación.
4. Pulsa **Configurar traducción automáticamente**.
5. Espera a que se instalen:
   - Python 3.11, si no está disponible.
   - `argostranslate`.
   - Modelo de traducción español a inglés.
   - Modelo de traducción inglés a español.
6. Pulsa **Verificar traducción** para confirmar el estado.

Los datos de Argos Translate se guardan en:

```text
%LOCALAPPDATA%\VoiceInterpreter\Argos
```

## Modelos Vosk

Los modelos recomendados son:

```text
vosk-model-small-es-0.42
vosk-model-small-en-us-0.15
```

Las rutas se configuran en `appsettings.json`:

```json
{
  "SpanishVoskModelPath": "Models/vosk-model-small-es-0.42",
  "EnglishVoskModelPath": "Models/vosk-model-small-en-us-0.15"
}
```

La carpeta `VoiceInterpreter/Models/` está excluida de Git.

## Flujo de uso

1. Pulsa temporalmente **Iniciar escucha de comandos**.
2. Di `iniciar intérprete`.
3. La aplicación comienza escuchando español.
4. La frase se reconoce y traduce al inglés.
5. La traducción se reproduce con la voz inglesa.
6. Un sonido breve indica el turno en inglés.
7. La respuesta inglesa se traduce y reproduce en español.
8. El flujo alterna hasta recibir un comando de finalización.

El micrófono se detiene mientras la aplicación traduce o habla. Esto evita que sus propias respuestas sean reconocidas como entrada.

## Comandos

Comandos principales en español:

```text
iniciar intérprete
repetir
terminar intérprete
ayuda
```

Durante el turno en inglés también se aceptan:

```text
repeat
repeat that
stop interpreter
end interpreter
```

El comando de repetición reproduce la última traducción, no los mensajes de estado.

## Configuración

`appsettings.json` admite:

```json
{
  "SpanishVoice": "",
  "EnglishVoice": "",
  "SpanishVoskModelPath": "Models/vosk-model-small-es-0.42",
  "EnglishVoskModelPath": "Models/vosk-model-small-en-us-0.15",
  "PythonExecutablePath": "python",
  "TranslationScriptPath": "Translation/translate.py"
}
```

Cuando `SpanishVoice` o `EnglishVoice` están vacíos, la aplicación selecciona automáticamente una voz instalada según su cultura.

## Componentes principales

- `SpeechService.cs`: síntesis local y repetición de mensajes.
- `SpeechRecognitionService.cs`: micrófono, modelos Vosk y selección de reconocedor.
- `TranslationService.cs`: comunicación segura con Python y configuración automática.
- `Translation/translate.py`: integración con Argos Translate.
- `MainWindow.xaml.cs`: flujo temporal de conversación y controles de desarrollo.
- `InterpreterState.cs`: estado e idioma del turno actual.

## Compilación

Desde la raíz de la solución:

```powershell
dotnet restore VoiceInterpreter\VoiceInterpreter.csproj
dotnet build VoiceInterpreter\VoiceInterpreter.csproj --no-restore
```

## Limitaciones del MVP

- La escucha se inicia manualmente desde la ventana.
- No existe detección automática de idioma.
- Los turnos alternan obligatoriamente entre español e inglés.
- Se utiliza el primer dispositivo de entrada expuesto por NAudio.
- No se guarda historial.
- No funciona como servicio ni se inicia automáticamente con Windows.
- La ventana todavía contiene herramientas visuales de desarrollo y soporte.
