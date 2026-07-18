using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace AlexaSkillWhatsApp.Services;

internal static class FirebaseAuthTokenProvider
{
    private static readonly HttpClient HttpClient = new();
    private static readonly SemaphoreSlim RefreshLock = new(1, 1);
    private static string? idToken;
    private static DateTimeOffset expiresAt;

    public static async Task<string> GetIdTokenAsync(CancellationToken cancellationToken = default)
    {
        if (!string.IsNullOrWhiteSpace(idToken) && expiresAt > DateTimeOffset.UtcNow.AddMinutes(5))
            return idToken;

        await RefreshLock.WaitAsync(cancellationToken);

        try
        {
            if (!string.IsNullOrWhiteSpace(idToken) && expiresAt > DateTimeOffset.UtcNow.AddMinutes(5))
                return idToken;

            var apiKey = GetRequiredEnvironmentVariable("VOICE_MESSAGING_FIREBASE_API_KEY");
            var payload = new
            {
                email = GetRequiredEnvironmentVariable("VOICE_MESSAGING_FIREBASE_EMAIL"),
                password = GetRequiredEnvironmentVariable("VOICE_MESSAGING_FIREBASE_PASSWORD"),
                returnSecureToken = true
            };
            var response = await HttpClient.PostAsJsonAsync(
                $"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={Uri.EscapeDataString(apiKey)}",
                payload,
                cancellationToken);

            response.EnsureSuccessStatusCode();
            var token = await response.Content.ReadFromJsonAsync<FirebaseTokenResponse>(cancellationToken: cancellationToken)
                ?? throw new InvalidOperationException("Firebase Authentication no devolvió un token.");

            if (string.IsNullOrWhiteSpace(token.IdToken))
                throw new InvalidOperationException("Firebase Authentication devolvió un ID token vacío.");

            idToken = token.IdToken;
            expiresAt = DateTimeOffset.UtcNow.AddSeconds(ParseExpiration(token.ExpiresIn));
            return idToken;
        }
        finally
        {
            RefreshLock.Release();
        }
    }

    private static int ParseExpiration(string? value) =>
        int.TryParse(value, out var seconds) && seconds > 0 ? seconds : 3600;

    private static string GetRequiredEnvironmentVariable(string name)
    {
        var value = Environment.GetEnvironmentVariable(name);

        if (string.IsNullOrWhiteSpace(value))
            throw new InvalidOperationException($"Falta la variable de entorno requerida {name}.");

        return value;
    }

    private sealed class FirebaseTokenResponse
    {
        [JsonPropertyName("idToken")]
        public string IdToken { get; set; } = "";

        [JsonPropertyName("expiresIn")]
        public string ExpiresIn { get; set; } = "3600";
    }
}
