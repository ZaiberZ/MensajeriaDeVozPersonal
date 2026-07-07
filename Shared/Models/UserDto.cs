using System.Text.Json.Serialization;

namespace Shared.Models;

public class UserDto
{
    [JsonPropertyName("Phone")]
    public string Phone { get; set; } = "";

    [JsonPropertyName("FullName")]
    public string FullName { get; set; } = "";

    [JsonPropertyName("Email")]
    public string Email { get; set; } = "";

    [JsonPropertyName("SupportPhone")]
    public string SupportPhone { get; set; } = "";

    [JsonPropertyName("IsRegistered")]
    public bool IsRegistered { get; set; }
}

public class GatewayStatusDto
{
    [JsonPropertyName("connected")]
    public bool Connected { get; set; }

    [JsonPropertyName("User")]
    public UserDto User { get; set; } = new();
}
