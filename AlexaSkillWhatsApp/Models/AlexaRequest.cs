using System.Text.Json.Serialization;

namespace AlexaSkillWhatsApp.Models;

public class AlexaRequest
{
    [JsonPropertyName("version")]
    public string Version { get; set; } = string.Empty;

    [JsonPropertyName("session")]
    public Session? Session { get; set; }

    [JsonPropertyName("request")]
    public RequestBody Request { get; set; } = new();
}

public class Session
{
    [JsonPropertyName("new")]
    public bool New { get; set; }
}

public class RequestBody
{
    [JsonPropertyName("type")]
    public string Type { get; set; } = string.Empty;

    [JsonPropertyName("locale")]
    public string? Locale { get; set; }

    [JsonPropertyName("intent")]
    public IntentBody? Intent { get; set; }
}

public class IntentBody
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;
}