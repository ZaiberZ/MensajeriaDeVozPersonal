using System.Text.Json;
using System.Text.Json.Serialization;

namespace AlexaSkillWhatsApp.Models;

public class AlexaRequest
{
    //[JsonPropertyName("version")]
    //public string Version { get; set; } = string.Empty;

    [JsonPropertyName("session")]
    public Session? Session { get; set; }

    [JsonPropertyName("request")]
    public RequestBody Request { get; set; } = new();
}

public class Session
{
    [JsonPropertyName("new")]
    public bool New { get; set; }
    [JsonPropertyName("sessionid")]
    public string SessionId { get; set; } = "";
    [JsonPropertyName("attributes")]
    public Dictionary<string, JsonElement>? Attributes { get; set; }
    [JsonPropertyName("user")]
    public SessionUser User { get; set; } = new();
}

public class SessionUser
{
    [JsonPropertyName("userid")]
    public string UserId { get; set; } = "";
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