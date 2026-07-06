using AlexaSkillWhatsApp.Helpers;
using AlexaSkillWhatsApp.Models;
using Amazon.Lambda.Core;
using Shared.Models;
using System.Text;
using System.Text.Json;

namespace AlexaSkillWhatsApp.Services;

public class AlexaRequestRouter
{
    private readonly ConversationService _conversation;
    private readonly ILambdaContext context;

    public AlexaRequestRouter(ILambdaContext context, UserDto user)
    {
        this.context = context;
        _conversation = new ConversationService(user);
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
        var intentName = request.Request.Intent?.Name;
        var state = ConversationState.FromSession(request.Session?.Attributes);

        if (state.WaitingForReply && intentName is not "ResponderMensajeIntent" and not "DictadoRespuestaIntent" and not "CancelarRespuestaIntent" and not "AMAZON.StopIntent" and not "AMAZON.CancelIntent")
            return AlexaResponseFactory.ElicitSlot("No pude entender la respuesta. Dímela nuevamente.", "ResponderMensajeIntent", "respuesta", state);

        if (state.WaitingForReplyConfirmation && intentName is not "ConfirmarIntent" and not "CancelarRespuestaIntent" and not "AMAZON.StopIntent" and not "AMAZON.CancelIntent")
            return AlexaResponseFactory.Speak("Di sí para enviar la respuesta o no para cancelarla.", state);

        return intentName switch
        {
            "LeerMensajesIntent" => await ReadMessages(),
            "SiguienteMensajeIntent" => await NextMessage(request),
            "RepetirMensajeIntent" => RepeatMessage(request),
            "LeerUltimosMensajesIntent" => await ReadLastMessages(request),
            "ResponderMensajeIntent" => Reply(request),
            "DictadoRespuestaIntent" => SaveReply(request),
            "ConfirmarIntent" => await ConfirmReply(request),
            "CancelarRespuestaIntent" => CancelReply(request),
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
        state.CurrentConversationSpeech = response;

        await MarkConversationAsReadAsync(messages, conversationMessages);

        return AlexaResponseFactory.Speak(response, state);
    }

    private async Task<string> NextMessage(AlexaRequest request)
    {
        var state = ConversationState.FromSession(request.Session?.Attributes);
        var messages = await _conversation.GetPendingMessagesAsync();

        if (!messages.Any())
            return AlexaResponseFactory.Speak("Ya no hay más conversaciones.", state);

        state.CurrentMessageIndex = 0;

        var currentMessage = messages[0];

        var conversationMessages = messages.TakeWhile(m => m.ChatId == currentMessage.ChatId).ToList();

        var lastMessage = conversationMessages.Last();

        state.CurrentMessageId = lastMessage.Id;
        state.CurrentChatId = lastMessage.ChatId;
        state.CurrentPhone = lastMessage.Phone;
        state.CurrentSender = lastMessage.Sender;
        state.CurrentAccount = lastMessage.Account;
        state.CurrentSource = lastMessage.Source;

        var response = ConversationService.ReadConversationMessages(messages, state.CurrentMessageIndex);
        state.CurrentConversationSpeech = response;

        await MarkConversationAsReadAsync(messages, conversationMessages);

        return AlexaResponseFactory.Speak(response, state);
    }

    private static string Reply(AlexaRequest request)
    {
        var state = ConversationState.FromSession(request.Session?.Attributes);

        if (!HasActiveConversation(state))
        {
            state.WaitingForReply = false;
            state.WaitingForReplyConfirmation = false;
            state.ReplyText = "";

            return AlexaResponseFactory.Speak("Primero lee una conversación para poder responder.", state);
        }

        state.WaitingForReply = true;
        state.WaitingForReplyConfirmation = false;
        state.ReplyText = "";

        if (TryGetReplyText(request, out var replyText))
            return SaveReply(state, replyText);

        return AlexaResponseFactory.ElicitSlot("¿Qué deseas responder?", "ResponderMensajeIntent", "respuesta", state);
    }
    private static string RepeatMessage(AlexaRequest request)
    {
        var state = ConversationState.FromSession(request.Session?.Attributes);

        if (string.IsNullOrWhiteSpace(state.CurrentConversationSpeech))
            return AlexaResponseFactory.Speak("Primero di leer mensajes para tener una conversación que repetir.", state);

        return AlexaResponseFactory.Speak(state.CurrentConversationSpeech, state);
    }
    private static string SaveReply(AlexaRequest request)
    {
        var state = ConversationState.FromSession(request.Session?.Attributes);

        if (!state.WaitingForReply)
        {
            return AlexaResponseFactory.Speak(
                "Primero di responder para iniciar una respuesta.", state);
        }

        if (!TryGetReplyText(request, out var replyText))
        {
            return AlexaResponseFactory.ElicitSlot("No pude entender la respuesta. Dímela nuevamente.", "ResponderMensajeIntent", "respuesta", state);
        }

        return SaveReply(state, replyText);
    }

    private static string SaveReply(ConversationState state, string replyText)
    {
        state.ReplyText = replyText;

        state.WaitingForReply = false;
        state.WaitingForReplyConfirmation = true;

        return AlexaResponseFactory.Speak($"Entendí. {state.ReplyText}. ¿Deseas enviarlo?", state);
    }

    private static bool TryGetReplyText(AlexaRequest request, out string replyText)
    {
        replyText = "";

        if (request.Request.Intent?.Slots == null ||
            !request.Request.Intent.Slots.TryGetValue("respuesta", out var slot) ||
            string.IsNullOrWhiteSpace(slot.Value))
        {
            return false;
        }

        replyText = slot.Value.Trim();
        return true;
    }

    private static bool HasActiveConversation(ConversationState state)
    {
        return !string.IsNullOrWhiteSpace(state.CurrentMessageId) &&
            !string.IsNullOrWhiteSpace(state.CurrentChatId) &&
            (!string.IsNullOrWhiteSpace(state.CurrentPhone) ||
             string.Equals(state.CurrentSource, "Airbnb", StringComparison.OrdinalIgnoreCase));
    }

    private static string CancelReply(AlexaRequest request)
    {
        var state = ConversationState.FromSession(request.Session?.Attributes);

        state.WaitingForReply = false;
        state.WaitingForReplyConfirmation = false;
        state.ReplyText = "";

        return AlexaResponseFactory.Speak("Se canceló la respuesta.", state);
    }

    private async Task<string> ConfirmReply(AlexaRequest request)
    {
        var state = ConversationState.FromSession(request.Session?.Attributes);

        context.Logger.LogLine("state: " + JsonSerializer.Serialize(state));

        if (!state.WaitingForReplyConfirmation || string.IsNullOrWhiteSpace(state.ReplyText))
        {
            context.Logger.LogLine("No se guardó la respuesta porque no existe una confirmación de respuesta pendiente.");

            return AlexaResponseFactory.Speak(
                "No hay una respuesta pendiente por enviar. Primero di responder.", state);
        }

        if (string.IsNullOrWhiteSpace(state.CurrentPhone) && !string.Equals(state.CurrentSource, "Airbnb", StringComparison.OrdinalIgnoreCase))
        {
            context.Logger.LogLine("No se guardó la respuesta porque el estado de la conversación no tiene destinatario.");

            return AlexaResponseFactory.Speak(
                "No pude guardar tu respuesta porque el mensaje no tiene destinatario. Lee nuevamente tus mensajes e inténtalo otra vez.");
        }

        await _conversation.SaveReplyAsync(
            state.CurrentMessageId,
            state.CurrentChatId,
            state.CurrentPhone,
            state.CurrentSender,
            state.CurrentAccount,
            state.CurrentSource,
            state.ReplyText
        );

        state.WaitingForReplyConfirmation = false;
        state.ReplyText = "";

        return AlexaResponseFactory.Speak("Perfecto. Tu respuesta fue guardada y será enviada.", state);
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

    private async Task MarkConversationAsReadAsync(List<MessageDto> allPendingMessages, List<MessageDto> conversationMessages)
    {
        foreach (var message in conversationMessages.Where(message => !message.IsRead))
        {
            await _conversation.MarkAsReadAsync(message.Id);
        }

        var readMessageIds = conversationMessages.Select(message => message.Id).ToHashSet();
        var hasOtherUnreadMessages = allPendingMessages.Any(message =>
            !message.IsRead && !readMessageIds.Contains(message.Id));

        if (!hasOtherUnreadMessages)
            await _conversation.SetHasPendingMessagesAsync(false);
    }
}
