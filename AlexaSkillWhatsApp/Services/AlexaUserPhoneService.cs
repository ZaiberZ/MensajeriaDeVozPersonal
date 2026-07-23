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

        var alexaIdHash = CreateKey(alexaUserId);
        var phone = await FindPhoneInUsersAsync(alexaIdHash);

        if (!string.IsNullOrWhiteSpace(phone))
            return phone;

        var legacyRecord = await GetLegacyRecordAsync(alexaIdHash);

        if (legacyRecord == null || string.IsNullOrWhiteSpace(legacyRecord.Phone))
            return null;

        return DigitsOnly(legacyRecord.Phone);
    }

    public async Task SavePhoneAsync(string alexaUserId, string phone)
    {
        if (string.IsNullOrWhiteSpace(alexaUserId))
            throw new InvalidOperationException("La solicitud no contiene el identificador del usuario de Alexa.");

        var normalizedPhone = DigitsOnly(phone);

        if (string.IsNullOrWhiteSpace(normalizedPhone))
            throw new InvalidOperationException("El teléfono no contiene dígitos válidos.");

        var alexaIdHash = CreateKey(alexaUserId);
        var updatedAt = AppClock.Now;
        var previousPhone = await FindPhoneInUsersAsync(alexaIdHash);
        var legacyRecord = await GetLegacyRecordAsync(alexaIdHash);

        if (string.IsNullOrWhiteSpace(previousPhone) && legacyRecord != null)
            previousPhone = DigitsOnly(legacyRecord.Phone);

        var targetAlexaIdHash = await GetCanonicalAlexaIdHashAsync(normalizedPhone);

        if (!string.IsNullOrWhiteSpace(targetAlexaIdHash) && targetAlexaIdHash != alexaIdHash)
            throw new InvalidOperationException("El teléfono ya está asociado con otro usuario de Alexa.");

        var record = new AlexaUserPhone
        {
            Phone = normalizedPhone,
            UpdatedAt = updatedAt
        };
        var updates = new Dictionary<string, object?>
        {
            [$"usuarios/{normalizedPhone}/configuracion/id_alexa_hash"] = alexaIdHash,
            [$"usuarios/{normalizedPhone}/configuracion/alexa_actualizado_en"] = updatedAt,
            [$"usuarios_alexa/{alexaIdHash}"] = record
        };

        if (!string.IsNullOrWhiteSpace(previousPhone) && previousPhone != normalizedPhone)
        {
            updates[$"usuarios/{previousPhone}/configuracion/id_alexa_hash"] = null;
            updates[$"usuarios/{previousPhone}/configuracion/alexa_actualizado_en"] = null;
        }

        var content = CreateJsonContent(updates);
        var response = await _httpClient.PatchAsync($"{FirebaseSettings.BaseUrl}/.json", content);
        response.EnsureSuccessStatusCode();
    }

    private async Task<string?> FindPhoneInUsersAsync(string alexaIdHash)
    {
        var orderBy = Uri.EscapeDataString("\"configuracion/id_alexa_hash\"");
        var equalTo = Uri.EscapeDataString(JsonSerializer.Serialize(alexaIdHash));
        var url = $"{FirebaseSettings.Users}.json?orderBy={orderBy}&equalTo={equalTo}&limitToFirst=2";

        try
        {
            var json = await _httpClient.GetStringAsync(url);

            if (string.IsNullOrWhiteSpace(json) || json == "null")
                return null;

            var users = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json);

            if (users == null || users.Count == 0)
                return null;

            if (users.Count > 1)
                throw new InvalidOperationException("El identificador de Alexa está asociado con más de un teléfono.");

            return DigitsOnly(users.Keys.Single());
        }
        catch (HttpRequestException)
        {
            return null;
        }
    }

    private async Task<AlexaUserPhone?> GetLegacyRecordAsync(string alexaIdHash)
    {
        var json = await _httpClient.GetStringAsync($"{FirebaseSettings.LegacyAlexaUser(alexaIdHash)}.json");

        if (string.IsNullOrWhiteSpace(json) || json == "null")
            return null;

        return JsonSerializer.Deserialize<AlexaUserPhone>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
    }

    private async Task<string?> GetCanonicalAlexaIdHashAsync(string phone)
    {
        var json = await _httpClient.GetStringAsync($"{FirebaseSettings.AlexaIdHashFor(phone)}.json");

        if (string.IsNullOrWhiteSpace(json) || json == "null")
            return null;

        return JsonSerializer.Deserialize<string>(json);
    }

    private static StringContent CreateJsonContent(object value) =>
        new(JsonSerializer.Serialize(value), Encoding.UTF8, "application/json");

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
