using Microsoft.CognitiveServices.Speech;

namespace VoiceInterpreter;

public sealed class SpeechService
{
    private readonly AppSettings settings;

    public SpeechService(AppSettings settings)
    {
        this.settings = settings;
    }

    public SpeechConfig CreateSpeechConfig()
    {
        if (string.IsNullOrWhiteSpace(settings.SpeechKey))
        {
            throw new InvalidOperationException("SpeechKey no está configurada.");
        }

        if (string.IsNullOrWhiteSpace(settings.SpeechRegion))
        {
            throw new InvalidOperationException("SpeechRegion no está configurada.");
        }

        return SpeechConfig.FromSubscription(settings.SpeechKey, settings.SpeechRegion);
    }
}
