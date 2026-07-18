using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Shared.Configuration;

namespace AlexaSkillWhatsApp.Services;

public class AlexaUserPhoneService
{
    private readonly HttpClient _httpClient = FirebaseHttpClient.Create();

    public async Task<string?> GetPhoneAsync(string alexaUserId)
    {
        if (string.IsNullOrWhiteSpace(alexaUserId))
            return null;

        var path = FirebaseSettings.AlexaUser(CreateKey(alexaUserId));
        var json = await _httpClient.GetStringAsync($"{path}.json");

        if (string.IsNullOrWhiteSpace(json) || json == "null")
            return null;

        return JsonSerializer.Deserialize<AlexaUserPhone>(json)?.Phone;
    }

    public async Task SavePhoneAsync(string alexaUserId, string phone)
    {
        if (string.IsNullOrWhiteSpace(alexaUserId))
            throw new InvalidOperationException("La solicitud no contiene el identificador del usuario de Alexa.");

        var record = new AlexaUserPhone
        {
            Phone = DigitsOnly(phone),
            UpdatedAt = AppClock.Now
        };

        var path = FirebaseSettings.AlexaUser(CreateKey(alexaUserId));
        var content = new StringContent(
            JsonSerializer.Serialize(record),
            Encoding.UTF8,
            "application/json");

        var response = await _httpClient.PutAsync($"{path}.json", content);
        response.EnsureSuccessStatusCode();
    }

    private static string CreateKey(string alexaUserId)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(alexaUserId));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static string DigitsOnly(string value) =>
        new(value.Where(char.IsDigit).ToArray());

    private sealed class AlexaUserPhone
    {
        public string Phone { get; set; } = "";
        public DateTime UpdatedAt { get; set; }
    }
}
