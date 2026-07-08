using AlexaSkillWhatsApp.Helpers;
using AlexaSkillWhatsApp.Models;
using Amazon.Lambda.Core;
using Shared.Models;
using System.Globalization;
using System.Text;
using System.Text.Json;

namespace AlexaSkillWhatsApp.Services;

public class AlexaRequestRouter
{
    private readonly ConversationService _conversation;
    private readonly ILambdaContext context;
    private readonly UserDto _user;

    public AlexaRequestRouter(ILambdaContext context, UserDto user)
    {
        this.context = context;
        _user = user;
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

        if (state.WaitingForContactConfirmation && intentName is not "ConfirmarIntent" and not "CancelarRespuestaIntent" and not "AMAZON.StopIntent" and not "AMAZON.CancelIntent")
            return AlexaResponseFactory.Speak($"Di sí si {state.SelectedContactName} es el contacto al que quieres escribir, o no para cancelarlo.", state);

        if (state.WaitingForContactMessage && intentName is not "ResponderMensajeIntent" and not "DictadoRespuestaIntent" and not "CancelarRespuestaIntent" and not "AMAZON.StopIntent" and not "AMAZON.CancelIntent")
            return AlexaResponseFactory.ElicitSlot("No pude entender el mensaje. Dímelo nuevamente.", "DictadoRespuestaIntent", "respuesta", state);

        if (state.WaitingForReply && intentName is not "ResponderMensajeIntent" and not "DictadoRespuestaIntent" and not "CancelarRespuestaIntent" and not "AMAZON.StopIntent" and not "AMAZON.CancelIntent")
            return AlexaResponseFactory.ElicitSlot("No pude entender la respuesta. Dímela nuevamente.", "ResponderMensajeIntent", "respuesta", state);

        if (state.WaitingForReplyConfirmation && intentName is not "ConfirmarIntent" and not "CancelarRespuestaIntent" and not "AMAZON.StopIntent" and not "AMAZON.CancelIntent")
            return AlexaResponseFactory.Speak("Di sí para enviar el mensaje o no para cancelarlo.", state);

        return intentName switch
        {
            "LeerMensajesIntent" => await ReadMessages(),
            "SiguienteMensajeIntent" => await NextMessage(request),
            "RepetirMensajeIntent" => RepeatMessage(request),
            "LeerUltimosMensajesIntent" => await ReadLastMessages(request),
            "WriteContactMessageIntent" => await BeginContactMessage(request),
            "ResponderMensajeIntent" => state.WaitingForContactMessage ? SaveText(request) : Reply(request),
            "DictadoRespuestaIntent" => SaveText(request),
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

        if (IsAirbnbSource(state.CurrentSource))
            return BlockAirbnbReply(state);

        state.WaitingForReply = true;
        state.WaitingForReplyConfirmation = false;
        state.ReplyText = "";

        if (TryGetReplyText(request, out var replyText))
            return SaveReply(state, replyText);

        return AlexaResponseFactory.ElicitSlot("¿Qué deseas responder?", "ResponderMensajeIntent", "respuesta", state);
    }
    private async Task<string> BeginContactMessage(AlexaRequest request)
    {
        if (!TryGetSlotValue(request, "ContactName", out var contactName))
            return AlexaResponseFactory.ElicitSlot("¿A qué contacto quieres escribirle?", "WriteContactMessageIntent", "ContactName", new ConversationState());

        var contacts = await _conversation.GetFrequentContactsAsync(_user.Phone);
        var contact = FindExactContact(contacts, contactName);

        if (contact != null)
            return AskForContactMessage(contact);

        contact = FindPartialContact(contacts, contactName);

        if (contact == null)
            return AlexaResponseFactory.Speak("No encontré ese contacto registrado. Primero agrégalo desde la interfaz del gateway.");

        var state = CreateSelectedContactState(contact);
        state.WaitingForContactConfirmation = true;

        return AlexaResponseFactory.Speak($"Encontré a {contact.Name}. ¿Es el contacto al que quieres escribir?", state);
    }

    private static string AskForContactMessage(ContactDto contact)
    {
        var state = CreateSelectedContactState(contact);
        state.WaitingForContactMessage = true;

        return AlexaResponseFactory.ElicitSlot($"¿Qué mensaje quieres enviarle a {contact.Name}?", "DictadoRespuestaIntent", "respuesta", state);
    }

    private static ConversationState CreateSelectedContactState(ContactDto contact)
    {
        return new ConversationState
        {
            SelectedContactName = contact.Name,
            SelectedContactChatId = contact.ChatId,
            SelectedContactPhone = contact.Phone,
            SelectedContactSource = string.IsNullOrWhiteSpace(contact.Source) ? "WhatsApp" : contact.Source
        };
    }

    private static ContactDto? FindExactContact(List<ContactDto> contacts, string contactName)
    {
        var normalizedName = NormalizeContactName(contactName);

        return contacts.FirstOrDefault(contact => NormalizeContactName(contact.Name) == normalizedName);
    }

    private static ContactDto? FindPartialContact(List<ContactDto> contacts, string contactName)
    {
        var normalizedName = NormalizeContactName(contactName);

        if (string.IsNullOrWhiteSpace(normalizedName))
            return null;

        return contacts.FirstOrDefault(contact =>
        {
            var normalizedContactName = NormalizeContactName(contact.Name);
            return normalizedContactName.Contains(normalizedName) ||
                normalizedName.Split(' ', StringSplitOptions.RemoveEmptyEntries).Any(word => normalizedContactName.Contains(word));
        });
    }

    private static string NormalizeContactName(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return "";

        var normalized = value.ToLowerInvariant().Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(normalized.Length);

        foreach (var character in normalized)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(character) != UnicodeCategory.NonSpacingMark)
                builder.Append(character);
        }

