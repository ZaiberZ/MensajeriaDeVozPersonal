using AlexaSkillWhatsApp.Helpers;
using AlexaSkillWhatsApp.Models;

namespace AlexaSkillWhatsApp.Services;

public class AlexaRequestRouter
{
    private readonly ConversationService conversation = new ConversationService();
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
            "AMAZON.HelpIntent" => AlexaResponseFactory.Speak("Puedes decir leer mensajes o responder mensaje."),
            "AMAZON.StopIntent" or "AMAZON.CancelIntent" => AlexaResponseFactory.EndConversation("Hasta luego."),
            _ => AlexaResponseFactory.Speak("No entendí ese comando."),
        };
    }

    private async Task<string> ReadMessages()
    {
        // return AlexaResponseFactory.Speak("Todavía no tienes mensajes.");
        var conversation = new ConversationService();

        return AlexaResponseFactory.Speak(await conversation.ReadFirstMessageAsync());
    }
}