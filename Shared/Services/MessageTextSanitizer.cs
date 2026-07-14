using System.Globalization;
using System.Text.RegularExpressions;

namespace AlexaSkillWhatsApp.Services;

public static class MessageTextSanitizer
{
    private static readonly Regex UrlPattern = new(@"\b(?:https?://|www\.)\S+", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex RepeatedSpacesPattern = new(@"\s{2,}", RegexOptions.Compiled);

    public static string ReplaceLinksForSpeech(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return "";

        var sanitizedText = UrlPattern.Replace(text, "Enlace");
        return RepeatedSpacesPattern.Replace(sanitizedText, " ").Trim();
    }

    public static string ReplaceLinksForSpeech(string? text, int maxLength)
    {
        var sanitizedText = ReplaceLinksForSpeech(text);

        if (sanitizedText.Length <= maxLength)
            return sanitizedText;

        var textElementIndexes = StringInfo.ParseCombiningCharacters(sanitizedText);
        var cutoffIndex = textElementIndexes.LastOrDefault(index => index <= maxLength);

        if (cutoffIndex == 0)
            cutoffIndex = textElementIndexes[0];

        return $"{sanitizedText[..cutoffIndex].TrimEnd()}... mensaje recortado por ser demasiado largo";
    }
}
