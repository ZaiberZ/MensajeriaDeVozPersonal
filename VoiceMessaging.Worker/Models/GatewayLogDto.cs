using System.Text.Json.Serialization;

namespace VoiceMessaging.Worker.Models;

public class GatewayLogDto
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("timestamp")]
    public DateTime Timestamp { get; set; }

    [JsonPropertyName("level")]
    public string Level { get; set; } = "";

    [JsonPropertyName("source")]
    public string Source { get; set; } = "";

    [JsonPropertyName("message")]
    public string Message { get; set; } = "";

    [JsonPropertyName("attemptCount")]
    public int AttemptCount { get; set; } = 1;

    [JsonPropertyName("lastAttemptAt")]
    public DateTime LastAttemptAt { get; set; }

    [JsonPropertyName("reportedAt")]
    public DateTime? ReportedAt { get; set; }
}

public class GatewayLogsResponseDto
{
    [JsonPropertyName("count")]
    public int Count { get; set; }

    [JsonPropertyName("allIds")]
    public List<string> AllIds { get; set; } = [];

    [JsonPropertyName("logs")]
    public List<GatewayLogDto> Logs { get; set; } = [];
}
