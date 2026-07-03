using Shared.Models;

namespace AlexaSkillWhatsApp.Services;

public class ConversationService
{
    private readonly FirebaseService _firebase = new();

    public async Task<int> GetPendingMessagesCountAsync()
    {
        var messages = await _firebase.GetPendingMessagesAsync();

        return messages.Count;
    }
    public async Task<List<MessageDto>> GetPendingMessagesAsync()
    {
        var messages = await _firebase.GetPendingMessagesAsync();

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
            $"{message.Sender} dice. " +
            $"{message.Text}. " +
            "Puedes decir siguiente, responder, repetir o terminar.";
    }

    public async Task<string> ReadFirstMessageAsync()
    {
        var messages = await _firebase.GetPendingMessagesAsync();

        if (!messages.Any())
            return "No tienes mensajes nuevos.";

        var message = messages.First();

        return
            $"Mensaje 1 de {messages.Count}. " +
            $"{message.Sender} dice. " +
            $"{message.Text}. " +
            "Puedes decir siguiente, responder, repetir o terminar.";
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
    public async Task MarkAsReadAsync(string messageId)
    {

        // if (message.IsRead)             return;

        await _firebase.MarkAsReadAsync(messageId);

    }
    public async Task<string> ReadConversationSummaryAsync()
    {
        var messages = await _firebase.GetPendingMessagesAsync();

        if (!messages.Any())
            return "No tienes mensajes nuevos.";

        var conversations = messages.GroupBy(m => m.ChatId)
            .Select(g => new
            {
                Sender = g.First().Sender,
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
        var messages = await _firebase.GetPendingMessagesAsync();

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

        var text = $"Tienes {conversationMessages.Count} mensajes de {firstMessage.Sender}. ";

        foreach (var message in conversationMessages)
        {
            text += $"{message.Text}. ";
        }

        text += "Puedes decir responder, siguiente, repetir o terminar.";

        return text;
    }
}

