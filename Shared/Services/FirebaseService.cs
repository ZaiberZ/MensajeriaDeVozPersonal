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

        _httpClient = FirebaseHttpClient.Create();
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
    private string DiagnosticsPath => $"{UserPath}/diagnosticos/logs_error";
    private string AlexaWriteTracesPath => $"{UserPath}/diagnosticos/intentos_envio_alexa";
    private string AlexaDeliveryReceiptsPath => $"{UserPath}/diagnosticos/envios_confirmados_alexa";
    private string DiagnosticLogsPath => $"{UserPath}/diagnosticos/logs";

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

    public async Task SetErrorLogReportStatusAsync(object status, CancellationToken cancellationToken = default)
    {
        var content = new StringContent(JsonSerializer.Serialize(status, _jsonOptions), Encoding.UTF8, "application/json");
        var response = await _httpClient.PutAsync($"{ControlPath}/error_log_report_status.json", content, cancellationToken);

        response.EnsureSuccessStatusCode();
    }

    public async Task SaveDailyErrorLogSnapshotAsync(DateTime date, DailyErrorLogSnapshotDto snapshot, CancellationToken cancellationToken = default)
    {
        var key = date.ToUniversalTime().ToString("yyyy-MM-dd");
        var content = new StringContent(JsonSerializer.Serialize(snapshot, _jsonOptions), Encoding.UTF8, "application/json");
        var response = await _httpClient.PutAsync($"{DiagnosticsPath}/{key}.json", content, cancellationToken);

        response.EnsureSuccessStatusCode();
    }

    public async Task DeleteDailyErrorLogSnapshotAsync(DateTime date, CancellationToken cancellationToken = default)
    {
        var key = date.ToUniversalTime().ToString("yyyy-MM-dd");
        var response = await _httpClient.DeleteAsync($"{DiagnosticsPath}/{key}.json", cancellationToken);

        response.EnsureSuccessStatusCode();
    }

    public async Task RegisterLastSentMessageAsync(ReplyMessageDto reply, string confirmedMessageId, DateTime confirmedAt, CancellationToken cancellationToken = default)
    {
        var payload = new
        {
            messageId = confirmedMessageId,
            replyToMessageId = reply.MessageId,
            replyId = reply.Id,
            chatId = reply.ChatId,
            phone = reply.Phone,
            recipientPhone = reply.Phone,
            recipientName = reply.Sender,
            sender = reply.Sender,
            account = reply.Account,
            source = reply.Source,
            text = reply.Text,
            sentAt = confirmedAt,
            confirmation = new
            {
                status = "acknowledged",
                confirmedAt,
                confirmedBy = string.Equals(reply.Source, "WhatsApp", StringComparison.OrdinalIgnoreCase) ? "whatsapp_message_ack" : "provider_response",
                minimumAck = string.Equals(reply.Source, "WhatsApp", StringComparison.OrdinalIgnoreCase) ? 1 : (int?)null,
                ackMeaning = string.Equals(reply.Source, "WhatsApp", StringComparison.OrdinalIgnoreCase) ? "server_received" : "provider_accepted",
                messageId = confirmedMessageId
            }
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
        var profile = new Dictionary<string, object>
        {
            [nameof(UserDto.Phone)] = _user.Phone,
            [nameof(UserDto.IsRegistered)] = _user.IsRegistered
        };

        if (!string.IsNullOrWhiteSpace(_user.FullName))
            profile[nameof(UserDto.FullName)] = _user.FullName;

        if (!string.IsNullOrWhiteSpace(_user.Email))
            profile[nameof(UserDto.Email)] = _user.Email;

        if (!string.IsNullOrWhiteSpace(_user.SupportPhone))
            profile[nameof(UserDto.SupportPhone)] = _user.SupportPhone;

        if (!string.IsNullOrWhiteSpace(_user.SupportEmail))
            profile[nameof(UserDto.SupportEmail)] = _user.SupportEmail;

        var content = new StringContent(JsonSerializer.Serialize(profile), Encoding.UTF8, "application/json");
        var response = await _httpClient.PatchAsync($"{UserPath}.json", content, cancellationToken);
        response.EnsureSuccessStatusCode();
        await IsAirbnbEnabledAsync(cancellationToken);
    }
    public async Task<List<MessageDto>> GetPendingMessagesAsync()
    {
        var json = await _httpClient.GetStringAsync($"{PendingMessagesPath}.json");

        if (string.IsNullOrWhiteSpace(json) || json == "null") return [];

        var dictionary = JsonSerializer.Deserialize<Dictionary<string, MessageDto>>(json, _jsonOptions);

        if (dictionary == null || dictionary.Count == 0) return [];

        return dictionary.Where(item => item.Value != null && !item.Value.IsRead)
            .Select(item =>
        {
            item.Value.Id = item.Key;
            return item.Value;
        }).OrderBy(message => message.Date).ToList();
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

    public async Task SaveReplyAsync(string messageId, string chatId, string phone, string sender, string account, string currentSource, string text, string alexaWriteTraceId = "")
    {
        if (string.IsNullOrWhiteSpace(phone) && !SupportsReplyWithoutPhone(currentSource))
            throw new ArgumentException("No se puede guardar una respuesta sin destinatario.", nameof(phone));

        var reply = new ReplyMessageDto
        {
            MessageId = messageId,
            AlexaWriteTraceId = alexaWriteTraceId,
            ChatId = chatId,
            Phone = phone,
            Sender = sender,
            Account = account,
            Text = text,
            Date = AppClock.Now,
            Source = currentSource
        };

        var json = JsonSerializer.Serialize(reply);

        var content = new StringContent(json, Encoding.UTF8, "application/json");

        var response = await _httpClient.PostAsync($"{OutgoingMessagesPath}.json", content);

        response.EnsureSuccessStatusCode();
        await SetHasPendingRepliesAsync(true);
    }

    public async Task SaveAlexaWriteTraceAsync(string traceId, AlexaWriteTraceDto trace, CancellationToken cancellationToken = default)
    {
        var content = new StringContent(JsonSerializer.Serialize(trace, _jsonOptions), Encoding.UTF8, "application/json");
        var response = await _httpClient.PutAsync($"{AlexaWriteTracesPath}/{traceId}.json", content, cancellationToken);

        response.EnsureSuccessStatusCode();
    }

    public async Task DeleteAlexaWriteTraceAsync(string traceId, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(traceId))
            return;

        var response = await _httpClient.DeleteAsync($"{AlexaWriteTracesPath}/{traceId}.json", cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    public async Task SaveAlexaDeliveryReceiptAsync(string traceId, AlexaDeliveryReceiptDto receipt, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(traceId))
            return;

        var content = new StringContent(JsonSerializer.Serialize(receipt, _jsonOptions), Encoding.UTF8, "application/json");
        var response = await _httpClient.PutAsync($"{AlexaDeliveryReceiptsPath}/{traceId}.json", content, cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    public async Task<Dictionary<string, AlexaWriteTraceDto>> GetAlexaWriteTracesAsync(CancellationToken cancellationToken = default)
    {
        var response = await _httpClient.GetAsync($"{AlexaWriteTracesPath}.json", cancellationToken);
        response.EnsureSuccessStatusCode();
        var json = await response.Content.ReadAsStringAsync(cancellationToken);

        if (string.IsNullOrWhiteSpace(json) || json == "null")
            return [];

        return JsonSerializer.Deserialize<Dictionary<string, AlexaWriteTraceDto>>(json, _jsonOptions) ?? [];
    }

    public async Task SaveDiagnosticLogAsync(DiagnosticLogDto log, CancellationToken cancellationToken = default)
    {
        var content = new StringContent(JsonSerializer.Serialize(log, _jsonOptions), Encoding.UTF8, "application/json");
        var response = await _httpClient.PostAsync($"{DiagnosticLogsPath}.json", content, cancellationToken);

        response.EnsureSuccessStatusCode();
    }

    public async Task<int> DeleteDiagnosticLogsOlderThanAsync(DateTime cutoff, CancellationToken cancellationToken = default)
    {
        var response = await _httpClient.GetAsync($"{DiagnosticLogsPath}.json", cancellationToken);
        response.EnsureSuccessStatusCode();
        var json = await response.Content.ReadAsStringAsync(cancellationToken);

        if (string.IsNullOrWhiteSpace(json) || json == "null")
            return 0;

        var logs = JsonSerializer.Deserialize<Dictionary<string, DiagnosticLogDto>>(json, _jsonOptions);

        if (logs == null || logs.Count == 0)
            return 0;

        var expiredIds = logs.Where(item => item.Value != null && item.Value.Timestamp < cutoff).Select(item => item.Key).ToList();

        foreach (var logId in expiredIds)
        {
            var deleteResponse = await _httpClient.DeleteAsync($"{DiagnosticLogsPath}/{logId}.json", cancellationToken);
            deleteResponse.EnsureSuccessStatusCode();
        }

        return expiredIds.Count;
    }

    public async Task<int> DeleteAlexaWriteTracesOlderThanAsync(DateTime cutoff, CancellationToken cancellationToken = default)
    {
        var response = await _httpClient.GetAsync($"{AlexaWriteTracesPath}.json", cancellationToken);
        response.EnsureSuccessStatusCode();
        var json = await response.Content.ReadAsStringAsync(cancellationToken);

        if (string.IsNullOrWhiteSpace(json) || json == "null")
            return 0;

        var traces = JsonSerializer.Deserialize<Dictionary<string, AlexaWriteTraceDto>>(json, _jsonOptions);

        if (traces == null || traces.Count == 0)
            return 0;

        var expiredIds = traces.Where(item => item.Value != null && item.Value.UpdatedAt < cutoff).Select(item => item.Key).ToList();

        foreach (var traceId in expiredIds)
            await DeleteAlexaWriteTraceAsync(traceId, cancellationToken);

        return expiredIds.Count;
    }

    public async Task<int> DeleteAlexaDeliveryReceiptsOlderThanAsync(DateTime cutoff, CancellationToken cancellationToken = default)
    {
        var response = await _httpClient.GetAsync($"{AlexaDeliveryReceiptsPath}.json", cancellationToken);
        response.EnsureSuccessStatusCode();
        var json = await response.Content.ReadAsStringAsync(cancellationToken);

        if (string.IsNullOrWhiteSpace(json) || json == "null")
            return 0;

        var receipts = JsonSerializer.Deserialize<Dictionary<string, AlexaDeliveryReceiptDto>>(json, _jsonOptions);

        if (receipts == null || receipts.Count == 0)
            return 0;

        var expiredIds = receipts.Where(item => item.Value != null && item.Value.ConfirmedAt < cutoff).Select(item => item.Key).ToList();

        foreach (var receiptId in expiredIds)
        {
            var deleteResponse = await _httpClient.DeleteAsync($"{AlexaDeliveryReceiptsPath}/{receiptId}.json", cancellationToken);
            deleteResponse.EnsureSuccessStatusCode();
        }

        return expiredIds.Count;
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
            GetContactLookupNames(contact).Any(name =>
                string.Equals(name.Trim(), normalizedName, StringComparison.OrdinalIgnoreCase)));

        if (exact != null)
            return exact;

        return contacts.FirstOrDefault(contact => GetContactLookupNames(contact)
            .Any(name => name.Contains(normalizedName, StringComparison.OrdinalIgnoreCase)));
    }

    private static IEnumerable<string> GetContactLookupNames(ContactDto contact)
    {
        return new[] { contact.Name }
            .Concat(contact.Aliases ?? [])
            .Where(name => !string.IsNullOrWhiteSpace(name));
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
        var json = JsonSerializer.Serialize(new { command, created = AppClock.Now });

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
        var body = JsonSerializer.Serialize(new { isRead = true, readAt = AppClock.Now });

        var request = new HttpRequestMessage(HttpMethod.Patch, $"{PendingMessagesPath}/{messageId}.json")
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json")
        };

        var response = await _httpClient.SendAsync(request);

        response.EnsureSuccessStatusCode();
    }

    public async Task<List<ReplyMessageDto>> GetPendingRepliesAsync()
    {
        var json = await _httpClient.GetStringAsync($"{OutgoingMessagesPath}.json");

        if (string.IsNullOrWhiteSpace(json) || json == "null") return [];

        var dictionary = JsonSerializer.Deserialize<Dictionary<string, ReplyMessageDto>>(json, _jsonOptions);

        if (dictionary == null) return [];

        return dictionary.Where(item => item.Value != null &&
            (!string.IsNullOrWhiteSpace(item.Value.Phone) || SupportsReplyWithoutPhone(item.Value.Source)))
        .Select(item =>
        {
            item.Value.Id = item.Key;
            return item.Value;
        }).OrderBy(message => message.Date).ToList();
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
