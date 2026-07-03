using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using AlexaSkillWhatsApp.Models;
using Shared.Models;

namespace AlexaSkillWhatsApp.Services;

public class AlexaCustomerProfileService
{
    public async Task<UserDto> GetUserAsync(AlexaRequest request)
    {
        var token = request.Context.System.ApiAccessToken;
        var endpoint = request.Context.System.ApiEndpoint;

        if (string.IsNullOrWhiteSpace(token) || string.IsNullOrWhiteSpace(endpoint))
            throw new AlexaProfilePermissionException();

        using var httpClient = new HttpClient { BaseAddress = new Uri(endpoint) };
        using var profileRequest = new HttpRequestMessage(HttpMethod.Get, "/v2/accounts/~current/settings/Profile.mobileNumber");

        profileRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await httpClient.SendAsync(profileRequest);

        if (response.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.Unauthorized)
            throw new AlexaProfilePermissionException();

        response.EnsureSuccessStatusCode();

        var mobile = await response.Content.ReadFromJsonAsync<AlexaMobileNumber>()
            ?? throw new InvalidOperationException("Alexa no devolvió el teléfono del usuario.");

        var countryCode = DigitsOnly(mobile.CountryCode);
        var phone = DigitsOnly(mobile.PhoneNumber);

        if (string.IsNullOrWhiteSpace(phone))
            throw new InvalidOperationException("El perfil de Alexa no tiene un teléfono configurado.");

        if (!string.IsNullOrWhiteSpace(countryCode) && !phone.StartsWith(countryCode))
            phone = countryCode + phone;

        return new UserDto
        {
            Phone = phone,
            IsRegistered = true
        };
    }

    private static string DigitsOnly(string value) =>
        new(value.Where(char.IsDigit).ToArray());
}

public class AlexaProfilePermissionException : Exception
{
}
