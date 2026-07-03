using AlexaSkillWhatsApp.Configuration;
using AlexaSkillWhatsApp.Models;
using AlexaSkillWhatsApp.Services;
using Amazon.Lambda.Core;
using System.Text.Json;

// Assembly attribute to enable the Lambda function's JSON input to be converted into a .NET class.
[assembly: LambdaSerializer(typeof(Amazon.Lambda.Serialization.SystemTextJson.DefaultLambdaJsonSerializer))]

namespace AlexaSkillWhatsApp;

public class Function
{
    public static async Task<string> FunctionHandler(JsonElement input, ILambdaContext context)
    {
        // context.Logger.LogLine(input.ToString());
        // context.Logger.LogLine(input.GetRawText());

        var request = JsonSerializer.Deserialize<AlexaRequest>(input.GetRawText())!;

        // context.Logger.LogLine($"Tipo: {request.Request.Type}");
        context.Logger.LogLine($"Intent: {request.Request.Intent?.Name}");
        // context.Logger.LogLine(input.GetRawText());

        if (request == null)
        {
            return Helpers.AlexaResponseFactory.Speak("Ocurrió un error.");
        }

        var user = LambdaUserConfiguration.GetUser();

        if (user == null)
        {
            try
            {
                user = await new AlexaCustomerProfileService().GetUserAsync(request);
            }
            catch (AlexaProfilePermissionException)
            {
                return Helpers.AlexaResponseFactory.AskForPhonePermission();
            }
            catch (Exception ex)
            {
                context.Logger.LogError($"No se pudo obtener el perfil de Alexa: {ex}");
                return Helpers.AlexaResponseFactory.Speak(
                    "No pude obtener el teléfono de tu perfil de Alexa. Revisa que tengas un número móvil configurado.");
            }
        }

        AlexaRequestRouter router = new AlexaRequestRouter(context, user);

        return await router.Process(request);
    }
}
