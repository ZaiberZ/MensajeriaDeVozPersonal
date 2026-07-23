using Shared.Models;
using System.Net.Http.Json;
using VoiceMessaging.Worker.Models;

namespace VoiceMessaging.Worker.Services;

public class WhatsAppService
{
    private readonly HttpClient _httpClient;

    public WhatsAppService(HttpClient http)
    {
        _httpClient = http;
    }

    public async Task<bool> IsConnectedAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            var status = await _httpClient.GetFromJsonAsync<GatewayStatusDto>("/whatsapp/status", cancellationToken);
            return status?.Connected == true;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (HttpRequestException)
        {
            return false;
        }
        catch (TaskCanceledException)
        {
            return false;
        }
    }

    public async Task SendMessageAsync(string phone, string text, CancellationToken cancellationToken = default)
    {
        var request = new { phone, text };
        var response = await _httpClient.PostAsJsonAsync("/whatsapp/send", request, cancellationToken);

        response.EnsureSuccessStatusCode();
    }

    public async Task<List<WhatsAppIncomingMessageDto>> GetMessagesAsync()
    {
        try
        {
            var messages = await _httpClient.GetFromJsonAsync<List<WhatsAppIncomingMessageDto>>("/whatsapp/messages");

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
        var response = await _httpClient.GetAsync("/whatsapp/unread-messages");

        if (response.StatusCode == System.Net.HttpStatusCode.ServiceUnavailable)
            return null;

        response.EnsureSuccessStatusCode();
        var messages = await response.Content.ReadFromJsonAsync<List<WhatsAppIncomingMessageDto>>();

        return messages ?? [];
    }

    public async Task<List<WhatsAppIncomingMessageDto>?> GetRecentMessagesAsync(IEnumerable<string> chatIds, int count)
    {
        var response = await _httpClient.PostAsJsonAsync("/whatsapp/recent-messages", new { chatIds, count });

        if (response.StatusCode == System.Net.HttpStatusCode.ServiceUnavailable)
            return null;

        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<List<WhatsAppIncomingMessageDto>>() ?? [];
    }

    public async Task MarkChatAsReadAsync(string chatId)
    {
        var response = await _httpClient.PostAsJsonAsync("/whatsapp/mark-read", new { chatId });

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

    public async Task<bool> ConsumeFavoriteMessagesSyncRequestAsync(CancellationToken cancellationToken)
    {
        try
        {
            var response = await _httpClient.PostAsync("/worker-actions/favorite-sync/consume", null, cancellationToken);
            response.EnsureSuccessStatusCode();
            var action = await response.Content.ReadFromJsonAsync<WorkerActionResponseDto>(cancellationToken: cancellationToken);
            return action?.Requested == true;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (HttpRequestException)
        {
            return false;
        }
        catch (TaskCanceledException)
        {
            return false;
        }
    }

    public async Task<GatewayLogsResponseDto> GetUnreportedErrorLogsAsync(int limit, CancellationToken cancellationToken)
    {
        var response = await _httpClient.GetAsync($"/logs/unreported-errors?limit={limit}", cancellationToken);

        response.EnsureSuccessStatusCode();

        return await response.Content.ReadFromJsonAsync<GatewayLogsResponseDto>(cancellationToken: cancellationToken)
            ?? new GatewayLogsResponseDto();
    }

    public async Task MarkLogsAsReportedAsync(IEnumerable<string> ids, CancellationToken cancellationToken)
    {
        var response = await _httpClient.PostAsJsonAsync("/logs/mark-reported", new { ids }, cancellationToken);

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

        var response = await _httpClient.PostAsJsonAsync("/whatsapp/send", request);

        response.EnsureSuccessStatusCode();
    }
}
