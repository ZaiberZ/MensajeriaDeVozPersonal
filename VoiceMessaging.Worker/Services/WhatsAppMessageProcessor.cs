using AlexaSkillWhatsApp.Services;
using Shared.Models;

namespace VoiceMessaging.Worker.Services;

public class WhatsAppMessageProcessor
{
    private readonly WhatsAppService _whatsApp;
    private readonly FirebaseService _firebase;
    private readonly ILogger _logger;
    private readonly Func<string, string, string?, CancellationToken, Task> _registerWorkerLog;

    public WhatsAppMessageProcessor(WhatsAppService whatsApp, FirebaseService firebase, ILogger logger, Func<string, string, string?, CancellationToken, Task> registerWorkerLog)
    {
        _whatsApp = whatsApp;
        _firebase = firebase;
        _logger = logger;
        _registerWorkerLog = registerWorkerLog;
    }

    public async Task<bool> ReconcileUnreadMessagesAsync(CancellationToken stoppingToken)
    {
        try
        {
            var whatsAppUnreadMessages = await _whatsApp.GetUnreadMessagesAsync();

            if (whatsAppUnreadMessages == null)
            {
                _logger.LogDebug("Reconciliación de lectura omitida porque WhatsApp todavía no está conectado.");
                return false;
            }

            if (whatsAppUnreadMessages.Count == 0)
            {
                _logger.LogInformation("Reconciliación de lectura completada. WhatsApp no tiene mensajes pendientes.");
                return true;
            }

            var firebaseMessages = await _firebase.GetAllMessagesAsync();
            var addedMessages = 0;
            var filteredMessages = 0;
            var readChats = 0;
            var hasUnreadMessagesInFirebase = firebaseMessages.Any(message => !message.IsRead);

            foreach (var chat in whatsAppUnreadMessages.GroupBy(message => message.ChatId))
            {
                var allChatMessagesAreReadInFirebase = true;

                foreach (var whatsAppMessage in chat)
                {
                    if (MessageFilter.IsAdvertising(whatsAppMessage))
                    {
                        filteredMessages++;
                        _logger.LogInformation("Mensaje de publicidad omitido durante reconciliacion: {sender} - {text}", whatsAppMessage.Sender, CreateLogPreview(whatsAppMessage.Text));
                        continue;
                    }

                    var firebaseMessage = FindMatchingMessage(firebaseMessages, whatsAppMessage);

                    if (firebaseMessage == null)
                    {
                        firebaseMessage = CreateFirebaseMessage(whatsAppMessage);
                        await _firebase.SaveIncomingMessageAsync(firebaseMessage);
                        firebaseMessages.Add(firebaseMessage);
                        addedMessages++;
                        hasUnreadMessagesInFirebase = true;
                        allChatMessagesAreReadInFirebase = false;
                        continue;
                    }

                    if (!firebaseMessage.IsRead)
                    {
                        hasUnreadMessagesInFirebase = true;
                        allChatMessagesAreReadInFirebase = false;
                    }
                }

                // sendSeen marca el chat completo. No debe ocultar mensajes que sigan
                // pendientes de lectura en Firebase.
                if (allChatMessagesAreReadInFirebase)
                {
                    await _whatsApp.MarkChatAsReadAsync(chat.Key);
                    readChats++;
                }
            }

            if (hasUnreadMessagesInFirebase)
                await _firebase.SetHasPendingMessagesAsync(true);

            _logger.LogInformation(
                "Reconciliación de lectura completada. Mensajes recuperados: {added}; mensajes de publicidad omitidos: {filtered}; chats marcados como leídos: {readChats}.",
                addedMessages,
                filteredMessages,
                readChats);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error reconciliando mensajes leídos entre Firebase y WhatsApp.");
            await _registerWorkerLog("error", "Error reconciliando mensajes leídos entre Firebase y WhatsApp.", ex.ToString(), stoppingToken);
            return false;
        }
    }

