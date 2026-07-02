using AlexaSkillWhatsApp.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading.Tasks;

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
        return await _firebase.GetPendingMessagesAsync();
    }

    public string ReadMessage(List<MessageDto> messages, int index)
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

        //Console.WriteLine(message.Text);
        //Console.WriteLine(message);

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
    public async Task SaveReplyAsync(string messageId, string sender, string account, string text)
    {
        await _firebase.SaveReplyAsync(messageId, sender, account, text);
    }
    public async Task MarkAsReadAsync(string messageId)
    {

        // if (message.IsRead)             return;

        await _firebase.MarkAsReadAsync(messageId);

    }
}

