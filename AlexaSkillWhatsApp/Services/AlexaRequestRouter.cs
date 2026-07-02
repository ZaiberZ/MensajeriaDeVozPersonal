using AlexaSkillWhatsApp.Helpers;
using AlexaSkillWhatsApp.Models;
using Amazon.Lambda.Core;
using System.Text;
using System.Text.Json;

namespace AlexaSkillWhatsApp.Services;

public class AlexaRequestRouter
{
    private readonly ConversationService conversation = new ConversationService();
    private ILambdaContext context;

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


        return AlexaResponseFactory.Speak(

            $"Bienvenido. " +
            $"Tienes {await conversation.GetPendingMessagesCountAsync()} mensajes nuevos. " +
            $"Di leer mensajes para comenzar.");
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

        var messages = await conversation.GetPendingMessagesAsync();

        if (!messages.Any())
            return AlexaResponseFactory.Speak("No tienes mensajes nuevos.");

        state.CurrentMessageIndex = 0;
        state.CurrentMessageId = messages[0].Id;
        state.CurrentSender = messages[0].Sender;
        state.CurrentAccount = messages[state.CurrentMessageIndex].Account;
        state.CurrentSource = messages[state.CurrentMessageIndex].Source;

        if (!messages[state.CurrentMessageIndex].IsRead)
        {
            await conversation.MarkAsReadAsync(state.CurrentMessageId);
        }

        return AlexaResponseFactory.Speak(conversation.ReadMessage(messages, 0), state);
    }

    private async Task<string> NextMessage(AlexaRequest request)
    {
        /// context.Logger.LogLine(request.Session.Attributes == null ? "Sin SessionAttributes" : JsonSerializer.Serialize(request.Session.Attributes));

        var state = ConversationState.FromSession(request.Session?.Attributes);

        // context.Logger.LogLine($"CurrentMessageIndex: {state.CurrentMessageIndex}");
        state.CurrentMessageIndex++;

        var messages = await conversation.GetPendingMessagesAsync();

        if (state.CurrentMessageIndex >= messages.Count)
        {
            state.CurrentMessageIndex = messages.Count - 1;

            return AlexaResponseFactory.Speak("Ya no hay más mensajes.", state);
        }

        var message = conversation.ReadMessage(messages, state.CurrentMessageIndex);

        state.CurrentMessageId = messages[state.CurrentMessageIndex].Id;
        state.CurrentSender = messages[state.CurrentMessageIndex].Sender;
        state.CurrentSource = messages[state.CurrentMessageIndex].Source;

        await conversation.MarkAsReadAsync(state.CurrentMessageId);

        return AlexaResponseFactory.Speak(message, state);
    }

    private string Reply(AlexaRequest request)
    {
        var state = ConversationState.FromSession(request.Session?.Attributes);

        state.WaitingForReply = true;

        return AlexaResponseFactory.Speak("¿Qué deseas responder?", state);
    }
    private async Task<string> RepeatMessage(AlexaRequest request)
    {
        var state = ConversationState.FromSession(request.Session?.Attributes);

        var messages = await conversation.GetPendingMessagesAsync();

        if (!messages.Any())
            return AlexaResponseFactory.Speak("No tienes mensajes nuevos.");

        if (state.CurrentMessageIndex < 0 || state.CurrentMessageIndex >= messages.Count)
        {
            state.CurrentMessageIndex = 0;
        }
        if (!messages[state.CurrentMessageIndex].IsRead)
        {
            await conversation.MarkAsReadAsync(state.CurrentMessageId);
        }
        var message = conversation.ReadMessage(messages, state.CurrentMessageIndex);

        return AlexaResponseFactory.Speak(message, state);
    }
    private string SaveReply(AlexaRequest request)
    {
        var state = ConversationState.FromSession(request.Session.Attributes);

        var slot = request.Request.Intent.Slots["respuesta"];

        // context.Logger.LogLine($"Slots: " + JsonSerializer.Serialize(request.Request.Intent.Slots));

        state.ReplyText = slot.Value;

        state.WaitingForReply = false;

        return AlexaResponseFactory.Speak($"Entendí. {state.ReplyText}. ¿Deseas enviarlo?", state);
    }

    private string CancelReply()
    {
        return AlexaResponseFactory.Speak("Se canceló la respuesta.");
    }

    private async Task<string> ConfirmReply(AlexaRequest request)
    {
        var state = ConversationState.FromSession(request.Session?.Attributes);

        context.Logger.LogLine($"state: " + JsonSerializer.Serialize(state));

        await conversation.SaveReplyAsync(state.CurrentMessageId, state.CurrentSender, state.CurrentAccount, state.CurrentSource, state.ReplyText);

        return AlexaResponseFactory.Speak("Perfecto. Tu respuesta fue guardada y será enviada.");
    }

    private async Task<string> ReadLastMessages(AlexaRequest request)
    {
        int cantidad = 5;

        if (request.Request.Intent.Slots.TryGetValue("cantidad", out var slot))
        {
            int.TryParse(slot.Value, out cantidad);
        }

        cantidad = Math.Clamp(cantidad, 1, 5);

        var messages = await conversation.GetLastMessagesAsync(cantidad);

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