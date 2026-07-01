using AlexaSkillWhatsApp.Helpers;
using AlexaSkillWhatsApp.Models;
using Amazon.Lambda.Core;
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
            "HelloWorldIntent" => AlexaResponseFactory.Speak("Hola desde el Hub de Mensajería."),
            "LeerMensajesIntent" => await ReadMessages(),
            "ResponderMensajeIntent" => AlexaResponseFactory.Speak("¿Qué deseas responder?"),
            "SiguienteMensajeIntent" => await NextMessage(request),
            "AMAZON.HelpIntent" => AlexaResponseFactory.Speak("Puedes decir leer mensajes o responder mensaje."),
            "AMAZON.StopIntent" or "AMAZON.CancelIntent" => AlexaResponseFactory.EndConversation("Hasta luego."),
            _ => AlexaResponseFactory.Speak("No entendí ese comando."),
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

        return AlexaResponseFactory.Speak(conversation.ReadMessage(messages, 0), state);
    }

    private async Task<string> NextMessage(AlexaRequest request)
    {
        context.Logger.LogLine(request.Session.Attributes == null ? "Sin SessionAttributes" : JsonSerializer.Serialize(request.Session.Attributes));

        var state = ConversationState.FromSession(request.Session?.Attributes);

        context.Logger.LogLine($"CurrentMessageIndex: {state.CurrentMessageIndex}");
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

        return AlexaResponseFactory.Speak(message, state);
    }
}