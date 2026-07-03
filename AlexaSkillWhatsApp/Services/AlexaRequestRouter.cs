using AlexaSkillWhatsApp.Helpers;
using AlexaSkillWhatsApp.Models;
using Amazon.Lambda.Core;
using System.Text;
using System.Text.Json;

namespace AlexaSkillWhatsApp.Services;

public class AlexaRequestRouter
{
    private readonly ConversationService _conversation = new ConversationService();
    private readonly ILambdaContext context;

    public AlexaRequestRouter(ILambdaContext context)
    {
        this.context = context;
    }

    public async Task<string> Process(AlexaRequest request)
    {
        return request.Request.Type switch
        {
            "LaunchRequest" => await Launch(),
            "IntentRequest" => await Intent(request),
            _ => AlexaResponseFactory.Speak("No pude entender la solicitud.")
        };
    }

    private async Task<string> Launch()
    {
        // return AlexaResponseFactory.Speak("Bienvenido al Hub de Mensajería. ¿Qué deseas hacer?");
        var text = await _conversation.ReadConversationSummaryAsync();

        return AlexaResponseFactory.Speak($"Bienvenido. {text}");

        //return AlexaResponseFactory.Speak(

        //    $"Bienvenido. " +
        //    $"Tienes {await _conversation.GetPendingMessagesCountAsync()} mensajes nuevos. " +
        //    $"Di leer mensajes para comenzar.");
    }

    private async Task<string> Intent(AlexaRequest request)
    {
        return (request.Request.Intent?.Name) switch
        {
            "LeerMensajesIntent" => await ReadMessages(),
            "SiguienteMensajeIntent" => await NextMessage(request),
            "RepetirMensajeIntent" => await RepeatMessage(request),
            "LeerUltimosMensajesIntent" => await ReadLastMessages(request),
            "ResponderMensajeIntent" => Reply(request),
            "DictadoRespuestaIntent" => SaveReply(request),
            "ConfirmarIntent" => await ConfirmReply(request),
            "CancelarRespuestaIntent" => CancelReply(),
            "AMAZON.HelpIntent" => AlexaResponseFactory.Speak("Puedes decir leer mensajes o responder."),
            "AMAZON.StopIntent" or "AMAZON.CancelIntent" => AlexaResponseFactory.EndConversation("Hasta luego."),
            _ => AlexaResponseFactory.Speak("No entendí ese comando.")
        };
    }

    private async Task<string> ReadMessages()
    {
        var state = new ConversationState();

        var messages = await _conversation.GetPendingMessagesAsync();

        if (!messages.Any())
            return AlexaResponseFactory.Speak("No tienes mensajes nuevos.");

        var currentMessage = messages[0];
        var conversationMessages = messages.TakeWhile(m => m.ChatId == currentMessage.ChatId).ToList();
        var lastMessage = conversationMessages.Last();

        state.CurrentMessageIndex = 0;
        state.CurrentMessageId = lastMessage.Id;
        state.CurrentChatId = lastMessage.ChatId;
        state.CurrentPhone = lastMessage.Phone;
        state.CurrentSender = lastMessage.Sender;
        state.CurrentAccount = lastMessage.Account;
        state.CurrentSource = lastMessage.Source;

        var response = ConversationService.ReadConversationMessages(messages, state.CurrentMessageIndex);

        foreach (var message in conversationMessages)
        {
            if (!message.IsRead)
            {
                await _conversation.MarkAsReadAsync(message.Id);
            }
        }

        return AlexaResponseFactory.Speak(response, state);
    }

    private async Task<string> NextMessage(AlexaRequest request)
    {
        var state = ConversationState.FromSession(request.Session?.Attributes);
        var messages = await _conversation.GetPendingMessagesAsync();

        if (!messages.Any())
            return AlexaResponseFactory.Speak("No tienes mensajes nuevos.", state);

        if (state.CurrentMessageIndex >= messages.Count)
            state.CurrentMessageIndex = 0;

        var currentChatId = messages[state.CurrentMessageIndex].ChatId;

        var nextIndex = messages.FindIndex(state.CurrentMessageIndex + 1, m => m.ChatId != currentChatId);

        if (nextIndex == -1)
        {
            return AlexaResponseFactory.Speak("Ya no hay más conversaciones.", state);
        }

        state.CurrentMessageIndex = nextIndex;

        var currentMessage = messages[state.CurrentMessageIndex];

        var conversationMessages = messages.Skip(state.CurrentMessageIndex).TakeWhile(m => m.ChatId == currentMessage.ChatId).ToList();

        var lastMessage = conversationMessages.Last();

        state.CurrentMessageId = lastMessage.Id;
        state.CurrentChatId = lastMessage.ChatId;
        state.CurrentPhone = lastMessage.Phone;
        state.CurrentSender = lastMessage.Sender;
        state.CurrentAccount = lastMessage.Account;
        state.CurrentSource = lastMessage.Source;

        var response = ConversationService.ReadConversationMessages(messages, state.CurrentMessageIndex);

        foreach (var message in conversationMessages)
        {
            if (!message.IsRead)
            {
                await _conversation.MarkAsReadAsync(message.Id);
            }
        }

        return AlexaResponseFactory.Speak(response, state);
    }