    public async Task SaveNewMessagesAsync(CancellationToken stoppingToken)
    {
        var errors = "";

        try
        {
            var messages = await _whatsApp.GetMessagesAsync();

            if (messages.Count == 0)
                return;

            var firebaseMessages = await _firebase.GetAllMessagesAsync();
            var addedMessages = 0;
            var filteredMessages = 0;

            foreach (var message in messages)
            {
                try
                {
                    if (MessageFilter.IsAdvertising(message))
                    {
                        filteredMessages++;
                        _logger.LogInformation("Mensaje de publicidad omitido: {sender} - {text}", message.Sender, CreateLogPreview(message.Text));
                        continue;
                    }

                    if (FindMatchingMessage(firebaseMessages, message) != null)
                    {
                        _logger.LogDebug("El mensaje {messageId} ya existe en Firebase.", message.Id);
                        continue;
                    }

                    var firebaseMessage = CreateFirebaseMessage(message);
                    await _firebase.SaveIncomingMessageAsync(firebaseMessage);
                    firebaseMessages.Add(firebaseMessage);
                    addedMessages++;
                    _logger.LogInformation("Mensaje guardado en Firebase: {sender} - {text}", firebaseMessage.Sender, firebaseMessage.Text);
                }
                catch (Exception ex)
                {
                    errors += ex.Message + " | ";
                }
            }

            if (!string.IsNullOrEmpty(errors))
                throw new Exception(errors);

            if (addedMessages > 0)
                await _firebase.SetHasPendingMessagesAsync(true);

            if (filteredMessages > 0)
                _logger.LogInformation("Mensajes de publicidad omitidos: {filtered}.", filteredMessages);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error guardando mensajes nuevos.");
            await _registerWorkerLog("error", "Error guardando mensajes nuevos.", ex.ToString(), stoppingToken);
        }

    }

    public async Task<bool> SyncFavoriteContactMessagesAsync(CancellationToken stoppingToken)
    {
        try
        {
            var contacts = await _firebase.GetFrequentContactsAsync("");
            var chatIds = contacts
                .Where(contact => string.Equals(contact.Source, "WhatsApp", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(contact.ChatId))
                .Select(contact => contact.ChatId).Distinct().ToList();

            if (chatIds.Count == 0)
                return true;

            var recentMessages = await _whatsApp.GetRecentMessagesAsync(chatIds, 5);

            if (recentMessages == null)
            {
                _logger.LogInformation("Sincronización de favoritos aplazada porque WhatsApp todavía no está conectado. Se volverá a intentar más tarde.");
                return false;
            }

            var firebaseMessages = await _firebase.GetAllMessagesAsync();
            var addedMessages = 0;

            foreach (var message in recentMessages.Where(message => !MessageFilter.IsAdvertising(message)))
            {
                if (FindMatchingMessage(firebaseMessages, message) != null)
                    continue;

                var firebaseMessage = CreateFirebaseMessage(message, isRead: true);
                await _firebase.SaveIncomingMessageAsync(firebaseMessage);
                firebaseMessages.Add(firebaseMessage);
                addedMessages++;
            }

            _logger.LogInformation("Sincronización de favoritos completada. Mensajes históricos agregados: {added}.", addedMessages);
            return true;
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            throw;
        }
        catch (HttpRequestException ex) when (ex.StatusCode is null)
        {
            _logger.LogWarning("Sincronización de favoritos aplazada por falta temporal de conexión: {message}", ex.Message);
            return false;
        }
        catch (TaskCanceledException ex)
        {
            _logger.LogWarning("Sincronización de favoritos aplazada porque la consulta excedió el tiempo de espera: {message}", ex.Message);
            return false;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error sincronizando los últimos mensajes de los contactos favoritos.");
            await _registerWorkerLog("error", "Error sincronizando los últimos mensajes de los contactos favoritos.", ex.ToString(), stoppingToken);
            return false;
        }
    }

    public Task SendReplyAsync(ReplyMessageDto reply)
    {
        return _whatsApp.SendReplyAsync(reply);
    }

    private static MessageDto CreateFirebaseMessage(WhatsAppIncomingMessageDto message, bool isRead = false)
    {
        return new MessageDto
        {
            ExternalMessageId = message.Id,
            ChatId = message.ChatId,
            Phone = message.Phone,
            Source = message.Source,
            Account = message.Account,
            Sender = message.Sender,
            Text = MessageTextSanitizer.ReplaceLinksForSpeech(message.Text),
            Date = message.Date,
            ReceivedAt = message.Date,
            IsRead = isRead
        };
    }

    private static MessageDto? FindMatchingMessage(IEnumerable<MessageDto> firebaseMessages, WhatsAppIncomingMessageDto whatsAppMessage)
    {
        return firebaseMessages.FirstOrDefault(firebaseMessage =>
            firebaseMessage.ChatId == whatsAppMessage.ChatId &&
            ((!string.IsNullOrWhiteSpace(whatsAppMessage.Id) && firebaseMessage.ExternalMessageId == whatsAppMessage.Id) ||
             (firebaseMessage.Text == whatsAppMessage.Text && Math.Abs((firebaseMessage.Date - whatsAppMessage.Date).TotalSeconds) <= 2)));
    }

    private static string CreateLogPreview(string text)
    {
        if (text.Length <= 120)
            return text;

        return text[..120] + "...";
    }
}
