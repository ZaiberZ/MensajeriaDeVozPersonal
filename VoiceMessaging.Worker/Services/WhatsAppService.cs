using Shared.Models;
using System.Net.Http.Json;

namespace VoiceMessaging.Worker.Services;

public class WhatsAppService
{
    private readonly HttpClient _httpClient;

    public WhatsAppService(HttpClient http)
    {
        _httpClient = http;
    }

    public async Task SendMessageAsync(string phone, string text)
    {
        var request = new { phone, text };

        var response = await _httpClient.PostAsJsonAsync("/send", request);

        var body = await response.Content.ReadAsStringAsync();

        Console.WriteLine($"Status: {response.StatusCode}");
        Console.WriteLine(body);
    }

    public async Task<List<WhatsAppIncomingMessageDto>> GetMessagesAsync()
    {
        try
        {
            var messages = await _httpClient.GetFromJsonAsync<List<WhatsAppIncomingMessageDto>>("/messages");

            return messages ?? [];
        }
        catch (Exception ex)
        {
            Console.WriteLine("Error al leer mensajes desde WhatsAppGateway:");
            Console.WriteLine(ex.Message);

            return [];
        }
    }

    public async Task<List<WhatsAppIncomingMessageDto>?> GetUnreadMessagesAsync()
    {
        var response = await _httpClient.GetAsync("/unread-messages");

        if (response.StatusCode == System.Net.HttpStatusCode.ServiceUnavailable)
            return null;

        response.EnsureSuccessStatusCode();
        var messages = await response.Content.ReadFromJsonAsync<List<WhatsAppIncomingMessageDto>>();

        return messages ?? [];
    }

    public async Task MarkChatAsReadAsync(string chatId)
    {
        var response = await _httpClient.PostAsJsonAsync("/mark-read", new { chatId });

        response.EnsureSuccessStatusCode();
    }

    public async Task ReportWorkerStatusAsync(bool hasPendingMessages, CancellationToken stoppingToken)
    {
        var response = await _httpClient.PostAsJsonAsync(
            "/worker-status",
            new { hasPendingMessages },
            stoppingToken);

        response.EnsureSuccessStatusCode();
    }

    public async Task SendReplyAsync(ReplyMessageDto reply)
    {
        var request = new
        {
            account = reply.Account,
            chatId = reply.ChatId,
            phone = reply.Phone,
            text = reply.Text
        };

        var response = await _httpClient.PostAsJsonAsync("/send", request);

        // var body = await response.Content.ReadAsStringAsync();

        // Console.WriteLine($"WhatsAppGateway status: {response.StatusCode}");
        // Console.WriteLine(body);

        response.EnsureSuccessStatusCode();
    }
}
