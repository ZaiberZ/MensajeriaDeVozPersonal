using System.Text.Json.Serialization;

namespace Shared.Models;

public class DiagnosticLogDto
{
    [JsonPropertyName("timestamp")]
    public DateTime Timestamp { get; set; }

    [JsonPropertyName("level")]
    public string Level { get; set; } = "error";

    [JsonPropertyName("source")]
    public string Source { get; set; } = "AlexaSkill";

    [JsonPropertyName("message")]
    public string Message { get; set; } = "";

    [JsonPropertyName("detail")]
    public string Detail { get; set; } = "";

    [JsonPropertyName("operation")]
    public string Operation { get; set; } = "";
}
