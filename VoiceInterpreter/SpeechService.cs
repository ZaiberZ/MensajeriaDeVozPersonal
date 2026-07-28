using System.Speech.Synthesis;

namespace VoiceInterpreter;

public sealed class SpeechService
{
    private readonly AppSettings settings;
    private readonly SemaphoreSlim audioLock;

    public SpeechService(AppSettings settings, SemaphoreSlim audioLock)
    {
        this.settings = settings;
        this.audioLock = audioLock;
    }

    public string? LastSpokenText { get; private set; }

    public Task SpeakAsync(string text, string language, CancellationToken cancellationToken = default)
    {
        return SpeakAsync(text, language, rememberText: true, cancellationToken);
    }

    public async Task RepeatLastAsync(string language, CancellationToken cancellationToken = default)
    {
        string? text = LastSpokenText;
        if (string.IsNullOrWhiteSpace(text))
        {
            await SpeakAsync("No hay ningún mensaje para repetir.", language, rememberText: false, cancellationToken);
            return;
        }

        await SpeakAsync(text, language, rememberText: true, cancellationToken);
    }

    public IReadOnlyList<string> GetInstalledVoices()
    {
        using SpeechSynthesizer synthesizer = new();
        return synthesizer.GetInstalledVoices()
            .Where(voice => voice.Enabled)
            .Select(voice => $"{voice.VoiceInfo.Name} ({voice.VoiceInfo.Culture.Name})")
            .ToList();
    }

    public bool HasInstalledVoice(string language)
    {
        using SpeechSynthesizer synthesizer = new();
        return synthesizer.GetInstalledVoices().Any(
            voice => voice.Enabled && voice.VoiceInfo.Culture.Name.StartsWith(language, StringComparison.OrdinalIgnoreCase));
    }

    private async Task SpeakAsync(string text, string language, bool rememberText, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            throw new ArgumentException("El texto que se reproducirá no puede estar vacío.", nameof(text));
        }

        string normalizedLanguage = language.Trim().ToLowerInvariant();
        if (normalizedLanguage is not ("es" or "en"))
        {
            throw new ArgumentException($"El idioma '{language}' no es compatible. Usa 'es' o 'en'.", nameof(language));
        }

        await audioLock.WaitAsync(cancellationToken);

        try
        {
            await Task.Run(() => Speak(text, normalizedLanguage), cancellationToken);

            if (rememberText)
            {
                LastSpokenText = text;
            }
        }
        finally
        {
            audioLock.Release();
        }
    }

    private void Speak(string text, string language)
    {
        using SpeechSynthesizer synthesizer = new();
        InstalledVoice voice = FindVoice(synthesizer, language);

        synthesizer.SelectVoice(voice.VoiceInfo.Name);
        synthesizer.SetOutputToDefaultAudioDevice();
        synthesizer.Speak(text);
    }

    private InstalledVoice FindVoice(SpeechSynthesizer synthesizer, string language)
    {
        string configuredVoice = language == "es" ? settings.SpanishVoice : settings.EnglishVoice;
        IReadOnlyList<InstalledVoice> installedVoices = synthesizer.GetInstalledVoices()
            .Where(voice => voice.Enabled)
            .ToList();

        if (!string.IsNullOrWhiteSpace(configuredVoice))
        {
            InstalledVoice? exactVoice = installedVoices.FirstOrDefault(
                voice => string.Equals(voice.VoiceInfo.Name, configuredVoice, StringComparison.OrdinalIgnoreCase));

            return exactVoice ?? throw new InvalidOperationException(
                $"La voz configurada '{configuredVoice}' no está instalada o no está habilitada en Windows.");
        }

        return installedVoices.FirstOrDefault(
            voice => voice.VoiceInfo.Culture.Name.StartsWith(language, StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidOperationException(
                $"No hay una voz de {GetLanguageName(language)} instalada y habilitada en Windows.");
    }

    private static string GetLanguageName(string language)
    {
        return language == "es" ? "español" : "inglés";
    }
}
