using System.Text.Json.Serialization;

namespace Shared.Models;

public class AirbnbIncomingMessageDto
{
    [JsonPropertyName("chatId")]
    public string ChatId { get; set; } = "";

    [JsonPropertyName("sender")]
    public string Sender { get; set; } = "";

    [JsonPropertyName("text")]
    public string Text { get; set; } = "";

    [JsonPropertyName("date")]
    public DateTime Date { get; set; } = DateTime.UtcNow;
}
