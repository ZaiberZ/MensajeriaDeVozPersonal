using System.Text.Json.Serialization;

namespace AlexaSkillWhatsApp.Models;

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
}