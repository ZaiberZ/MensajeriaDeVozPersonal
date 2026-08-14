using System.Text.Json.Serialization;

namespace VoiceMessaging.Worker.Models;

public class GatewayLogDto
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("timestamp")]
    public DateTimeOffset Timestamp { get; set; }

    [JsonPropertyName("level")]
    public string Level { get; set; } = "";

    [JsonPropertyName("source")]
    public string Source { get; set; } = "";

    [JsonPropertyName("message")]
    public string Message { get; set; } = "";

    [JsonPropertyName("detail")]
    public string? Detail { get; set; }

    [JsonPropertyName("attemptCount")]
    public int AttemptCount { get; set; } = 1;

    [JsonPropertyName("lastAttemptAt")]
    public DateTimeOffset LastAttemptAt { get; set; }

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

public class WhatsAppSendResponseDto
{
    [JsonPropertyName("success")]
    public bool Success { get; set; }

    [JsonPropertyName("confirmed")]
    public bool Confirmed { get; set; }

    [JsonPropertyName("messageId")]
    public string MessageId { get; set; } = "";
}

public class MarkLogsReportedResponseDto
{
    [JsonPropertyName("success")]
    public bool Success { get; set; }

    [JsonPropertyName("updatedCount")]
    public int UpdatedCount { get; set; }
}
