using AlexaSkillWhatsApp.Configuration;
using AlexaSkillWhatsApp.Models;
using AlexaSkillWhatsApp.Services;
using Amazon.Lambda.Core;
using Shared.Models;
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

        var alexaUserId = request.Session?.User.UserId ?? "";
        var phoneService = new AlexaUserPhoneService();
        var registrationHandler = new AlexaPhoneRegistrationHandler(phoneService);
        var registrationResponse = await registrationHandler.TryHandleAsync(request);

        if (registrationResponse != null)
            return registrationResponse;

        UserDto? user = null;
        var savedPhone = await phoneService.GetPhoneAsync(alexaUserId);

        if (!string.IsNullOrWhiteSpace(savedPhone))
        {
            user = new UserDto
            {
                Phone = savedPhone,
                IsRegistered = true
            };
        }

        user ??= LambdaUserConfiguration.GetUser();

        if (user == null)
            return Helpers.AlexaResponseFactory.Speak(
                "Aún no tienes un teléfono configurado. Di configurar teléfono seguido de tu número completo.");

        AlexaRequestRouter router = new AlexaRequestRouter(context, user);

        return await router.Process(request);
    }
}
