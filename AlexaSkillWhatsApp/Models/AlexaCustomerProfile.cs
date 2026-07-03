using System.Text.Json.Serialization;

namespace AlexaSkillWhatsApp.Models;

public class AlexaMobileNumber
{
    [JsonPropertyName("countryCode")]
    public string CountryCode { get; set; } = "";

    [JsonPropertyName("phoneNumber")]
    public string PhoneNumber { get; set; } = "";
}
