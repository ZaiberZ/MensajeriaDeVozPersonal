using Shared.Models;
using System.Net.Http.Json;

namespace VoiceMessaging.Worker.Services;

public class AirbnbService
{
    private readonly HttpClient _httpClient;

    public AirbnbService(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    public async Task<List<AirbnbIncomingMessageDto>> GetMessagesAsync(CancellationToken cancellationToken)
    {
        var response = await _httpClient.GetAsync("/airbnb/messages", cancellationToken);
        response.EnsureSuccessStatusCode();

        return await response.Content.ReadFromJsonAsync<List<AirbnbIncomingMessageDto>>(cancellationToken: cancellationToken) ?? [];
    }

    public async Task<bool> IsAuthenticatedAsync(CancellationToken cancellationToken)
    {
        var response = await _httpClient.GetAsync("/airbnb/status", cancellationToken);
        response.EnsureSuccessStatusCode();
        var status = await response.Content.ReadFromJsonAsync<AirbnbStatusDto>(cancellationToken: cancellationToken);

        return status?.Authenticated == true;
    }

    public async Task SendReplyAsync(ReplyMessageDto reply, CancellationToken cancellationToken)
    {
        var response = await _httpClient.PostAsJsonAsync(
            "/airbnb/send",
            new { chatId = reply.ChatId, text = reply.Text },
            cancellationToken);
        var result = await response.Content.ReadFromJsonAsync<AirbnbSendResultDto>(cancellationToken: cancellationToken);

        if (!response.IsSuccessStatusCode || result?.Success != true)
            throw new InvalidOperationException(result?.Message ?? $"Airbnb respondió HTTP {(int)response.StatusCode}.");
    }

    private sealed class AirbnbSendResultDto
    {
        public bool Success { get; set; }
        public string Message { get; set; } = "";
    }

    private sealed class AirbnbStatusDto
    {
        public bool Authenticated { get; set; }
    }
}
