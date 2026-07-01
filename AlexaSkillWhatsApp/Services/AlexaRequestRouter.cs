using AlexaSkillWhatsApp.Helpers;
using AlexaSkillWhatsApp.Models;

namespace AlexaSkillWhatsApp.Services;

public static class AlexaRequestRouter
{
    public static string Process(AlexaRequest request)
    {
        return request.Request.Type switch
        {
            "LaunchRequest" => Launch(),
            "IntentRequest" => Intent(request),
            _ => AlexaResponseFactory.Speak("No pude entender la solicitud.")
        };
    }

    private static string Launch()
    {
        return AlexaResponseFactory.Speak("Bienvenido al Hub de Mensajería. ¿Qué deseas hacer?");
    }

    private static string Intent(AlexaRequest request)
    {
        return (request.Request.Intent?.Name) switch
        {
            "HelloWorldIntent" => AlexaResponseFactory.Speak("Hola desde el Hub de Mensajería."),
            "LeerMensajesIntent" => AlexaResponseFactory.Speak("Todavía no tienes mensajes."),
            "ResponderMensajeIntent" => AlexaResponseFactory.Speak("¿Qué deseas responder?"),
            "AMAZON.HelpIntent" => AlexaResponseFactory.Speak("Puedes decir leer mensajes o responder mensaje."),
            "AMAZON.StopIntent" or "AMAZON.CancelIntent" => AlexaResponseFactory.EndConversation("Hasta luego."),
            _ => AlexaResponseFactory.Speak("No entendí ese comando."),
        };
    }
}