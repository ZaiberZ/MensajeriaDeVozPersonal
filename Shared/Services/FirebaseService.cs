using System.Text;
using System.Text.Json;
using Shared.Configuration;
using Shared.Models;

namespace AlexaSkillWhatsApp.Services;

public class FirebaseService
{
    private readonly HttpClient _httpClient;
    private readonly UserDto _user;
    private readonly string _userId;
    //    private readonly ILambdaContext _context;
    private readonly JsonSerializerOptions _jsonOptions = new() { PropertyNameCaseInsensitive = true };

    public FirebaseService(UserDto user)
    {
        ArgumentNullException.ThrowIfNull(user);

        if (string.IsNullOrWhiteSpace(user.Phone))
            throw new ArgumentException("El usuario debe tener un teléfono.", nameof(user));

        _httpClient = new HttpClient();
        _user = user;
        _userId = new string(user.Phone.Where(char.IsDigit).ToArray());

        if (string.IsNullOrWhiteSpace(_userId))
            throw new ArgumentException("El teléfono del usuario no contiene dígitos válidos.", nameof(user));

        //      _context = context;
    }

    private string UserPath => FirebaseSettings.User(_userId);
    private string PendingMessagesPath => FirebaseSettings.PendingMessagesFor(_userId);
    private string OutgoingMessagesPath => FirebaseSettings.OutgoingMessagesFor(_userId);
    private string FrequentContactsPath => FirebaseSettings.FrequentContactsFor(_userId);
    private string CommandsPath => FirebaseSettings.CommandsFor(_userId);
    private string StatusPath => FirebaseSettings.StatusFor(_userId);
    private string ControlPath => $"{UserPath}/control";
    private string ConfigurationPath => $"{UserPath}/configuracion";

    public async Task<bool> HasPendingMessagesAsync()
    {
        var json = await _httpClient.GetStringAsync($"{ControlPath}/has_pending_messages.json");

        return !string.IsNullOrWhiteSpace(json) && json != "null" &&
               JsonSerializer.Deserialize<bool>(json, _jsonOptions);
    }

    public async Task<bool> HasPendingRepliesAsync()
    {
        var json = await _httpClient.GetStringAsync($"{ControlPath}/has_pending_replies.json");

        return !string.IsNullOrWhiteSpace(json) && json != "null" &&
               JsonSerializer.Deserialize<bool>(json, _jsonOptions);
    }

    public Task SetHasPendingMessagesAsync(bool value)
    {
        return SetControlFlagAsync("has_pending_messages", value);
    }

    public Task SetHasPendingRepliesAsync(bool value)
    {
        return SetControlFlagAsync("has_pending_replies", value);
    }

    public async Task<DateTime?> GetLastErrorLogsReportedAtAsync(CancellationToken cancellationToken = default)
    {
        var response = await _httpClient.GetAsync($"{ControlPath}/last_error_logs_reported_at.json", cancellationToken);
        response.EnsureSuccessStatusCode();
        var json = await response.Content.ReadAsStringAsync(cancellationToken);

        if (string.IsNullOrWhiteSpace(json) || json == "null")
            return null;

        return JsonSerializer.Deserialize<DateTime>(json, _jsonOptions);
    }

    public async Task SetLastErrorLogsReportedAtAsync(DateTime value, CancellationToken cancellationToken = default)
    {
        var json = JsonSerializer.Serialize(value, _jsonOptions);
        var content = new StringContent(json, Encoding.UTF8, "application/json");
        var response = await _httpClient.PutAsync($"{ControlPath}/last_error_logs_reported_at.json", content, cancellationToken);

        response.EnsureSuccessStatusCode();
    }

    public async Task RegisterLastSentMessageAsync(ReplyMessageDto reply, DateTime sentAt, CancellationToken cancellationToken = default)
    {
        var payload = new
        {
            messageId = reply.MessageId,
            replyId = reply.Id,
            chatId = reply.ChatId,
            phone = reply.Phone,
            recipientPhone = reply.Phone,
            recipientName = reply.Sender,
            sender = reply.Sender,
            account = reply.Account,
            source = reply.Source,
            text = reply.Text,
            sentAt
        };
        var json = JsonSerializer.Serialize(payload, _jsonOptions);
        var content = new StringContent(json, Encoding.UTF8, "application/json");
        var response = await _httpClient.PutAsync($"{ControlPath}/last_sent_message.json", content, cancellationToken);

        response.EnsureSuccessStatusCode();
    }

