namespace VoiceInterpreter;

public sealed class TranslationStatus
{
    public bool PythonAvailable { get; init; }

    public bool ArgosTranslateAvailable { get; init; }

    public bool SpanishToEnglishModelAvailable { get; init; }

    public bool EnglishToSpanishModelAvailable { get; init; }

    public string ErrorMessage { get; init; } = string.Empty;

    public bool IsReady => PythonAvailable
        && ArgosTranslateAvailable
        && SpanishToEnglishModelAvailable
        && EnglishToSpanishModelAvailable;
}
