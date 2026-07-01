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
}

