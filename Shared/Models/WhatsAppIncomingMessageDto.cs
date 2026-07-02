using System.Text.Json.Serialization;

namespace Shared.Models;

public class WhatsAppIncomingMessageDto
{
    [JsonPropertyName("chatId")]
    public string ChatId { get; set; } = "";
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("sender")]
    public string Sender { get; set; } = "";

    [JsonPropertyName("phone")]
    public string Phone { get; set; } = "";

    [JsonPropertyName("text")]
    public string Text { get; set; } = "";

    [JsonPropertyName("source")]
    public string Source { get; set; } = "WhatsApp";

    [JsonPropertyName("account")]
    public string Account { get; set; } = "Personal";

    [JsonPropertyName("date")]
    public DateTime Date { get; set; } = DateTime.UtcNow;
}
