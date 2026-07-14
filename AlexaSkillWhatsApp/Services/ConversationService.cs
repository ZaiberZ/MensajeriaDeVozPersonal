using Shared.Models;

namespace AlexaSkillWhatsApp.Services;

public class ConversationService
{
    private const int MaxSpokenMessageLength = 1200;
    private const int MaxConversationSpeechLength = 6000;
    private readonly FirebaseService _firebase;

    public ConversationService(UserDto user)
    {
        _firebase = new FirebaseService(user);
    }

    public async Task<int> GetPendingMessagesCountAsync()
    {
        var messages = await GetPendingMessagesAsync();

        return messages.Count;
    }
    public async Task<List<MessageDto>> GetPendingMessagesAsync()
    {
        if (!await _firebase.HasPendingMessagesAsync())
            return [];

        var messages = await _firebase.GetPendingMessagesAsync();

        if (messages.Count == 0)
            await _firebase.SetHasPendingMessagesAsync(false);

        return messages.OrderBy(m => m.ChatId).ThenBy(m => m.Date).ToList();
    }

    public static string ReadMessage(List<MessageDto> messages, int index)
    {
        if (!messages.Any())
            return "No tienes mensajes nuevos.";

        if (index >= messages.Count)
            return "Ya no hay más mensajes.";

        var message = messages[index];

        return
            $"Mensaje {index + 1} de {messages.Count}. " +
            $"{GetMessageIntro(message)}. " +
            $"{PrepareMessageForSpeech(message.Text)}. " +
            GetNavigationPrompt(message);
    }

    public async Task<string> ReadFirstMessageAsync()
    {
        var messages = await GetPendingMessagesAsync();

        if (!messages.Any())
            return "No tienes mensajes nuevos.";

        var message = messages.First();

        return
            $"Mensaje 1 de {messages.Count}. " +
            $"{GetMessageIntro(message)}. " +
            $"{PrepareMessageForSpeech(message.Text)}. " +
            GetNavigationPrompt(message);
    }
    public async Task<List<MessageDto>> GetLastMessagesAsync(int count)
    {
        var messages = await GetPendingMessagesAsync();

        return messages.TakeLast(count).ToList();
    }
    public async Task SaveReplyAsync(string messageId, string chatId, string phone, string sender, string account, string currentSource, string text)
    {
        await _firebase.SaveReplyAsync(messageId, chatId, phone, sender, account, currentSource, text);
    }
    public Task<List<ContactDto>> GetFrequentContactsAsync(string phone)
    {
        return _firebase.GetFrequentContactsAsync(phone);
    }
    public Task<ContactDto?> FindFrequentContactByNameAsync(string phone, string contactName)
    {
        return _firebase.FindFrequentContactByNameAsync(phone, contactName);
    }
    public async Task MarkAsReadAsync(string messageId)
    {

        // if (message.IsRead)             return;

        await _firebase.MarkAsReadAsync(messageId);

    }
    public Task SetHasPendingMessagesAsync(bool value)
    {
        return _firebase.SetHasPendingMessagesAsync(value);
    }
    public async Task<string> ReadConversationSummaryAsync()
    {
        var messages = await GetPendingMessagesAsync();

        if (!messages.Any())
            return "No tienes mensajes nuevos.";

        var conversations = messages.GroupBy(m => m.ChatId)
            .Select(g => new
            {
                Sender = GetSpokenSender(g.First()),
                Count = g.Count()
            }).ToList();

        if (conversations.Count == 1)
        {
            var conversation = conversations.First();

            return $"Tienes {conversation.Count} mensajes de {conversation.Sender}. Puedes decir leer mensajes.";
        }

        var text = $"Tienes mensajes de {conversations.Count} conversaciones. ";

        foreach (var conversation in conversations)
        {
            text += $"{conversation.Count} de {conversation.Sender}. ";
        }

        text += "Puedes decir leer mensajes.";

        return text;
    }
    public async Task<List<MessageDto>> GetPendingMessagesGroupedAsync()
    {
        var messages = await GetPendingMessagesAsync();

        return messages.OrderBy(m => m.ChatId).ThenBy(m => m.Date).ToList();
    }
    public static string ReadConversationMessages(List<MessageDto> messages, int startIndex)
    {
        if (!messages.Any())
            return "No tienes mensajes nuevos.";

        if (startIndex >= messages.Count)
            return "Ya no hay más mensajes.";

        var firstMessage = messages[startIndex];

        var conversationMessages = messages.Skip(startIndex).TakeWhile(m => m.ChatId == firstMessage.ChatId).ToList();

        var text = IsAirbnbSource(firstMessage.Source)
            ? $"Tienes {conversationMessages.Count} mensajes. De Airbnb, {firstMessage.Sender} dice. "
            : $"Tienes {conversationMessages.Count} mensajes de {GetSpokenSender(firstMessage)}. ";

        foreach (var message in conversationMessages)
        {
            var spokenMessage = $"{PrepareMessageForSpeech(message.Text)}. ";

            if (text.Length + spokenMessage.Length > MaxConversationSpeechLength)
            {
                text += "El resto de la conversación se omitió por ser demasiado larga. ";
                break;
            }

            text += spokenMessage;
        }

        text += GetNavigationPrompt(firstMessage);

        return text;
    }

    public static string GetMessageIntro(MessageDto message)
    {
        if (IsAirbnbSource(message.Source))
            return $"De Airbnb, {message.Sender} dice";

        return $"{message.Sender} dice";
    }

    public static string GetSpokenSender(MessageDto message)
    {
        if (IsAirbnbSource(message.Source))
            return $"Airbnb de {message.Sender}";

        return message.Sender;
    }

    private static string PrepareMessageForSpeech(string? text)
    {
        return MessageTextSanitizer.ReplaceLinksForSpeech(text, MaxSpokenMessageLength);
    }

    private static bool IsAirbnbSource(string source)
    {
        return string.Equals(source, "Airbnb", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(source, "AirbnbEmail", StringComparison.OrdinalIgnoreCase);
    }

    private static string GetNavigationPrompt(MessageDto message)
    {
        return IsAirbnbSource(message.Source)
            ? "Puedes decir siguiente, repetir o terminar."
            : "Puedes decir siguiente, responder, repetir o terminar.";
    }
}

