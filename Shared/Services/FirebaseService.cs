using System.Text;
using System.Text.Json;
using Shared.Configuration;
using Shared.Models;

namespace AlexaSkillWhatsApp.Services;

public class FirebaseService
{
    private readonly HttpClient _httpClient;
    //    private readonly ILambdaContext _context;
    private readonly JsonSerializerOptions _jsonOptions = new() { PropertyNameCaseInsensitive = true };

    public FirebaseService()
    {
        _httpClient = new HttpClient();
        //      _context = context;
    }
    //public async Task<string> GetRawPendingMessagesAsync()
    //{
    //    return await _httpClient.GetStringAsync(            $"{FirebaseSettings.PendingMessages}.json");
    //}

    public async Task<List<MessageDto>> GetPendingMessagesAsync()
    {
        try
        {
            var json = await _httpClient.GetStringAsync($"{FirebaseSettings.PendingMessages}.json");

            if (string.IsNullOrWhiteSpace(json) || json == "null") return [];

            //    _context.Logger.LogLine(json);

            var dictionary = JsonSerializer.Deserialize<Dictionary<string, MessageDto>>(json, _jsonOptions)!;

            if (dictionary == null) return [];

            foreach (var item in dictionary)
            {
                item.Value.Id = item.Key;
            }

            return dictionary.Values.OrderBy(m => m.Date).ToList();
        }
        catch (Exception ex)
        {
            Console.WriteLine(ex);

            return [];
        }
    }

    public async Task SaveReplyAsync(string messageId, string chatId, string phone, string sender, string account, string currentSource, string text)
    {
        var reply = new ReplyMessageDto
        {
            MessageId = messageId,
            ChatId = chatId,
            Phone = phone,
            Sender = sender,
            Account = account,
            Text = text,
            Date = DateTime.UtcNow,
            Source = currentSource
        };

        var json = JsonSerializer.Serialize(reply);

        var content = new StringContent(json, Encoding.UTF8, "application/json");

        await _httpClient.PostAsync($"{FirebaseSettings.OutgoingMessages}.json", content);
    }

    public async Task DeletePendingMessageAsync(string messageId)
    {
        await _httpClient.DeleteAsync($"{FirebaseSettings.PendingMessages}/{messageId}.json");
    }

    public async Task SendCommandAsync(string command)
    {
        var json = JsonSerializer.Serialize(new { command, created = DateTime.UtcNow });

        var content = new StringContent(json, Encoding.UTF8, "application/json");

        await _httpClient.PutAsync($"{FirebaseSettings.Commands}/current.json", content);
    }
    public async Task UpdateStatusAsync(string property, object value)
    {
        var json = JsonSerializer.Serialize(value);

        var content = new StringContent(json, Encoding.UTF8, "application/json");

        await _httpClient.PutAsync($"{FirebaseSettings.Status}/{property}.json", content);
    }

    public async Task<string?> GetStatusAsync(string property)
    {
        var json = await _httpClient.GetStringAsync($"{FirebaseSettings.Status}/{property}.json");

        if (json == "null") return null;

        return JsonSerializer.Deserialize<string>(json);
    }
    public async Task MarkAsReadAsync(string messageId)
    {
        var body = JsonSerializer.Serialize(new { isRead = true });

        var request = new HttpRequestMessage(HttpMethod.Patch, $"{FirebaseSettings.PendingMessages}/{messageId}.json")
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json")
        };

        var response = await _httpClient.SendAsync(request);

        response.EnsureSuccessStatusCode();
    }

    public async Task<List<ReplyMessageDto>> GetPendingRepliesAsync()
    {
        try
        {
            var json = await _httpClient.GetStringAsync($"{FirebaseSettings.OutgoingMessages}.json");

            if (string.IsNullOrWhiteSpace(json) || json == "null")
                return [];

            var dictionary = JsonSerializer.Deserialize<Dictionary<string, ReplyMessageDto>>(json, _jsonOptions);

            if (dictionary == null)
                return [];

            foreach (var item in dictionary) { item.Value.Id = item.Key; }

            return dictionary.Values.OrderBy(r => r.Date).ToList();
        }
        catch (Exception ex)
        {
            Console.WriteLine("Error leyendo mensajes_por_enviar:");
            Console.WriteLine(ex);

            return [];
        }
    }

    public async Task SaveIncomingMessageAsync(MessageDto message)
    {
        var json = JsonSerializer.Serialize(message);

        var content = new StringContent(json, Encoding.UTF8, "application/json");

        var response = await _httpClient.PostAsync($"{FirebaseSettings.PendingMessages}.json", content);

        response.EnsureSuccessStatusCode();
    }

    public async Task DeleteReplyAsync(string replyId)
    {
        var response = await _httpClient.DeleteAsync($"{FirebaseSettings.OutgoingMessages}/{replyId}.json");

        response.EnsureSuccessStatusCode();
    }
}