    private static string Reply(AlexaRequest request)
    {
        var state = ConversationState.FromSession(request.Session?.Attributes);

        state.WaitingForReply = true;

        return AlexaResponseFactory.Speak("¿Qué deseas responder?", state);
    }
    private async Task<string> RepeatMessage(AlexaRequest request)
    {
        var state = ConversationState.FromSession(request.Session?.Attributes);

        var messages = await _conversation.GetPendingMessagesAsync();

        if (!messages.Any())
            return AlexaResponseFactory.Speak("No tienes mensajes nuevos.", state);

        if (state.CurrentMessageIndex < 0 || state.CurrentMessageIndex >= messages.Count)
            state.CurrentMessageIndex = 0;

        var currentMessage = messages[state.CurrentMessageIndex];

        var conversationMessages = messages.Skip(state.CurrentMessageIndex).TakeWhile(m => m.ChatId == currentMessage.ChatId).ToList();

        var lastMessage = conversationMessages.Last();

        state.CurrentMessageId = lastMessage.Id;
        state.CurrentChatId = lastMessage.ChatId;
        state.CurrentPhone = lastMessage.Phone;
        state.CurrentSender = lastMessage.Sender;
        state.CurrentAccount = lastMessage.Account;
        state.CurrentSource = lastMessage.Source;

        foreach (var message in conversationMessages)
        {
            if (!message.IsRead)
            {
                await _conversation.MarkAsReadAsync(message.Id);
            }
        }

        var response = ConversationService.ReadConversationMessages(messages, state.CurrentMessageIndex);

        return AlexaResponseFactory.Speak(response, state);
    }
    private static string SaveReply(AlexaRequest request)
    {
        var state = ConversationState.FromSession(request.Session!.Attributes);

        var slot = request.Request.Intent!.Slots!["respuesta"];

        // context.Logger.LogLine($"Slots: " + JsonSerializer.Serialize(request.Request.Intent.Slots));

        state.ReplyText = slot.Value;

        state.WaitingForReply = false;

        return AlexaResponseFactory.Speak($"Entendí. {state.ReplyText}. ¿Deseas enviarlo?", state);
    }

    private static string CancelReply()
    {
        return AlexaResponseFactory.Speak("Se canceló la respuesta.");
    }

    private async Task<string> ConfirmReply(AlexaRequest request)
    {
        var state = ConversationState.FromSession(request.Session?.Attributes);

        context.Logger.LogLine("state: " + JsonSerializer.Serialize(state));

        await _conversation.SaveReplyAsync(
            state.CurrentMessageId,
            state.CurrentChatId,
            state.CurrentPhone,
            state.CurrentSender,
            state.CurrentAccount,
            state.CurrentSource,
            state.ReplyText
        );

        return AlexaResponseFactory.Speak("Perfecto. Tu respuesta fue guardada y será enviada.");
    }

    private async Task<string> ReadLastMessages(AlexaRequest request)
    {
        int cantidad = 5;

        if (request.Request.Intent!.Slots!.TryGetValue("cantidad", out var slot))
        {
            int.TryParse(slot.Value, out cantidad);
        }

        cantidad = Math.Clamp(cantidad, 1, 5);

        var messages = await _conversation.GetLastMessagesAsync(cantidad);

        if (!messages.Any())
            return AlexaResponseFactory.Speak("No tienes mensajes.");

        StringBuilder sb = new();

        sb.Append($"Estos son los últimos {messages.Count} mensajes. ");

        int index = 1;

        foreach (var message in messages)
        {
            sb.Append(
                $"Mensaje {index}. " +
                $"{message.Sender} dice. " +
                $"{message.Text}. ");

            index++;
        }

        return AlexaResponseFactory.Speak(sb.ToString());
    }
}