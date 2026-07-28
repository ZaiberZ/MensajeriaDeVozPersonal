namespace VoiceInterpreter;

public sealed class AppSettings
{
    public string SpanishVoice { get; set; } = string.Empty;

    public string EnglishVoice { get; set; } = string.Empty;

    public string SpanishVoskModelPath { get; set; } = "Models/vosk-model-small-es-0.42";

    public string EnglishVoskModelPath { get; set; } = "Models/vosk-model-small-en-us-0.15";
}
