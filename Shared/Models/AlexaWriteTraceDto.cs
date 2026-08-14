using System.Text.Json.Serialization;

namespace Shared.Models;

public class AlexaWriteTraceDto
{
    [JsonPropertyName("sessionId")]
    public string SessionId { get; set; } = "";

    [JsonPropertyName("startedAt")]
    public DateTime StartedAt { get; set; }

    [JsonPropertyName("updatedAt")]
    public DateTime UpdatedAt { get; set; }

    [JsonPropertyName("status")]
    public string Status { get; set; } = "dictation_started";

    [JsonPropertyName("turns")]
    public List<string> Turns { get; set; } = [];
}
