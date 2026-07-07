using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Shared.Models;

namespace VoiceMessaging.Worker.Services;

public static class MessageFilter
{
    private static readonly Regex[] AdvertisingPatterns =
    [
        new(@"\bprestamo\b", RegexOptions.Compiled),
        new(@"tarjeta\s+de\s+credito", RegexOptions.Compiled),
        new(@"meses\s+sin\s+intereses", RegexOptions.Compiled),
        new(@"\bpromocion(?:es)?\b", RegexOptions.Compiled),
        new(@"\baprovecha\b.*\b(descuento|oferta|meses|promocion)", RegexOptions.Compiled),
        new(@"\bvig\.?\s*\d{1,2}\s*/\s*\w+", RegexOptions.Compiled),
        new(@"elige\s+si\s+o\s+no", RegexOptions.Compiled),
        new(@"dejar\s+de\s+recibir\s+notificaciones", RegexOptions.Compiled),
        new(@"selecciona\s+salir", RegexOptions.Compiled),
        new(@"\bterabox\b", RegexOptions.Compiled),
        new(@"ver\s+o\s+descargar", RegexOptions.Compiled),
        new(@"descargar?\s+(?:la\s+)?(?:pelicula|gratis)", RegexOptions.Compiled),
        new(@"\bgratis\b.*\blink\b|\blink\b.*\bgratis\b", RegexOptions.Compiled)
    ];

    public static bool IsAdvertising(WhatsAppIncomingMessageDto message)
    {
        return IsAdvertising(message.Text);
    }

    public static bool IsAdvertising(MessageDto message)
    {
        return IsAdvertising(message.Text);
    }

    public static bool IsAdvertising(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return false;

        var normalizedText = NormalizeForMatching(text);

        return AdvertisingPatterns.Any(pattern => pattern.IsMatch(normalizedText));
    }

    private static string NormalizeForMatching(string text)
    {
        var normalizedText = text.ToLowerInvariant().Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(normalizedText.Length);

        foreach (var character in normalizedText)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(character) != UnicodeCategory.NonSpacingMark)
                builder.Append(character);
        }

        return builder.ToString().Normalize(NormalizationForm.FormC);
    }
}
