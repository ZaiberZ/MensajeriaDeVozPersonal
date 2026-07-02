using System.Text.Json.Serialization;

namespace Shared.Models;

public class MessageDto
{
    public string Id { get; set; } = Guid.NewGuid().ToString();

    [JsonPropertyName("source")]
    public string Source { get; set; } = "WhatsApp";

    [JsonPropertyName("account")]
    public string Account { get; set; } = "Personal";

    [JsonPropertyName("sender")]
    public string Sender { get; set; } = "";

    [JsonPropertyName("text")]
    public string Text { get; set; } = "";

    [JsonPropertyName("isAudio")]
    public bool IsAudio { get; set; }

    [JsonPropertyName("audioUrl")]
    public string? AudioUrl { get; set; }

    [JsonPropertyName("date")]
    public DateTime Date { get; set; } = DateTime.Now;

    [JsonPropertyName("isRead")]
    public bool IsRead { get; set; }
    [JsonPropertyName("phone")]
    public string Phone { get; set; } = "";
}

public class ReplyMessageDto
{
    public string Id { get; set; } = string.Empty;
    public string MessageId { get; set; } = "";
    public string Source { get; set; } = "";      // WhatsApp | Airbnb
    public string Account { get; set; } = "";     // Personal | Trabajo | Host
    public string Sender { get; set; } = "";
    public string Text { get; set; } = "";
    public DateTime Date { get; set; } = DateTime.UtcNow;
    public string Phone { get; set; } = "";
}