    public async Task<bool> IsAirbnbEnabledAsync(CancellationToken cancellationToken = default)
    {
        var response = await _httpClient.GetAsync($"{ConfigurationPath}/airbnb/enabled.json", cancellationToken);
        response.EnsureSuccessStatusCode();
        var json = await response.Content.ReadAsStringAsync(cancellationToken);

        if (string.IsNullOrWhiteSpace(json) || json == "null")
        {
            await SetAirbnbEnabledAsync(false, cancellationToken);
            return false;
        }

        return JsonSerializer.Deserialize<bool>(json, _jsonOptions);
    }

    public async Task SetAirbnbEnabledAsync(bool value, CancellationToken cancellationToken = default)
    {
        var json = JsonSerializer.Serialize(value, _jsonOptions);
        var content = new StringContent(json, Encoding.UTF8, "application/json");
        var response = await _httpClient.PutAsync($"{ConfigurationPath}/airbnb/enabled.json", content, cancellationToken);

        response.EnsureSuccessStatusCode();
    }

    private async Task SetControlFlagAsync(string flag, bool value)
    {
        var json = JsonSerializer.Serialize(value, _jsonOptions);
        var content = new StringContent(json, Encoding.UTF8, "application/json");
        var response = await _httpClient.PutAsync($"{ControlPath}/{flag}.json", content);

        response.EnsureSuccessStatusCode();
    }

    public async Task EnsureUserRegisteredAsync(CancellationToken cancellationToken = default)
    {
        var response = await _httpClient.GetAsync($"{UserPath}.json", cancellationToken);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!string.IsNullOrWhiteSpace(json) && json != "null")
        {
            await IsAirbnbEnabledAsync(cancellationToken);
            return;
        }

        var userJson = JsonSerializer.Serialize(_user);
        var content = new StringContent(userJson, Encoding.UTF8, "application/json");
        var createResponse = await _httpClient.PutAsync($"{UserPath}.json", content, cancellationToken);

