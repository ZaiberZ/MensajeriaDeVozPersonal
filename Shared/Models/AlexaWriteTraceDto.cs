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

public class AlexaDeliveryReceiptDto
{
    [JsonPropertyName("operation")]
    public string Operation { get; set; } = "";

    [JsonPropertyName("recipient")]
    public string Recipient { get; set; } = "";

    [JsonPropertyName("text")]
    public string Text { get; set; } = "";

    [JsonPropertyName("whatsAppMessageId")]
    public string WhatsAppMessageId { get; set; } = "";

    [JsonPropertyName("confirmedAt")]
    public DateTime ConfirmedAt { get; set; }

    [JsonPropertyName("minimumAck")]
    public int MinimumAck { get; set; } = 1;

    [JsonPropertyName("ackMeaning")]
    public string AckMeaning { get; set; } = "server_received";

    [JsonPropertyName("replyId")]
    public string ReplyId { get; set; } = "";
}
