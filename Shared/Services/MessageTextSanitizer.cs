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
}