        createResponse.EnsureSuccessStatusCode();
        await SetAirbnbEnabledAsync(false, cancellationToken);
    }
    public async Task<List<MessageDto>> GetPendingMessagesAsync()
    {
        try
        {
            var json = await _httpClient.GetStringAsync($"{PendingMessagesPath}.json");

            if (string.IsNullOrWhiteSpace(json) || json == "null") return [];

            var dictionary = JsonSerializer.Deserialize<Dictionary<string, MessageDto>>(json, _jsonOptions);

            if (dictionary == null || dictionary.Count == 0) return [];

            var messages = dictionary.Where(item => item.Value != null && !item.Value.IsRead)
                .Select(item =>
                {
                    item.Value.Id = item.Key;
                    return item.Value;
                }).OrderBy(m => m.Date).ToList();

            return messages;
        }
        catch (Exception ex)
        {
            Console.WriteLine(ex);

            return [];
        }
    }

    public async Task<List<MessageDto>> GetAllMessagesAsync()
    {
        var json = await _httpClient.GetStringAsync($"{PendingMessagesPath}.json");

        if (string.IsNullOrWhiteSpace(json) || json == "null")
            return [];

        var dictionary = JsonSerializer.Deserialize<Dictionary<string, MessageDto>>(json, _jsonOptions);

        if (dictionary == null || dictionary.Count == 0)
            return [];

        return dictionary
            .Where(item => item.Value != null)
            .Select(item =>
            {
                item.Value.Id = item.Key;
                return item.Value;
            })
            .OrderBy(message => message.Date)
            .ToList();
    }

    public async Task SaveReplyAsync(string messageId, string chatId, string phone, string sender, string account, string currentSource, string text)
    {
        if (string.IsNullOrWhiteSpace(phone) && !SupportsReplyWithoutPhone(currentSource))
            throw new ArgumentException("No se puede guardar una respuesta sin destinatario.", nameof(phone));

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

        var response = await _httpClient.PostAsync($"{OutgoingMessagesPath}.json", content);

        response.EnsureSuccessStatusCode();
        await SetHasPendingRepliesAsync(true);
    }

    public async Task<List<ContactDto>> GetFrequentContactsAsync(string phone)
    {
        var userId = new string((phone ?? "").Where(char.IsDigit).ToArray());
        var path = string.IsNullOrWhiteSpace(userId)
            ? FrequentContactsPath
            : FirebaseSettings.FrequentContactsFor(userId);
        var json = await _httpClient.GetStringAsync($"{path}.json");

        if (string.IsNullOrWhiteSpace(json) || json == "null")
            return [];

        var dictionary = JsonSerializer.Deserialize<Dictionary<string, ContactDto>>(json, _jsonOptions);

        if (dictionary == null || dictionary.Count == 0)
            return [];

        return dictionary
            .Where(item => item.Value != null)
            .Select(item =>
            {
                item.Value.Id = item.Key;
                return item.Value;
            })
            .OrderBy(contact => contact.Name)
            .ToList();
    }

    public async Task<ContactDto?> FindFrequentContactByNameAsync(string phone, string contactName)
    {
        if (string.IsNullOrWhiteSpace(contactName))
            return null;

        var contacts = await GetFrequentContactsAsync(phone);
        var normalizedName = contactName.Trim();
        var exact = contacts.FirstOrDefault(contact =>
            string.Equals(contact.Name?.Trim(), normalizedName, StringComparison.OrdinalIgnoreCase));

        if (exact != null)
            return exact;

        return contacts.FirstOrDefault(contact =>
            !string.IsNullOrWhiteSpace(contact.Name) &&
            contact.Name.Contains(normalizedName, StringComparison.OrdinalIgnoreCase));
    }

    public async Task DeletePendingMessageAsync(string messageId)
    {
        var response = await _httpClient.DeleteAsync($"{PendingMessagesPath}/{messageId}.json");

        response.EnsureSuccessStatusCode();
    }

    public async Task<int> DeleteReadMessagesOlderThanAsync(DateTime cutoff)
    {
        var json = await _httpClient.GetStringAsync($"{PendingMessagesPath}.json");

        if (string.IsNullOrWhiteSpace(json) || json == "null")
            return 0;

        var messages = JsonSerializer.Deserialize<Dictionary<string, MessageDto>>(json, _jsonOptions);

        if (messages == null || messages.Count == 0)
            return 0;

        var messageIdsToDelete = messages
            .Where(item => item.Value != null && item.Value.IsRead && item.Value.Date < cutoff)
            .Select(item => item.Key).ToList();

        foreach (var messageId in messageIdsToDelete)
            await DeletePendingMessageAsync(messageId);

        return messageIdsToDelete.Count;
    }

    public async Task SendCommandAsync(string command)
    {
        var json = JsonSerializer.Serialize(new { command, created = DateTime.UtcNow });

        var content = new StringContent(json, Encoding.UTF8, "application/json");

        await _httpClient.PutAsync($"{CommandsPath}/current.json", content);
    }
    public async Task UpdateStatusAsync(string property, object value)
    {
        var json = JsonSerializer.Serialize(value);

        var content = new StringContent(json, Encoding.UTF8, "application/json");

        await _httpClient.PutAsync($"{StatusPath}/{property}.json", content);
    }

    public async Task<string?> GetStatusAsync(string property)
    {
        var json = await _httpClient.GetStringAsync($"{StatusPath}/{property}.json");

        if (json == "null") return null;

        return JsonSerializer.Deserialize<string>(json);
    }
    public async Task MarkAsReadAsync(string messageId)
    {
        var body = JsonSerializer.Serialize(new { isRead = true });

        var request = new HttpRequestMessage(HttpMethod.Patch, $"{PendingMessagesPath}/{messageId}.json")
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
            var json = await _httpClient.GetStringAsync($"{OutgoingMessagesPath}.json");

            if (string.IsNullOrWhiteSpace(json) || json == "null") return [];

            var dictionary = JsonSerializer.Deserialize<Dictionary<string, ReplyMessageDto>>(json, _jsonOptions);

            if (dictionary == null) return [];

            var replies = dictionary.Where(item => item.Value != null &&
                (!string.IsNullOrWhiteSpace(item.Value.Phone) || SupportsReplyWithoutPhone(item.Value.Source)))
           .Select(item =>
           {
               item.Value.Id = item.Key;
               return item.Value;
           }).OrderBy(m => m.Date).ToList();


            return replies;
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

        var response = await _httpClient.PostAsync($"{PendingMessagesPath}.json", content);

        response.EnsureSuccessStatusCode();
    }

    public async Task DeleteReplyAsync(string replyId)
    {
        var response = await _httpClient.DeleteAsync($"{OutgoingMessagesPath}/{replyId}.json");

        response.EnsureSuccessStatusCode();
    }

    private static bool SupportsReplyWithoutPhone(string source)
    {
        return string.Equals(source, "Airbnb", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(source, "AirbnbEmail", StringComparison.OrdinalIgnoreCase);
    }
}