        return builder.ToString().Normalize(NormalizationForm.FormC).Trim();
    }

    private static string ConfirmContactCandidate(ConversationState state)
    {
        state.WaitingForContactConfirmation = false;
        state.WaitingForContactMessage = true;

        return AlexaResponseFactory.ElicitSlot($"¿Qué mensaje quieres enviarle a {state.SelectedContactName}?", "DictadoRespuestaIntent", "respuesta", state);
    }

    private static string CancelContactCandidate(ConversationState state)
    {
        ClearContactMessageState(state);
        return AlexaResponseFactory.Speak("De acuerdo. Se canceló el mensaje.", state);
    }

    private static string RepeatMessage(AlexaRequest request)
    {
        var state = ConversationState.FromSession(request.Session?.Attributes);

        if (string.IsNullOrWhiteSpace(state.CurrentConversationSpeech))
            return AlexaResponseFactory.Speak("Primero di leer mensajes para tener una conversación que repetir.", state);

        return AlexaResponseFactory.Speak(state.CurrentConversationSpeech, state);
    }
    private static string SaveText(AlexaRequest request)
    {
        var state = ConversationState.FromSession(request.Session?.Attributes);

        if (state.WaitingForContactMessage)
            return SaveContactMessage(request, state);

        if (!state.WaitingForReply)
        {
            return AlexaResponseFactory.Speak(
                "Primero di responder para iniciar una respuesta.", state);
        }

        if (IsAirbnbSource(state.CurrentSource))
            return BlockAirbnbReply(state);

        if (!TryGetReplyText(request, out var replyText))
        {
            return AlexaResponseFactory.ElicitSlot("No pude entender la respuesta. Dímela nuevamente.", "ResponderMensajeIntent", "respuesta", state);
        }

        return SaveReply(state, replyText);
    }

    private static string SaveContactMessage(AlexaRequest request, ConversationState state)
    {
        if (!TryGetReplyText(request, out var text))
        {
            return AlexaResponseFactory.ElicitSlot("No pude entender el mensaje. Dímelo nuevamente.", "DictadoRespuestaIntent", "respuesta", state);
        }

        state.PendingText = text;
        state.ReplyText = text;
        state.WaitingForContactMessage = false;
        state.WaitingForReplyConfirmation = true;

        return AlexaResponseFactory.Speak($"Quieres enviar a {state.SelectedContactName}: {state.PendingText}?", state);
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
        return TryGetSlotValue(request, "respuesta", out replyText);
    }

    private static bool TryGetSlotValue(AlexaRequest request, string slotName, out string value)
    {
        value = "";

        if (request.Request.Intent?.Slots == null ||
            !request.Request.Intent.Slots.TryGetValue(slotName, out var slot) ||
            string.IsNullOrWhiteSpace(slot.Value))
        {
            return false;
        }

        value = slot.Value.Trim();
        return true;
    }

    private static bool HasActiveConversation(ConversationState state)
    {
        return !string.IsNullOrWhiteSpace(state.CurrentMessageId) &&
            !string.IsNullOrWhiteSpace(state.CurrentChatId) &&
            (!string.IsNullOrWhiteSpace(state.CurrentPhone) || SupportsReplyWithoutPhone(state.CurrentSource));
    }

    private static bool SupportsReplyWithoutPhone(string source)
    {
        return string.Equals(source, "Airbnb", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(source, "AirbnbEmail", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsAirbnbSource(string source)
    {
        return string.Equals(source, "Airbnb", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(source, "AirbnbEmail", StringComparison.OrdinalIgnoreCase);
    }

    private static string BlockAirbnbReply(ConversationState state)
    {
        state.WaitingForReply = false;
        state.WaitingForReplyConfirmation = false;
        state.ReplyText = "";

        return AlexaResponseFactory.Speak("Por ahora solo puedo leer mensajes de Airbnb. No puedo responderlos desde Alexa.", state);
    }

    private static string CancelReply(AlexaRequest request)
    {
        var state = ConversationState.FromSession(request.Session?.Attributes);

        if (state.WaitingForContactConfirmation)
            return CancelContactCandidate(state);

        state.WaitingForReply = false;
        state.WaitingForReplyConfirmation = false;
        state.ReplyText = "";
        ClearContactMessageState(state);

        return AlexaResponseFactory.Speak("Se canceló el mensaje.", state);
    }

    private async Task<string> ConfirmReply(AlexaRequest request)
    {
        var state = ConversationState.FromSession(request.Session?.Attributes);

        context.Logger.LogLine("state: " + JsonSerializer.Serialize(state));

        if (state.WaitingForContactConfirmation)
            return ConfirmContactCandidate(state);

        if (HasPendingContactMessage(state))
            return await ConfirmContactMessage(state);

        if (!state.WaitingForReplyConfirmation || string.IsNullOrWhiteSpace(state.ReplyText))
        {
            context.Logger.LogLine("No se guardó la respuesta porque no existe una confirmación de respuesta pendiente.");

            return AlexaResponseFactory.Speak(
                "No hay una respuesta pendiente por enviar. Primero di responder.", state);
        }

        if (IsAirbnbSource(state.CurrentSource))
        {
            context.Logger.LogLine("No se guardó la respuesta porque los mensajes de Airbnb no se pueden responder desde Alexa.");
            return BlockAirbnbReply(state);
        }

        if (string.IsNullOrWhiteSpace(state.CurrentPhone) && !SupportsReplyWithoutPhone(state.CurrentSource))
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

    private async Task<string> ConfirmContactMessage(ConversationState state)
    {
        if (string.IsNullOrWhiteSpace(state.SelectedContactPhone) && string.Equals(state.SelectedContactSource, "WhatsApp", StringComparison.OrdinalIgnoreCase))
            return AlexaResponseFactory.Speak("No pude guardar el mensaje porque el contacto no tiene teléfono. Actualízalo desde la interfaz del gateway.");

        await _conversation.SaveReplyAsync(
            "",
            state.SelectedContactChatId,
            state.SelectedContactPhone,
            state.SelectedContactName,
            "Personal",
            string.IsNullOrWhiteSpace(state.SelectedContactSource) ? "WhatsApp" : state.SelectedContactSource,
            state.PendingText
        );

        ClearContactMessageState(state);
        state.WaitingForReplyConfirmation = false;
        state.ReplyText = "";

        return AlexaResponseFactory.Speak("Perfecto. Tu mensaje fue guardado y será enviado.", state);
    }

    private static bool HasPendingContactMessage(ConversationState state)
    {
        return state.WaitingForReplyConfirmation &&
            !string.IsNullOrWhiteSpace(state.PendingText) &&
            !string.IsNullOrWhiteSpace(state.SelectedContactChatId);
    }

    private static void ClearContactMessageState(ConversationState state)
    {
        state.WaitingForContactMessage = false;
        state.SelectedContactName = "";
        state.SelectedContactChatId = "";
        state.SelectedContactSource = "";
        state.SelectedContactPhone = "";
        state.PendingText = "";
        state.WaitingForContactConfirmation = false;
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
                $"{ConversationService.GetMessageIntro(message)}. " +
                $"{MessageTextSanitizer.ReplaceLinksForSpeech(message.Text)}. ");

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
